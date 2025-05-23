import {
  OpenAI,
  PineconeVectorStore,
  VectorStoreIndex,
  Settings,
  OpenAIEmbedding,
  VectorIndexRetriever,
} from "llamaindex";
import { GetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { extractSqlLevel } from "../utils/levelExtractor.js";
const dynamoDbClient = new DynamoDBClient({
  region: "us-east-1",
});
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Function to remove patterns from text
function replacePatterns(text) {
  const signs = [
    "\\]\\*\\*\\*\\]",
    "\\[\\*\\*\\*\\]",
    "\\*\\*",
    "\\[\\*\\*:\\]",
    "\\[\\*\\*::\\]",
    "\\[\\*\\*\\.\\]",
    "\\[\\*\\*\\.\\.\\]",
  ];
  const regex = new RegExp(signs.join("|"), "g");
  return text.replace(regex, "");
}

// Helper function to configure Azure options
function getAzureEmbeddingOptions() {
  return {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    deployment: "text-embedding-3-small",
    apiKey: process.env.AZURE_OPENAI_KEY,
  };
}

// Initialize OpenAI settings based on assistant configuration
async function initializeSettings(config) {
  const { setEnvs } = await import("@llamaindex/env");
  setEnvs(process.env);
  Settings.llm = new OpenAI({
    azure: {
      apiKey: process.env.AZURE_OPENAI_KEY,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      deployment: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
      model: process.env.MODEL,
    },
    additionalChatOptions: {
      frequency_penalty: config.frequencyPenalty,
      presence_penalty: config.presencePenalty,
      stream: config.stream ? config.stream : undefined,
    },
    temperature: config.temperature,
    topP: config.topP,
  });
  Settings.embedModel = new OpenAIEmbedding({
    model: "text-embedding-3-small",
    azure: getAzureEmbeddingOptions(),
  });
}

// Create and return separate indices for chat messages and assistant documents
async function createIndices() {
  const pcvs_chat = new PineconeVectorStore({
    indexName: "chat-messages",
    chunkSize: process.env.CHUNK_SIZE,
    storesText: true,
    embeddingModel: new OpenAIEmbedding({
      model: "text-embedding-3-small",
      azure: getAzureEmbeddingOptions(),
    }),
  });

  const pcvs_assistant = new PineconeVectorStore({
    indexName: "assistant-documents",
    chunkSize: process.env.CHUNK_SIZE,
    storesText: true,
    embeddingModel: new OpenAIEmbedding({
      model: "text-embedding-3-small",
      azure: getAzureEmbeddingOptions(),
    }),
  });

  const index_chat_messages = await VectorStoreIndex.fromVectorStore(pcvs_chat);
  const index_assistant_documents = await VectorStoreIndex.fromVectorStore(
    pcvs_assistant
  );

  return {
    index_chat_messages,
    index_assistant_documents,
  };
}

function createAssistantRetriever({
  index_assistant_documents,
  assistantId,
  level,
}) {
  const filters = [
    {
      key: "assistantId",
      value: assistantId,
      operator: "==",
    },
  ];

  if (level) {
    filters.push({
      key: "level",
      value: level,
      operator: "==",
    });
    console.log(`Filtering assistant documents by level: ${level}`);
  }

  return new VectorIndexRetriever({
    index: index_assistant_documents,
    includeValues: true,
    filters: {
      filters: filters,
    },
    similarityTopK: 5,
  });
}

function createChatRetriever({ index_chat_messages, conversationId }) {
  return new VectorIndexRetriever({
    index: index_chat_messages,
    includeValues: true,
    filters: {
      filters: [
        {
          key: "conversationId",
          value: conversationId,
          operator: "==",
        },
      ],
    },
    similarityTopK: 5,
  });
}

function filterByScore(results, minScore = 0.25) {
  return results.filter((result) => (result.score || 0) > minScore);
}

// Load scenario configurations asynchronously from URL
let scenarioConfigs = [];
let lastConfigFetchTime = 0; // Timestamp of the last successful fetch
const CONFIG_CACHE_DURATION = 60 * 10 * 1000; // 1 hour in milliseconds
const configUrl =
  "https://raw.githubusercontent.com/wagmi-upschool/mobile-texts/refs/heads/main/rag.json";

async function loadScenarioConfigs() {
  const now = Date.now();
  // Check if cache is still valid
  if (
    now - lastConfigFetchTime < CONFIG_CACHE_DURATION &&
    scenarioConfigs.length > 0
  ) {
    console.log("Using cached scenario configurations.");
    return; // Use cached data
  }

  console.log(`Fetching scenario configurations from ${configUrl}...`);
  try {
    const response = await fetch(configUrl);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    scenarioConfigs = data.scenarios; // Assuming the structure is { scenarios: [...] }
    lastConfigFetchTime = now; // Update timestamp on successful fetch
    console.log("Scenario configurations loaded/refreshed successfully.");
  } catch (error) {
    console.error("Error loading scenarioConfig from URL:", error);
    // Fallback or default configuration could be set here if needed
    // If fetch fails, retain potentially stale data but log the error.
    // Only reset to default if scenarioConfigs is empty.
    if (scenarioConfigs.length === 0) {
      scenarioConfigs = [
        {
          id: "General",
          Stage1DocInstructions:
            "Provide a clear and contextual response based on the provided information.",
          Stage2HistoryInstructions:
            "Refine the prepared response for continuity and clarity. Always answer in Turkish",
        },
      ];
      console.warn(
        "Using default scenario configurations due to fetch error on initial load."
      );
    } else {
      console.warn(
        "Using potentially stale scenario configurations due to fetch error."
      );
    }
  }
}

// Load configs when the module initializes
loadScenarioConfigs();

// Prompt template for Stage 1: Retrieve info based on knowledge base
function getStage1Prompt(retrievedDocs, userQuery, scenarioType) {
  const context = retrievedDocs
    .map((doc) => doc.node.text)
    .join(
      "\n---\
"
    );
  // Find the task instructions from the loaded configuration
  const scenarioConfig =
    scenarioConfigs.find((sc) => sc.id === scenarioType) ||
    scenarioConfigs.find((sc) => sc.id === "General");
  let taskInstructions = scenarioConfig.Stage1DocInstructions;
  let finalTaskInstructions = taskInstructions;

  // Add handling for conversational queries
  const conversationalKeywords = [
    "selam",
    "merhaba",
    "naber",
    "devam et",
    "tamam",
    "evet",
    "hayır",
  ];
  const isConversational = conversationalKeywords.some(
    (keyword) => userQuery.toLowerCase().trim() === keyword
  );

  // Append conversational handling instructions if needed
  if (isConversational) {
    finalTaskInstructions += `

<conversational_handling>
If the query is a purely conversational Turkish expression (e.g., "selam", "merhaba", "naber", "devam et", "tamam", "evet", "hayır"):
<item>For greetings (e.g., "selam", "merhaba", "naber"): Respond naturally and briefly. Do not use the provided context for your response.</item>
<item>For continuation phrases (e.g., "devam et", "tamam"): Continue the previous conversational flow or provide a brief acknowledgment to allow the user to continue. Do not use the provided context unless directly relevant to continuing the flow.</item>
<item>For affirmations/negations (e.g., "evet", "hayır"): Acknowledge the user's input and maintain the current conversational context. Do not use the provided context to introduce new topics.</item>
</conversational_handling>`;
  }

  // Construct the prompt using XML structure
  return `
<prompt>
  <context>${
    isConversational
      ? "No relevant context found."
      : context || "No relevant context found."
  }</context>
  <query>${userQuery}</query>
  <scenario_type>${scenarioType || "General"}</scenario_type>
  <task>${finalTaskInstructions}</task>
</prompt>
`;
}

// Prompt template for Stage 2: Refine response with chat history
function getStage2Prompt(
  stage1Response, // Stage 1 LLM response
  chatHistory, // Retrieved chat history nodes (NodeWithScore[]) - for specific scenario logic
  expandedChatHistory, // Expanded chat history with all user messages and filtered assistant messages
  query, // Current user query
  scenarioType, // Determined scenario type
  agentPrompt // Initial system/agent instructions
) {
  // Fetch stage 2 instructions
  const scenarioConfig =
    scenarioConfigs.find((sc) => sc.id === scenarioType) ||
    scenarioConfigs.find((sc) => sc.id === "General");
  let stage2Instructions = scenarioConfig.Stage2HistoryInstructions;

  // Map expanded chat history to message format for broader context
  const expandedHistoryMessages = expandedChatHistory
    .map((msg) => {
      const content = msg.node.text || "";
      if (!content) {
        return null; // Skip messages with empty content
      }
      return {
        role: msg.node.metadata?.role === "user" ? "user" : "assistant",
        content: content,
      };
    })
    .filter((msg) => msg !== null); // Remove null entries

  // For specific scenarios (like SQL), add any additional specific messages that aren't already in expanded history
  const specificMessages = [];
  if (scenarioType === "SQL" && chatHistory.length > 0) {
    // For SQL scenarios, add specific messages that might not be in expanded history
    const expandedTexts = new Set(
      expandedChatHistory.map((msg) => msg.node.text)
    );

    chatHistory.forEach((msg) => {
      const content = msg.text || "";
      if (content && !expandedTexts.has(content)) {
        specificMessages.push({
          role: msg.metadata?.role === "user" ? "user" : "assistant",
          content: content,
        });
      }
    });
  }

  // Construct the message array
  const messages = [
    {
      role: "system",
      content: `${agentPrompt} ${stage2Instructions}`, // Combine agent prompt and task instructions
    },
    {
      role: "system",
      content:
        "Character Limit: Generate a concise response that ends naturally and fits within 1000 characters. Do not exceed the limit. I REPEAT YOU MUST NOT EXCEED LIMIT. ALWAYS COMPLETE RESPONSE IN 1000 CHARACTER!!!!!!!!! \n" +
        "Language: MUST always answer in Turkish",
    },
    // Add expanded history messages for broader context
    ...expandedHistoryMessages,
    // Add any specific scenario messages that weren't already included
    ...specificMessages,
    {
      role: "assistant",
      content: stage1Response,
    },
    {
      role: "user",
      content: query,
    },
  ];

  return messages; // Return the structured message array
}

// Function to map group title to scenario type
function mapGroupToScenarioType(groupInfo) {
  if (!groupInfo || !groupInfo.groupTitle) {
    console.warn("Group info or title missing, defaulting scenario type.");
    return "General"; // Default or consider throwing error
  }

  // The groupTitle from DynamoDB might have the structure { S: "Title" }
  // Adjust access accordingly. Assuming direct access for now.
  const title = groupInfo.groupTitle.S || groupInfo.groupTitle; // Handle potential DynamoDB structure

  console.log(`Mapping group title: ${title}`);

  // Define mappings (case-insensitive comparison)
  const lowerCaseTitle = title.toLowerCase();
  if (lowerCaseTitle.includes("prova odası")) {
    return "Work Rehearsal";
  } else if (lowerCaseTitle.includes("sorumluluk dostu")) {
    return "Mentorship";
  } else if (lowerCaseTitle.includes("role play")) {
    return "Role-play";
  }

  console.warn(
    `No specific scenario mapping found for group title: ${title}. Defaulting.`
  );
  return "General"; // Default if no mapping matches
}

// Controller to handle streaming reflection requests
export async function handleWhatToAskController(req, res) {
  const { userId, conversationId } = req.params;
  console.log("conversationId:", conversationId);
  const { query, assistantId, type, stage } = req.body;

  try {
    // Ensure latest scenario configs are loaded (respecting cache duration)
    await loadScenarioConfigs();

    const systemMessage = await fetchAssistantConfig(assistantId, stage);
    if (!systemMessage || !systemMessage.prompt)
      throw new Error("Assistant configuration or prompt not found");

    // Determine Scenario Type - Priority 1: Direct Assistant ID match in scenarioConfig
    let scenarioType = null;
    const directScenario = scenarioConfigs.find(
      (sc) => sc.assistantIds && sc.assistantIds.includes(assistantId)
    );

    if (directScenario) {
      scenarioType = directScenario.id;
      console.log(
        `Scenario type overridden by direct assistantId match: ${scenarioType}`
      );
    } else {
      // Priority 2: Determine from Assistant Group
      console.log(
        `No direct scenario override found for assistant ${assistantId}. Checking group...`
      );
      const groupInfo = await fetchAssistantGroupInfo(assistantId, stage);
      if (!groupInfo) {
        // Handle case where assistant doesn't belong to a group or group fetch fails
        console.warn(
          `Could not determine group for assistant ${assistantId}. Defaulting scenario type.`
        );
        // Use default 'General' or handle as needed
        scenarioType = "General";
      } else {
        scenarioType = mapGroupToScenarioType(groupInfo);
      }
    }

    console.log(`Determined final scenarioType: ${scenarioType}`);

    // Calculate replacedPatterns here to pass to getStage1Prompt
    const agentPrompt = replacePatterns(systemMessage.prompt);

    const assistantConfig = {
      temperature: parseFloat(systemMessage.temperature) || 0.2,
      topP: parseFloat(systemMessage.topP) || 0.95,
      maxTokens: parseInt(systemMessage.maxTokens) || 800,
      frequencyPenalty: parseFloat(systemMessage.frequencyPenalty) || 0.0,
      presencePenalty: parseFloat(systemMessage.presencePenalty) || 0.0,
      responseType: "text",
      stream: true, // Stage 2 will stream
    };

    await initializeSettings(assistantConfig);

    // Create indices for both chat messages and assistant documents
    const { index_chat_messages, index_assistant_documents } =
      await createIndices();

    // --- Logic to get chat history (potentially for level extraction and Stage 2 prompt) ---
    const chatHistoryRetriever = createChatRetriever({
      index_chat_messages,
      conversationId,
    });
    const retrievedChatMessages = await chatHistoryRetriever.retrieve(query);

    let level = null;
    let chatHistoryForStage2Prompt = [];

    if (scenarioType === "SQL") {
      console.log(
        "SQL Scenario: Attempting to extract level from the relevant user message."
      );
      let relevantMessageNode = null;
      let relevantMessageTextForLevel = "";

      if (retrievedChatMessages && retrievedChatMessages.length > 0) {
        const userMessages = retrievedChatMessages.filter(
          (msg) =>
            msg.node.metadata?.role === "user" || !msg.node.metadata?.role
        );

        // Find the specific message for level extraction
        for (const msgNode of userMessages) {
          const messageText = msgNode.node.text || "";
          let lowerCaseText = messageText.toLowerCase();
          lowerCaseText = lowerCaseText.replace(/i\u0307/g, "i"); // Normalize for Turkish 'İ'
          if (lowerCaseText.startsWith("hangi seviyeden başlamak istersin")) {
            relevantMessageNode = msgNode;
            relevantMessageTextForLevel = messageText;
            console.log(
              "Identified relevant user message for SQL level extraction:",
              relevantMessageTextForLevel
            );
            break; // Found the message, no need to check further
          }
        }
      }

      if (!relevantMessageTextForLevel && query) {
        relevantMessageTextForLevel = query;
        console.log(
          "SQL Scenario: Using current query for level extraction as no specific user message was identified."
        );
      }

      level = extractSqlLevel(relevantMessageTextForLevel); // extractSqlLevel already handles normalization
      console.log(`SQL Scenario - Extracted level: ${level}`);
      // For Stage 2 history, if we found the specific message, use it. Otherwise, empty or other logic might be needed.
      // Based on previous logic, it seems we want to use this specific message if found.
      chatHistoryForStage2Prompt = relevantMessageNode
        ? [relevantMessageNode]
        : [];
    } else {
      console.log(
        "Non-SQL Scenario: Level extraction/filtering will not be applied."
      );
      // For non-SQL scenarios, use standard filtered chat history for Stage 2 prompt
      const chatHistoryMinScore = 0.25; // Default score for non-SQL chat history filtering
      chatHistoryForStage2Prompt = filterByScore(
        retrievedChatMessages,
        chatHistoryMinScore
      );
      console.log(
        `Non-SQL Scenario - Filtered chatHistoryForStage2Prompt count: ${chatHistoryForStage2Prompt.length}`
      );
    }
    // --- End: Level extraction and chat history setup for Stage 2 ---

    // Stage 1: Retrieve Knowledge & Generate Initial Response
    const retriever_assistant = createAssistantRetriever({
      index_assistant_documents,
      assistantId,
      level, // Pass the extracted level
    });
    let assistantDocs = await retriever_assistant.retrieve(query);
    console.log(
      "Stage 1: Retrieved assistantDocs count:",
      assistantDocs.length
    );
    // Filter by score based on scenarioType
    const assistantDocsMinScore = scenarioType === "SQL" ? 0.75 : 0.25;
    assistantDocs = filterByScore(assistantDocs, assistantDocsMinScore);
    console.log("Stage 1: Filtered assistantDocs count:", assistantDocs.length);

    // Pass determined scenarioType to getStage1Prompt
    const stage1Prompt = getStage1Prompt(assistantDocs, query, scenarioType);
    console.log("\n--- Stage 1 Prompt ---\n", stage1Prompt);

    // Use Settings.llm directly for the first non-streaming call
    const stage1Completion = await Settings.llm.complete({
      prompt: stage1Prompt,
    });
    const stage1Response = stage1Completion.text;
    console.log("\n--- Stage 1 Response ---\n", stage1Response);

    // Prepare expanded chat history for Stage 2 (without summarization)
    // Separate user and assistant messages from retrieved chat messages
    const userMessages = retrievedChatMessages.filter(
      (msg) => msg.node.metadata?.role === "user" || !msg.node.metadata?.role
    );
    const assistantMessages = retrievedChatMessages.filter(
      (msg) => msg.node.metadata?.role === "assistant"
    );

    // Use all user messages (unfiltered for better context)
    const allUserMessages = userMessages;

    // Filter assistant messages by score for quality
    const filteredAssistantMessages = filterByScore(assistantMessages, 0.25);

    // Combine and sort messages by timestamp if available, otherwise maintain retrieval order
    const expandedChatHistory = [
      ...allUserMessages,
      ...filteredAssistantMessages,
    ];

    console.log(
      `Expanded chat history: ${allUserMessages.length} user messages, ${filteredAssistantMessages.length} assistant messages`
    );

    // Use getStage2Prompt to construct the message array for the LLM
    const stage2Messages = getStage2Prompt(
      stage1Response,
      chatHistoryForStage2Prompt, // Use the correctly scoped variable for specific scenario logic
      expandedChatHistory, // Pass expanded history instead of summarized text
      query,
      scenarioType,
      agentPrompt
    );
    console.log(
      "\n--- Stage 2 Messages ---\n",
      JSON.stringify(stage2Messages, null, 2)
    );

    // Use Settings.llm configured for streaming for the final output
    const finalResultStream = await Settings.llm.chat({
      messages: stage2Messages, // Pass the structured messages array directly
      stream: true,
    });

    // Stream final response
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");

    for await (const chunk of finalResultStream) {
      res.write(chunk.delta); // Use delta for chat streaming
    }
    res.write("[DONE-UP]");
    res.end();
  } catch (err) {
    console.error("Error in handleWhatToAskController:", err);
    // Avoid sending detailed error messages in production
    res.status(500).json({ error: "An internal server error occurred." });
  }
}

// Fetch assistant configuration from DynamoDB
async function fetchAssistantConfig(assistantId, stage) {
  const env = stage ?? process.env.STAGE;
  const params = {
    TableName: `UpAssistant-${env}`,
    Key: {
      id: assistantId,
    },
  };
  const result = await dynamoDbClient.send(new GetCommand(params));
  return result.Item ? result.Item : null;
}

// Fetch assistant group info by scanning the AssistantGroup table
async function fetchAssistantGroupInfo(assistantId, stage) {
  const env = stage ?? process.env.STAGE;
  const tableName = `AssistantGroup-${env}`; // Adjust if table name format is different
  console.log(`Scanning table ${tableName} for assistantId: ${assistantId}`);

  const params = {
    TableName: tableName,
    FilterExpression: "contains(relatedAssistants, :assistantIdVal)",
    ExpressionAttributeValues: {
      ":assistantIdVal": assistantId,
    },
  };

  try {
    const command = new ScanCommand(params);
    const results = await dynamoDbClient.send(command);

    if (results.Items && results.Items.length > 0) {
      console.log(
        `Found group for assistant ${assistantId}:`,
        results.Items[0].groupTitle
      );
      return results.Items[0];
    } else {
      console.log(`No group found containing assistantId: ${assistantId}`);
      return null;
    }
  } catch (error) {
    console.error(`Error scanning ${tableName}:`, error);
    throw new Error(`Failed to fetch assistant group info: ${error.message}`);
  }
}

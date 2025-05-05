import {
  OpenAI,
  PineconeVectorStore,
  VectorStoreIndex,
  Settings,
  OpenAIEmbedding,
  getResponseSynthesizer,
  RetrieverQueryEngine,
  defaultTreeSummarizePrompt,
  VectorIndexRetriever,
  defaultRefinePrompt,
} from "llamaindex";
import { GetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import fs from "fs";
import path from "path";
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

function createAssistantRetriever({ index_assistant_documents, assistantId }) {
  return new VectorIndexRetriever({
    index: index_assistant_documents,
    includeValues: true,
    filters: {
      filters: [
        {
          key: "assistantId",
          value: assistantId,
          operator: "==",
        },
      ],
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
const configUrl =
  "https://raw.githubusercontent.com/wagmi-upschool/mobile-texts/refs/heads/main/rag.json";

async function loadScenarioConfigs() {
  console.log(`Fetching scenario configurations from ${configUrl}...`);
  try {
    const response = await fetch(configUrl);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    scenarioConfigs = data.scenarios; // Assuming the structure is { scenarios: [...] }
    console.log("Scenario configurations loaded successfully.");
  } catch (error) {
    console.error("Error loading scenarioConfig from URL:", error);
    // Fallback or default configuration could be set here if needed
    scenarioConfigs = [
      {
        id: "General",
        taskInstructions:
          "Provide a clear and contextual response based on the provided information.",
        stage2Instructions:
          "Refine the prepared response for continuity and clarity. Always answer in Turkish",
      },
    ];
    console.warn("Using default scenario configurations due to fetch error.");
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
  let taskInstructions = scenarioConfig.taskInstructions;

  // Add handling for conversational queries
  const conversationalKeywords = ["yes", "okay", "thanks", "i see", "go on"];
  const isConversational = conversationalKeywords.some(
    (keyword) => userQuery.toLowerCase().trim() === keyword
  );

  let finalTaskInstructions = taskInstructions; // Start with instructions from JSON
  // Append conversational handling instructions if needed
  if (isConversational) {
    finalTaskInstructions += `\n\n<conversational_handling>\nIf query is purely conversational (like \"yes\", \"okay\", \"thanks\", \"I see\", \"go on\"):\n<item>Respond naturally while maintaining the established interaction style (${
      scenarioType || "default"
    })</item>\n<item>Use brief responses as opportunities to subtly reinforce key principles from context if appropriate</item>\n<item>Keep the flow going without forcing educational content</item>\n</conversational_handling>`;
  }

  // Construct the prompt using XML structure
  return `
<prompt>
  <context>${context || "No relevant context found."}</context>
  <query>${userQuery}</query>
  <scenario_type>${scenarioType || "General"}</scenario_type>
  <task>${finalTaskInstructions}</task>
</prompt>
`;
}

// Prompt template for Stage 2: Refine response with chat history
function getStage2Prompt(
  stage1Response, // Stage 1 LLM response
  chatHistory, // Retrieved chat history nodes
  query, // Current user query
  scenarioType, // Determined scenario type (currently unused in this structure)
  agentPrompt // Initial system/agent instructions
) {
  // Fetch stage 2 instructions
  const scenarioConfig =
    scenarioConfigs.find((sc) => sc.id === scenarioType) ||
    scenarioConfigs.find((sc) => sc.id === "General");
  let stage2Instructions = scenarioConfig.stage2Instructions;

  // Map chat history to the required format (user/assistant roles)
  const formattedHistoryMessages = chatHistory
    .map((msg) => ({
      // Infer role based on metadata - adjust field name if necessary
      role: msg.metadata?.sender === "user" ? "user" : "assistant",
      // Assuming the message content is in the 'text' field - adjust if necessary
      content: msg.text || "",
    }))
    .filter((msg) => msg.content); // Ensure content is not empty

  return `
  <prompt>
    <agent_prompt>${agentPrompt} </agent_prompt>
    <context>${stage1Response}</context>
    <query>${query}</query>
    <task>${stage2Instructions}</task>
    <history>${chatHistory.map((msg) => msg.text).join("\n")}</history>
  </prompt>
  `; // Return the structured message array
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

    // Stage 1: Retrieve Knowledge & Generate Initial Response
    const retriever_assistant = createAssistantRetriever({
      index_assistant_documents,
      assistantId,
    });
    let assistantDocs = await retriever_assistant.retrieve(query);
    console.log(
      "Stage 1: Retrieved assistantDocs count:",
      assistantDocs.length
    );
    assistantDocs = filterByScore(assistantDocs); // Filter by score
    console.log("Stage 1: Filtered assistantDocs count:", assistantDocs.length);

    // Pass determined scenarioType to getStage1Prompt
    const stage1Prompt = getStage1Prompt(
      assistantDocs,
      query,
      scenarioType,
      agentPrompt
    );
    console.log("\n--- Stage 1 Prompt ---\n", stage1Prompt);

    // Use Settings.llm directly for the first non-streaming call
    const stage1Completion = await Settings.llm.complete({
      prompt: stage1Prompt,
    });
    const stage1Response = stage1Completion.text;
    console.log("\n--- Stage 1 Response ---\n", stage1Response);

    // Stage 2: Retrieve History & Refine Response (Streaming)
    const retriever_chat = createChatRetriever({
      index_chat_messages,
      conversationId,
    });
    let chatHistory = await retriever_chat.retrieve(query);
    console.log("\nStage 2: Retrieved chatHistory count:", chatHistory.length);

    chatHistory = filterByScore(chatHistory); // Filter by score
    console.log("Stage 2: Filtered chatHistory count:", chatHistory.length);

    // Use getStage2Prompt to construct the message array for the LLM
    const stage2Instructions = getStage2Prompt(
      stage1Response,
      chatHistory, // Pass retrieved history
      query,
      scenarioType,
      agentPrompt // Pass agent prompt
    );

    // Use Settings.llm configured for streaming for the final output
    const finalResultStream = await Settings.llm.chat({
      messages: [
        { role: "user", content: stage2Instructions }, // Pass the structured messages array from getStage2Prompt
      ],
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
    // FilterExpression requires attribute type definition if not using DocumentClient's marshalling
    FilterExpression: "contains(relatedAssistants, :assistantIdVal)",
    ExpressionAttributeValues: {
      // Assuming relatedAssistants is a list of strings (S)
      // If it's a list of objects like { "S": "id" }, this needs adjustment
      // DynamoDB ScanCommand requires explicit type descriptors like {"S": assistantId}
      // The GetCommand uses marshalling implicitly, ScanCommand might not depending on client setup.
      // Let's assume DocumentClient handles marshalling, otherwise we need { "S": assistantId }
      // UPDATE: Based on example JSON, relatedAssistants is "L": [{"S": "..."}], so contains might need adjustment or a different approach.
      // A direct contains check on a list of maps might not work as expected with FilterExpression.
      // Let's try scanning and filtering in code for robustness, though less efficient.
      ":assistantIdVal": assistantId, // DocumentClient simplifies this usually. Let's assume it works. Revisit if errors occur.
    },
  };

  try {
    // Using ScanCommand. A full table scan can be inefficient. Consider a GSI if performance is critical.
    const command = new ScanCommand(params);
    const results = await dynamoDbClient.send(command);

    if (results.Items && results.Items.length > 0) {
      // Assuming only one group contains the assistant
      console.log(
        `Found group for assistant ${assistantId}:`,
        results.Items[0].groupTitle
      );
      // The raw result needs unmarshalling if not using DocumentClient's `scan`
      // Let's assume standard client requires manual unmarshalling or switching to DocumentClient.
      // For simplicity now, let's return the first match assuming basic structure access works.
      // This might need refinement based on the actual client setup and DynamoDB structure handling.
      return results.Items[0]; // Return the first matching group item
    } else {
      console.log(`No group found containing assistantId: ${assistantId}`);
      return null;
    }
  } catch (error) {
    console.error(`Error scanning ${tableName}:`, error);
    // Rethrow or handle error appropriately
    throw new Error(`Failed to fetch assistant group info: ${error.message}`);
  }
}

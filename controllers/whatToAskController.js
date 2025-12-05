import {
  OpenAI,
  PineconeVectorStore,
  VectorStoreIndex,
  Settings,
  OpenAIEmbedding,
  VectorIndexRetriever,
} from "llamaindex";
import { GetCommand, ScanCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { v4 as uuidv4 } from "uuid";
import { extractSqlLevel } from "../utils/levelExtractor.js";
import { ConversationMemoryService } from "../services/conversationMemoryService.js";
import { AssistantInputOptionsService } from "../services/assistantInputOptionsService.js";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Initialize AWS clients
const dynamoDbClient = new DynamoDBClient({
  region: "us-east-1",
});

const lambdaClient = new LambdaClient({
  region: "us-east-1",
});

const sqsClient = new SQSClient({
  region: "us-east-1",
});

const assistantInputOptionsService = new AssistantInputOptionsService({
  stage: process.env.STAGE,
});

// SQS Queue URLs - Use environment variables from ECS task definition
const ANALYSIS_QUEUE_URL = process.env.ANALYSIS_QUEUE_URL;
const PRIORITY_QUEUE_URL = process.env.PRIORITY_QUEUE_URL;

// Validate required environment variables
if (!ANALYSIS_QUEUE_URL) {
  console.warn("ANALYSIS_QUEUE_URL environment variable not set");
}
if (!PRIORITY_QUEUE_URL) {
  console.warn("PRIORITY_QUEUE_URL environment variable not set");
}
if (!process.env.STAGE) {
  console.warn("STAGE environment variable not set");
}

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
  topic,
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

  if (topic) {
    filters.push({
      key: "topic",
      value: topic,
      operator: "==",
    });
    console.log(`Filtering assistant documents by topic: ${topic}`);
  }

  return new VectorIndexRetriever({
    index: index_assistant_documents,
    includeValues: true,
    filters: {
      filters: filters,
    },
    similarityTopK: 8, // Increased from 5 to get more relevant context
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

function logAssistantDocSamples(docs, label = "assistantDocs", maxItems = 3) {
  try {
    docs.slice(0, maxItems).forEach((doc, idx) => {
      const textPreview = (doc?.node?.text || "").replace(/\s+/g, " ");
      const trimmedText =
        textPreview.length > 120
          ? `${textPreview.substring(0, 120)}...`
          : textPreview;
      console.log(
        `[${label} ${idx}] score=${(doc?.score || 0).toFixed(
          3
        )} metadata=${JSON.stringify(doc?.node?.metadata || {})} text="${trimmedText}"`
      );
      console.log(`[${label} ${idx} metadata obj]`, doc?.node?.metadata || {});
    });
  } catch (err) {
    console.error("Error logging assistant doc samples:", err);
  }
}

// Enhanced query function that includes conversation context
function createContextAwareQuery(userQuery, conversationContext) {
  if (!conversationContext || !conversationContext.context) {
    return userQuery;
  }

  const { currentTopic, userProfile } = conversationContext.context;

  // If we have a current topic, enhance the query with topic context
  if (
    currentTopic &&
    currentTopic.topic !== "general" &&
    currentTopic.confidence > 0.5
  ) {
    const topicKeywords = currentTopic.keywords.join(" ");
    const enhancedQuery = `${userQuery} ${topicKeywords} ${currentTopic.topic}`;
    console.log(`Enhanced query with topic context: ${enhancedQuery}`);
    return enhancedQuery;
  }

  return userQuery;
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
function getStage1Prompt(
  retrievedDocs,
  userQuery,
  scenarioType,
  personalizationContext,
  conversationContext = ""
) {
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
  <task>${finalTaskInstructions}</task>${conversationContext || ""}${
    personalizationContext || ""
  }
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
  agentPrompt, // Initial system/agent instructions
  personalizationContext // Personalization context
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
        role:
          msg.node.metadata && msg.node.metadata.role === "user"
            ? "user"
            : "assistant",
        content: content,
      };
    })
    .filter((msg) => msg !== null); // Remove null entries

  // For specific scenarios (like SQL), add any additional specific messages that aren't already in expanded history
  const specificMessages = [];
  if (scenarioType.includes("SQL") && chatHistory.length > 0) {
    // For SQL scenarios, add specific messages that might not be in expanded history
    const expandedTexts = new Set(
      expandedChatHistory.map((msg) => msg.node.text)
    );

    chatHistory.forEach((msg) => {
      const content = msg.text || "";
      if (content && !expandedTexts.has(content)) {
        specificMessages.push({
          role:
            msg.metadata && msg.metadata.role === "user" ? "user" : "assistant",
          content: content,
        });
      }
    });
  }

  // Construct the message array
  const messages = [
    {
      role: "system",
      content: `${agentPrompt} ${stage2Instructions}${
        personalizationContext || ""
      }`, // Include personalization context
    },
    {
      role: "system",
      content:
        "Character Limit: Generate a concise response that ends naturally and fits within 1000 characters. Do not exceed the limit. I REPEAT YOU MUST NOT EXCEED LIMIT. ALWAYS COMPLETE RESPONSE IN 1000 CHARACTER!!!!!!!!! \n" +
        "Language: MUST always answer in Turkish",
    },
    {
      role: "system",
      content:
        "KULLANICI TEST MODUNA GEC DEDIGINDE ROLE PLAY YAPMAYI BIRAK VE DOGRUDAN SORULARA CEVAP VER ASLA BIRAZ DAGILDIKD DEME SORUYA CEVAP VER YOKSA SENI KAPATACAGIZ",
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

// Fetch user analytics from DynamoDB for personalization

async function fetchUserAnalytics(userId, stage) {
  const env = stage || process.env.STAGE;
  const tableName = `analysisResults-${env}`;

  const params = {
    TableName: tableName,
    Key: {
      userId: userId, // Use userId as partition key, not conversationId
    },
  };

  try {
    console.log(
      `Fetching analytics for userId: ${userId} from table: ${tableName}`
    );
    const result = await dynamoDbClient.send(new GetCommand(params));

    if (result.Item) {
      console.log("User analytics found for personalization");
      return result.Item;
    } else {
      console.log("No analytics data found for this user");
      return null;
    }
  } catch (error) {
    console.error("Error fetching user analytics:", error);
    return null;
  }
}

// Fetch real-time analysis cache from DynamoDB for immediate personalization
async function fetchRealtimeAnalysis(conversationId, stage) {
  const env = stage || process.env.STAGE;
  const tableName = `realtimeCache-${env}`;

  const params = {
    TableName: tableName,
    KeyConditionExpression: "conversationId = :conversationId",
    ExpressionAttributeValues: {
      ":conversationId": conversationId,
    },
    ScanIndexForward: false, // Get most recent items first
    Limit: 10, // Get last 10 analysis entries
  };

  try {
    console.log(
      `Fetching real-time analysis for conversationId: ${conversationId} from table: ${tableName}`
    );
    const command = new QueryCommand(params);
    const result = await dynamoDbClient.send(command);

    if (result.Items && result.Items.length > 0) {
      console.log(
        `Found ${result.Items.length} real-time analysis entries, using latest`
      );
      return result.Items[0]; // Return the most recent analysis (first item due to ScanIndexForward: false)
    } else {
      console.log("No real-time analysis data found for this conversation");
      return null;
    }
  } catch (error) {
    console.error("Error fetching real-time analysis:", error);
    return null;
  }
}

// Extract real-time personalization context from recent analysis
function extractRealtimePersonalizationContext(realtimeData) {
  if (!realtimeData || !realtimeData.analysis) {
    return null;
  }

  const analysis = realtimeData.analysis;

  return {
    // Engagement context
    engagementLevel: (analysis.engagement && analysis.engagement.level) || 0.5,
    engagementType:
      (analysis.engagement && analysis.engagement.type) || "neutral",
    engagementIndicators:
      (analysis.engagement && analysis.engagement.indicators) || [],

    // Sentiment and emotional state
    currentSentiment:
      (analysis.sentiment && analysis.sentiment.sentiment) || "neutral",
    sentimentIntensity:
      (analysis.sentiment && analysis.sentiment.intensity) || 0.5,
    sentimentConfidence:
      (analysis.sentiment && analysis.sentiment.confidence) || 0.5,
    currentEmotions: (analysis.sentiment && analysis.sentiment.emotions) || [],

    // Understanding and comprehension
    understandingLevel:
      (analysis.understanding && analysis.understanding.understanding_level) ||
      "moderate",
    understandingConfidence:
      (analysis.understanding && analysis.understanding.confidence) || 0.5,
    needsClarification:
      (analysis.understanding && analysis.understanding.needs_clarification) ||
      [],
    misconceptions:
      (analysis.understanding && analysis.understanding.misconceptions) || [],

    // Error patterns and suggestions
    hasErrors: (analysis.errors && analysis.errors.detected) || false,
    errorSeverity: (analysis.errors && analysis.errors.severity) || "low",
    errorSuggestions: (analysis.errors && analysis.errors.suggestions) || [],

    // Triggers and concerns
    triggers: analysis.triggers || [],

    // Timestamp for context
    analysisTimestamp: analysis.timestamp,
    messageId: analysis.messageId,
  };
}

// Create real-time personalization prompt addition
function createRealtimePersonalizationPrompt(realtimeData) {
  if (!realtimeData) {
    return "";
  }

  let realtimePrompt = "\n<realtime_context>\n";

  // Current engagement state
  realtimePrompt += "<current_engagement>\n";
  realtimePrompt += `- Engagement level: ${realtimeData.engagementLevel} (${realtimeData.engagementType})\n`;
  if (realtimeData.engagementIndicators.length > 0) {
    realtimePrompt += `- Engagement indicators: ${realtimeData.engagementIndicators.join(
      ", "
    )}\n`;
  }
  realtimePrompt += "</current_engagement>\n";

  // Current emotional/sentiment state
  realtimePrompt += "<current_sentiment>\n";
  realtimePrompt += `- Sentiment: ${realtimeData.currentSentiment} (intensity: ${realtimeData.sentimentIntensity})\n`;
  if (realtimeData.currentEmotions.length > 0) {
    realtimePrompt += `- Current emotions: ${realtimeData.currentEmotions.join(
      ", "
    )}\n`;
  }
  realtimePrompt += "</current_sentiment>\n";

  // Understanding assessment
  realtimePrompt += "<understanding_assessment>\n";
  realtimePrompt += `- Understanding level: ${realtimeData.understandingLevel}\n`;
  realtimePrompt += `- Confidence in understanding: ${realtimeData.understandingConfidence}\n`;
  if (realtimeData.needsClarification.length > 0) {
    realtimePrompt += `- Needs clarification: ${realtimeData.needsClarification.join(
      "; "
    )}\n`;
  }
  if (realtimeData.misconceptions.length > 0) {
    realtimePrompt += `- Misconceptions detected: ${realtimeData.misconceptions.join(
      "; "
    )}\n`;
  }
  realtimePrompt += "</understanding_assessment>\n";

  // Error handling context
  if (realtimeData.hasErrors) {
    realtimePrompt += "<error_context>\n";
    realtimePrompt += `- Errors detected: ${realtimeData.hasErrors}\n`;
    realtimePrompt += `- Error severity: ${realtimeData.errorSeverity}\n`;
    if (realtimeData.errorSuggestions.length > 0) {
      realtimePrompt += `- Suggestions: ${realtimeData.errorSuggestions.join(
        "; "
      )}\n`;
    }
    realtimePrompt += "</error_context>\n";
  }

  // Triggers and concerns
  if (realtimeData.triggers.length > 0) {
    realtimePrompt += "<current_triggers>\n";
    realtimeData.triggers.forEach((trigger) => {
      realtimePrompt += `- ${trigger.type} (${
        trigger.severity
      }): ${JSON.stringify(trigger.data)}\n`;
    });
    realtimePrompt += "</current_triggers>\n";
  }

  // Response adaptation guidelines
  realtimePrompt += "<adaptation_guidelines>\n";

  // Engagement-based adaptations
  if (realtimeData.engagementLevel < 0.3) {
    realtimePrompt +=
      "- LOW ENGAGEMENT DETECTED: Use more engaging, interactive approaches. Ask direct questions. Use simpler language.\n";
  } else if (realtimeData.engagementLevel > 0.7) {
    realtimePrompt +=
      "- HIGH ENGAGEMENT: User is actively engaged. Can use more complex concepts and deeper discussions.\n";
  }

  // Understanding-based adaptations
  if (
    realtimeData.understandingLevel === "none" ||
    realtimeData.understandingLevel === "low"
  ) {
    realtimePrompt +=
      "- LOW UNDERSTANDING: Simplify explanations. Use more examples. Check comprehension frequently.\n";
  }

  // Sentiment-based adaptations
  if (realtimeData.currentSentiment === "negative") {
    realtimePrompt +=
      "- NEGATIVE SENTIMENT: Be more supportive and encouraging. Address concerns directly.\n";
  } else if (realtimeData.currentSentiment === "positive") {
    realtimePrompt +=
      "- POSITIVE SENTIMENT: Build on positive momentum. Can introduce new challenges.\n";
  }

  realtimePrompt += "</adaptation_guidelines>\n";
  realtimePrompt += "</realtime_context>\n";

  return realtimePrompt;
}

// Extract relevant personalization insights from analytics data
function extractPersonalizationContext(analyticsData) {
  if (!analyticsData || !analyticsData.analysis) {
    return null;
  }

  const analysis = analyticsData.analysis;

  // Extract key personalization fields
  const personalization = {
    // Communication preferences
    communicationGuidelines:
      (analysis.personalizationInsights &&
        analysis.personalizationInsights.communicationGuidelines) ||
      {},
    personalizedGreeting:
      (analysis.personalizationInsights &&
        analysis.personalizationInsights.personalizedGreeting) ||
      "",

    // Content and learning preferences
    contentRecommendations:
      (analysis.personalizationInsights &&
        analysis.personalizationInsights.contentRecommendations) ||
      {},
    learningStyle:
      (analysis.learningPatterns &&
        analysis.learningPatterns.learningStyle &&
        analysis.learningPatterns.learningStyle.primary) ||
      "mixed",
    preferredInteractionStyle:
      (analysis.learningPatterns &&
        analysis.learningPatterns.engagementPatterns &&
        analysis.learningPatterns.engagementPatterns
          .preferredInteractionStyle) ||
      "collaborative",
    explanationPreferences:
      (analysis.learningPatterns &&
        analysis.learningPatterns.explanationPreferences) ||
      [],

    // Emotional and engagement context
    overallMood:
      (analysis.emotionalState && analysis.emotionalState.overallMood) ||
      "neutral",
    confidenceLevel:
      (analysis.skillAssessment && analysis.skillAssessment.confidence) || 0.5,
    currentSkillLevel:
      (analysis.skillAssessment && analysis.skillAssessment.currentLevel) ||
      "intermediate",
    engagementLevel:
      (analysis.emotionalState &&
        analysis.emotionalState.engagementLevel &&
        analysis.emotionalState.engagementLevel.overall) ||
      0.5,

    // Topic interests and preferences
    highInterestTopics:
      (analysis.topicAnalysis &&
        analysis.topicAnalysis.interestIndicators &&
        analysis.topicAnalysis.interestIndicators.highInterestTopics) ||
      [],
    lowInterestTopics:
      (analysis.topicAnalysis &&
        analysis.topicAnalysis.interestIndicators &&
        analysis.topicAnalysis.interestIndicators.lowInterestTopics) ||
      [],
    strugglingConcepts:
      (analysis.skillAssessment &&
        analysis.skillAssessment.strugglingConcepts) ||
      [],
    masteredConcepts:
      (analysis.skillAssessment && analysis.skillAssessment.masteredConcepts) ||
      [],

    // Session suggestions
    nextSessionSuggestions:
      (analysis.personalizationInsights &&
        analysis.personalizationInsights.nextSessionSuggestions) ||
      {},
    learningGoals:
      (analysis.personalizationInsights &&
        analysis.personalizationInsights.learningGoals) ||
      {},

    // Additional context
    attentionSpan:
      (analysis.learningPatterns &&
        analysis.learningPatterns.attentionSpan &&
        analysis.learningPatterns.attentionSpan.estimatedMinutes) ||
      10,
    pacingPreference:
      (analysis.learningPatterns &&
        analysis.learningPatterns.pacingPreference) ||
      "moderate",
    motivationalTriggers:
      (analysis.learningPatterns &&
        analysis.learningPatterns.motivationalTriggers) ||
      [],
  };

  return personalization;
}

// Create personalization context string for prompts
function createPersonalizationPrompt(personalizationData) {
  if (!personalizationData) {
    return "";
  }

  let personalizationPrompt = "\n<personalization_context>\n";

  // Communication style guidelines
  if (
    personalizationData.communicationGuidelines &&
    Object.keys(personalizationData.communicationGuidelines).length > 0
  ) {
    const guidelines = personalizationData.communicationGuidelines;
    personalizationPrompt += "<communication_style>\n";
    if (guidelines.tone)
      personalizationPrompt += `- Tone: ${guidelines.tone}\n`;
    if (guidelines.complexity)
      personalizationPrompt += `- Language complexity: ${guidelines.complexity}\n`;
    if (guidelines.responseLength)
      personalizationPrompt += `- Preferred response length: ${guidelines.responseLength}\n`;
    if (guidelines.encouragementLevel)
      personalizationPrompt += `- Encouragement level: ${guidelines.encouragementLevel}\n`;
    if (guidelines.useAnalogies)
      personalizationPrompt += `- Use analogies: ${
        guidelines.useAnalogies ? "yes" : "no"
      }\n`;
    if (guidelines.useHumor)
      personalizationPrompt += `- Use humor: ${
        guidelines.useHumor ? "yes" : "no"
      }\n`;
    personalizationPrompt += "</communication_style>\n";
  }

  // Learning preferences
  personalizationPrompt += "<learning_preferences>\n";
  if (personalizationData.learningStyle)
    personalizationPrompt += `- Learning style: ${personalizationData.learningStyle}\n`;
  if (personalizationData.preferredInteractionStyle)
    personalizationPrompt += `- Interaction style: ${personalizationData.preferredInteractionStyle}\n`;
  if (personalizationData.explanationPreferences.length > 0) {
    personalizationPrompt += `- Explanation preferences: ${personalizationData.explanationPreferences.join(
      ", "
    )}\n`;
  }
  if (personalizationData.pacingPreference)
    personalizationPrompt += `- Pacing preference: ${personalizationData.pacingPreference}\n`;
  personalizationPrompt += "</learning_preferences>\n";

  // Current state and context
  personalizationPrompt += "<user_context>\n";
  if (personalizationData.overallMood)
    personalizationPrompt += `- Current mood: ${personalizationData.overallMood}\n`;
  if (personalizationData.currentSkillLevel)
    personalizationPrompt += `- Skill level: ${personalizationData.currentSkillLevel}\n`;
  if (personalizationData.confidenceLevel)
    personalizationPrompt += `- Confidence level: ${personalizationData.confidenceLevel}\n`;
  if (personalizationData.engagementLevel)
    personalizationPrompt += `- Engagement level: ${personalizationData.engagementLevel}\n`;
  if (personalizationData.attentionSpan)
    personalizationPrompt += `- Estimated attention span: ${personalizationData.attentionSpan} minutes\n`;
  personalizationPrompt += "</user_context>\n";

  // Topic interests
  if (
    personalizationData.highInterestTopics.length > 0 ||
    personalizationData.lowInterestTopics.length > 0
  ) {
    personalizationPrompt += "<topic_preferences>\n";
    if (personalizationData.highInterestTopics.length > 0) {
      personalizationPrompt += `- High interest topics: ${personalizationData.highInterestTopics.join(
        ", "
      )}\n`;
    }
    if (personalizationData.lowInterestTopics.length > 0) {
      personalizationPrompt += `- Low interest topics: ${personalizationData.lowInterestTopics.join(
        ", "
      )}\n`;
    }
    personalizationPrompt += "</topic_preferences>\n";
  }

  // Learning progress
  if (
    personalizationData.masteredConcepts.length > 0 ||
    personalizationData.strugglingConcepts.length > 0
  ) {
    personalizationPrompt += "<learning_progress>\n";
    if (personalizationData.masteredConcepts.length > 0) {
      personalizationPrompt += `- Mastered concepts: ${personalizationData.masteredConcepts.join(
        ", "
      )}\n`;
    }
    if (personalizationData.strugglingConcepts.length > 0) {
      personalizationPrompt += `- Struggling with: ${personalizationData.strugglingConcepts.join(
        ", "
      )}\n`;
    }
    personalizationPrompt += "</learning_progress>\n";
  }

  // Content recommendations
  if (
    personalizationData.contentRecommendations &&
    Object.keys(personalizationData.contentRecommendations).length > 0
  ) {
    const content = personalizationData.contentRecommendations;
    personalizationPrompt += "<content_guidance>\n";
    if (content.emphasizeTopics && content.emphasizeTopics.length > 0) {
      personalizationPrompt += `- Emphasize topics: ${content.emphasizeTopics.join(
        ", "
      )}\n`;
    }
    if (content.avoidTopics && content.avoidTopics.length > 0) {
      personalizationPrompt += `- Avoid topics: ${content.avoidTopics.join(
        ", "
      )}\n`;
    }
    if (content.difficulty)
      personalizationPrompt += `- Preferred difficulty: ${content.difficulty}\n`;
    if (content.format && content.format.length > 0) {
      personalizationPrompt += `- Preferred formats: ${content.format.join(
        ", "
      )}\n`;
    }
    personalizationPrompt += "</content_guidance>\n";
  }

  // Motivational context
  if (personalizationData.motivationalTriggers.length > 0) {
    personalizationPrompt += `<motivational_triggers>\n- ${personalizationData.motivationalTriggers.join(
      ", "
    )}\n</motivational_triggers>\n`;
  }

  // Personalized greeting for context
  if (personalizationData.personalizedGreeting) {
    personalizationPrompt += `<personalized_greeting_example>\n${personalizationData.personalizedGreeting}\n</personalized_greeting_example>\n`;
  }

  personalizationPrompt += "</personalization_context>\n";

  return personalizationPrompt;
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
  console.log("userId:", userId);
  const { query, assistantId, type, stage } = req.body;

  let fullOutput = ""; // Track the complete response for analysis

  try {
    // Create indices for both chat messages and assistant documents
    const { index_chat_messages, index_assistant_documents } =
      await createIndices();

    // Initialize conversation memory service with vector index
    const memoryService = new ConversationMemoryService(stage);
    memoryService.setVectorIndex(index_chat_messages); // 🔥 FIX: Set vector index for unified retrieval

    // Ensure latest scenario configs are loaded (respecting cache duration)
    await loadScenarioConfigs();

    // WUP-806 FIX: Get comprehensive conversation context using vector DB
    console.log("Fetching conversation context for memory continuity...");
    const conversationContext = await memoryService.getConversationContext(
      conversationId,
      30, // Get last 30 messages for better context
      3000 // Allow up to 3000 tokens for conversation history
    );

    const conversationContextPrompt =
      memoryService.createConversationContextPrompt(conversationContext);
    console.log("Conversation context prepared:", {
      messageCount: conversationContext.metadata.totalMessages,
      currentTopic: conversationContext.context.currentTopic?.topic,
      userLevel: conversationContext.context.userProfile?.skillLevel?.level,
      conversationPhase: conversationContext.context.conversationFlow?.phase,
      dataSource: conversationContext.metadata.dataSource, // Track which source was used
    });

    // Detect topic from first user message via assistant input options
    const priorUserMessages =
      (conversationContext.messages || []).filter(
        (msg) => msg.role === "user"
      ).length;
    const isFirstUserMessage = priorUserMessages === 0;
    let detectedTopic = null;

    if (isFirstUserMessage && query) {
      try {
        const normalizedQuery = query
          .toString()
          .toLocaleLowerCase("tr")
          .trim();
        const optionsService =
          stage && stage !== process.env.STAGE
            ? new AssistantInputOptionsService({ stage })
            : assistantInputOptionsService;
        const options = await optionsService.getAllOptions(assistantId);
        const normalizedOptions = options
          .map((opt) => {
            const raw =
              (opt.value || opt.text || opt.SK || "").toString().trim();
            return {
              raw,
              normalized: raw.toLocaleLowerCase("tr"),
            };
          })
          .filter((opt) => opt.normalized.length > 0);

        const matched = normalizedOptions.find((opt) =>
          normalizedQuery.includes(opt.normalized)
        );

        if (matched) {
          detectedTopic = matched.raw;
          console.log(
            `First user message matched input option for topic filter: ${detectedTopic}`
          );
        } else {
          console.log(
            "First user message did not match any input option; no topic filter applied."
          );
        }
      } catch (error) {
        console.error("Error detecting topic from input options:", error);
      }
    }

    // Fetch user analytics for personalization - use userId instead of conversationId
    console.log("Fetching user analytics for personalization...");
    const analyticsData = await fetchUserAnalytics(userId, stage);
    const personalizationData = extractPersonalizationContext(analyticsData);
    const personalizationPrompt =
      createPersonalizationPrompt(personalizationData);

    // Fetch real-time analysis for immediate personalization - use conversationId
    console.log("Fetching real-time analysis for immediate personalization...");
    const realtimeAnalysisData = await fetchRealtimeAnalysis(
      conversationId,
      stage
    );
    const realtimePersonalizationData =
      extractRealtimePersonalizationContext(realtimeAnalysisData);
    const realtimePersonalizationPrompt = createRealtimePersonalizationPrompt(
      realtimePersonalizationData
    );

    // Combine both personalization contexts
    const combinedPersonalizationPrompt =
      personalizationPrompt + realtimePersonalizationPrompt;

    console.log(
      "Personalization context prepared:",
      personalizationData ? "Yes" : "No"
    );
    console.log(
      "Real-time personalization context prepared:",
      realtimePersonalizationData ? "Yes" : "No"
    );

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

    // 🔥 NEW: Get specialized retrievers from memory service for different purposes
    let level = null;
    let chatHistoryForStage2Prompt = [];
    let semanticChatMessages = [];

    const dualRetrievers = memoryService.createDualRetrievers(conversationId);

    if (dualRetrievers) {
      console.log("Using vector-based retrievers for chat history");

      // Get semantically relevant messages for current query
      try {
        semanticChatMessages = await dualRetrievers.semantic.retrieve(query);
        console.log(
          `Retrieved ${semanticChatMessages.length} semantically relevant messages`
        );
      } catch (error) {
        console.error("Error retrieving semantic messages:", error);
        semanticChatMessages = [];
      }
    } else {
      console.log(
        "Vector retrievers not available, using conversation context messages"
      );
      // Fallback: Use messages from conversation context
      semanticChatMessages = conversationContext.messages
        .slice(-5)
        .map((msg) => ({
          node: {
            text: msg.content,
            metadata: { role: msg.role },
          },
        }));
    }

    // Handle SQL level extraction and scenario-specific logic
    if (scenarioType.includes("SQL")) {
      console.log(
        "SQL Scenario: Attempting to extract level from conversation context."
      );

      // Use conversation context messages for level extraction
      const userMessages = conversationContext.messages.filter(
        (msg) => msg.role === "user"
      );
      let relevantMessageForLevel = null;

      // Find the specific message for level extraction
      for (const message of userMessages) {
        const messageText = message.content || "";
        let lowerCaseText = messageText.toLowerCase();
        lowerCaseText = lowerCaseText.replace(/i\u0307/g, "i"); // Normalize for Turkish 'İ'
        if (lowerCaseText.startsWith("hangi seviyeden başlamak istersin")) {
          relevantMessageForLevel = messageText;
          console.log(
            "Identified relevant user message for SQL level extraction:",
            relevantMessageForLevel
          );
          break;
        }
      }

      if (!relevantMessageForLevel && query) {
        relevantMessageForLevel = query;
        console.log(
          "SQL Scenario: Using current query for level extraction as no specific user message was identified."
        );
      }

      level = extractSqlLevel(relevantMessageForLevel || query);
      console.log(`SQL Scenario - Extracted level: ${level}`);

      // For Stage 2 history, use SQL-related messages from conversation context
      chatHistoryForStage2Prompt = conversationContext.messages
        .filter((msg) => {
          const content = msg.content.toLowerCase();
          return (
            content.includes("seviye") ||
            content.includes("sql") ||
            content.includes("join")
          );
        })
        .slice(-3) // Get last 3 SQL-related messages
        .map((msg) => ({
          node: {
            text: msg.content,
            metadata: { role: msg.role },
          },
        }));

      console.log(
        `SQL Scenario: Using ${chatHistoryForStage2Prompt.length} SQL-related messages from conversation context`
      );
    } else {
      console.log(
        "Non-SQL Scenario: Level extraction/filtering will not be applied."
      );
      // For non-SQL scenarios, use semantically relevant messages
      const chatHistoryMinScore = 0.25;
      chatHistoryForStage2Prompt = filterByScore(
        semanticChatMessages,
        chatHistoryMinScore
      );
      console.log(
        `Non-SQL Scenario - Filtered chatHistoryForStage2Prompt count: ${chatHistoryForStage2Prompt.length}`
      );
    }

    // Stage 1: Retrieve Knowledge & Generate Initial Response
    // WUP-806 FIX: Use conversation context for better document retrieval
    const contextAwareQuery = createContextAwareQuery(
      query,
      conversationContext
    );

    const retriever_assistant = createAssistantRetriever({
      index_assistant_documents,
      assistantId,
      level, // Pass the extracted level
      topic: detectedTopic, // Apply topic filter only when matched on first user message
    });

    let assistantDocs = await retriever_assistant.retrieve(contextAwareQuery);
    console.log(
      "Stage 1: Retrieved assistantDocs count:",
      assistantDocs.length
    );

    // WUP-806 FIX: More lenient score filtering to preserve context
    const assistantDocsMinScore = scenarioType.includes("SQL") ? 0.65 : 0.2; // Reduced thresholds for all SQL variants
    assistantDocs = filterByScore(assistantDocs, assistantDocsMinScore);
    console.log("Stage 1: Filtered assistantDocs count:", assistantDocs.length);
    logAssistantDocSamples(assistantDocs, "assistantDocs", 5);

    // WUP-806 FIX: Pass conversation context to Stage 1 prompt
    const stage1Prompt = getStage1Prompt(
      assistantDocs,
      query,
      scenarioType,
      combinedPersonalizationPrompt,
      conversationContextPrompt // Add conversation context
    );
    console.log("\n--- Stage 1 Prompt ---\n", stage1Prompt);

    // Use Settings.llm directly for the first non-streaming call
    const stage1Completion = await Settings.llm.complete({
      prompt: stage1Prompt,
    });
    const stage1Response = stage1Completion.text;
    console.log("\n--- Stage 1 Response ---\n", stage1Response);

    // WUP-806 FIX: Use chronological conversation context from memory service
    // Convert conversation memory format to stage2 format for compatibility
    const expandedChatHistory = conversationContext.messages.map((msg) => ({
      node: {
        text: msg.content,
        metadata: { role: msg.role },
      },
    }));

    console.log(
      `WUP-806 FIX: Using unified message retrieval: ${expandedChatHistory.length} messages from ${conversationContext.metadata.dataSource}`
    );

    // WUP-806 FIX: Enhance Stage 2 with conversation context
    const enhancedPersonalizationPrompt =
      combinedPersonalizationPrompt + conversationContextPrompt;

    const stage2Messages = getStage2Prompt(
      stage1Response,
      chatHistoryForStage2Prompt, // Use the correctly scoped variable for specific scenario logic
      expandedChatHistory, // Pass chronological history from unified source
      query,
      scenarioType,
      agentPrompt,
      enhancedPersonalizationPrompt // Include conversation context
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
      const content = chunk.delta;
      fullOutput += content; // Collect the full output
      res.write(content); // Use delta for chat streaming
    }
    res.write("[DONE-UP]");
    res.end();

    // 🔥 POST-STREAM: SQS + Real-time Analysis
    console.log("Starting post-stream analysis...");

    // Get chat history count for analysis triggers using conversation context
    const chatHistoryCount = conversationContext.metadata.totalMessages;

    // Create mock chat history array for analysis (similar to Lambda structure)
    const mockChatHistory = Array(chatHistoryCount).fill({
      role: "user",
      content: "message",
    });

    await Promise.all([
      triggerRealtimeAnalysis(
        req.body,
        conversationId,
        userId,
        mockChatHistory,
        fullOutput
      ),
      sendToAnalysisQueues(req.body, conversationId, userId, mockChatHistory),
    ]);

    console.log("Post-stream analysis completed successfully");
  } catch (err) {
    console.error("Error in handleWhatToAskController:", err);

    // If streaming hasn't started, send error response
    if (!res.headersSent) {
      res.status(500).json({
        error: "An internal server error occurred.",
      });
    }
  }
}

// Fetch assistant configuration from DynamoDB
async function fetchAssistantConfig(assistantId, stage) {
  const env = stage || process.env.STAGE;
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
  const env = stage || process.env.STAGE;
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

// 🔥 REAL-TIME ANALYSIS (Direct Lambda call for speed)
async function triggerRealtimeAnalysis(
  requestBody,
  conversationId,
  userId,
  chatHistory,
  fullOutput
) {
  const realtimePayload = {
    message: {
      id: uuidv4(),
      content: requestBody.query,
      role: "user",
      timestamp: new Date().toISOString(),
    },
    conversationContext: {
      conversationId: conversationId,
      lastAssistantMessage: fullOutput,
      messageCount: chatHistory.length + 1,
      assistantId: requestBody.assistantId,
    },
    userId: userId,
    assistantId: requestBody.assistantId,
  };

  try {
    const command = new InvokeCommand({
      FunctionName: `realtimeMessageAnalysis-${process.env.STAGE}`,
      InvocationType: "Event",
      Payload: JSON.stringify({
        body: JSON.stringify(realtimePayload),
      }),
    });

    await lambdaClient.send(command);
    console.log("Real-time analysis triggered successfully");
  } catch (error) {
    console.error("Real-time analysis failed:", error);
    // Don't fail main flow for analysis errors
  }
}

// 🔥 SQS QUEUE INTEGRATION
async function sendToAnalysisQueues(
  requestBody,
  conversationId,
  userId,
  chatHistory
) {
  const messageCount = chatHistory.length + 1;
  const timestamp = new Date().toISOString();
  const analysisRequests = [];

  // Periodic analysis (every 10 messages)
  if (messageCount % 10 === 0) {
    analysisRequests.push({
      queue: ANALYSIS_QUEUE_URL,
      priority: "medium",
      message: {
        conversationId: conversationId,
        userId: userId,
        triggerType: "periodic_analysis",
        messageCount: messageCount,
        metadata: {
          reason: `Periodic analysis at ${messageCount} messages`,
          timestamp: timestamp,
        },
      },
    });
  }

  // Initial analysis (3rd message) - HIGH PRIORITY
  if (messageCount === 3) {
    analysisRequests.push({
      queue: PRIORITY_QUEUE_URL,
      priority: "high",
      message: {
        conversationId: conversationId,
        userId: userId,
        triggerType: "initial_analysis",
        messageCount: messageCount,
        metadata: {
          reason: "Initial conversation analysis for personalization",
          timestamp: timestamp,
          urgency: "immediate_personalization",
        },
      },
    });
  }

  // Milestone analysis (25, 50, 100 messages)
  if ([25, 50, 100].includes(messageCount)) {
    analysisRequests.push({
      queue: ANALYSIS_QUEUE_URL,
      priority: "medium",
      message: {
        conversationId: conversationId,
        userId: userId,
        triggerType: "milestone_analysis",
        messageCount: messageCount,
        metadata: {
          reason: `Milestone analysis at ${messageCount} messages`,
          timestamp: timestamp,
          milestone: messageCount,
        },
      },
    });
  }

  // Time-based analysis (30+ minutes)
  try {
    const conversationStart = await getConversationStartTime(conversationId);
    const duration = Date.now() - conversationStart;

    if (duration > 30 * 60 * 1000 && messageCount % 10 !== 0) {
      // Don't duplicate with periodic
      analysisRequests.push({
        queue: ANALYSIS_QUEUE_URL,
        priority: "medium",
        message: {
          conversationId: conversationId,
          userId: userId,
          triggerType: "time_based_analysis",
          messageCount: messageCount,
          metadata: {
            reason: "Long conversation duration analysis",
            timestamp: timestamp,
            duration: duration,
          },
        },
      });
    }
  } catch (error) {
    console.error("Error checking conversation duration:", error);
  }

  // Send to SQS queues
  if (analysisRequests.length > 0) {
    const sqsPromises = analysisRequests.map((request) => sendToSQS(request));
    await Promise.all(sqsPromises);
    console.log(`Sent ${analysisRequests.length} analysis requests to SQS`);
  }
}

// 🔥 SQS SEND FUNCTION
async function sendToSQS({ queue, priority, message }) {
  try {
    const messageAttributes = {
      userId: {
        DataType: "String",
        StringValue: message.userId,
      },
      priority: {
        DataType: "String",
        StringValue: priority,
      },
      conversationId: {
        DataType: "String",
        StringValue: message.conversationId,
      },
      triggerType: {
        DataType: "String",
        StringValue: message.triggerType,
      },
    };

    const sqsParams = {
      QueueUrl: queue,
      MessageBody: JSON.stringify(message),
      MessageAttributes: messageAttributes,
    };

    // Add FIFO-specific parameters for priority queue
    if (queue === PRIORITY_QUEUE_URL) {
      sqsParams.MessageGroupId = message.conversationId;
      sqsParams.MessageDeduplicationId = `${message.conversationId}-${
        message.messageCount
      }-${message.triggerType}-${Date.now()}`;
    }

    const command = new SendMessageCommand(sqsParams);
    await sqsClient.send(command);
    console.log(`Sent ${message.triggerType} to ${priority} priority queue`);
  } catch (error) {
    console.error(`Error sending to SQS (${priority}):`, error);
    // Don't fail main flow for SQS errors
  }
}

// Helper function - get conversation start time
async function getConversationStartTime(conversationId) {
  if (!conversationId) return Date.now();

  const env = process.env.STAGE;
  const params = {
    TableName: `UpConversationMessage-${env}`,
    KeyConditionExpression: "conversationId = :conversationId",
    ScanIndexForward: true,
    Limit: 1,
    ExpressionAttributeValues: {
      ":conversationId": conversationId,
    },
  };

  try {
    const command = new QueryCommand(params);
    const result = await dynamoDbClient.send(command);
    if (result.Items && result.Items.length > 0) {
      return new Date(result.Items[0].createdAt).getTime();
    }
    return Date.now();
  } catch (error) {
    console.error("Error getting conversation start time:", error);
    return Date.now();
  }
}

// Helper function to get chat history count
async function getChatHistoryCount(conversationId) {
  if (!conversationId) return 0;

  const env = process.env.STAGE;
  const params = {
    TableName: `UpConversationMessage-${env}`,
    KeyConditionExpression: "conversationId = :conversationId",
    Select: "COUNT",
    ExpressionAttributeValues: {
      ":conversationId": conversationId,
    },
  };

  try {
    const command = new QueryCommand(params);
    const result = await dynamoDbClient.send(command);
    return result.Count || 0;
  } catch (error) {
    console.error("Error getting chat history count:", error);
    return 0;
  }
}

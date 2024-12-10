import {
  OpenAI,
  PineconeVectorStore,
  VectorStoreIndex,
  Settings,
  OpenAIEmbedding,
  ContextChatEngine,
  SummaryIndex,
  OpenAIContextAwareAgent,
  getResponseSynthesizer,
  RetrieverQueryEngine,
  VectorIndexRetriever,
} from "llamaindex";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

const dynamoDbClient = new DynamoDBClient({
  region: "us-east-1",
});

// Helper function for timing measurements
function getTimeElapsed(startTime) {
  const elapsed = process.hrtime(startTime);
  return (elapsed[0] * 1000 + elapsed[1] / 1000000).toFixed(2); // Convert to milliseconds
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
    model: "gpt-4o",
    deployment: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
    additionalChatOptions: {
      deployment: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
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
    chunkSize: 100,
    storesText: true,
  });

  const pcvs_assistant = new PineconeVectorStore({
    indexName: "assistant-documents",
    chunkSize: 100,
    storesText: true,
  });

  const index_chat_messages = await VectorStoreIndex.fromVectorStore(pcvs_chat);
  const index_assistant_documents = await VectorStoreIndex.fromVectorStore(
    pcvs_assistant
  );

  return { index_chat_messages, index_assistant_documents };
}

function createRetrievers(
  index_chat_messages,
  index_assistant_documents,
  conversationId,
  assistantId
) {
  const retriever_chat = new VectorIndexRetriever({
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
    similarityTopK: 100,
  });

  const retriever_assistant = new VectorIndexRetriever({
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
    similarityTopK: 100,
  });

  return { retriever_chat, retriever_assistant };
}

class CombinedRetriever {
  constructor(retrievers) {
    this.retrievers = retrievers;
  }

  async retrieve(query) {
    const retrievalStartTime = process.hrtime();
    const results = await Promise.all(
      this.retrievers.map((retriever) => retriever.retrieve(query))
    );
    const retrievalTime = getTimeElapsed(retrievalStartTime);
    console.log("Combined retrieval time:", retrievalTime, "ms");
    return results.flat();
  }
}

// Fetch assistant configuration from DynamoDB
async function fetchAssistantConfig(assistantId) {
  const env = process.env.STAGE;
  const params = {
    TableName: `UpAssistant-${env}`,
    Key: {
      id: assistantId,
    },
  };
  const result = await dynamoDbClient.send(new GetCommand(params));
  return result.Item ? result.Item : null;
}

// Controller to handle streaming reflection requests
export async function handleWhatToAskController(req, res) {
  const functionStartTime = process.hrtime();
  console.log("Function started at:", new Date().toISOString());

  const { userId, conversationId } = req.params;
  const { query, assistantId, type } = req.body;

  const timings = {
    configFetch: 0,
    initialization: 0,
    indicesCreation: 0,
    retrieversSetup: 0,
    queryEngineSetup: 0,
    totalSetup: 0,
    firstResponseTime: 0,
  };

  try {
    // Timing: Config fetch
    const configStartTime = process.hrtime();
    const systemMessage = await fetchAssistantConfig(assistantId);
    timings.configFetch = getTimeElapsed(configStartTime);

    if (!systemMessage) throw new Error("Assistant configuration not found");
    const replacedPatterns = replacePatterns(systemMessage.prompt);
    const assistantConfig = {
      temperature: parseFloat(systemMessage.temperature) || 0.2,
      topP: parseFloat(systemMessage.topP) || 0.95,
      maxTokens: parseInt(systemMessage.maxTokens) || 800,
      frequencyPenalty: parseFloat(systemMessage.frequencyPenalty) || 0.0,
      presencePenalty: parseFloat(systemMessage.presencePenalty) || 0.0,
      responseType: "text",
      stream: true,
    };

    // Timing: Initialization
    const initStartTime = process.hrtime();
    await initializeSettings(assistantConfig);
    timings.initialization = getTimeElapsed(initStartTime);

    // Timing: Indices creation
    const indicesStartTime = process.hrtime();
    const { index_chat_messages, index_assistant_documents } =
      await createIndices();
    timings.indicesCreation = getTimeElapsed(indicesStartTime);

    // Timing: Retrievers setup
    const retrieversStartTime = process.hrtime();
    const { retriever_chat, retriever_assistant } = createRetrievers(
      index_chat_messages,
      index_assistant_documents,
      conversationId,
      assistantId
    );

    const combinedRetriever = new CombinedRetriever([
      retriever_chat,
      retriever_assistant,
    ]);
    timings.retrieversSetup = getTimeElapsed(retrieversStartTime);

    // Timing: Query engine setup
    const queryEngineStartTime = process.hrtime();
    const responseSynthesizer = await getResponseSynthesizer("tree_summarize", {
      llm: new OpenAI({
        azure: {
          endpoint: process.env.AZURE_OPENAI_ENDPOINT,
          deployment: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
          apiKey: process.env.AZURE_OPENAI_KEY,
        },
        model: "gpt-4o",
        additionalChatOptions: {
          frequency_penalty: assistantConfig.frequencyPenalty,
          presence_penalty: assistantConfig.presencePenalty,
          stream: assistantConfig.stream ? assistantConfig.stream : undefined,
        },
        temperature: assistantConfig.temperature,
        topP: assistantConfig.topP,
      }),
    });

    const queryEngine = new RetrieverQueryEngine(
      combinedRetriever,
      responseSynthesizer
    );
    timings.queryEngineSetup = getTimeElapsed(queryEngineStartTime);

    const query_ = `[System Prompts: 
            ${replacedPatterns}]
            -----------------------------------
            User Query:
                ${query}
            `;

    timings.totalSetup = getTimeElapsed(functionStartTime);

    // Log all timings before streaming starts
    console.log("Performance Metrics (ms):", {
      ...timings,
      timestamp: new Date().toISOString(),
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

    // Retrieve and stream the result
    const streamStartTime = process.hrtime();
    const result = await queryEngine.query({
      stream: true,
      query: query_,
    });

    if (result && typeof result[Symbol.asyncIterator] === "function") {
      let isFirstChunk = true;
      for await (const chunk of result) {
        if (isFirstChunk) {
          timings.firstResponseTime = getTimeElapsed(streamStartTime);
          console.log("Time to first chunk:", timings.firstResponseTime, "ms");
          isFirstChunk = false;
        }
        console.log(chunk.response);
        res.write(chunk.response);
      }
      const totalTime = getTimeElapsed(functionStartTime);
      console.log("Stream completed. Total execution time:", totalTime, "ms");
      res.write("[DONE-UP]");
      res.end();
    } else {
      // Handle non-async iterable response
      const totalTime = getTimeElapsed(functionStartTime);
      console.log(
        "Non-streaming response completed. Total time:",
        totalTime,
        "ms"
      );
      res.write("[DONE-UP]");
      res.end(result.response || "No response");
    }
  } catch (err) {
    const errorTime = getTimeElapsed(functionStartTime);
    console.error("Error occurred after:", errorTime, "ms");
    console.error(err);
    res.status(500).json({
      error: err.message,
      timings,
    });
  }
}

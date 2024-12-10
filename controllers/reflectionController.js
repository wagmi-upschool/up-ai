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

// Load environment variables
dotenv.config();

const dynamoDbClient = new DynamoDBClient({
  region: "us-east-1",
});

// Helper function for timing measurements
function getTimeElapsed(startTime) {
  const elapsed = process.hrtime(startTime);
  return (elapsed[0] * 1000 + elapsed[1] / 1000000).toFixed(2);
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

// Create and return a Pinecone-based index
async function createIndex(conversationId) {
  const pcvs = new PineconeVectorStore({
    indexName: "chat-messages",
    chunkSize: 100,
    storesText: true,
  });
  return await VectorStoreIndex.fromVectorStore(pcvs);
}

function createRetriever(index, conversationId, type) {
  const retriever = new VectorIndexRetriever({
    index: index,
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
  return retriever;
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

// Helper function to handle stream chunks
async function handleStreamChunk(chunk, res) {
  if (!chunk) return;

  if (typeof chunk === "string") {
    res.write(chunk);
  } else if (chunk.response) {
    res.write(chunk.response);
  } else if (chunk.text) {
    res.write(chunk.text);
  } else if (chunk.content) {
    res.write(chunk.content);
  }
}

// Helper function to create OpenAI instance
function createOpenAIInstance(config) {
  return new OpenAI({
    azure: {
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      deployment: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
      apiKey: process.env.AZURE_OPENAI_KEY,
    },
    model: "gpt-4o",
    additionalChatOptions: {
      frequency_penalty: config.frequencyPenalty,
      presence_penalty: config.presencePenalty,
      stream: true,
    },
    temperature: config.temperature,
    topP: config.topP,
  });
}

export async function handleReflection(req, res) {}
// Controller to handle streaming reflection requests
// ... (previous imports and helper functions remain the same)

export async function handleReflectionStream(req, res) {
  const functionStartTime = process.hrtime();
  console.log("Function started at:", new Date().toISOString());

  const { userId, conversationId } = req.params;
  const { query, assistantId, type } = req.body;
  console.log("Request details:", { query, assistantId, type });

  const timings = {
    configFetch: 0,
    initialization: 0,
    indexCreation: 0,
    streamSetup: 0,
    totalSetup: 0,
    firstChunk: 0,
  };

  try {
    // Config fetch timing
    const configStartTime = process.hrtime();
    const systemMessage = await fetchAssistantConfig(assistantId);
    timings.configFetch = getTimeElapsed(configStartTime);

    if (!systemMessage) throw new Error("Assistant configuration not found");
    console.log("System message retrieved:", { prompt: systemMessage.prompt });

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
    console.log("Assistant config:", assistantConfig);

    // Initialization timing
    const initStartTime = process.hrtime();
    await initializeSettings(assistantConfig);
    timings.initialization = getTimeElapsed(initStartTime);

    // Index creation timing
    const indexStartTime = process.hrtime();
    const index = await createIndex(conversationId);
    const retriever = await createRetriever(
      index,
      conversationId,
      type || "default"
    );
    timings.indexCreation = getTimeElapsed(indexStartTime);

    // Set headers
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

    try {
      const streamSetupTime = process.hrtime();
      let response;

      // Create OpenAI instance with explicit configurations
      const llm = new OpenAI({
        azure: {
          endpoint: process.env.AZURE_OPENAI_ENDPOINT,
          deployment: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
          apiKey: process.env.AZURE_OPENAI_KEY,
        },
        model: "gpt-4o",
        additionalChatOptions: {
          frequency_penalty: assistantConfig.frequencyPenalty,
          presence_penalty: assistantConfig.presencePenalty,
          stream: true,
        },
        temperature: assistantConfig.temperature,
        topP: assistantConfig.topP,
      });

      // Get response synthesizer
      const responseSynthesizer = await getResponseSynthesizer(
        "tree_summarize",
        {
          llm,
        }
      );

      // Create query engine
      const queryEngine = new RetrieverQueryEngine(
        retriever,
        responseSynthesizer
      );

      console.log("Preparing query with system prompt");
      const query_ = `[System Prompts: 
            ${replacedPatterns}]
            -----------------------------------
            User Query:
                ${query}
            `;
      console.log("Final query:", query_);

      // Get response
      console.log("Executing query...");
      response = await queryEngine.query({
        stream: true,
        query: query_,
      });

      timings.streamSetup = getTimeElapsed(streamSetupTime);
      timings.totalSetup = getTimeElapsed(functionStartTime);

      console.log("Performance Metrics (ms):", {
        ...timings,
        timestamp: new Date().toISOString(),
      });

      if (!response) {
        throw new Error("No response received from the query engine");
      }

      // Handle Promise-like responses
      if (response.then) {
        console.log("Resolving Promise response");
        response = await response;
        console.log("Promise resolved:", { responseType: typeof response });
      }

      let hasWrittenContent = false;
      let isFirstChunk = true;
      const streamStartTime = process.hrtime();

      if (response.response) {
        // Single response
        console.log("Single response received");
        res.write(response.response);
        hasWrittenContent = true;
      } else if (response[Symbol.asyncIterator]) {
        // Stream response
        console.log("Processing stream response");
        for await (const chunk of response) {
          if (isFirstChunk) {
            timings.firstChunk = getTimeElapsed(streamStartTime);
            console.log(
              "First chunk received after:",
              timings.firstChunk,
              "ms"
            );
            console.log("First chunk content:", chunk);
            isFirstChunk = false;
          }

          if (chunk) {
            if (typeof chunk === "string") {
              console.log("Writing string chunk");
              res.write(chunk);
              hasWrittenContent = true;
            } else if (chunk.response) {
              console.log("Writing response chunk");
              res.write(chunk.response);
              hasWrittenContent = true;
            } else if (chunk.text) {
              console.log("Writing text chunk");
              res.write(chunk.text);
              hasWrittenContent = true;
            } else if (chunk.content) {
              console.log("Writing content chunk");
              res.write(chunk.content);
              hasWrittenContent = true;
            } else {
              console.log("Received chunk with unknown format:", chunk);
            }
          }
        }
      } else if (typeof response === "string") {
        // Direct string response
        console.log("Writing direct string response");
        res.write(response);
        hasWrittenContent = true;
      } else {
        console.log("Unexpected response type:", typeof response, response);
        throw new Error(`Unexpected response type: ${typeof response}`);
      }

      if (!hasWrittenContent) {
        console.log("No content was written to the response");
        res.write("No response generated. Please try again.");
      }

      const totalTime = getTimeElapsed(functionStartTime);
      console.log("Stream completed. Total execution time:", totalTime, "ms");

      res.write("[DONE-UP]");
      res.end();
    } catch (streamError) {
      console.error("Streaming error details:", {
        error: streamError,
        type: streamError.constructor.name,
        message: streamError.message,
        stack: streamError.stack,
      });

      const errorTime = getTimeElapsed(functionStartTime);
      console.log("Stream error occurred after:", errorTime, "ms");

      if (!res.headersSent) {
        res.status(500).json({
          error: "Streaming error occurred",
          details: streamError.message,
          timings,
          errorTime,
        });
      } else {
        res.write("\n[ERROR] Streaming interrupted");
        res.write("[DONE-UP]");
        res.end();
      }
    }
  } catch (err) {
    const errorTime = getTimeElapsed(functionStartTime);
    console.error("General error details:", {
      error: err,
      type: err.constructor.name,
      message: err.message,
      stack: err.stack,
    });
    console.log("Error occurred after:", errorTime, "ms");

    if (!res.headersSent) {
      res.status(500).json({
        error: err.message,
        timings,
        errorTime,
      });
    }
  }
}

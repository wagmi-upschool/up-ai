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

// Helper function to safely process and write stream chunks
async function processStreamChunk(chunk, res, hasWrittenContent) {
  if (!chunk) return hasWrittenContent;

  try {
    let content = "";

    if (typeof chunk === "string") {
      content = chunk;
    } else if (chunk.response) {
      content = String(chunk.response);
    } else if (chunk.text) {
      content = String(chunk.text);
    } else if (chunk.content) {
      content = String(chunk.content);
    } else if (typeof chunk.toString === "function") {
      content = chunk.toString();
    }

    if (content && content.trim()) {
      res.write(content);
      return true;
    }
  } catch (error) {
    console.error("Error processing chunk:", error, "Chunk:", chunk);
  }

  return hasWrittenContent;
}

// Helper function for direct LLM responses
async function getDirectLLMResponse(query, systemPrompt, llm) {
  console.log("Using direct LLM response as vector store is empty");
  try {
    const response = await llm.chat({
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: query,
        },
      ],
    });

    // Return a proper streaming format
    return {
      [Symbol.asyncIterator]: async function* () {
        const content =
          response.text ||
          response.response ||
          response.content ||
          response.toString();
        yield { response: String(content) };
      },
    };
  } catch (error) {
    console.error("Error in direct LLM response:", error);
    throw error;
  }
}

// Controller to handle streaming reflection requests
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

    // Initialization timing
    const initStartTime = process.hrtime();
    await initializeSettings(assistantConfig);
    timings.initialization = getTimeElapsed(initStartTime);

    // Create LLM instance
    const llm = createOpenAIInstance(assistantConfig);

    // Set response headers
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

    try {
      const streamSetupTime = process.hrtime();
      let response;
      let hasWrittenContent = false;

      // Create index and check vector store
      const index = await createIndex(conversationId);
      const retriever = await createRetriever(
        index,
        conversationId,
        type || "default"
      );
      const testResults = await retriever.retrieve(query);

      if (testResults.length === 0) {
        // No vector store results, use direct LLM
        response = await getDirectLLMResponse(query, replacedPatterns, llm);
      } else {
        // Use vector store results
        const responseSynthesizer = await getResponseSynthesizer(
          "tree_summarize",
          { llm }
        );
        const queryEngine = new RetrieverQueryEngine(
          retriever,
          responseSynthesizer
        );

        const query_ = `[System Prompts: 
            ${replacedPatterns}]
            -----------------------------------
            User Query:
                ${query}
            `;

        response = await queryEngine.query({
          stream: false, // Changed to false to handle streaming manually
          query: query_,
        });
      }

      timings.streamSetup = getTimeElapsed(streamSetupTime);
      timings.totalSetup = getTimeElapsed(functionStartTime);

      if (!response) {
        throw new Error("No response received from the engine");
      }

      // Process the response
      if (typeof response === "object" && response.response) {
        // Handle single response object
        hasWrittenContent = await processStreamChunk(
          response,
          res,
          hasWrittenContent
        );
      } else if (typeof response === "string") {
        // Handle direct string response
        hasWrittenContent = await processStreamChunk(
          response,
          res,
          hasWrittenContent
        );
      } else if (response[Symbol.asyncIterator]) {
        // Handle streaming response
        for await (const chunk of response) {
          hasWrittenContent = await processStreamChunk(
            chunk,
            res,
            hasWrittenContent
          );
        }
      }

      // Use fallback if no content was written
      if (!hasWrittenContent) {
        const fallbackResponse = await llm.chat({
          messages: [
            {
              role: "system",
              content: replacedPatterns,
            },
            {
              role: "user",
              content: query,
            },
          ],
        });

        const fallbackText = String(
          fallbackResponse.text ||
            fallbackResponse.response ||
            fallbackResponse.content ||
            "I apologize, but I couldn't generate a response. Please try rephrasing your question."
        );

        res.write(fallbackText);
      }

      const totalTime = getTimeElapsed(functionStartTime);
      console.log("Stream completed. Total execution time:", totalTime, "ms");

      res.write("[DONE-UP]");
      res.end();
    } catch (streamError) {
      console.error("Streaming error:", streamError);
      const errorTime = getTimeElapsed(functionStartTime);

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
    console.error("General error:", err);

    if (!res.headersSent) {
      res.status(500).json({
        error: err.message,
        timings,
        errorTime,
      });
    }
  }
}

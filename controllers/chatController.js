import {
  OpenAI,
  PineconeVectorStore,
  VectorStoreIndex,
  Settings,
  OpenAIEmbedding,
  getResponseSynthesizer,
  RetrieverQueryEngine,
  VectorIndexRetriever,
} from "llamaindex";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import dotenv from "dotenv";

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

async function initializeSettings(config) {
  const { setEnvs } = await import("@llamaindex/env");
  setEnvs(process.env);
  Settings.llm = new OpenAI({
    model: process.env.MODEL,
    deployment: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
    additionalChatOptions: {
      deployment: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
      frequency_penalty: config.frequencyPenalty,
      presence_penalty: config.presencePenalty,
      stream: true,
    },
    temperature: config.temperature,
    topP: config.topP,
  });
  Settings.embedModel = new OpenAIEmbedding({
    model: "text-embedding-3-small",
    azure: getAzureEmbeddingOptions(),
  });
}

async function createIndices() {
  const pcvs_chat = new PineconeVectorStore({
    indexName: "chat-messages",
    chunkSize: 100,
    storesText: true,
    embeddingModel: new OpenAIEmbedding({
      model: "text-embedding-3-small",
      azure: getAzureEmbeddingOptions(),
    }),
  });

  const pcvs_assistant = new PineconeVectorStore({
    indexName: "assistant-documents",
    chunkSize: 100,
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

  return { index_chat_messages, index_assistant_documents };
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
    similarityTopK: 100,
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
    similarityTopK: 100,
  });
}

class CombinedRetriever {
  constructor(retrievers, retrieverTypes) {
    this.retrievers = retrievers;
    this.retrieverTypes = retrieverTypes; // Array of types matching retrievers array
  }

  async retrieve(query) {
    const results = await Promise.all(
      this.retrievers.map((retriever, index) =>
        retriever.retrieve(query).then((nodes) =>
          nodes.map((node) => {
            // Add source metadata to each node
            if (!node.metadata) {
              node.metadata = {};
            }
            node.metadata.source_type = this.retrieverTypes[index];
            return node;
          })
        )
      )
    );
    return results.flat();
  }
}

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

export async function handleLLMStream(req, res) {
  const functionStartTime = process.hrtime();
  console.log("Function started at:", new Date().toISOString());

  const { userId, conversationId } = req.params;
  const { query, assistantId, stage } = req.body;
  console.log(
    "userId:",
    userId,
    "conversationId:",
    conversationId,
    "query:",
    query,
    "assistantId:",
    assistantId,
    "stage:",
    stage
  );

  const timings = {
    configFetch: 0,
    initialization: 0,
    streamSetup: 0,
    totalSetup: 0,
  };

  try {
    const configStartTime = process.hrtime();
    const systemMessage = await fetchAssistantConfig(assistantId, stage);
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

    const initStartTime = process.hrtime();
    await initializeSettings(assistantConfig);
    timings.initialization = getTimeElapsed(initStartTime);

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

    // Create indices for both chat messages and assistant documents
    const { index_chat_messages, index_assistant_documents } =
      await createIndices();

    let retrievers = [];
    let retrieverTypes = [];
    let response;

    // Add chat retriever if we have a conversation ID
    if (conversationId) {
      const retriever_chat = createChatRetriever({
        index_chat_messages,
        conversationId,
      });
      retrievers.push(retriever_chat);
      retrieverTypes.push("chat");
    }

    // Add assistant retriever if we have an assistant ID
    if (assistantId) {
      const retriever_assistant = createAssistantRetriever({
        index_assistant_documents,
        assistantId,
      });
      retrievers.push(retriever_assistant);
      retrieverTypes.push("assistant");
    }

    // Create combined retriever
    const combinedRetriever = new CombinedRetriever(retrievers, retrieverTypes);

    // Get results from all retrievers
    const results = await combinedRetriever.retrieve(query);
    console.log("Retrieved results:", results);

    if (!conversationId || conversationId === "null" || results.length === 0) {
      console.log("Using direct LLM response");
      const llm = new OpenAI({
        azure: {
          endpoint: process.env.AZURE_OPENAI_ENDPOINT,
          deployment: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
          apiKey: process.env.AZURE_OPENAI_KEY,
        },
        model: process.env.MODEL,
        additionalChatOptions: {
          frequency_penalty: assistantConfig.frequencyPenalty,
          presence_penalty: assistantConfig.presencePenalty,
          stream: false,
        },
        temperature: assistantConfig.temperature,
        topP: assistantConfig.topP,
      });

      const response = await llm.chat({
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
        stream: true,
      });

      for await (const chunk of response) {
        res.write(chunk.delta);
      }

      console.log(response);
    } else {
      console.log("Using retriever response");

      const responseSynthesizer = await getResponseSynthesizer("refine", {
        llm: new OpenAI({
          azure: {
            endpoint: process.env.AZURE_OPENAI_ENDPOINT,
            deployment: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
            apiKey: process.env.AZURE_OPENAI_KEY,
          },
          model: process.env.MODEL,
          additionalChatOptions: {
            frequency_penalty: assistantConfig.frequencyPenalty,
            presence_penalty: assistantConfig.presencePenalty,
            stream: true,
          },
          temperature: assistantConfig.temperature,
          topP: assistantConfig.topP,
        }),
        textQATemplate: `
            Context information is provided below. This information comes from two sources:
            1. Conversation history - which contains previous messages from the chat
            2. Knowledge base - which contains reference documents and information
            
            The sources are marked in the context.
            
            Given this information, please answer the query.
            
            Context:
            {context_str}
            
            Query: {query_str}
            
            Answer:
          `,
      });

      // Define a transformer function to preprocess retrieved nodes
      const transformNodes = (nodes) => {
        return nodes.map((node) => {
          // Add source type prefix to each node's text
          const sourceType = node.metadata?.source_type || "unknown";
          let prefix = "";

          if (sourceType === "chat") {
            prefix = "[FROM CONVERSATION HISTORY]: ";
          } else if (sourceType === "assistant") {
            prefix = "[FROM KNOWLEDGE BASE]: ";
          }

          // Create a copy of the node with modified text
          return {
            ...node,
            text: prefix + node.text,
          };
        });
      };

      const queryEngine = new RetrieverQueryEngine(
        combinedRetriever,
        responseSynthesizer,
        undefined,
        {
          nodeTransformer: transformNodes,
        }
      );

      response = await queryEngine.query({
        query: query,
        stream: true,
      });

      console.log(response);
      let fullOutput = "";
      for await (const chunk of response) {
        fullOutput += chunk.delta;
        res.write(chunk.delta);
      }
      console.log("Full output:", fullOutput);
    }
    res.write("[DONE-UP]");
    res.end();
  } catch (err) {
    console.error("Error in handleLLMStream:", err);
    const errorTime = getTimeElapsed(functionStartTime);

    if (!res.headersSent) {
      res.status(500).json({
        error: err.message,
        timings,
        errorTime,
      });
    } else {
      res.write("\n[ERROR] Streaming interrupted");
      res.write("[DONE-UP]");
      res.end();
    }
  }
}

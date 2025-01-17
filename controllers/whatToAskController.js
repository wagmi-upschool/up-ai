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
    model: process.env.MODEL,
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
  constructor(retrievers) {
    this.retrievers = retrievers;
  }

  async retrieve(query) {
    const results = await Promise.all(
      this.retrievers.map((retriever) => retriever.retrieve(query))
    );
    return results.flat();
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

// Controller to handle streaming reflection requests
export async function handleWhatToAskController(req, res) {
  const { userId, conversationId } = req.params;
  const { query, assistantId, type, stage } = req.body;

  try {
    const systemMessage = await fetchAssistantConfig(assistantId, stage);
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
    await initializeSettings(assistantConfig);

    // Create indices for both chat messages and assistant documents
    const { index_chat_messages, index_assistant_documents } =
      await createIndices();

    const retriever_chat = createChatRetriever({
      index_chat_messages: index_chat_messages,
      conversationId: conversationId,
    });

    const retriever_assistant = createAssistantRetriever({
      index_assistant_documents: index_assistant_documents,
      assistantId: assistantId,
    });

    // Combine the retrievers
    const combinedRetriever =
      conversationId == null
        ? new CombinedRetriever([retriever_assistant])
        : new CombinedRetriever([retriever_chat, retriever_assistant]);

    // console.log(retriever_chat);
    // console.log(retriever_chat.filters);
    // console.log(retriever_chat.filters.filters);

    // console.log(retriever_assistant);
    // console.log(retriever_assistant.filters);
    // console.log(retriever_assistant.filters.filters);

    console.log(await combinedRetriever.retrieve("networking"));

    const responseSynthesizer = await getResponseSynthesizer("tree_summarize", {
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

    const query_ = `[System Prompts: 
            ${replacedPatterns}]
            -----------------------------------
            User Query:
                ${query}
            `;

    console.log();
    // Retrieve the result from queryEngine
    const result = await queryEngine.query({
      stream: true,
      query: query_,
    });

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");

    // Stream each chunk of the response
    if (result && typeof result[Symbol.asyncIterator] === "function") {
      for await (const chunk of result) {
        console.log(chunk.response);
        res.write(chunk.response);
      }
      res.write("[DONE-UP]");
      res.end();
    } else {
      // Handle non-async iterable response
      res.end(result.response || "No response");
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message,
    });
  }
}

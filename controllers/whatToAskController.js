import {
  OpenAI,
  PineconeVectorStore,
  VectorStoreIndex,
  Settings,
  OpenAIEmbedding,
  getResponseSynthesizer,
  RetrieverQueryEngine,
  VectorIndexRetriever,
  defaultRefinePrompt
} from "llamaindex";
import {
  GetCommand
} from "@aws-sdk/lib-dynamodb";
import {
  DynamoDBClient
} from "@aws-sdk/client-dynamodb";
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
  const {
    setEnvs
  } = await import("@llamaindex/env");
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
    index_assistant_documents
  };
}

function createAssistantRetriever({
  index_assistant_documents,
  assistantId
}) {
  return new VectorIndexRetriever({
    index: index_assistant_documents,
    includeValues: true,
    filters: {
      filters: [{
        key: "assistantId",
        value: assistantId,
        operator: "==",
      },],
    },
    similarityTopK: 5,
  });
}

function createChatRetriever({
  index_chat_messages,
  conversationId
}) {
  return new VectorIndexRetriever({
    index: index_chat_messages,
    includeValues: true,
    filters: {
      filters: [{
        key: "conversationId",
        value: conversationId,
        operator: "==",
      },],
    },
    similarityTopK: 5,
  });
}

// Update the CombinedRetriever to properly merge results
class CombinedRetriever {
  constructor(retrievers) {
    this.retrievers = retrievers;
  }

  async retrieve(query) {
    // Get results from all retrievers
    const results = await Promise.all(
      this.retrievers.map((retriever) => retriever.retrieve(query))
    );

    // Flatten and sort by score
    const flatResults = results.flat().sort((a, b) =>
      (b.score || 0) - (a.score || 0)
    );

    return flatResults;
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

// First, let's add a helper function to filter results by score
function filterByScore(results, minScore = 0.40) {
  return results.filter(result => (result.score || 0) > minScore);
}

// Controller to handle streaming reflection requests
export async function handleWhatToAskController(req, res) {
  const {
    userId,
    conversationId
  } = req.params;
  const {
    query,
    assistantId,
    type,
    stage
  } = req.body;

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
    const {
      index_chat_messages,
      index_assistant_documents
    } =
      await createIndices();

    // First, retrieve relevant assistant documents
    const retriever_assistant = createAssistantRetriever({
      index_assistant_documents,
      assistantId,
    });

    let assistantDocs = await retriever_assistant.retrieve(query);
    assistantDocs = filterByScore(assistantDocs);

    // Then get relevant chat history for context
    const retriever_chat = createChatRetriever({
      index_chat_messages,
      conversationId,
    });
    let chatHistory = await retriever_chat.retrieve(query);
    chatHistory = filterByScore(chatHistory);

    // Format chat history into a conversation format
    const formattedChatHistory = chatHistory
      .sort((a, b) => (new Date(a.node.metadata?.createdAt).getTime() || 0) - (new Date(b.node.metadata?.createdAt).getTime() || 0))
      .map(msg => `${msg.node.metadata?.role || 'Unknown'}: ${msg.node.text}`)
      .join('\n');
    // -----------------------------------
    const formattedQuery = `
            System Prompt:
            ${replacedPatterns}
            -----------------------------------
            ${assistantDocs.length > 0 ? `Knowledge Base:\n${assistantDocs.map(doc => doc.node.text).join('\n')}\n-----------------------------------` : ''}
            ${chatHistory.length > 0 ? `Conversation History:\n${formattedChatHistory}\n-----------------------------------` : ''}
            Current User Query:
            ${query}
            -----------------------------------
            ${getInstructions(assistantDocs.length > 0, chatHistory.length > 0)}
            `;

    // Helper function to generate appropriate instructions based on available context
    function getInstructions(hasKnowledge, hasHistory) {
      if (hasKnowledge && hasHistory) {
        return `Based on the Knowledge Base and Conversation History above:
            1. First understand the user's intent from the Current User Query
            2. Find relevant information from the Knowledge Base
            3. Consider the context from the Conversation History
            4. Provide a clear and contextual response`;
      } else if (hasKnowledge) {
        return `Based on the Knowledge Base above:
            1. First understand the user's intent from the Current User Query
            2. Find relevant information from the Knowledge Base
            3. Provide a clear and informative response`;
      } else if (hasHistory) {
        return `Based on the Conversation History above:
            1. First understand the user's intent from the Current User Query
            2. Consider the context from the Conversation History
            3. Provide a contextually appropriate response`;
      } else {
        return `Based on the System Prompt:
            1. First understand the user's intent from the Current User Query
            2. Provide a response aligned with the system context
            3. If you cannot provide a specific answer, guide the user appropriately`;
      }
    }

    console.log('-----------------------------------');
    console.log(formattedQuery);
    const responseSynthesizer = await getResponseSynthesizer("compact", {
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
          stream: assistantConfig.stream,
        },
        temperature: assistantConfig.temperature,
        topP: assistantConfig.topP,
      }),
      refineTemplate: defaultRefinePrompt.partialFormat({
        query: query,
        existingAnswer: formattedChatHistory,
        context: `${assistantDocs.map(doc => doc.node.text).join('\n')}`,
      }),
      textQATemplate: defaultRefinePrompt.partialFormat({
        chatHistory: formattedChatHistory,
        existingAnswer: formattedChatHistory,
        query: query,
        question: query,
        context: `${assistantDocs.map(doc => doc.node.text).join('\n')}`,
      }),
    });

    // Create query engine with just the assistant documents retriever
    const queryEngine = new RetrieverQueryEngine(
      retriever_assistant,
      responseSynthesizer
    );
    queryEngine.updatePrompts({
      textQATemplate: defaultRefinePrompt.partialFormat({
        chatHistory: formattedChatHistory,
        existingAnswer: formattedChatHistory,
        query: query,
        question: query,
        context: `${assistantDocs.map(doc => doc.node.text).join('\n')}`,
      }),
      refineTemplate: defaultRefinePrompt.partialFormat({
        query: query,
        existingAnswer: formattedChatHistory,
        context: `${assistantDocs.map(doc => doc.node.text).join('\n')}`,
      }),
    });
    // Retrieve the result from queryEngine with the formatted query
    const result = await queryEngine.query({
      stream: true,
      query: formattedQuery,
    });

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Transfer-Encoding", "chunked");

    // Stream each chunk of the response
    if (result && typeof result[Symbol.asyncIterator] === "function") {
      for await (const chunk of result) {
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
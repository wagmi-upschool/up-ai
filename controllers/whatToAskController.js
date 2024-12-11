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

function getTimeElapsed(startTime) {
  const elapsed = process.hrtime(startTime);
  return (elapsed[0] * 1000 + elapsed[1] / 1000000).toFixed(2);
}

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

class FallbackRetriever {
  constructor(retrievers) {
    this.retrievers = retrievers.filter((retriever) => retriever !== null);
  }

  async retrieve(query) {
    let allResults = [];

    for (const retriever of this.retrievers) {
      try {
        const results = await retriever.retrieve(query);
        if (results && results.length > 0) {
          allResults = allResults.concat(results);
        }
      } catch (error) {
        console.warn(`Retriever error: ${error.message}`);
        // Continue to next retriever
      }
    }

    return allResults;
  }
}

function createRetrievers(
  index_chat_messages,
  index_assistant_documents,
  conversationId,
  assistantId
) {
  // Only create chat retriever if conversationId exists
  const retriever_chat = conversationId
    ? new VectorIndexRetriever({
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
      })
    : null;

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

export async function handleWhatToAskController(req, res) {
  const functionStartTime = process.hrtime();

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

    const initStartTime = process.hrtime();
    await initializeSettings(assistantConfig);
    timings.initialization = getTimeElapsed(initStartTime);

    const indicesStartTime = process.hrtime();
    const { index_chat_messages, index_assistant_documents } =
      await createIndices();
    timings.indicesCreation = getTimeElapsed(indicesStartTime);

    const retrieversStartTime = process.hrtime();
    const { retriever_chat, retriever_assistant } = createRetrievers(
      index_chat_messages,
      index_assistant_documents,
      conversationId,
      assistantId
    );

    // Create array of retrievers, excluding null retrievers
    const retrievers = [retriever_chat, retriever_assistant].filter(Boolean);

    const fallbackRetriever = new FallbackRetriever(retrievers);
    timings.retrieversSetup = getTimeElapsed(retrieversStartTime);

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
      fallbackRetriever,
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

    console.log("Performance Metrics (ms):", {
      ...timings,
      timestamp: new Date().toISOString(),
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

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
        res.write(chunk.response);
      }
      const totalTime = getTimeElapsed(functionStartTime);
      console.log("Stream completed. Total execution time:", totalTime, "ms");
      res.write("[DONE-UP]");
      res.end();
    } else {
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

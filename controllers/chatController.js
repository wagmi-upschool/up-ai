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
import { AssistantInputOptionsService } from "../services/assistantInputOptionsService.js";
import dotenv from "dotenv";

dotenv.config();

const dynamoDbClient = new DynamoDBClient({
  region: "us-east-1",
});

const assistantInputOptionsService = new AssistantInputOptionsService({
  stage: process.env.STAGE,
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

// Normalize noisy topic labels (e.g., "2️⃣ İlk Kademe Yönetim (...)") into the plain value stored in metadata
function normalizeTopicValue(topic) {
  if (!topic) return null;
  // Drop anything in parentheses and strip emojis/numbers/punctuation
  const withoutParens = topic.split("(")[0];
  const cleaned = withoutParens
    .replace(/[^\p{L}\s]/gu, " ") // keep only letters and spaces
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

function logRetrieverSamples(results, label = "results", maxItems = 3) {
  try {
    results.slice(0, maxItems).forEach((doc, idx) => {
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
      console.log(
        `[${label} ${idx} metadata obj]:`,
        doc?.node?.metadata || {}
      );
    });
  } catch (err) {
    console.error("Error logging retriever samples:", err);
  }
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

function createAssistantRetriever({
  index_assistant_documents,
  assistantId,
  topic,
}) {
  const normalizedTopic = normalizeTopicValue(topic);
  const filters = [
    {
      key: "assistantId",
      value: assistantId,
      operator: "==",
    },
  ];

  if (normalizedTopic) {
    filters.push({
      key: "topic",
      value: normalizedTopic,
      operator: "==",
    });
    console.log(
      `Filtering assistant documents by topic: ${normalizedTopic} (raw: ${topic})`
    );
  } else if (topic) {
    console.log(
      `Skipping topic filter; could not normalize topic from raw: ${topic}`
    );
  }

  return new VectorIndexRetriever({
    index: index_assistant_documents,
    includeValues: true,
    filters: {
      filters,
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

    // Detect topic from first user message (only when no prior user messages)
    const normalizedConversationId =
      conversationId &&
      conversationId !== "null" &&
      conversationId !== "undefined"
        ? conversationId
        : null;
    let priorUserMessages = 0;
    if (normalizedConversationId) {
      try {
        const chatHistoryRetriever = createChatRetriever({
          index_chat_messages,
          conversationId: normalizedConversationId,
        });
        const historyNodes = await chatHistoryRetriever.retrieve(
          "conversation history context"
        );
        priorUserMessages = historyNodes.filter(
          (n) => (n?.node?.metadata?.role || "").toLowerCase() === "user"
        ).length;
      } catch (err) {
        console.warn(
          "Could not determine prior user messages, assuming not first message:",
          err?.message
        );
        priorUserMessages = 1; // avoid applying topic filter on uncertainty
      }
    }
    const isFirstUserMessage = priorUserMessages === 0;
    let detectedTopic = null;

    if (isFirstUserMessage && query) {
      try {
        const normalizedQuery = query.toString().toLocaleLowerCase("tr").trim();
        const service =
          stage && stage !== process.env.STAGE
            ? new AssistantInputOptionsService({ stage })
            : assistantInputOptionsService;
        const options = await service.getAllOptions(assistantId);
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
      } catch (err) {
        console.error("Error detecting topic from input options:", err);
      }
    }

    let retrievers = [];
    let response;

    // Add chat retriever if we have a conversation ID
    if (normalizedConversationId) {
      const retriever_chat = createChatRetriever({
        index_chat_messages,
        conversationId: normalizedConversationId,
      });
      retrievers.push(retriever_chat);
    }

    // Add assistant retriever if we have an assistant ID
    if (assistantId) {
      const retriever_assistant = createAssistantRetriever({
        index_assistant_documents,
        assistantId,
        topic: detectedTopic,
      });
      retrievers.push(retriever_assistant);
    }

    // Create combined retriever
    const combinedRetriever = new CombinedRetriever(retrievers);

    // Get results from all retrievers
    const results = await combinedRetriever.retrieve(query);
    console.log("Retrieved results (raw):", results);
    try {
      const formatted = results.slice(0, 5).map((doc) => ({
        score: doc?.score || 0,
        metadata: doc?.node?.metadata || {},
        text:
          (doc?.node?.text || "").length > 200
            ? `${doc.node.text.substring(0, 200)}...`
            : doc?.node?.text || "",
      }));
      console.log(
        "Retrieved results (formatted metadata):",
        JSON.stringify(formatted, null, 2)
      );
    } catch (err) {
      console.error("Error formatting retrieved results:", err);
    }
    logRetrieverSamples(results, "retrieverResults", 5);

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

      const responseSynthesizer = await getResponseSynthesizer(
        "tree_summarize",
        {
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
        }
      );

      const queryEngine = new RetrieverQueryEngine(
        combinedRetriever,
        responseSynthesizer
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

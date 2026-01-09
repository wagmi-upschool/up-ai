import {
  OpenAI,
  PineconeVectorStore,
  VectorStoreIndex,
  Settings,
  OpenAIEmbedding,
  VectorIndexRetriever,
} from "llamaindex";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
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

// In-process cache to persist detected topics per conversation across turns
const conversationTopicCache = new Map();

const RETRIEVER_LIMITS = {
  assistant: {
    topK: 40,
    minScore: 0.3,
    maxItems: 16,
  },
};
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

function filterAndTrimResults(nodes = [], minScore = 0, maxItems = null) {
  const filtered = nodes
    .filter((doc) => (doc?.score || 0) >= minScore)
    .sort((a, b) => (b?.score || 0) - (a?.score || 0));
  return maxItems ? filtered.slice(0, maxItems) : filtered;
}

function normalizeConversationMessages(items = []) {
  return items
    .map((item) => {
      const content = (item?.content ?? item?.message ?? "").toString().trim();
      if (!content) return null;
      const timestamp = item?.createdAt ?? item?.timestamp ?? null;
      return {
        content,
        role: item?.role || "user",
        timestamp,
        metadata: {
          assistantId: item?.assistantId ?? null,
          assistantGroupId: item?.assistantGroupId ?? null,
          userId: item?.userId ?? null,
          identifier: item?.identifier ?? item?.id ?? null,
          type: item?.type ?? null,
          isGptSuitable:
            typeof item?.isGptSuitable === "boolean"
              ? item.isGptSuitable
              : null,
        },
      };
    })
    .filter(Boolean);
}

function buildHistoryNodes(messages = []) {
  return messages.map((message) => ({
    node: {
      text: message.content,
      metadata: {
        role: message.role,
        timestamp: message.timestamp,
        createdAt: message.timestamp,
        assistantId: message.metadata.assistantId,
        assistantGroupId: message.metadata.assistantGroupId,
        userId: message.metadata.userId,
        source: "chat-messages",
      },
    },
    score: 0,
  }));
}

function buildChatHistoryMessages(messages = [], maxItems) {
  const resolved =
    typeof maxItems === "number" ? messages.slice(-maxItems) : messages;
  return resolved.map((message) => ({
    role: "memory",
    content: message.content,
  }));
}

async function fetchConversationMessages(conversationId, stage, limit) {
  if (!conversationId) return [];
  const env = stage ?? process.env.STAGE;

  try {
    let items = [];
    let lastEvaluatedKey;

    do {
      const params = {
        TableName: `UpConversationMessage-${env}`,
        KeyConditionExpression: "conversationId = :conversationId",
        ExpressionAttributeValues: {
          ":conversationId": conversationId,
        },
        ScanIndexForward: false,
        ExclusiveStartKey: lastEvaluatedKey,
      };

      if (typeof limit === "number") {
        const remaining = limit - items.length;
        if (remaining <= 0) break;
        params.Limit = remaining;
      }

      const command = new QueryCommand(params);
      const result = await dynamoDbClient.send(command);
      if (result.Items && result.Items.length > 0) {
        items = items.concat(result.Items);
      }
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    if (!items.length) return [];
    return items.reverse();
  } catch (error) {
    console.error("Error fetching chat messages from DynamoDB:", error);
    return null;
  }
}

async function streamDirectLLM({
  res,
  systemPrompt,
  query,
  assistantConfig,
  chatHistoryMessages = [],
}) {
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
      stream: true,
    },
    temperature: assistantConfig.temperature,
    topP: assistantConfig.topP,
  });

  const response = await llm.chat({
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      ...chatHistoryMessages,
      {
        role: "user",
        content: query,
      },
    ],
    stream: true,
  });

  let fullOutput = "";
  let hasWritten = false;
  for await (const chunk of response) {
    fullOutput += chunk.delta;
    res.write(chunk.delta);
    hasWritten = true;
  }

  return { fullOutput, hasWritten };
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

function normalizeInputOptions(options = []) {
  return options
    .map((opt) => {
      const raw = (opt.value || opt.text || opt.SK || "").toString().trim();
      return raw
        ? {
            raw,
            normalized: raw.toLocaleLowerCase("tr"),
            matchKey: (normalizeTopicValue(raw) || raw).toLocaleLowerCase("tr"),
          }
        : null;
    })
    .filter(Boolean);
}

function matchOptionFromText(text, normalizedOptions = []) {
  if (!text || !normalizedOptions.length) return null;
  const rawText = text.toString().trim();
  const normalizedText = (normalizeTopicValue(rawText) || rawText)
    .toLocaleLowerCase("tr")
    .trim();

  if (normalizedText) {
    const matches = normalizedOptions.filter((opt) => {
      if (!opt.matchKey) return false;
      return (
        normalizedText.includes(opt.matchKey) ||
        opt.matchKey.includes(normalizedText)
      );
    });

    if (matches.length) {
      matches.sort((a, b) => b.matchKey.length - a.matchKey.length);
      return matches[0].raw;
    }
  }

  const fallbackText = rawText.toLocaleLowerCase("tr").trim();
  if (!fallbackText) return null;
  const fallbackMatch = normalizedOptions.find((opt) =>
    fallbackText.includes(opt.normalized)
  );
  return fallbackMatch ? fallbackMatch.raw : null;
}

function detectOptionFromHistory(historyNodes = [], normalizedOptions = []) {
  if (!historyNodes.length || !normalizedOptions.length) return null;

  // Prefer the earliest user messages, then fall back to any message content
  const sorted = [...historyNodes].sort((a, b) => {
    const tsA = new Date(
      a?.node?.metadata?.timestamp || a?.node?.metadata?.createdAt || 0
    ).getTime();
    const tsB = new Date(
      b?.node?.metadata?.timestamp || b?.node?.metadata?.createdAt || 0
    ).getTime();
    return tsA - tsB;
  });

  const tryMatch = (nodes) => {
    for (const node of nodes) {
      const match = matchOptionFromText(node?.node?.text, normalizedOptions);
      if (match) return match;
    }
    return null;
  };

  const userNodes = sorted.filter(
    (n) => (n?.node?.metadata?.role || "").toLowerCase() === "user"
  );

  return tryMatch(userNodes) || tryMatch(sorted);
}

function logRetrieverSamples(results, label = "results", maxItems = 3) {
  try {
    results.slice(0, maxItems).forEach((doc, idx) => {
      const metadata = {
        topic: doc?.node?.metadata?.topic ?? null,
        source: doc?.node?.metadata?.source ?? null,
        assistantId: doc?.node?.metadata?.assistantId ?? null,
      };
      const textPreview = (doc?.node?.text || "").replace(/\s+/g, " ");
      const trimmedText =
        textPreview.length > 120
          ? `${textPreview.substring(0, 120)}...`
          : textPreview;
      console.log(
        `[${label} ${idx}] score=${(doc?.score || 0).toFixed(
          3
        )} metadata=${JSON.stringify(metadata)} text="${trimmedText}"`
      );
    });
  } catch (err) {
    console.error("Error logging retriever samples:", err);
  }
}

function logConversationMessages(messages = [], label = "chat-history") {
  try {
    messages.forEach((message, idx) => {
      const payload = {
        role: message.role,
        timestamp: message.timestamp,
        content: message.content,
        metadata: message.metadata,
      };
      console.log(`[${label} ${idx}] ${JSON.stringify(payload)}`);
    });
  } catch (err) {
    console.error("Error logging conversation messages:", err);
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

async function createAssistantIndex() {
  const pcvs_assistant = new PineconeVectorStore({
    indexName: "assistant-documents",
    chunkSize: 100,
    storesText: true,
    embeddingModel: new OpenAIEmbedding({
      model: "text-embedding-3-small",
      azure: getAzureEmbeddingOptions(),
    }),
  });

  const index_assistant_documents = await VectorStoreIndex.fromVectorStore(
    pcvs_assistant
  );

  return { index_assistant_documents };
}

function createAssistantRetriever({
  index_assistant_documents,
  assistantId,
  topic,
}) {
  const rawTopic = typeof topic === "string" ? topic.trim() : null;
  const filters = [
    {
      key: "assistantId",
      value: assistantId,
      operator: "==",
    },
  ];

  if (rawTopic) {
    filters.push({
      key: "topic",
      value: rawTopic,
      operator: "==",
    });
    console.log(`Filtering assistant documents by topic: ${rawTopic}`);
  } else if (topic) {
    console.log(
      `Skipping topic filter; topic value is empty after trimming: ${topic}`
    );
  }

  return new VectorIndexRetriever({
    index: index_assistant_documents,
    includeValues: true,
    filters: {
      filters,
    },
    similarityTopK: RETRIEVER_LIMITS.assistant.topK,
  });
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

    // Create index for assistant documents
    const { index_assistant_documents } = await createAssistantIndex();

    // Detect topic from current query or recover from prior conversation turns
    const normalizedConversationId =
      conversationId &&
      conversationId !== "null" &&
      conversationId !== "undefined"
        ? conversationId
        : null;
    const cachedTopic =
      normalizedConversationId &&
      conversationTopicCache.has(normalizedConversationId)
        ? conversationTopicCache.get(normalizedConversationId)
        : null;
    let priorUserMessages = 0;
    let historyNodes = [];
    let conversationMessages = [];
    if (normalizedConversationId) {
      const items = await fetchConversationMessages(
        normalizedConversationId,
        stage,
        null
      );

      if (!items) {
        console.warn(
          "Could not determine prior user messages, assuming not first message."
        );
        priorUserMessages = 1; // avoid applying topic filter on uncertainty
      } else {
        conversationMessages = normalizeConversationMessages(items);
        historyNodes = buildHistoryNodes(conversationMessages);
        priorUserMessages = historyNodes.filter(
          (n) => (n?.node?.metadata?.role || "").toLowerCase() === "user"
        ).length;
        console.log(
          `Fetched ${conversationMessages.length} chat messages from DynamoDB`
        );
      }
    }
    const isFirstUserMessage = priorUserMessages === 0;
    let detectedTopic = null;
    let normalizedOptions = [];

    if (assistantId && query) {
      try {
        const service =
          stage && stage !== process.env.STAGE
            ? new AssistantInputOptionsService({ stage })
            : assistantInputOptionsService;
        const options = await service.getAllOptions(assistantId);
        normalizedOptions = normalizeInputOptions(options);

        detectedTopic = matchOptionFromText(query, normalizedOptions);
        if (detectedTopic) {
          console.log(
            `Topic detected from current query for topic filter: ${detectedTopic}`
          );
        }

        if (!detectedTopic && historyNodes.length) {
          const recoveredTopic = detectOptionFromHistory(
            historyNodes,
            normalizedOptions
          );
          if (recoveredTopic) {
            detectedTopic = recoveredTopic;
            console.log(
              `Topic recovered from conversation history for topic filter: ${detectedTopic}`
            );
          }
        }
      } catch (err) {
        console.error("Error detecting topic from input options:", err);
      }
    }

    if (!detectedTopic && cachedTopic) {
      detectedTopic = cachedTopic;
      console.log(
        `Using cached topic for conversation ${normalizedConversationId}: ${cachedTopic}`
      );
    }

    if (!detectedTopic && normalizedOptions.length) {
      console.log(
        isFirstUserMessage
          ? "First user message did not match any input option; no topic filter applied."
          : "No topic match in current query or history; skipping topic filter."
      );
    }

    if (detectedTopic && normalizedConversationId) {
      conversationTopicCache.set(normalizedConversationId, detectedTopic);
    }
    const baseSystemPrompt = `${replacedPatterns}

Kullanıcı kademesi: ${detectedTopic || ""}
Bu bilgiyi kalıcı bağlam olarak kabul et ve yanıtlarını buna göre uyumla.`;

    // Retrieve assistant docs (chat history already fetched from DynamoDB)
    let assistantResults = [];
    const chatHistoryMessages = buildChatHistoryMessages(conversationMessages);
    if (conversationMessages.length) {
      //logConversationMessages(conversationMessages, "dynamodb-chat");
    }

    // Get assistant documents if we have an assistant ID
    if (assistantId) {
      const primaryAssistantRetriever = createAssistantRetriever({
        index_assistant_documents,
        assistantId,
        topic: detectedTopic,
      });

      assistantResults = await primaryAssistantRetriever.retrieve(query);

      // Fallback: if topic-filtered retrieval returns zero, try normalized topic
      if (assistantResults.length === 0 && detectedTopic) {
        const normalizedTopic = normalizeTopicValue(detectedTopic);
        if (normalizedTopic && normalizedTopic !== detectedTopic) {
          console.log(
            `Assistant retriever returned 0 results with topic filter "${detectedTopic}". Retrying with normalized topic "${normalizedTopic}".`
          );
          const normalizedRetriever = createAssistantRetriever({
            index_assistant_documents,
            assistantId,
            topic: normalizedTopic,
          });
          assistantResults = await normalizedRetriever.retrieve(query);
        }
      }

      console.log(
        `Assistant retriever returned ${assistantResults.length} documents`
      );
    }

    // Filter and limit assistant results
    let filteredAssistant = filterAndTrimResults(
      assistantResults,
      RETRIEVER_LIMITS.assistant.minScore,
      RETRIEVER_LIMITS.assistant.maxItems
    );

    // If we still have no assistant docs after filtering, keep the top matches.
    if (!filteredAssistant.length && assistantResults.length) {
      console.log(
        `Assistant results below minScore ${RETRIEVER_LIMITS.assistant.minScore}; keeping top results without score filter.`
      );
      filteredAssistant = filterAndTrimResults(
        assistantResults,
        0,
        RETRIEVER_LIMITS.assistant.maxItems
      );
    }

    try {
      const formatted = filteredAssistant.slice(0, 5).map((doc) => ({
        score: doc?.score || 0,
        metadata: {
          topic: doc?.node?.metadata?.topic,
          source: doc?.node?.metadata?.source,
          assistantId: doc?.node?.metadata?.assistantId,
          text: doc?.node?.text || "",
        },
        text:
          (doc?.node?.text || "").length > 200
            ? `${doc.node.text.substring(0, 200)}...`
            : doc?.node?.text || "",
      }));
      console.log(
        "Retrieved results (formatted metadata):",
        JSON.stringify(formatted, null, 2)
      );

      console.log(
        `Retrieval counts (assistant-documents raw/filtered): ${assistantResults.length}/${filteredAssistant.length}`
      );
      console.log(
        `Chat history (DynamoDB): ${conversationMessages.length} messages, using ${chatHistoryMessages.length}`
      );
    } catch (err) {
      console.error("Error formatting retrieved results:", err);
    }
    //logRetrieverSamples(results, "retrieverResults", 5);

    const assistantDocResults = filteredAssistant;
    if (assistantDocResults.length) {
      console.log(
        `Logging all assistant-documents results (${assistantDocResults.length})`
      );
      const topicCounts = assistantDocResults.reduce((acc, doc) => {
        const topic = (doc?.node?.metadata?.topic || "Unknown")
          .toString()
          .trim();
        acc[topic] = (acc[topic] || 0) + 1;
        return acc;
      }, {});
      const sortedTopics = Object.entries(topicCounts).sort(
        (a, b) => b[1] - a[1]
      );
      console.log("Assistant-documents topic counts:");
      sortedTopics.forEach(([topic, count]) => {
        console.log(`- ${topic}: ${count}`);
      });
      logRetrieverSamples(assistantDocResults, "assistantDocsOnly", 5);
    } else {
      console.log("No assistant-documents results to log.");
    }

    const hasAssistantDocs = filteredAssistant.length > 0;
    let fullOutput = "";
    let hasWritten = false;

    if (!hasAssistantDocs) {
      console.log("Using direct LLM response (no assistant documents)");
      const directResult = await streamDirectLLM({
        res,
        systemPrompt: baseSystemPrompt,
        query,
        assistantConfig,
        chatHistoryMessages,
      });
      fullOutput = directResult.fullOutput;
      hasWritten = directResult.hasWritten;
    } else {
      console.log("Using retriever response with context");

      const retrievedChunks = filteredAssistant
        .map((doc, idx) => {
          const text = (doc?.node?.text || "").trim();
          return text ? `[Document ${idx + 1}]\n${text}` : "";
        })
        .filter(Boolean)
        .join("\n\n");

      const userPromptMessage = retrievedChunks
        ? {
            role: "user",
            content: `
RETRIEVED info:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${retrievedChunks}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

USER QUESTION:
${query}
`,
          }
        : {
            role: "user",
            content: query,
          };

      try {
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
            stream: true,
          },
          temperature: assistantConfig.temperature,
          topP: assistantConfig.topP,
        });

        const responseStream = await llm.chat({
          messages: [
            {
              role: "system",
              content: baseSystemPrompt,
            },
            ...chatHistoryMessages,
            userPromptMessage,
          ],
          stream: true,
        });

        // res.write(
        //   `Kullanıcı kademesi: ${detectedTopic || "tespit edilemedi"}\n\n`
        // );

        for await (const chunk of responseStream) {
          fullOutput += chunk.delta;
          res.write(chunk.delta);
          hasWritten = true;
        }
      } catch (synthError) {
        console.error(
          "Error streaming retriever response, falling back to direct LLM:",
          synthError
        );
        if (!hasWritten) {
          const directResult = await streamDirectLLM({
            res,
            systemPrompt: baseSystemPrompt,
            query,
            assistantConfig,
            chatHistoryMessages,
          });
          fullOutput = directResult.fullOutput;
          hasWritten = directResult.hasWritten;
        } else {
          res.write("\n[ERROR] Streaming interrupted");
        }
      }
    }

    if (fullOutput) {
      console.log("Full output:", fullOutput);
    }
    console.log("Query:", query);
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

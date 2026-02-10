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
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { countTokens } from "gpt-tokenizer/model/gpt-4o-mini";
import dotenv from "dotenv";
import { CognitoJwtVerifier } from "aws-jwt-verify";
dotenv.config();

const dynamoDbClient = new DynamoDBClient({
  region: "us-east-1",
});

// Helper function for timing measurements
function getTimeElapsed(startTime) {
  const elapsed = process.hrtime(startTime);
  return (elapsed[0] * 1000 + elapsed[1] / 1000000).toFixed(2);
}

// Save token data to DynamoDB
async function saveTokenData(userId, type, amount, conversationId, stage) {
  const timestamp = new Date().toISOString();
  const params = {
    TableName: `ConsumedToken-${stage}`,
    Item: {
      id: uuidv4(),
      userId,
      conversationId,
      type,
      amount,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
  console.log(params);
  await dynamoDbClient.send(new PutCommand(params));
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

async function initializeSettings(config) {
  const { setEnvs } = await import("@llamaindex/env");
  setEnvs(process.env);

  Settings.llm = new OpenAI({
    model: process.env.MODEL,
    apiKey: process.env.AZURE_OPENAI_KEY,
    additionalSessionOptions: { baseURL: process.env.AZURE_OPENAI_BASE_URL },
    additionalChatOptions: {
      frequency_penalty: config.frequencyPenalty,
      presence_penalty: config.presencePenalty,
      stream: true,
    },
    temperature: config.temperature,
    topP: config.topP,
  });

  Settings.embedModel = new OpenAIEmbedding({
    model: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
    apiKey: process.env.AZURE_OPENAI_KEY,
    additionalSessionOptions: { baseURL: process.env.AZURE_OPENAI_EMBEDDING_BASE_URL },
  });
}

async function createIndex(conversationId) {
  const pcvs = new PineconeVectorStore({
    indexName: "chat-messages",
    chunkSize: 100,
    storesText: true,
  });
  return await VectorStoreIndex.fromVectorStore(pcvs);
}

// Function to count embedding tokens
async function countEmbeddingTokens(text) {
  // cl100k_base is the tokenizer used by text-embedding-3-small
  const { encoding_for_model } = await import("tiktoken");
  const encoding = await encoding_for_model("text-embedding-3-small");
  return encoding.encode(text).length;
}

function createRetriever(index, conversationId) {
  return new VectorIndexRetriever({
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

export async function handleReflectionStream(req, res) {
  const functionStartTime = process.hrtime();
  console.log("Function started at:", new Date().toISOString());
  const poolId = process.env.POOL_ID;
  const { query, assistantId, latestMessage, stage } = req.body;

  // Dynamically import and initialize JWT verifier
  let userEmail;
  try {
    if (!req.headers.authorization) {
      throw new Error("Token not found.");
    }

    const verifier = CognitoJwtVerifier.create({
      userPoolId: stage === "myenv" ? "us-east-1_akkBktCUt" : poolId,
      tokenUse: "id",
      clientId: null,
    });

    const token = req.headers.authorization.split(" ")[1];
    const payload = await verifier.verify(token);
    userEmail = payload.email;
    console.log("Token verified for user:", userEmail);
  } catch (error) {
    console.error("Token verification error:", error);
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { userId, conversationId } = req.params;

  const timings = {
    configFetch: 0,
    initialization: 0,
    streamSetup: 0,
    totalSetup: 0,
  };

  try {
    console.log(
      `conversationId:${conversationId} \n query: ${query} assistantId:${assistantId}`
    );
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

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // Count tokens from system message and user query
    totalInputTokens += countTokens(replacedPatterns);
    totalInputTokens += countTokens(query);
    if (latestMessage) {
      totalInputTokens += countTokens(latestMessage);
    }

    let response;
    const index = await createIndex(conversationId);
    const retriever = await createRetriever(index, conversationId);
    const testResults = await retriever.retrieve(query);

    // Count embedding tokens for the query
    const queryEmbeddingTokens = await countEmbeddingTokens(query);

    // Count embedding tokens for retrieved nodes
    let retrievedNodesTokens = 0;
    if (testResults && testResults.length > 0) {
      retrievedNodesTokens = await testResults.reduce(
        async (totalPromise, result) => {
          const total = await totalPromise;
          // Check if result has node and text property
          if (result.node && result.node.text) {
            const tokens = await countEmbeddingTokens(result.node.text);
            return total + tokens;
          }
          return total;
        },
        Promise.resolve(0)
      );
    }

    // Add only query embedding tokens to total input tokens
    totalInputTokens += queryEmbeddingTokens;

    // Log token usage for debugging
    console.log(
      "Embedding tokens - Query:",
      queryEmbeddingTokens,
      "Retrieved:",
      retrievedNodesTokens
    );
    console.log(
      "Total input tokens (including query embeddings):",
      totalInputTokens
    );

    if (testResults.length == 0) {
      console.log("Using direct LLM response");
      const llm = new OpenAI({
        model: process.env.MODEL,
        apiKey: process.env.AZURE_OPENAI_KEY,
        additionalSessionOptions: { baseURL: process.env.AZURE_OPENAI_BASE_URL },
        additionalChatOptions: {
          frequency_penalty: assistantConfig.frequencyPenalty,
          presence_penalty: assistantConfig.presencePenalty,
          stream: false,
        },
        temperature: assistantConfig.temperature,
        topP: assistantConfig.topP,
      });

      console.log(latestMessage);
      let fullOutput = "";
      const response = await llm.chat({
        messages: [
          {
            role: "system",
            content: replacedPatterns,
          },
          {
            role: "memory",
            content: latestMessage,
          },
          {
            role: "user",
            content: query,
          },
        ],
        stream: true,
      });

      for await (const chunk of response) {
        const content = chunk.delta;
        fullOutput += content;
        res.write(content);
      }
      totalOutputTokens = countTokens(fullOutput);
    } else {
      console.log("Using responseSynthesizer");
      const responseSynthesizer = await getResponseSynthesizer(
        "tree_summarize",
        {
          llm: new OpenAI({
            model: process.env.MODEL,
            apiKey: process.env.AZURE_OPENAI_KEY,
            additionalSessionOptions: { baseURL: process.env.AZURE_OPENAI_BASE_URL },
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
        retriever,
        responseSynthesizer
      );

      const query_ = `[System Prompts: 
            ${replacedPatterns}]
            -----------------------------------
            User Query:
                ${query}
            `;

      let fullOutput = "";
      response = await queryEngine.query({
        query: query_,
        stream: true,
      });

      for await (const chunk of response) {
        const content = chunk.delta;
        fullOutput += content;
        res.write(content);
      }
      totalOutputTokens = countTokens(fullOutput);
    }

    // Save token usage data
    await saveTokenData(
      userEmail,
      "input",
      totalInputTokens,
      conversationId,
      stage
    );
    await saveTokenData(
      userEmail,
      "output",
      totalOutputTokens,
      conversationId,
      stage
    );

    console.log(
      "Token usage - Input:",
      totalInputTokens,
      "Output:",
      totalOutputTokens
    );

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

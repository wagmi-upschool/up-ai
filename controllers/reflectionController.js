/**
 * @fileoverview Controller for handling reflection queries with RAG system
 */

import { OpenAI, Settings } from "llamaindex";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import dotenv from "dotenv";
import { DocumentIndexer } from "../lib/rag/documentIndexer.js";
import { RAGQueryEngine } from "../lib/query-engine/ragQueryEngine.js";
import { VectorStoreService } from "../lib/vector-store/vectorStoreService.js";
import { TokenCounter } from "../lib/token-management/tokenCounter.js";
import { initPinecone } from "../config/pinecone.js";

dotenv.config();

const dynamoDbClient = new DynamoDBClient({
  region: "us-east-1",
});

/**
 * Removes specific patterns from text
 * @param {string} text - The text to process
 * @returns {string} The processed text with patterns removed
 */
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

/**
 * Fetches assistant configuration from DynamoDB
 * @param {string} assistantId - The ID of the assistant
 * @param {string} stage - Environment stage
 * @returns {Promise<Object|null>} Assistant configuration
 */
async function fetchAssistantConfig(assistantId, stage) {
  const env = stage ?? process.env.STAGE;
  const params = {
    TableName: `UpAssistant-${env}`,
    Key: {
      id: assistantId,
    },
  };
  const result = await dynamoDbClient.send(new GetCommand(params));
  return result.Item ?? null;
}

/**
 * Verifies JWT token and extracts user email
 * @param {string} authHeader - Authorization header
 * @returns {Promise<string>} User's email
 * @throws {Error} If token is invalid or missing
 */
async function verifyToken(authHeader) {
  if (!authHeader) {
    throw new Error("Token not found.");
  }

  const verifier = CognitoJwtVerifier.create({
    userPoolId: process.env.POOL_ID,
    tokenUse: "id",
    clientId: null,
  });

  const token = authHeader.split(" ")[1];
  const payload = await verifier.verify(token);
  return payload.email;
}

/**
 * Handles reflection stream requests
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export async function handleReflectionStream(req, res) {
  try {
    // Verify JWT token
    //const userEmail = await verifyToken(req.headers.authorization);
    const userEmail = "test@test.com";

    const { userId, conversationId } = req.params;
    const { query, assistantId, latestMessage, stage } = req.body;

    // Initialize services
    const pineconeClient = await initPinecone();
    const vectorStoreService = new VectorStoreService();
    const documentIndexer = new DocumentIndexer(pineconeClient);
    const tokenCounter = new TokenCounter();

    // Fetch assistant configuration
    const systemMessage = await fetchAssistantConfig(assistantId, stage);
    if (!systemMessage) {
      throw new Error("Assistant configuration not found");
    }

    // Process system message
    const systemPrompt = replacePatterns(systemMessage.prompt);
    const assistantConfig = {
      temperature: parseFloat(systemMessage.temperature) || 0.2,
      topP: parseFloat(systemMessage.topP) || 0.95,
      maxTokens: parseInt(systemMessage.maxTokens) || 800,
      frequencyPenalty: parseFloat(systemMessage.frequencyPenalty) || 0.0,
      presencePenalty: parseFloat(systemMessage.presencePenalty) || 0.0,
      stream: true,
    };

    // Set up response headers
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

    // Count input tokens
    tokenCounter.addInputTokens(systemPrompt, query);
    if (latestMessage) {
      tokenCounter.addInputTokens(latestMessage);
    }

    // Create vector stores
    const chatStore = vectorStoreService.createChatMessagesStore();
    const assistantStore = vectorStoreService.createAssistantDocumentsStore();

    // Initialize query engine
    const queryEngine = new RAGQueryEngine(chatStore, assistantConfig);

    // Set up filters based on conversation/assistant ID
    const filters = conversationId
      ? [
          {
            key: "conversationId",
            value: conversationId,
            operator: "==",
          },
        ]
      : [
          {
            key: "assistantId",
            value: assistantId,
            operator: "==",
          },
        ];

    // Initialize query engine with filters
    await queryEngine.initializeQueryEngine(filters);

    // Process query
    const queryIterator = conversationId
      ? queryEngine.streamingQuery(query, systemPrompt)
      : queryEngine.directLLMQuery(query, systemPrompt);

    console.log(queryIterator);

    let fullOutput = "";
    for await (const chunk of queryIterator) {
      console.log(chunk);
      const content = chunk;
      if (content) {
        fullOutput += content;
        res.write(content);
      }
    }

    console.log(fullOutput);

    // Count and save token usage
    tokenCounter.addOutputTokens(fullOutput);
    await tokenCounter.saveTokenUsage({
      userId: userEmail,
      conversationId,
      stage,
    });

    res.write("[DONE-UP]");
    res.end();
  } catch (error) {
    console.error("Error in handleReflectionStream:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: error.message,
      });
    } else {
      res.write("\n[ERROR] Streaming interrupted");
      res.write("[DONE-UP]");
      res.end();
    }
  }
}

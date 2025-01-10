/**
 * @fileoverview Controller for handling chat interactions with LLM
 */

import { OpenAI } from "llamaindex";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
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
 * @returns {Promise<Object|null>} The assistant configuration or null if not found
 * @throws {Error} If DynamoDB operation fails
 */
async function fetchAssistantConfig(assistantId) {
  const env = process.env.STAGE;
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
 * Handles LLM stream requests and responses
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @throws {Error} If processing fails
 */
export async function handleLLMStream(req, res) {
  try {
    const { userId, conversationId } = req.params;
    const { query, assistantId } = req.body;

    // Initialize services
    const pineconeClient = await initPinecone();
    const vectorStoreService = new VectorStoreService();
    const documentIndexer = new DocumentIndexer(pineconeClient);
    const tokenCounter = new TokenCounter();

    // Fetch assistant configuration
    const systemMessage = await fetchAssistantConfig(assistantId);
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

    // Create vector stores
    const chatStore = vectorStoreService.createChatMessagesStore();
    const assistantStore = vectorStoreService.createAssistantDocumentsStore();

    // Initialize query engine with appropriate store
    const queryEngine = new RAGQueryEngine(
      conversationId ? chatStore : assistantStore,
      assistantConfig
    );

    // Set up filters based on conversation/assistant ID
    const filters = conversationId ? { conversationId } : { assistantId };

    // Process query
    const response = await queryEngine.query({
      query: query,
      stream: true,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
      ],
    });

    let fullOutput = "";
    for await (const chunk of response) {
      const content = chunk?.delta?.trim();
      if (content) {
        fullOutput += content;
        res.write(content);
      }
    }

    // Count and save token usage
    tokenCounter.addOutputTokens(fullOutput);
    await tokenCounter.saveTokenUsage({
      userId,
      conversationId,
      stage: process.env.STAGE,
    });

    res.write("[DONE-UP]");
    res.end();
  } catch (error) {
    console.error("Error in handleLLMStream:", error);

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

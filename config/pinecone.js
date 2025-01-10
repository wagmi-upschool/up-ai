/**
 * @fileoverview Pinecone vector store configuration and initialization
 */

import dotenv from "dotenv";
import { PineconeVectorStore } from "llamaindex";

dotenv.config();

/**
 * Initializes and configures the Pinecone client
 * @returns {Promise<PineconeVectorStore>} Initialized Pinecone store
 * @throws {Error} If initialization fails
 */
export const initPinecone = async () => {
  try {
    const store = new PineconeVectorStore({
      apiKey: process.env.PINECONE_API_KEY,
      environment: process.env.PINECONE_ENVIRONMENT,
      indexName: process.env.PINECONE_INDEX_NAME,
    });
    return store;
  } catch (error) {
    console.error("Pinecone initialization error:", error);
    throw error;
  }
};

/**
 * Configuration for different Pinecone indexes
 */
export const PINECONE_INDEXES = {
  CHAT_MESSAGES: "chat-messages",
  ASSISTANT_DOCUMENTS: "assistant-documents",
};

/**
 * Default configuration for Pinecone vector store
 */
export const PINECONE_CONFIG = {
  chunkSize: 100,
  storesText: true,
  similarityTopK: 100,
};

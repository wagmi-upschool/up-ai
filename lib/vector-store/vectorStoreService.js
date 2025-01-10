/**
 * @fileoverview Vector store service for managing Pinecone operations
 */

import { PineconeVectorStore, OpenAIEmbedding } from "llamaindex";
import { PINECONE_CONFIG, PINECONE_INDEXES } from "../../config/pinecone.js";

/**
 * Class for managing vector store operations
 */
export class VectorStoreService {
  /**
   * Creates a new VectorStoreService instance
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    this.options = { ...PINECONE_CONFIG, ...options };
    this.embedModel = new OpenAIEmbedding({
      model: "text-embedding-3-small",
      azure: {
        endpoint: process.env.AZURE_OPENAI_ENDPOINT,
        deployment: "text-embedding-3-small",
        apiKey: process.env.AZURE_OPENAI_KEY,
      },
    });
  }

  /**
   * Creates a vector store instance for chat messages
   * @returns {PineconeVectorStore} Configured vector store
   */
  createChatMessagesStore() {
    return new PineconeVectorStore({
      indexName: PINECONE_INDEXES.CHAT_MESSAGES,
      chunkSize: this.options.chunkSize,
      storesText: this.options.storesText,
      embeddingModel: this.embedModel,
    });
  }

  /**
   * Creates a vector store instance for assistant documents
   * @returns {PineconeVectorStore} Configured vector store
   */
  createAssistantDocumentsStore() {
    return new PineconeVectorStore({
      indexName: PINECONE_INDEXES.ASSISTANT_DOCUMENTS,
      chunkSize: this.options.chunkSize,
      storesText: this.options.storesText,
      embeddingModel: this.embedModel,
    });
  }

  /**
   * Creates a custom vector store instance
   * @param {string} indexName - Name of the Pinecone index
   * @param {Object} options - Additional options
   * @returns {PineconeVectorStore} Configured vector store
   */
  createCustomStore(indexName, options = {}) {
    return new PineconeVectorStore({
      indexName,
      ...this.options,
      ...options,
      embeddingModel: this.embedModel,
    });
  }

  /**
   * Deletes vectors by filter
   * @param {string} indexName - Name of the Pinecone index
   * @param {Object} filter - Filter criteria
   * @returns {Promise<void>}
   * @throws {Error} If deletion fails
   */
  async deleteVectorsByFilter(indexName, filter) {
    try {
      const store = this.createCustomStore(indexName);
      await store.delete({ filter });
    } catch (error) {
      console.error("Vector deletion error:", error);
      throw error;
    }
  }

  /**
   * Updates vectors in batch
   * @param {string} indexName - Name of the Pinecone index
   * @param {Array} vectors - Array of vectors to update
   * @returns {Promise<void>}
   * @throws {Error} If update fails
   */
  async batchUpdateVectors(indexName, vectors) {
    try {
      const store = this.createCustomStore(indexName);
      await store.upsert(vectors);
    } catch (error) {
      console.error("Batch update error:", error);
      throw error;
    }
  }

  /**
   * Queries vectors by similarity
   * @param {string} indexName - Name of the Pinecone index
   * @param {Object} query - Query parameters
   * @returns {Promise<Array>} Query results
   * @throws {Error} If query fails
   */
  async querySimilarVectors(indexName, query) {
    try {
      const store = this.createCustomStore(indexName);
      return await store.query(query);
    } catch (error) {
      console.error("Vector query error:", error);
      throw error;
    }
  }
}

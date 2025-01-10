/**
 * @fileoverview Document indexing and processing functionality
 */

import {
  Document,
  VectorStoreIndex,
  serviceContextFromDefaults,
  OpenAIEmbedding,
} from "llamaindex";
import { PINECONE_CONFIG } from "../../config/pinecone.js";

/**
 * Class for handling document indexing operations
 */
export class DocumentIndexer {
  /**
   * Creates a new DocumentIndexer instance
   * @param {Object} pineconeClient - Initialized Pinecone client
   * @param {Object} options - Configuration options
   */
  constructor(pineconeClient, options = {}) {
    this.pineconeClient = pineconeClient;
    this.options = { ...PINECONE_CONFIG, ...options };
    this.serviceContext = serviceContextFromDefaults({});
  }

  /**
   * Splits text into manageable chunks
   * @param {string} text - Text to be chunked
   * @param {number} chunkSize - Size of each chunk
   * @returns {string[]} Array of text chunks
   */
  splitTextIntoChunks(text, chunkSize = this.options.chunkSize) {
    const chunks = [];
    let currentChunk = "";

    const sentences = text.match(/[^\.!\?]+[\.!\?]+/g) || [text];

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > chunkSize) {
        if (currentChunk) chunks.push(currentChunk.trim());
        currentChunk = "";
      }
      currentChunk += sentence + " ";
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Creates Document objects from text chunks
   * @param {string[]} chunks - Array of text chunks
   * @param {Object} metadata - Additional metadata for documents
   * @returns {Document[]} Array of Document objects
   */
  createDocumentsFromChunks(chunks, metadata = {}) {
    return chunks.map((chunk, index) => {
      return new Document({
        text: chunk,
        metadata: {
          ...metadata,
          chunkIndex: index,
        },
      });
    });
  }

  /**
   * Indexes a document in the vector store
   * @param {string} content - Document content
   * @param {Object} metadata - Document metadata
   * @returns {Promise<VectorStoreIndex>} Created vector store index
   * @throws {Error} If indexing fails
   */
  async indexDocument(content, metadata) {
    try {
      const chunks = this.splitTextIntoChunks(content);
      const documents = this.createDocumentsFromChunks(chunks, metadata);

      const index = await VectorStoreIndex.fromDocuments(documents, {
        serviceContext: this.serviceContext,
      });

      return index;
    } catch (error) {
      console.error("Document indexing error:", error);
      throw error;
    }
  }

  /**
   * Batch indexes multiple documents
   * @param {Array<{content: string, metadata: Object}>} documents - Array of documents
   * @returns {Promise<VectorStoreIndex>} Created vector store index
   * @throws {Error} If batch indexing fails
   */
  async batchIndexDocuments(documents) {
    try {
      const allDocuments = [];

      for (const doc of documents) {
        const chunks = this.splitTextIntoChunks(doc.content);
        const docs = this.createDocumentsFromChunks(chunks, doc.metadata);
        allDocuments.push(...docs);
      }

      const index = await VectorStoreIndex.fromDocuments(allDocuments, {
        serviceContext: this.serviceContext,
      });

      return index;
    } catch (error) {
      console.error("Batch indexing error:", error);
      throw error;
    }
  }
}

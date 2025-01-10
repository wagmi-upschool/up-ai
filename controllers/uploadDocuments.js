/**
 * @fileoverview Controller for handling document uploads and indexing
 */

import dotenv from "dotenv";
import { DocumentIndexer } from "../lib/rag/documentIndexer.js";
import { VectorStoreService } from "../lib/vector-store/vectorStoreService.js";
import { TokenCounter } from "../lib/token-management/tokenCounter.js";
import { initPinecone } from "../config/pinecone.js";

dotenv.config();

/**
 * Handles adding documents to assistant-documents
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export async function handleAddDocumentsToAssistantDocuments(req, res) {
  const { assistantId } = req.params;
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: "No text provided" });
  }

  try {
    // Initialize services
    const pineconeClient = await initPinecone();
    const vectorStoreService = new VectorStoreService();
    const documentIndexer = new DocumentIndexer(pineconeClient);
    const tokenCounter = new TokenCounter();

    // Count input tokens
    tokenCounter.addInputTokens(text);

    // Create documents with metadata
    const index = await documentIndexer.indexDocument(text, {
      source: "assistant-documents",
      assistantId: assistantId,
    });

    // Save token usage
    await tokenCounter.saveTokenUsage({
      userId: req.userId,
      conversationId: null,
      stage: process.env.STAGE,
    });

    res.status(200).json({ message: "Documents added successfully" });
  } catch (error) {
    console.error("Error adding documents:", error);
    res.status(500).json({ error: "Failed to add documents" });
  }
}

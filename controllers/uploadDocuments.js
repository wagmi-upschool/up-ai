import fs from "fs";
import dotenv from "dotenv";
import {
  OpenAI,
  Settings,
  OpenAIEmbedding,
  Document,
  storageContextFromDefaults,
  VectorStoreIndex,
  PineconeVectorStore,
} from "llamaindex";

dotenv.config(); // Load environment variables

// Function to configure Azure Embedding options
function getAzureEmbeddingOptions() {
  return {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    deployment: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME, // Updated
    apiKey: process.env.AZURE_OPENAI_KEY,
  };
}

// Initialize OpenAI and Pinecone settings
async function initializeSettings(config) {
  const { setEnvs } = await import("@llamaindex/env");
  setEnvs(process.env); // Set environment variables for LlamaIndex

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

export function splitTextIntoChunks(text, chunkSize = 1000) {
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
 * Create documents from text chunks with metadata.
 * @param {string[]} chunks - Array of text chunks.
 * @param {Object} [metadata={}] - Additional metadata for each document.
 * @returns {Document[]} - Array of Document objects.
 */
export function createDocumentsFromChunks(chunks, metadata = {}) {
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

// Initialize Pinecone Vector Store
const pcvs_assistant_documents = new PineconeVectorStore({
  indexName: "assistant-documents",
  chunkSize: 100,
  storesText: true,
  embeddingModel: new OpenAIEmbedding({
    model: "text-embedding-3-small",
    azure: getAzureEmbeddingOptions(),
  }),
});

// Define a storage context that's backed by our Pinecone vector store
const storageContext = await storageContextFromDefaults({
  vectorStore: pcvs_assistant_documents,
});

/**
 * Function to store documents in Pinecone Vector Store
 * @param {Array} documents - Array of documents to store
 */
export async function storeAssistantDocuments(documents) {
  if (!Array.isArray(documents) || documents.length === 0) {
    throw new Error("No documents provided to store.");
  }

  // Validate each document
  documents.forEach((doc, idx) => {
    if (!doc.text || typeof doc.text !== "string") {
      throw new Error(`Document at index ${idx} is missing valid text.`);
    }
  });

  try {
    // Create a VectorStoreIndex from the documents
    await VectorStoreIndex.fromDocuments(documents, {
      storageContext,
      embedModel: Settings.embedModel,
    });
  } catch (error) {
    console.error("Error in Pinecone add:", error);
    throw error;
  }
}

/**
 * Controller function to add documents to assistant-documents
 */
export async function handleAddDocumentsToAssistantDocuments(req, res) {
  const { assistantId } = req.params; // Extract assistantId from URL
  const { text } = req.body; // Extract text from request body

  if (!text) {
    return res.status(400).json({ error: "No text provided" });
  }

  try {
    // Example OpenAI and Pinecone configuration
    const assistantConfig = {
      temperature: 0.2,
      topP: 0.95,
      frequencyPenalty: 0.0,
      presencePenalty: 0.0,
      stream: false,
    };

    // Initialize settings before proceeding
    await initializeSettings(assistantConfig);

    // Split text into smaller chunks
    const chunks = splitTextIntoChunks(text);

    // Create documents with metadata
    const documents = createDocumentsFromChunks(chunks, {
      source: "assistant-documents",
      assistantId: assistantId,
    });

    console.log(documents);

    // Store documents in Pinecone Vector Store
    await storeAssistantDocuments(documents);

    res.status(200).json({ message: "Documents added successfully" });
  } catch (error) {
    console.error("Error adding documents:", error);
    res.status(500).json({ error: "Failed to add documents" });
  }
}

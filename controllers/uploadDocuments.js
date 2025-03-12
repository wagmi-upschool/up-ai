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
  const {
    setEnvs
  } = await import("@llamaindex/env");
  setEnvs(process.env); // Set environment variables for LlamaIndex

  Settings.llm = new OpenAI({
    model: process.env.MODEL,
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

export function splitTextIntoChunks(text, chunkSize = 512, overlap = 128) {
  if (overlap >= chunkSize) {
    throw new Error('Overlap size must be less than chunk size');
  }

  // Normalize spaces and clean the text first
  const normalizedText = text.replace(/\s+/g, ' ').trim();

  // Split into sentences, being careful with Turkish punctuation and sentence structure
  const sentences = normalizedText
    .split(/(?<=[.!?])\s*(?=[A-ZĞÜŞİÖÇa-zğüşıöç])/u)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;
  let lastChunkEndIndex = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];

    // Add sentence to current chunk if it fits
    if (currentLength + sentence.length <= chunkSize) {
      currentChunk.push(sentence);
      currentLength += sentence.length + 1; // +1 for space
    } else {
      // Store current chunk
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.join(' '));

        // Calculate overlap
        let overlapLength = 0;
        let overlapSentences = [];

        // Go backwards through current chunk to build overlap
        for (let j = currentChunk.length - 1; j >= 0; j--) {
          const overlapSentence = currentChunk[j];
          if (overlapLength + overlapSentence.length <= overlap) {
            overlapSentences.unshift(overlapSentence);
            overlapLength += overlapSentence.length + 1;
          } else {
            break;
          }
        }

        // Start new chunk with overlap sentences
        currentChunk = [...overlapSentences];
        currentLength = overlapSentences.join(' ').length;
      }

      // Add current sentence to new chunk if it fits
      if (sentence.length <= chunkSize) {
        currentChunk.push(sentence);
        currentLength += sentence.length + 1;
      } else {
        // Handle very long sentences by splitting them
        console.warn('Found very long sentence that exceeds chunk size');
        currentChunk.push(sentence);
        currentLength += sentence.length + 1;
      }
    }
  }

  // Add final chunk if there's anything left
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(' '));
  }

  return chunks.map(chunk => chunk.trim());
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
  const {
    assistantId
  } = req.params; // Extract assistantId from URL
  const {
    text
  } = req.body; // Extract text from request body

  if (!text) {
    return res.status(400).json({
      error: "No text provided"
    });
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

    // Split text into smaller chunks with overlap
    const chunks = splitTextIntoChunks(text, 512, 102); // Increased overlap for better context

    // Create documents with metadata
    const documents = createDocumentsFromChunks(chunks, {
      source: "assistant-documents",
      assistantId: assistantId,
    });

    console.log(documents);
    // Store documents in Pinecone Vector Store
    await storeAssistantDocuments(documents);

    res.status(200).json({
      message: "Documents added successfully"
    });
  } catch (error) {
    console.error("Error adding documents:", error);
    res.status(500).json({
      error: "Failed to add documents"
    });
  }
}
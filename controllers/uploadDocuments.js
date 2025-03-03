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

// Custom tokenizer implementation since get_tokenizer is not available
export function createSimpleTokenizer() {
  return {
    encode: (text) => {
      // Simple implementation that treats words and punctuation as tokens
      // In production, you should use a proper tokenizer like GPT's tiktoken
      return text
        .split(/(\s+|\b|[.,!?;:])/g)
        .filter((token) => token.trim() !== "");
    },
    decode: (tokens) => {
      // Join tokens back to text
      return tokens.join("");
    },
  };
}

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

/**
 * Split text into chunks with configurable overlap
 * @param {string} text - The text to split into chunks
 * @param {number} chunkSize - The maximum size of each chunk in tokens
 * @param {number} overlapPercentage - Percentage of chunk to overlap (default 15)
 * @returns {Array} Array of chunks with metadata
 */
export function splitTextIntoChunksWithOverlap(
  text,
  chunkSize = 1000,
  overlapPercentage = 15
) {
  // Calculate overlap size based on percentage
  const chunkOverlap = Math.floor(chunkSize * (overlapPercentage / 100));

  // Tokenize text using our custom tokenizer
  const tokenizer = createSimpleTokenizer();
  const tokens = tokenizer.encode(text);

  const chunks = [];
  let i = 0;

  while (i < tokens.length) {
    // Get chunk of tokens
    const chunk_end = Math.min(i + chunkSize, tokens.length);
    const chunk_tokens = tokens.slice(i, chunk_end);

    // Decode back to text
    const chunk_text = tokenizer.decode(chunk_tokens);

    // Store chunk with metadata
    chunks.push({
      text: chunk_text,
      token_count: chunk_tokens.length,
      start_idx: i,
      end_idx: chunk_end,
      overlap: i > 0 ? chunkOverlap : 0, // Track if this chunk has overlap
    });

    // Move to next chunk, accounting for overlap
    i += chunkSize - chunkOverlap;
  }

  return chunks;
}

/**
 * Create documents from text chunks with metadata.
 * @param {Object[]} chunks - Array of chunk objects with text property.
 * @param {Object} [metadata={}] - Additional metadata for each document.
 * @returns {Document[]} - Array of Document objects.
 */
export function createDocumentsFromChunks(chunks, metadata = {}) {
  return chunks
    .map((chunk, index) => {
      // Check if chunk is an object with a text property or a string
      const chunkText =
        typeof chunk === "object" && chunk.text ? chunk.text : chunk;

      // Ensure chunkText is a string
      if (typeof chunkText !== "string") {
        console.warn(
          `Chunk at index ${index} has invalid text format:`,
          chunkText
        );
        return null;
      }

      return new Document({
        text: chunkText,
        metadata: {
          ...metadata,
          chunkIndex: index,
          // Include additional chunk metadata if available
          ...(typeof chunk === "object"
            ? {
                token_count: chunk.token_count,
                start_idx: chunk.start_idx,
                end_idx: chunk.end_idx,
                overlap: chunk.overlap,
              }
            : {}),
        },
      });
    })
    .filter((doc) => doc !== null); // Filter out any null documents
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

  try {
    // Create a VectorStoreIndex from the documents
    await VectorStoreIndex.fromDocuments(documents, {
      storageContext,
      embedModel: Settings.embedModel,
    });
    console.log("Documents stored successfully");
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

    console.log("Splitting text into chunks...");
    // Split text into smaller chunks
    const chunks = splitTextIntoChunksWithOverlap(text, 256);
    console.log(`Created ${chunks.length} chunks`);

    console.log("Creating documents from chunks...");
    // Create documents with metadata
    const documents = createDocumentsFromChunks(chunks, {
      source: "assistant-documents",
      assistantId: assistantId,
    });
    console.log(`Created ${documents.length} documents`);

    // Store documents in Pinecone Vector Store
    console.log("Storing documents in Pinecone...");
    await storeAssistantDocuments(documents);

    res.status(200).json({ message: "Documents added successfully" });
  } catch (error) {
    console.error("Error adding documents:", error);
    res.status(500).json({ error: "Failed to add documents" });
  }
}

/**
 * Test function to demonstrate chunking with overlap using a Messi and Ronaldo story
 */
export function testChunkingWithMessiRonaldoStory() {
  // Sample long story about Messi and Ronaldo
  const messiRonaldoStory = `
The Tale of Two Legends: Messi and Ronaldo

In the annals of football history, few rivalries have captured the imagination quite like that of Lionel Messi and Cristiano Ronaldo. Born just two years apart, these two extraordinary athletes would go on to redefine excellence in the beautiful game, pushing each other to unprecedented heights while amassing a combined collection of trophies, records, and accolades that may never be matched.

Lionel Messi's story begins in Rosario, Argentina, where he was born on June 24, 1987. From an early age, his exceptional talent was evident, but so too was a growth hormone deficiency that threatened to derail his dreams. Fortune favored the gifted child when FC Barcelona, recognizing his immense potential, offered to pay for his medical treatment if he would join their famed La Masia academy. It was a decision that would alter the course of football history.

Meanwhile, on the Portuguese island of Madeira, Cristiano Ronaldo was developing his own unique set of skills. Born on February 5, 1985, into a humble family, Ronaldo's determination was evident from the start. By age 12, he had left home to pursue his football dreams with Sporting Lisbon. His blinding speed, powerful shooting, and mesmerizing footwork soon caught the attention of Sir Alex Ferguson, who brought the teenage sensation to Manchester United in 2003.

While Ronaldo was making waves in England, Messi was steadily rising through Barcelona's ranks. His senior team debut came in October 2004, and by the 2006-2007 season, he had established himself as one of the world's most exciting talents. His low center of gravity, close ball control, and magical left foot drew comparisons to Diego Maradona, Argentina's beloved football icon.

The 2007-2008 season marked Ronaldo's explosion into global superstardom. Scoring 42 goals across all competitions, he led Manchester United to Premier League and Champions League glory, earning his first Ballon d'Or in the process. His transformation from flashy winger to devastating goalscorer was complete.

What followed was perhaps the greatest individual rivalry sports has ever witnessed. When Ronaldo moved to Real Madrid in 2009 for a then-world record fee, the stage was set for direct competition with Messi in Spain's La Liga. Their battles in El Clásico became must-watch events, transcending the sport itself.`;

  // Test with different chunk sizes and overlap percentages
  const testCases = [
    { chunkSize: 100, overlapPercentage: 15 },
    { chunkSize: 200, overlapPercentage: 20 },
    { chunkSize: 300, overlapPercentage: 10 },
  ];

  console.log("Testing chunking with Messi and Ronaldo story:");

  for (const { chunkSize, overlapPercentage } of testCases) {
    console.log(
      `\n--- Testing with chunkSize=${chunkSize}, overlapPercentage=${overlapPercentage} ---`
    );

    const chunks = splitTextIntoChunksWithOverlap(
      messiRonaldoStory,
      chunkSize,
      overlapPercentage
    );

    console.log(`Generated ${chunks.length} chunks`);

    // Display the first few chunks to verify overlap
    for (let i = 0; i < Math.min(3, chunks.length); i++) {
      const chunk = chunks[i];
      console.log(`\nChunk ${i + 1}:`);
      console.log(
        `Start index: ${chunk.start_idx}, End index: ${chunk.end_idx}`
      );
      console.log(`Token count: ${chunk.token_count}`);
      console.log(`Overlap tokens: ${chunk.overlap}`);

      // Show just the beginning and end of each chunk text
      if (chunk.text.length > 100) {
        console.log(
          `Text (truncated): ${chunk.text.substring(
            0,
            50
          )}...${chunk.text.substring(chunk.text.length - 50)}`
        );
      } else {
        console.log(`Text: ${chunk.text}`);
      }
    }
  }

  return "Chunking test completed";
}

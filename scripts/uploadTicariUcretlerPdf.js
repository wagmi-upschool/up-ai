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
  PDFReader,
} from "llamaindex";
import { Pinecone } from '@pinecone-database/pinecone';
import path from "path";
import { v4 as uuidv4 } from "uuid";

dotenv.config();

const ASSISTANT_ID = "0186f1fa-ded1-45ff-a7cf-20d7807ac429";
const PDF_PATH = "/Users/yusuf/Software/Projects/AI-ML/up-ai/files/Ticari Müşterilerden Alınabilecek Azami Ücretler.pdf";

// Function to configure Azure Embedding options
function getAzureEmbeddingOptions() {
  return {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    deployment: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME,
    apiKey: process.env.AZURE_OPENAI_KEY,
  };
}

// Initialize OpenAI and Pinecone settings
async function initializeSettings() {
  const { setEnvs } = await import("@llamaindex/env");
  setEnvs(process.env);

  Settings.llm = new OpenAI({
    model: process.env.MODEL,
    deployment: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
    additionalChatOptions: {
      deployment: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
      frequency_penalty: 0.0,
      presence_penalty: 0.0,
    },
    temperature: 0.2,
    topP: 0.95,
  });

  Settings.embedModel = new OpenAIEmbedding({
    model: "text-embedding-3-small",
    azure: getAzureEmbeddingOptions(),
  });
}

// Function to split text into chunks (Turkish-optimized)
function splitTextIntoChunks(text, chunkSize = 512, overlap = 128) {
  if (overlap >= chunkSize) {
    throw new Error("Overlap size must be less than chunk size");
  }

  const normalizedText = text.replace(/\s+/g, " ").trim();
  
  // Split by Turkish sentence patterns
  const sentences = normalizedText
    .split(/(?<=[.!?])\s*(?=[A-ZĞÜŞİÖÇa-zğüşıöç0-9])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];

    if (currentLength + sentence.length <= chunkSize) {
      currentChunk.push(sentence);
      currentLength += sentence.length + 1;
    } else {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.join(" "));

        let overlapLength = 0;
        let overlapSentences = [];

        for (let j = currentChunk.length - 1; j >= 0; j--) {
          const overlapSentence = currentChunk[j];
          if (overlapLength + overlapSentence.length <= overlap) {
            overlapSentences.unshift(overlapSentence);
            overlapLength += overlapSentence.length + 1;
          } else {
            break;
          }
        }

        currentChunk = [...overlapSentences];
        currentLength = overlapSentences.join(" ").length;
      }

      if (sentence.length <= chunkSize) {
        currentChunk.push(sentence);
        currentLength += sentence.length + 1;
      } else {
        console.warn("Found very long sentence that exceeds chunk size");
        currentChunk.push(sentence);
        currentLength += sentence.length + 1;
      }
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(" "));
  }

  return chunks.map((chunk) => chunk.trim());
}

// Function to delete old Pinecone items by assistantId
async function deleteOldPineconeItems(assistantId) {
  console.log(`🗑️  Deleting old Pinecone items for assistantId: ${assistantId}`);
  
  try {
    const pc = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });
    
    const index = pc.index('assistant-documents');
    
    // Query vectors with the specific assistantId in metadata
    const queryResponse = await index.query({
      vector: new Array(1536).fill(0), // Dummy vector for embedding dimension
      filter: {
        assistantId: { "$eq": assistantId }
      },
      topK: 10000,
      includeMetadata: true,
      includeValues: false
    });
    
    if (queryResponse.matches && queryResponse.matches.length > 0) {
      console.log(`📊 Found ${queryResponse.matches.length} vectors to delete`);
      
      const idsToDelete = queryResponse.matches.map(match => match.id);
      
      // Delete in batches
      const batchSize = 1000;
      let deletedCount = 0;
      
      for (let i = 0; i < idsToDelete.length; i += batchSize) {
        const batch = idsToDelete.slice(i, i + batchSize);
        await index.deleteMany(batch);
        deletedCount += batch.length;
        console.log(`🗑️  Deleted batch: ${deletedCount}/${idsToDelete.length} vectors`);
      }
      
      console.log(`✅ Successfully deleted ${deletedCount} vectors`);
      return deletedCount;
    } else {
      console.log(`ℹ️  No existing vectors found for assistantId: ${assistantId}`);
      return 0;
    }
    
  } catch (error) {
    console.error("❌ Error deleting old Pinecone items:", error);
    throw error;
  }
}

// Function to extract banking fee categories from text
function extractBankingFeeCategory(text) {
  const categories = {
    'kredi': ['kredi', 'loan', 'borç'],
    'havale': ['havale', 'transfer', 'gönder'],
    'pos': ['pos', 'kart', 'card'],
    'cek': ['çek', 'check', 'senet'],
    'akreditif': ['akreditif', 'letter of credit', 'l/c'],
    'doviz': ['döviz', 'foreign exchange', 'fx'],
    'hesap': ['hesap', 'account', 'banking'],
    'komisyon': ['komisyon', 'commission', 'fee'],
    'teminat': ['teminat', 'guarantee', 'warranty'],
    'kefalet': ['kefalet', 'surety', 'bail']
  };

  const lowerText = text.toLowerCase();
  
  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(keyword => lowerText.includes(keyword))) {
      return category;
    }
  }
  
  return 'genel';
}

// Function to determine fee type based on content
function determineFeeType(text) {
  const lowerText = text.toLowerCase();
  
  if (lowerText.includes('maksimum') || lowerText.includes('azami') || lowerText.includes('üst limit')) {
    return 'maksimum';
  } else if (lowerText.includes('minimum') || lowerText.includes('asgari') || lowerText.includes('alt limit')) {
    return 'minimum';
  } else if (lowerText.includes('oran') || lowerText.includes('%')) {
    return 'oran';
  } else if (lowerText.includes('sabit') || lowerText.includes('fixed')) {
    return 'sabit';
  }
  
  return 'standart';
}

// Main function to process PDF and upload to Pinecone
async function processTicariUcretlerPdf() {
  console.log(`🚀 Starting processing of Ticari Ücretler PDF`);
  console.log(`📁 PDF Path: ${PDF_PATH}`);
  console.log(`🆔 Assistant ID: ${ASSISTANT_ID}`);

  try {
    // Step 1: Initialize settings
    console.log("⚙️  Initializing settings...");
    await initializeSettings();

    // Step 2: Delete old items
    const deletedCount = await deleteOldPineconeItems(ASSISTANT_ID);

    // Step 3: Check if PDF exists
    if (!fs.existsSync(PDF_PATH)) {
      throw new Error(`PDF file not found: ${PDF_PATH}`);
    }

    // Step 4: Extract text from PDF
    console.log("📖 Extracting text from PDF...");
    const reader = new PDFReader();
    const llamaDocs = await reader.loadData(PDF_PATH);
    
    let fullText = "";
    if (Array.isArray(llamaDocs) && llamaDocs.length > 0) {
      fullText = llamaDocs.map((doc) => (doc && doc.text ? doc.text : "")).join("\n\n");
    }

    if (!fullText.trim()) {
      throw new Error("No text content extracted from PDF");
    }

    console.log(`📊 Extracted ${fullText.length} characters from PDF`);

    // Step 5: Split into chunks
    console.log("✂️  Splitting text into chunks...");
    const chunks = splitTextIntoChunks(fullText, 512, 128);
    console.log(`📝 Created ${chunks.length} chunks`);

    // Step 6: Create documents with enhanced metadata
    console.log("📋 Creating documents with metadata...");
    const baseMetadata = {
      source: "assistant-documents",
      assistantId: ASSISTANT_ID,
      sourceType: "pdf",
      timestamp: new Date().toISOString(),
      pdf_name: path.basename(PDF_PATH),
      pdf_type: "commercial_fees",
      document_type: "ticari_ucretler_tablosu",
      language: "turkish",
      sector: "banking",
    };

    const documents = chunks.map((chunk, index) => {
      const category = extractBankingFeeCategory(chunk);
      const feeType = determineFeeType(chunk);
      
      return new Document({
        text: chunk,
        metadata: {
          ...baseMetadata,
          chunkIndex: index,
          banking_category: category,
          fee_type: feeType,
          // Add specific identifiers for banking content
          content_tags: [category, feeType, 'banking_fees', 'commercial_rates'],
        },
      });
    });

    // Step 7: Initialize Pinecone Vector Store and upload
    console.log("☁️  Initializing Pinecone Vector Store...");
    const pcvs = new PineconeVectorStore({
      indexName: "assistant-documents",
      chunkSize: 100,
      storesText: true,
      embeddingModel: Settings.embedModel,
    });

    const storageContext = await storageContextFromDefaults({
      vectorStore: pcvs,
    });

    console.log("📤 Uploading documents to Pinecone...");
    await VectorStoreIndex.fromDocuments(documents, {
      storageContext,
      embedModel: Settings.embedModel,
    });

    console.log("✅ SUCCESS! Documents uploaded to Pinecone");
    
    // Summary
    console.log("\n📊 UPLOAD SUMMARY:");
    console.log(`🗑️  Old vectors deleted: ${deletedCount}`);
    console.log(`📝 New documents created: ${documents.length}`);
    console.log(`🆔 Assistant ID: ${ASSISTANT_ID}`);
    console.log(`📁 Source file: ${path.basename(PDF_PATH)}`);
    console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
    
    return {
      success: true,
      oldVectorsDeleted: deletedCount,
      newDocumentsUploaded: documents.length,
      assistantId: ASSISTANT_ID,
      sourceFile: PDF_PATH,
    };

  } catch (error) {
    console.error("❌ Error processing PDF and uploading:", error);
    throw error;
  }
}

// Main execution
async function main() {
  try {
    const result = await processTicariUcretlerPdf();
    console.log("\n🎉 Script completed successfully!");
    console.log(result);
  } catch (error) {
    console.error("\n💥 Script failed:", error);
    process.exit(1);
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { processTicariUcretlerPdf };
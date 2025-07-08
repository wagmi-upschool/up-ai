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
import path from "path";
import { v4 as uuidv4 } from "uuid";

dotenv.config();

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

// Function to parse text into numbered sections
function parseNumberedSections(text) {
  const sections = [];
  const lines = text.split(/\r?\n/);
  
  // Regex patterns for different numbering levels
  const sectionPatterns = [
    /^(\d+\.\d+\.\d+)\s+(.+?)$/,  // 1.1.1 format
    /^(\d+\.\d+)\s+(.+?)$/,       // 1.1 format  
    /^(\d+)\.\s+(.+?)$/,          // 1. format
  ];
  
  let currentSection = null;
  let currentContent = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    let matchFound = false;
    
    // Check if line matches any section pattern
    for (const pattern of sectionPatterns) {
      const match = line.match(pattern);
      if (match) {
        // Save previous section if exists
        if (currentSection) {
          sections.push({
            number: currentSection.number,
            title: currentSection.title,
            content: currentContent.join('\n').trim()
          });
        }
        
        // Start new section
        currentSection = {
          number: match[1],
          title: match[2].trim()
        };
        currentContent = [line]; // Include the header line
        matchFound = true;
        break;
      }
    }
    
    // If no pattern matched, add to current section content
    if (!matchFound && currentSection) {
      currentContent.push(line);
    }
  }
  
  // Add the last section
  if (currentSection && currentContent.length > 0) {
    sections.push({
      number: currentSection.number,
      title: currentSection.title,
      content: currentContent.join('\n').trim()
    });
  }
  
  return sections;
}

// Function to split long text into smaller chunks (fallback)
function splitTextIntoChunks(text, chunkSize = 512, overlap = 128) {
  if (overlap >= chunkSize) {
    throw new Error("Overlap size must be less than chunk size");
  }

  const normalizedText = text.replace(/\s+/g, " ").trim();
  const sentences = normalizedText
    .split(/(?<=[.!?])\s*(?=[A-ZĞÜŞİÖÇa-zğüşıöç])/u)
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

// Function to extract fee category from section content
function extractFeeCategory(sectionTitle, sectionContent) {
  const combined = (sectionTitle + " " + sectionContent).toLowerCase();
  
  const categories = {
    'kredi_tahsis': ['kredi tahsis', 'kredi kullandırım'],
    'pos_islem': ['pos', 'kart ödeme', 'terminal'],
    'havale_eft': ['havale', 'eft', 'transfer'],
    'cek_senet': ['çek', 'senet', 'kambiyo'],
    'akreditif': ['akreditif', 'letter of credit'],
    'teminat_mektubu': ['teminat mektubu', 'garanti mektubu'],
    'kefalet': ['kefalet', 'aval'],
    'doviz': ['döviz', 'foreign exchange'],
    'hesap_isletim': ['hesap işletim', 'hesap açılış'],
    'komisyon': ['komisyon', 'masraf']
  };
  
  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(keyword => combined.includes(keyword))) {
      return category;
    }
  }
  
  return 'genel';
}

// Function to delete old Pinecone items by assistantId
async function deleteOldPineconeItems(assistantId) {
  console.log(`Deleting old Pinecone items for assistantId: ${assistantId}`);
  
  try {
    // Initialize Pinecone Vector Store
    const pcvs = new PineconeVectorStore({
      indexName: "assistant-documents",
      chunkSize: 100,
      storesText: true,
      embeddingModel: new OpenAIEmbedding({
        model: "text-embedding-3-small",
        azure: getAzureEmbeddingOptions(),
      }),
    });

    // Note: LlamaIndex doesn't provide a direct delete by metadata method
    // You might need to use the Pinecone client directly or implement a custom solution
    console.log("⚠️  Note: Direct deletion by assistantId requires Pinecone client implementation");
    console.log("Old items with assistantId should be manually removed or implement custom deletion");
    
    return true;
  } catch (error) {
    console.error("Error deleting old Pinecone items:", error);
    throw error;
  }
}

// Function to process PDF and upload to Pinecone
async function processPdfAndUpload(pdfPath, assistantId) {
  console.log(`Processing PDF: ${pdfPath}`);
  console.log(`Assistant ID: ${assistantId}`);

  try {
    // Initialize settings
    await initializeSettings();

    // Step 1: Delete old items
    await deleteOldPineconeItems(assistantId);

    // Step 2: Extract text from PDF
    const reader = new PDFReader();
    const llamaDocs = await reader.loadData(pdfPath);
    
    let fullText = "";
    if (Array.isArray(llamaDocs) && llamaDocs.length > 0) {
      fullText = llamaDocs.map((doc) => (doc && doc.text ? doc.text : "")).join("\n\n");
    }

    if (!fullText.trim()) {
      throw new Error("No text content extracted from PDF");
    }

    console.log(`Extracted ${fullText.length} characters from PDF`);

    // Step 3: Parse into numbered sections
    const sections = parseNumberedSections(fullText);
    console.log(`Found ${sections.length} numbered sections`);

    // Step 4: Create documents from sections
    const baseMetadata = {
      source: "assistant-documents",
      assistantId: assistantId,
      sourceType: "pdf",
      timestamp: new Date().toISOString(),
      pdf_name: path.basename(pdfPath),
      pdf_type: "commercial_fees",
      category: "ticari_ucretler",
    };

    const documents = [];
    
    if (sections.length > 0) {
      // Process numbered sections as separate nodes
      sections.forEach((section, index) => {
        const category = extractFeeCategory(section.title, section.content);
        
        // If section content is too long, split it into chunks
        if (section.content.length > 1000) {
          const chunks = splitTextIntoChunks(section.content, 512, 128);
          chunks.forEach((chunk, chunkIndex) => {
            documents.push(new Document({
              text: chunk,
              metadata: {
                ...baseMetadata,
                section_number: section.number,
                section_title: section.title,
                section_category: category,
                section_index: index,
                chunk_index: chunkIndex,
                is_chunked: true,
                total_chunks: chunks.length,
              },
            }));
          });
        } else {
          // Use entire section as single document
          documents.push(new Document({
            text: section.content,
            metadata: {
              ...baseMetadata,
              section_number: section.number,
              section_title: section.title,
              section_category: category,
              section_index: index,
              is_chunked: false,
            },
          }));
        }
      });
    } else {
      // Fallback: if no numbered sections found, use chunk-based approach
      console.log("No numbered sections found, falling back to chunk-based processing");
      const chunks = splitTextIntoChunks(fullText, 512, 128);
      documents.push(...chunks.map((chunk, index) => {
        return new Document({
          text: chunk,
          metadata: {
            ...baseMetadata,
            chunkIndex: index,
            processing_method: "fallback_chunks",
          },
        });
      }));
    }

    // Step 5: Initialize Pinecone Vector Store and upload
    const pcvs = new PineconeVectorStore({
      indexName: "assistant-documents",
      chunkSize: 100,
      storesText: true,
      embeddingModel: Settings.embedModel,
    });

    const storageContext = await storageContextFromDefaults({
      vectorStore: pcvs,
    });

    console.log("Uploading documents to Pinecone...");
    await VectorStoreIndex.fromDocuments(documents, {
      storageContext,
      embedModel: Settings.embedModel,
    });

    console.log("✅ Successfully uploaded documents to Pinecone");
    
    // Log section information
    if (sections.length > 0) {
      console.log("\n📋 Processed Sections:");
      sections.forEach((section, index) => {
        console.log(`  ${section.number}: ${section.title.substring(0, 50)}...`);
      });
    }
    
    return {
      success: true,
      documentCount: documents.length,
      sectionsCount: sections.length,
      assistantId: assistantId,
      sourceFile: pdfPath,
    };

  } catch (error) {
    console.error("Error processing PDF and uploading:", error);
    throw error;
  }
}

// Main execution
async function main() {
  const pdfPath = "/Users/yusuf/Software/Projects/AI-ML/up-ai/files/Ticari Müşterilerden Alınabilecek Azami Ücretler.pdf";
  const assistantId = "0186f1fa-ded1-45ff-a7cf-20d7807ac429";

  try {
    const result = await processPdfAndUpload(pdfPath, assistantId);
    console.log("Upload result:", result);
  } catch (error) {
    console.error("Script failed:", error);
    process.exit(1);
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { processPdfAndUpload, deleteOldPineconeItems };
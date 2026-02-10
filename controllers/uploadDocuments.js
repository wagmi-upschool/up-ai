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
import fetch from "node-fetch";
import { writeFile } from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid"; // You'll need to install this: npm install uuid
import { createObjectCsvWriter } from "csv-writer"; // npm install csv-writer

dotenv.config(); // Load environment variables

// Initialize OpenAI and Pinecone settings
async function initializeSettings(config) {
  const { setEnvs } = await import("@llamaindex/env");
  setEnvs(process.env);

  Settings.llm = new OpenAI({
    model: process.env.MODEL,
    apiKey: process.env.AZURE_OPENAI_KEY,
    additionalSessionOptions: { baseURL: process.env.AZURE_OPENAI_BASE_URL },
    additionalChatOptions: {
      frequency_penalty: config.frequencyPenalty,
      presence_penalty: config.presencePenalty,
      stream: config.stream ? config.stream : undefined,
    },
    temperature: config.temperature,
    topP: config.topP,
  });

  Settings.embedModel = new OpenAIEmbedding({
    model: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
    apiKey: process.env.AZURE_OPENAI_KEY,
    additionalSessionOptions: { baseURL: process.env.AZURE_OPENAI_EMBEDDING_BASE_URL },
  });
}

export function splitTextIntoChunks(text, chunkSize = 512, overlap = 128) {
  if (overlap >= chunkSize) {
    throw new Error("Overlap size must be less than chunk size");
  }

  // Normalize spaces and clean the text first
  const normalizedText = text.replace(/\s+/g, " ").trim();

  // Split into sentences, being careful with Turkish punctuation and sentence structure
  const sentences = normalizedText
    .split(/(?<=[.!?])\s*(?=[A-ZĞÜŞİÖÇa-zğüşıöç])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

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
        chunks.push(currentChunk.join(" "));

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
        currentLength = overlapSentences.join(" ").length;
      }

      // Add current sentence to new chunk if it fits
      if (sentence.length <= chunkSize) {
        currentChunk.push(sentence);
        currentLength += sentence.length + 1;
      } else {
        // Handle very long sentences by splitting them
        console.warn("Found very long sentence that exceeds chunk size");
        currentChunk.push(sentence);
        currentLength += sentence.length + 1;
      }
    }
  }

  // Add final chunk if there's anything left
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(" "));
  }

  return chunks.map((chunk) => chunk.trim());
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

/**
 * Analyzes PDF content to extract hard skill metadata.
 * @param {string} fullPdfText - Full text of the PDF.
 * @param {string} currentChunkText - Text of the current chunk being processed
 * @param {number} currentChunkAbsoluteStartIndex - Absolute start index of the current chunk in the full PDF text
 * @returns {Object} - Extracted hard skill metadata.
 */
async function analyzePDFForHardSkillMetadata(
  fullPdfText,
  currentChunkText,
  currentChunkAbsoluteStartIndex
) {
  try {
    // Initial defaults, will be updated
    let chapterNumber = "0";
    let chapterTitle = "Chapter 0"; // Simplified title
    let sectionFullID = "0.0"; // e.g., "1.1"
    let sectionTitle = "Preamble/TOC"; // Specific title part, to be simplified later
    let level = "beginner";

    // Corrected marker for SQLNotesForProfessionals (1).pdf - ensure it matches exactly or use a robust regex
    const mainContentStartMarkerPattern =
      /^Chapter\s+1:\s*Getting started with SQL/im;
    let mainContentActualStartIndex = fullPdfText.search(
      mainContentStartMarkerPattern
    );

    if (mainContentActualStartIndex === -1) {
      mainContentActualStartIndex = 0;
      console.warn(
        "Main content start marker 'Chapter 1: Getting started with SQL' not found reliably. Metadata accuracy may be affected for early chunks, processing from document start."
      );
    }

    const cleanTitleForMatch = (rawTitle) =>
      rawTitle
        ? rawTitle
            .replace(/\.+$/, "")
            .replace(/\s+\d+$/, "")
            .trim()
        : "Unnamed";

    if (
      currentChunkAbsoluteStartIndex < mainContentActualStartIndex &&
      mainContentActualStartIndex !== 0
    ) {
      // Chunk is in preamble, use default preamble metadata
      section = `Section ${sectionFullID}`; // Construct final section string
    } else {
      // Chunk is in main content
      const textBeforeChunkStart = fullPdfText.substring(
        0,
        currentChunkAbsoluteStartIndex
      );

      const chapterRegex = /^Chapter\s+(\d+):/gm;
      const sectionRegex = /^Section\s+(\d+\.\d+):/gm;

      let lastChapterFoundNumber = "1";
      let lastChapterMatchIndex =
        mainContentActualStartIndex > 0 ? mainContentActualStartIndex : 0;
      let match;

      // Find the last chapter heading before or at the start of the current chunk
      let tempChapterSearchText =
        mainContentActualStartIndex === 0
          ? textBeforeChunkStart
          : fullPdfText.substring(
              mainContentActualStartIndex,
              currentChunkAbsoluteStartIndex
            );
      while ((match = chapterRegex.exec(tempChapterSearchText)) !== null) {
        // Ensure the match is indeed before or at the start of the current chunk relative to the searched text
        // The match.index is relative to tempChapterSearchText
        lastChapterFoundNumber = match[1];
        lastChapterMatchIndex =
          (mainContentActualStartIndex === 0
            ? 0
            : mainContentActualStartIndex) + match.index; // Absolute index in fullPdfText
      }
      chapterNumber = lastChapterFoundNumber;
      chapterTitle = `Chapter ${chapterNumber}`;

      // Find the last section heading (for the current chapter) before or at the start of the current chunk
      let lastSectionFoundID = `${chapterNumber}.0`;
      // Search for sections from the start of the found chapter up to the start of the current chunk
      const textForSectionSearch = fullPdfText.substring(
        lastChapterMatchIndex,
        currentChunkAbsoluteStartIndex
      );

      while ((match = sectionRegex.exec(textForSectionSearch)) !== null) {
        if (match[1].startsWith(chapterNumber + ".")) {
          lastSectionFoundID = match[1];
        }
      }
      sectionFullID = lastSectionFoundID;
      sectionTitle = `Section ${sectionFullID}`;

      // Override with chunk-specific headings if present at the VERY START of the chunk
      const chunkChapterStartMatch =
        currentChunkText.match(/^Chapter\s+(\d+):/im);
      if (chunkChapterStartMatch) {
        chapterNumber = chunkChapterStartMatch[1];
        chapterTitle = `Chapter ${chapterNumber}`;
        sectionFullID = `${chapterNumber}.0`; // Reset section for new chapter
        sectionTitle = `Section ${sectionFullID}`;
        // Check if this chunk ALSO defines the first section of this new chapter
        const chunkSectionInNewChapter = currentChunkText.match(
          new RegExp(`^Section\s+(${chapterNumber}\.\d+):`, "im")
        );
        if (chunkSectionInNewChapter) {
          sectionFullID = chunkSectionInNewChapter[1];
          sectionTitle = `Section ${sectionFullID}`;
        }
      } else {
        const chunkSectionStartMatch = currentChunkText.match(
          new RegExp(`^Section\s+(${chapterNumber}\.\d+):`, "im")
        );
        if (chunkSectionStartMatch) {
          sectionFullID = chunkSectionStartMatch[1];
          sectionTitle = `Section ${sectionFullID}`;
        }
      }
      section = sectionTitle; // Final section string based on numbers
    }

    const chapterNumInt = parseInt(chapterNumber, 10);
    const beginnerChapters = [
      0, 1, 2, 3, 5, 6, 8, 13, 14, 15, 19, 38, 41, 53, 78,
    ];
    const advancedChapters = [
      10, 20, 26, 27, 28, 29, 30, 31, 32, 34, 46, 48, 49, 59, 60, 61, 62, 63,
      68, 69, 72, 85, 91, 93, 94, 98, 100, 101, 102, 103, 104,
    ];

    if (beginnerChapters.includes(chapterNumInt)) {
      level = "beginner";
    } else if (advancedChapters.includes(chapterNumInt)) {
      level = "advanced";
    } else {
      level = "intermediate";
    }

    return {
      level,
      chapter_number: chapterNumber,
      chapter_title: chapterTitle,
      section: section, // Use the simplified section title
    };
  } catch (error) {
    console.error(
      "Error analyzing PDF metadata for chunk:",
      error.message,
      error.stack
    );
    return {
      level: "error",
      chapter_number: "error",
      chapter_title: "Error",
      section: "Error",
    };
  }
}

// Initialize Pinecone Vector Store
const pcvs_assistant_documents = new PineconeVectorStore({
  indexName: "assistant-documents",
  chunkSize: 100,
  storesText: true,
  embeddingModel: new OpenAIEmbedding({
    model: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
    apiKey: process.env.AZURE_OPENAI_KEY,
    additionalSessionOptions: { baseURL: process.env.AZURE_OPENAI_EMBEDDING_BASE_URL },
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

  console.log(`Processing ${documents.length} documents for storage...`);

  // Validate each document and flatten metadata
  documents = documents.map((doc, idx) => {
    if (!doc.text || typeof doc.text !== "string") {
      throw new Error(`Document at index ${idx} is missing valid text.`);
    }

    // Flatten metadata if originalMetadata exists
    if (doc.metadata?.originalMetadata) {
      const { originalMetadata, ...otherMetadata } = doc.metadata;
      doc.metadata = {
        ...otherMetadata,
        pdf_name: originalMetadata.file_name || "",
        pdf_type: originalMetadata.file_type || "",
        pdf_size: String(originalMetadata.file_size || ""),
        pdf_page: String(originalMetadata.page_number || ""),
      };
    }

    return doc;
  });

  try {
    console.log("Creating VectorStoreIndex from documents...");
    // Create a VectorStoreIndex from the documents
    await VectorStoreIndex.fromDocuments(documents, {
      storageContext,
      embedModel: Settings.embedModel,
    });
    console.log("Successfully stored documents in Pinecone");
  } catch (error) {
    console.error("Error in Pinecone add:", error);
    throw error;
  }
}

/**
 * Fetches PDF from URL and extracts text content using LlamaIndex PDFReader
 * @param {string} url - URL of the PDF file
 * @returns {Promise<Document[]>} - Array of Document objects
 */
async function fetchAndExtractPDF(url) {
  let tempFilePath = null;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const tempFileName = `temp-${uuidv4()}.pdf`;
    tempFilePath = path.join(process.cwd(), "temp", tempFileName);
    await fs.promises.mkdir(path.join(process.cwd(), "temp"), {
      recursive: true,
    });
    await writeFile(tempFilePath, buffer);
    const reader = new PDFReader();
    const llamaDocs = await reader.loadData(tempFilePath);
    await fs.promises.unlink(tempFilePath);

    if (Array.isArray(llamaDocs) && llamaDocs.length > 0) {
      // Ensure that we handle cases where doc.text might not exist or be null
      const texts = llamaDocs.map((doc) => (doc && doc.text ? doc.text : ""));
      return texts.join("\n\n");
    } else {
      console.warn(
        "PDFReader returned no documents or an unexpected format. Returning empty string."
      );
      return ""; // Ensure a string is always returned
    }
  } catch (error) {
    if (tempFilePath) {
      try {
        await fs.promises.unlink(tempFilePath);
      } catch (cleanupError) {
        console.error("Error cleaning up temporary file:", cleanupError);
      }
    }
    console.error("Error fetching or parsing PDF:", error);
    throw error; // Re-throw the error to be caught by the caller
  }
}

/**
 * Logs document chunks and metadata to a CSV file for verification
 * @param {Document[]} documents - Array of documents to log
 * @param {string} type - Type of documents (e.g., 'hardskill', 'standard')
 * @param {string} assistantId - ID of the assistant
 * @returns {Promise<string>} - Path to the created CSV file
 */
async function logDocumentsToCSV(documents, type, assistantId) {
  try {
    // Create logs directory if it doesn't exist
    const logDir = path.join(process.cwd(), "logs");
    await fs.promises.mkdir(logDir, { recursive: true });

    // Create a unique filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = path.join(
      logDir,
      `${type}_chunks_${assistantId}_${timestamp}.csv`
    );

    // Define CSV headers
    const csvWriter = createObjectCsvWriter({
      path: filename,
      header: [
        { id: "chunkIndex", title: "Chunk Index" },
        { id: "level", title: "Skill Level" },
        { id: "chapter_number", title: "Chapter Number" },
        { id: "chapter_title", title: "Chapter Title" },
        { id: "section", title: "Section" },
        { id: "sourceType", title: "Source Type" },
        { id: "pdf_name", title: "PDF Name" },
        { id: "timestamp", title: "Timestamp" },
        { id: "text", title: "Text Content" },
      ],
    });

    // Prepare data for CSV
    const records = documents.map((doc) => {
      // Extract key fields from metadata, with fallbacks
      return {
        chunkIndex: doc.metadata.chunkIndex || "",
        level: doc.metadata.level || "",
        chapter_number: doc.metadata.chapter_number || "",
        chapter_title: doc.metadata.chapter_title || "",
        section: doc.metadata.section || "",
        sourceType: doc.metadata.sourceType || "",
        pdf_name: doc.metadata.pdf_name || "",
        timestamp: doc.metadata.timestamp || "",
        // Truncate text to prevent CSV issues
        text: doc.text.substring(0, 500) + (doc.text.length > 500 ? "..." : ""),
      };
    });

    // Write to CSV
    await csvWriter.writeRecords(records);
    console.log(`CSV log created at: ${filename}`);
    return filename;
  } catch (error) {
    console.error("Error creating CSV log:", error);
    return null;
  }
}

/**
 * Logs document chunks and metadata to a JSON file for verification.
 * @param {Document[]} documents - Array of LlamaIndex Document objects to log.
 * @param {string} type - Type of documents (e.g., 'hardskill', 'standard').
 * @param {string} assistantId - ID of the assistant.
 * @returns {Promise<string|null>} - Path to the created JSON file, or null on error.
 */
async function logDocumentsToJSON(documents, type, assistantId) {
  try {
    const logDir = path.join(process.cwd(), "logs");
    await fs.promises.mkdir(logDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = path.join(
      logDir,
      `${type}_chunks_${assistantId}_${timestamp}.json`
    );

    const loggableDocuments = documents.map((doc) => ({
      text: doc.text,
      metadata: doc.metadata,
    }));

    await writeFile(filename, JSON.stringify(loggableDocuments, null, 2));
    console.log(`JSON log created at: ${filename}`);
    return filename;
  } catch (error) {
    console.error("Error creating JSON log:", error);
    return null;
  }
}

/**
 * Controller function to add documents to assistant-documents
 */
export async function handleAddDocumentsToAssistantDocuments(req, res) {
  const { assistantId } = req.params;
  const { text, url, isHardSkill, hardSkillMetadata, additionalMetadata } =
    req.body;

  console.log(`Processing request for assistantId: ${assistantId}`);
  console.log(`Input type: ${url ? "PDF URL" : "text"}`);
  if (isHardSkill) {
    console.log("Processing as hard skill content");
  }

  try {
    let llamaDocuments = [];
    let logFilePath = null;
    let documentSourceType = url ? "pdf" : "text";

    // Allow callers to attach arbitrary metadata (e.g., topic) to each chunk
    const extraMetadata =
      additionalMetadata &&
      typeof additionalMetadata === "object" &&
      !Array.isArray(additionalMetadata)
        ? additionalMetadata
        : {};

    const baseMetadata = {
      ...extraMetadata, // user-provided metadata should not override system-set fields below
      source: "assistant-documents",
      assistantId: assistantId,
      sourceType: documentSourceType,
      timestamp: new Date().toISOString(),
      isHardSkill: isHardSkill || false,
    };
    if (url) {
      baseMetadata.sourceUrl = url;
    }

    let fullTextContent = "";
    if (url) {
      console.log(`Fetching and extracting text from PDF URL: ${url}`);
      const extractedText = await fetchAndExtractPDF(url);
      fullTextContent = typeof extractedText === "string" ? extractedText : ""; // Ensure it's a string
      if (!fullTextContent) {
        console.warn(
          "fetchAndExtractPDF returned empty or non-string content for URL."
        );
      }
    } else if (text) {
      fullTextContent = typeof text === "string" ? text : ""; // Ensure text is a string
      if (!fullTextContent) {
        console.warn("Direct text input is empty or non-string.");
      }
    }

    if (!fullTextContent && (url || text)) {
      // Check if after processing, content is still effectively empty
      console.warn(
        "No processable text content found from URL or direct input after initial extraction."
      );
      return res.status(400).json({
        error: "No text content to process from URL or direct input.",
      });
    }

    if (isHardSkill) {
      console.log("Parsing document into sections for hard skill...");
      const parsedSections = parseDocumentIntoSections(fullTextContent);
      console.log(`Document parsed into ${parsedSections.length} sections.`);
      let globalChunkCounter = 0;

      for (const section of parsedSections) {
        const chapterNumber = section.inferredChapterNumber;
        const chapterTitle = `Chapter ${chapterNumber}`;

        let sectionNumberToUse = chapterNumber + ".0"; // Default to .0 if no specific section number
        let sectionTitleToUse = section.rawSectionHeading; // Use the full raw heading as the section title

        const sectionNumMatch = section.rawSectionHeading.match(
          /^Section\s+(\d+\.\d+):/i
        );
        if (
          sectionNumMatch &&
          sectionNumMatch[1].startsWith(chapterNumber + ".")
        ) {
          sectionNumberToUse = sectionNumMatch[1];
        } else if (
          section.rawSectionHeading === `${chapterTitle} Overview` &&
          chapterNumber !== "0"
        ) {
          sectionNumberToUse = chapterNumber + ".0";
        } else if (chapterNumber === "0") {
          // Preamble
          sectionNumberToUse = "0.0";
          sectionTitleToUse = "Preamble/TOC";
        }

        const level = getLevelForChapter(chapterNumber);
        const sectionContent = section.sectionContent;
        const chunks = splitTextIntoChunks(sectionContent, 512, 102);

        chunks.forEach((chunkText, chunkIndexInSection) => {
          const docMetadata = {
            ...baseMetadata, // Common metadata
            chapter_number: chapterNumber,
            chapter_title: chapterTitle,
            section_number: sectionNumberToUse,
            section_title: sectionTitleToUse,
            level: level,
            // chunkIndex: globalChunkCounter, // Overall chunk index
            // sectionChunkIndex: chunkIndexInSection // Index of chunk within this section
          };
          llamaDocuments.push(
            new Document({ text: chunkText, metadata: docMetadata })
          );
          globalChunkCounter++;
        });
      }
      if (llamaDocuments.length > 0) {
        logFilePath = await logDocumentsToJSON(
          llamaDocuments,
          "hardskill",
          assistantId
        );
      }
    } else {
      // Standard processing (not a hard skill, or different logic for non-hard-skill)
      console.log("Processing as standard content (not hard skill)...");
      const chunks = splitTextIntoChunks(fullTextContent, 512, 102);
      llamaDocuments = chunks.map(
        (chunk, index) =>
          new Document({
            text: chunk,
            metadata: {
              ...baseMetadata,
              // chunkIndex: index, // Keep chunkIndex relative to all chunks of the doc
              // Add other relevant flat metadata if available (e.g. pdf_name from earlier logic)
            },
          })
      );
      // Potentially log these too if needed, using a different type e.g., 'standard'
      if (llamaDocuments.length > 0) {
        logFilePath = await logDocumentsToJSON(
          llamaDocuments,
          "standard",
          assistantId
        );
      }
    }

    if (llamaDocuments.length === 0 && (url || text)) {
      console.warn(
        "No documents were generated from the input. This might be due to empty content after parsing or an issue in section/chunk processing."
      );
      // Decide if to error out or return success with 0 documents
    }

    const assistantConfig = {
      temperature: 0.2,
      topP: 0.95,
      frequencyPenalty: 0.0,
      presencePenalty: 0.0,
      stream: false,
    };
    await initializeSettings(assistantConfig);

    if (llamaDocuments.length > 0) {
      await storeAssistantDocuments(llamaDocuments);
    }

    res.status(200).json({
      message: "Documents processed successfully",
      documentCount: llamaDocuments.length,
      sourceType: documentSourceType,
      isHardSkill: isHardSkill || false,
      logFile: logFilePath,
    });
  } catch (error) {
    console.error("Error in handleAddDocumentsToAssistantDocuments:", error);
    res
      .status(500)
      .json({ error: "Failed to add documents", details: error.message });
  }
}

// Helper function to determine skill level based on chapter number
const chapterLevels = {
  beginner: [0, 1, 2, 3, 5, 6, 8, 13, 14, 15, 19, 38, 41, 53, 78],
  intermediate: [], // Auto-populated
  advanced: [
    10, 20, 26, 27, 28, 29, 30, 31, 32, 34, 46, 48, 49, 59, 60, 61, 62, 63, 68,
    69, 72, 85, 91, 93, 94, 98, 100, 101, 102, 103, 104,
  ],
};
const allCategorizedChapters = new Set([
  ...chapterLevels.beginner,
  ...chapterLevels.advanced,
]);
for (let i = 0; i <= 111; i++) {
  // Assuming max chapter around 111 based on SQL Notes
  if (!allCategorizedChapters.has(i)) {
    chapterLevels.intermediate.push(i);
  }
}
function getLevelForChapter(chapterNumberStr) {
  const num = parseInt(chapterNumberStr, 10);
  if (isNaN(num)) return "intermediate"; // Default for non-numeric chapters
  if (chapterLevels.beginner.includes(num)) return "beginner";
  if (chapterLevels.advanced.includes(num)) return "advanced";
  if (chapterLevels.intermediate.includes(num)) return "intermediate";
  return "intermediate"; // Default if somehow not categorized
}

/**
 * Parses the full document text into logical sections based on Chapter and Section headings.
 * @param {string} fullText - The entire text content of the document.
 * @returns {Array<Object>} - Array of section objects.
 */
function parseDocumentIntoSections(fullText) {
  const sections = [];
  const lines = fullText.split(/\r?\n/);

  let currentChapterNumber = "0";
  let currentChapterTitle = "Chapter 0"; // Default for preamble
  let currentSectionNumber = "0.0";
  let currentRawSectionHeading = "Preamble/TOC";
  let currentSectionContentLines = [];

  const chapterRegex = /^Chapter\s+(\d+):(.*)/i;
  const sectionRegex = /^Section\s+(\d+\.\d+):(.*)/i;
  // Marker for SQL Notes for Professionals - adjust if different for other docs
  const mainContentStartMarker = "Chapter 1: Getting started with SQL";
  let mainContentEffectivelyStarted = false;

  for (const line of lines) {
    if (
      !mainContentEffectivelyStarted &&
      line.trim().startsWith(mainContentStartMarker.substring(0, 30))
    ) {
      mainContentEffectivelyStarted = true;
    }

    const chapterMatch = line.match(chapterRegex);
    const sectionMatch = line.match(sectionRegex);

    if (chapterMatch) {
      if (currentSectionContentLines.length > 0) {
        sections.push({
          inferredChapterNumber: currentChapterNumber,
          rawSectionHeading: currentRawSectionHeading,
          sectionContent: currentSectionContentLines.join("\n").trim(),
        });
      }
      currentSectionContentLines = [];

      currentChapterNumber = chapterMatch[1];
      currentChapterTitle = `Chapter ${currentChapterNumber}`;
      // Reset section for new chapter to a default ".0" or overview
      currentSectionNumber = `${currentChapterNumber}.0`;
      currentRawSectionHeading = `${currentChapterTitle} Overview`; // Default heading for chapter start
      currentSectionContentLines.push(line); // Include chapter heading in its own section's content
    } else if (sectionMatch) {
      if (currentSectionContentLines.length > 0) {
        sections.push({
          inferredChapterNumber: currentChapterNumber,
          rawSectionHeading: currentRawSectionHeading,
          sectionContent: currentSectionContentLines.join("\n").trim(),
        });
      }
      currentSectionContentLines = [];

      currentSectionNumber = sectionMatch[1];
      currentRawSectionHeading = line.trim(); // Full line is the raw section heading

      // Infer chapter from section if section starts a new chapter implicitly or if preamble handling is off
      const sectionChapterPart = currentSectionNumber.split(".")[0];
      if (
        sectionChapterPart !== currentChapterNumber &&
        mainContentEffectivelyStarted
      ) {
        console.warn(
          `Section ${currentSectionNumber} appears in chapter ${currentChapterNumber}. Updating chapter context.`
        );
        currentChapterNumber = sectionChapterPart;
        currentChapterTitle = `Chapter ${currentChapterNumber}`;
      }
      currentSectionContentLines.push(line); // Include section heading in its content
    } else {
      if (mainContentEffectivelyStarted || currentChapterNumber !== "0") {
        //Only add content if main content started or in Ch 0
        if (line.trim() !== "") {
          // Avoid just empty lines
          currentSectionContentLines.push(line);
        }
      }
    }
  }

  // Add the last processed section
  if (currentSectionContentLines.length > 0) {
    sections.push({
      inferredChapterNumber: currentChapterNumber,
      rawSectionHeading: currentRawSectionHeading,
      sectionContent: currentSectionContentLines.join("\n").trim(),
    });
  }
  return sections;
}

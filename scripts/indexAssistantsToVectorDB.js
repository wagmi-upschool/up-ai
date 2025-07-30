/**
 * WUP-858: Script to index assistants from DynamoDB to Pinecone vector database
 * Fetches assistants from UpAssistant table and indexes them for recommendation system
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { Pinecone } from "@pinecone-database/pinecone";
import { OpenAIEmbedding } from "llamaindex";
import { config } from "dotenv";

// Load environment variables
config();

// Environment configuration - CRITICAL: Must match deployment environment
const STAGE = process.env.STAGE || "myenv"; // myenv=UAT, upwagmitec=PROD
const PINECONE_INDEX_NAME = "assistant-recommend";

// Initialize AWS DynamoDB client
const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
});
const dynamoDocClient = DynamoDBDocumentClient.from(dynamoClient);

// Initialize Pinecone client
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

// Initialize OpenAI Embedding model (same as existing system)
function getAzureEmbeddingOptions() {
  return {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    deployment: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME,
    apiKey: process.env.AZURE_OPENAI_KEY,
  };
}

const embeddingModel = new OpenAIEmbedding({
  model: "text-embedding-3-small",
  azure: getAzureEmbeddingOptions(),
});

/**
 * Loads assistants from updated_assistants.json file with enhanced categories
 * Uses local JSON file instead of DynamoDB for updated data structure
 */
async function loadAssistantsFromJSON() {
  console.log(`🔍 Loading assistants from updated_assistants.json`);

  try {
    const fs = await import("fs");
    const path = await import("path");

    const jsonPath = path.resolve("./updated_assistants.json");
    const jsonData = await fs.promises.readFile(jsonPath, "utf8");
    const assistants = JSON.parse(jsonData);

    // Filter by environment and status
    const filteredAssistants = assistants.filter(
      (assistant) =>
        assistant.environment === STAGE && assistant.status === true
    );

    console.log(`📦 Loaded ${assistants.length} total assistants`);
    console.log(
      `✅ Filtered to ${filteredAssistants.length} active assistants for environment: ${STAGE}`
    );

    return filteredAssistants;
  } catch (error) {
    console.error(`❌ Error loading assistants from JSON:`, error);
    throw error;
  }
}

/**
 * Fetches all assistants from the appropriate DynamoDB table based on environment
 * CRITICAL: Environment filtering is essential for data isolation
 */
async function fetchAssistantsFromDynamoDB() {
  const tableName = `UpAssistant-${STAGE}`;
  console.log(`🔍 Fetching assistants from table: ${tableName}`);

  try {
    const allAssistants = [];
    let lastEvaluatedKey = null;

    do {
      const params = {
        TableName: tableName,
        FilterExpression: "#status = :status",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":status": true,
        },
        ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}),
      };

      const result = await dynamoDocClient.send(new ScanCommand(params));
      allAssistants.push(...result.Items);
      lastEvaluatedKey = result.LastEvaluatedKey;

      console.log(
        `📦 Fetched ${result.Items.length} assistants, total: ${allAssistants.length}`
      );
    } while (lastEvaluatedKey);

    console.log(`✅ Total active assistants fetched: ${allAssistants.length}`);
    return allAssistants;
  } catch (error) {
    console.error(`❌ Error fetching assistants from ${tableName}:`, error);
    throw error;
  }
}

/**
 * Fetches user group to assistant mappings from DynamoDB
 * CRITICAL: Used to determine which assistants belong to which user groups
 */
async function fetchUserGroupAssistants() {
  const tableName = `UserGroupAssistants-${STAGE}`;
  console.log(`🔍 Fetching user group mappings from table: ${tableName}`);

  try {
    const params = {
      TableName: tableName,
    };

    const result = await dynamoDocClient.send(new ScanCommand(params));
    console.log(`📦 Fetched ${result.Items.length} user group mappings`);

    // Create a mapping from assistantId to userGroups
    const assistantToGroups = {};
    result.Items.forEach((item) => {
      const userGroup = item.partitionKey.replace("GROUP#", "");
      if (item.assistantIds && Array.isArray(item.assistantIds)) {
        item.assistantIds.forEach((assistantId) => {
          if (!assistantToGroups[assistantId]) {
            assistantToGroups[assistantId] = [];
          }
          assistantToGroups[assistantId].push(userGroup);
        });
      }
    });

    console.log(
      `✅ Created assistant to user groups mapping for ${
        Object.keys(assistantToGroups).length
      } assistants`
    );
    return assistantToGroups;
  } catch (error) {
    console.error(
      `❌ Error fetching user group mappings from ${tableName}:`,
      error
    );
    throw error;
  }
}

/**
 * Enhanced agent data mapping with Turkish categories and keywords
 */
const enhancedAgentData = {
  "97729d8e-b722-4822-9490-a900cec81260": {
    category: "İletişim Becerileri",
    keywords: [
      "etkin dinleme",
      "aktif dinleme",
      "iletişim",
      "kişilerarası beceriler",
      "dinleme pratiği",
      "yumuşak beceriler",
    ],
  },
  "5a0d25d3-d483-41ca-8551-9e83f47e0f7a": {
    category: "İletişim Becerileri",
    keywords: [
      "geri bildirim",
      "geribildirim",
      "iletişim",
      "pratik",
      "iş yeri becerileri",
      "yapıcı eleştiri",
    ],
  },
  "4edebe53-5663-4e36-bb73-4b5696c168ca": {
    category: "Kariyer Gelişimi",
    keywords: [
      "performans değerlendirme",
      "performans görüşmesi",
      "kariyer koçluğu",
      "görüşme hazırlığı",
      "profesyonel gelişim",
    ],
  },
  "a52ac10b-9771-4276-b320-ef0bf677d470": {
    category: "İletişim Becerileri",
    keywords: [
      "soru sorma",
      "soru becerileri",
      "iletişim",
      "koçluk",
      "etkili sorular",
      "etkileşim",
    ],
  },
  "ca33604c-0e0f-4130-b16e-e05676f63976": {
    category: "Verimlilik",
    keywords: [
      "öncelik belirleme",
      "öncelik ayarlama",
      "zaman yönetimi",
      "günlük planlama",
      "verimlilik",
      "görev yönetimi",
    ],
  },
  "cef94e12-d507-4421-818c-9c9b72aae4df": {
    category: "Teknik Eğitim",
    keywords: [
      "SQL",
      "veritabanı",
      "öğrenme",
      "programlama",
      "teknik beceriler",
      "adım adım",
      "eğitim",
    ],
  },
  "d80184f3-876b-4701-87e7-ad374418eb15": {
    category: "Mentorluk",
    keywords: [
      "mentorluk",
      "rehberlik",
      "koçluk",
      "profesyonel gelişim",
      "kariyer desteği",
      "öğrenme",
    ],
  },
  "4b88c4d7-f88d-471f-b5e5-7f52d137cace": {
    category: "Not Alma",
    keywords: [
      "not alma",
      "not tutma",
      "özet",
      "etkinlik notları",
      "konferans",
      "dokümantasyon",
    ],
  },
  "7f0ee92d-dd52-4c5b-9b80-cbbadb9cd98c": {
    category: "Teknik Eğitim",
    keywords: [
      "SQL",
      "veritabanı",
      "öğrenme",
      "programlama",
      "teknik beceriler",
      "adım adım",
      "eğitim",
    ],
  },
  "8cecea10-07e7-4572-9053-bd443091ef28": {
    category: "Kişisel Sağlık",
    keywords: [
      "mutluluk",
      "sevinç",
      "minnettarlık",
      "pozitif düşünce",
      "refah",
      "günlük",
      "farkındalık",
    ],
  },
  "6c1405f9-9966-4d16-b9b3-06bdd62e4fd6": {
    category: "Kariyer Gelişimi",
    keywords: [
      "mülakat",
      "iş görüşmesi",
      "iş başvuru hazırlığı",
      "kariyer gelişimi",
      "mülakat becerileri",
      "iş arama",
    ],
  },
  "cc6f56e5-35dd-4638-980b-2d24bb04f875": {
    category: "Kişisel Sağlık",
    keywords: [
      "meditasyon",
      "derin düşünce",
      "farkındalık",
      "ruh sağlığı",
      "stres atma",
      "sağlık",
      "zihin pratiği",
    ],
  },
  "ddb044ed-f39a-4d07-a3dc-230ccb6c4751": {
    category: "Kişisel Gelişim",
    keywords: [
      "alışkanlık",
      "alışkanlık oluşturma",
      "kendini geliştirme",
      "kişisel büyüme",
      "hedef belirleme",
      "davranış değişikliği",
    ],
  },
  "848a0a46-1bc3-42bf-8aa1-f5fe672907bc": {
    category: "Yaşam Planlaması",
    keywords: [
      "yıl sonu değerlendirme",
      "yıl değerlendirmesi",
      "planlama",
      "hedef belirleme",
      "düşünme",
      "yeni yıl planlaması",
    ],
  },
  "4ded3a5e-1437-4d9d-a0e7-f43cf4a42c68": {
    category: "Verimlilik",
    keywords: [
      "zaman yönetimi",
      "zaman kontrolü",
      "enerji yönetimi",
      "verimlilik",
      "etkinlik",
      "iş-yaşam dengesi",
    ],
  },
  "d63e9a3b-a6f3-4a54-a707-615119a6ffb9": {
    category: "Öğrenme ve Eğitim",
    keywords: [
      "kitap okuma",
      "okuma",
      "öğrenme",
      "eğitim",
      "bilgi",
      "kişisel büyüme",
      "alışkanlık oluşturma",
    ],
  },
  "3c5ecfa4-58fe-493a-b308-472ac39cceec": {
    category: "Satış Eğitimi",
    keywords: [
      "satış",
      "satış eğitimi",
      "satış antrenmanı",
      "pratik",
      "iletişim",
      "iş becerileri",
      "müşteri ilişkileri",
    ],
  },
  "0777e23c-c4f7-4cd2-88cf-3f5136eee9b2": {
    category: "Verimlilik",
    keywords: [
      "öncelik belirleme",
      "öncelik ayarlama",
      "sabah rutini",
      "verimlilik",
      "planlama",
      "günlük yönetim",
    ],
  },
  "038c9287-3d3e-41c9-96d4-d8544381d35a": {
    category: "Kişisel Gelişim",
    keywords: [
      "büyüme zihniyeti",
      "gelişim odaklı düşünce",
      "kişisel gelişim",
      "öğrenme zihniyeti",
      "eğitim hazırlığı",
    ],
  },
  "cdbee26a-38cc-4d7f-b6b5-684e12e82764": {
    category: "Not Alma",
    keywords: [
      "hafıza",
      "bellek",
      "not alma",
      "özet",
      "belgeleme",
      "öğrenme desteği",
      "çalışma yardımı",
    ],
  },
  "2358d468-0c96-4fed-9639-ab3b0c4637b0": {
    category: "Profesyonel Gelişim",
    keywords: [
      "profesyonel gelişim",
      "mesleki gelişim",
      "kariyer büyümesi",
      "öğrenme",
      "beceri geliştirme",
      "kariyer planlama",
    ],
  },
  "d0cf1ea7-c191-4a5b-be2a-c45772af88e2": {
    category: "Kişisel Gelişim",
    keywords: [
      "günlük konuşma",
      "günlük sohbet",
      "kişisel büyüme",
      "gelişim",
      "koçluk",
      "sürekli öğrenme",
    ],
  },
};

/**
 * Prepares assistant data for vectorization with clean, focused content
 * Creates natural language descriptions instead of keyword spam
 */
function prepareAssistantForIndexing(assistant, userGroups = []) {
  const name = assistant.name || "";
  const description = assistant.description || "";
  const mainCategory = assistant.mainCategory || "";
  const subCategory = assistant.subCategory || "";
  
  // Extract most relevant keywords (first 10 words to avoid spam)
  const extractedKeywords = assistant.extractedKeywords || "";
  const topKeywords = extractedKeywords
    .split(" ")
    .filter(k => k.trim().length > 2) // Remove short words
    .slice(0, 10) // Take only top 10 keywords
    .join(" ");
  
  // Create natural, contextual content for better embeddings
  const searchableContent = [
    name,                                    // Agent name (most important)
    description,                             // Natural description
    `${mainCategory} ${subCategory}`,        // Category context
    topKeywords                              // Limited, focused keywords
  ]
  .filter(content => content && content.trim().length > 0)
  .join(". ")                                  // Use periods for natural separation
  .toLowerCase()
  .replace(/\s+/g, " ")                        // Normalize whitespace
  .trim();
  
  console.log(`📝 Simplified content for ${name}: "${searchableContent.substring(0, 100)}..."`);
  console.log(`📏 Content length: ${searchableContent.length} chars (target: ~300-600)`);
  
  // Streamlined metadata - only essential fields
  const metadata = {
    assistantId: assistant.id,
    name: name,
    description: description,
    environment: STAGE,
    userGroups: userGroups,
    category: assistant.category || `${mainCategory} > ${subCategory}`,
    mainCategory: mainCategory,
    subCategory: subCategory,
    semanticCluster: assistant.semanticCluster || "",
    extractedKeywords: topKeywords, // Only top keywords
    type: assistant.type || "",
    src: assistant.src || "",
    createdAt: assistant.createdAt || "",
    updatedAt: assistant.updatedAt || ""
  };
  
  return {
    content: searchableContent,
    metadata
  };
}

/**
 * Generates embeddings for assistant content using OpenAI
 * Uses the same embedding model as the existing RAG system (text-embedding-3-small)
 */
async function generateEmbedding(content) {
  console.log(`🔤 Generating embedding for content length: ${content.length}`);

  try {
    // Use the same embedding model as the existing system
    const embedding = await embeddingModel.getTextEmbedding(content);
    console.log(`✅ Generated embedding with dimension: ${embedding.length}`);
    return embedding;
  } catch (error) {
    console.error(`❌ Error generating embedding:`, error);
    throw error;
  }
}

/**
 * Indexes assistants to Pinecone vector database
 * CRITICAL: Includes environment and userGroup metadata for filtering
 */
async function indexAssistantsToPinecone(assistants, assistantToGroups) {
  console.log(
    `🚀 Starting to index ${assistants.length} assistants to Pinecone index: ${PINECONE_INDEX_NAME}`
  );

  try {
    const index = pinecone.index(PINECONE_INDEX_NAME);
    const vectors = [];

    for (const assistant of assistants) {
      const userGroups = assistantToGroups[assistant.id] || [];
      const preparedAssistant = prepareAssistantForIndexing(
        assistant,
        userGroups
      );

      // Skip assistants without meaningful content
      if (!preparedAssistant.content.trim()) {
        console.log(
          `⚠️  Skipping assistant ${assistant.id} - no searchable content`
        );
        continue;
      }

      // Generate embedding
      const embedding = await generateEmbedding(preparedAssistant.content);

      vectors.push({
        id: `${STAGE}_${assistant.id}`, // CRITICAL: Environment prefix for isolation
        values: embedding,
        metadata: preparedAssistant.metadata,
      });

      console.log(
        `✅ Prepared vector for assistant: ${assistant.name} (${assistant.id})`
      );
    }

    // Batch upsert to Pinecone
    if (vectors.length > 0) {
      console.log(`📤 Upserting ${vectors.length} vectors to Pinecone...`);

      // Upsert in batches of 100 (Pinecone limit)
      const batchSize = 100;
      for (let i = 0; i < vectors.length; i += batchSize) {
        const batch = vectors.slice(i, i + batchSize);
        await index.upsert(batch);
        console.log(
          `📦 Upserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
            vectors.length / batchSize
          )}`
        );
      }

      console.log(
        `🎉 Successfully indexed ${vectors.length} assistants to Pinecone!`
      );
    } else {
      console.log(`⚠️  No vectors to index`);
    }
  } catch (error) {
    console.error(`❌ Error indexing to Pinecone:`, error);
    throw error;
  }
}

/**
 * Saves assistants data to JSON file with full fields for verification
 */
async function saveAssistantsToJSON(assistants, assistantToGroups) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `./logs/assistants_full_${STAGE}_${timestamp}.json`;

    // Create logs directory if it doesn't exist
    const fs = await import("fs");
    await fs.promises.mkdir("./logs", { recursive: true });

    // Prepare essential assistant data (only fields used for embedding + critical metadata)
    const fullAssistantData = assistants.map((assistant) => ({
      // Core identification
      id: assistant.id,
      name: assistant.name,
      description: assistant.description,
      title: assistant.title,
      status: assistant.status,

      // Fields actually used for embedding
      type: assistant.type,
      category: assistant.category,

      // Visual
      src: assistant.src,

      // Ownership & timestamps
      userId: assistant.userId,
      createdAt: assistant.createdAt,
      updatedAt: assistant.updatedAt,

      // CRITICAL: User group mapping for filtering
      userGroups: assistantToGroups[assistant.id] || [],

      // Environment isolation
      environment: STAGE,

      // Search optimization - use enhanced keywords only
      extractedKeywords:
        enhancedAgentData[assistant.id]?.keywords?.join(" ") || "",
      searchableContent: [
        assistant.name || "",
        assistant.description || "",
        assistant.title || "",
        enhancedAgentData[assistant.id]?.keywords?.join(" ") || "",
        assistant.type || "",
        assistant.category || "",
      ]
        .filter((content) => content.trim().length > 0)
        .join(" ")
        .substring(0, 300),
    }));

    // Save to JSON file
    await fs.promises.writeFile(
      filename,
      JSON.stringify(fullAssistantData, null, 2),
      "utf8"
    );

    console.log(`💾 Full assistant data saved to: ${filename}`);
    console.log(
      `📝 Contains ${fullAssistantData.length} assistants with complete metadata`
    );

    return filename;
  } catch (error) {
    console.error(`❌ Error saving assistants to JSON:`, error);
    return null;
  }
}

/**
 * Main function to execute the indexing process
 */
async function main() {
  console.log(
    `🚀 Starting assistant indexing process for environment: ${STAGE}`
  );
  console.log(`📍 Target Pinecone index: ${PINECONE_INDEX_NAME}`);

  try {
    // Step 1: Load assistants from updated JSON file
    const assistants = await loadAssistantsFromJSON();

    // Step 2: Extract user group mappings from JSON data
    const assistantToGroups = {};
    assistants.forEach((assistant) => {
      if (assistant.userGroups && Array.isArray(assistant.userGroups)) {
        assistantToGroups[assistant.id] = assistant.userGroups;
      }
    });

    // Step 3: Save full data to JSON for verification
    const jsonFile = await saveAssistantsToJSON(assistants, assistantToGroups);

    // Step 4: Index to Pinecone
    await indexAssistantsToPinecone(assistants, assistantToGroups);

    console.log(`🎉 Assistant indexing completed successfully!`);
    console.log(`📊 Summary:`);
    console.log(`   - Environment: ${STAGE}`);
    console.log(`   - Assistants processed: ${assistants.length}`);
    console.log(
      `   - User groups mapped: ${Object.keys(assistantToGroups).length}`
    );
    console.log(`   - Full data saved to: ${jsonFile}`);
  } catch (error) {
    console.error(`💥 Assistant indexing failed:`, error);
    process.exit(1);
  }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export {
  main,
  fetchAssistantsFromDynamoDB,
  fetchUserGroupAssistants,
  prepareAssistantForIndexing,
};

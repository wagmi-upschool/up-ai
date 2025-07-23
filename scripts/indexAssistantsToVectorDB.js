/**
 * WUP-858: Script to index assistants from DynamoDB to Pinecone vector database
 * Fetches assistants from UpAssistant table and indexes them for recommendation system
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { Pinecone } from '@pinecone-database/pinecone';
import { OpenAIEmbedding } from 'llamaindex';
import { config } from 'dotenv';

// Load environment variables
config();

// Environment configuration - CRITICAL: Must match deployment environment
const STAGE = process.env.STAGE || 'myenv'; // myenv=UAT, upwagmitec=PROD
const PINECONE_INDEX_NAME = 'assistant-recommend';

// Initialize AWS DynamoDB client
const dynamoClient = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1'
});
const dynamoDocClient = DynamoDBDocumentClient.from(dynamoClient);

// Initialize Pinecone client
const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY
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
                FilterExpression: '#status = :status',
                ExpressionAttributeNames: {
                    '#status': 'status'
                },
                ExpressionAttributeValues: {
                    ':status': true
                },
                ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {})
            };
            
            const result = await dynamoDocClient.send(new ScanCommand(params));
            allAssistants.push(...result.Items);
            lastEvaluatedKey = result.LastEvaluatedKey;
            
            console.log(`📦 Fetched ${result.Items.length} assistants, total: ${allAssistants.length}`);
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
            TableName: tableName
        };
        
        const result = await dynamoDocClient.send(new ScanCommand(params));
        console.log(`📦 Fetched ${result.Items.length} user group mappings`);
        
        // Create a mapping from assistantId to userGroups
        const assistantToGroups = {};
        result.Items.forEach(item => {
            const userGroup = item.partitionKey.replace('GROUP#', '');
            if (item.assistantIds && Array.isArray(item.assistantIds)) {
                item.assistantIds.forEach(assistantId => {
                    if (!assistantToGroups[assistantId]) {
                        assistantToGroups[assistantId] = [];
                    }
                    assistantToGroups[assistantId].push(userGroup);
                });
            }
        });
        
        console.log(`✅ Created assistant to user groups mapping for ${Object.keys(assistantToGroups).length} assistants`);
        return assistantToGroups;
        
    } catch (error) {
        console.error(`❌ Error fetching user group mappings from ${tableName}:`, error);
        throw error;
    }
}

/**
 * Prepares assistant data for vectorization
 * Combines critical fields into searchable content
 */
function prepareAssistantForIndexing(assistant, userGroups = []) {
    // Create searchable content combining key fields
    const searchableContent = [
        assistant.name || '',
        assistant.description || '',
        assistant.title || '',
        // Extract keywords from prompt if exists
        extractKeywordsFromPrompt(assistant.prompt || ''),
        // Add category/type information if available
        assistant.type || '',
        assistant.category || ''
    ].filter(content => content.trim().length > 0).join(' ');
    
    // Prepare metadata with CRITICAL environment and userGroup filtering
    const metadata = {
        assistantId: assistant.id,
        name: assistant.name || '',
        description: assistant.description || '',
        userId: assistant.userId || '',
        environment: STAGE, // CRITICAL: Environment isolation
        userGroups: userGroups, // CRITICAL: User group filtering
        status: assistant.status,
        createdAt: assistant.createdAt || '',
        updatedAt: assistant.updatedAt || '',
        type: assistant.type || '',
        category: assistant.category || '',
        src: assistant.src || '', // Image URL
        temperature: assistant.temperature || '',
        maxTokens: assistant.maxTokens || '',
        hasUserInput: assistant.type === 'user-input' ? true : false
    };
    
    return {
        content: searchableContent,
        metadata
    };
}

/**
 * Extracts relevant keywords from assistant prompt
 * Simplified approach for Turkish content - focus on name and description
 */
function extractKeywordsFromPrompt(prompt) {
    if (!prompt || typeof prompt !== 'string') return '';
    
    // Simple cleaning - just remove obvious instruction markers
    let cleanedPrompt = prompt
        // Remove the ]***] title blocks
        .replace(/\]?\*\*\*\]?[^]*?\]\*\*\*\]/g, '')
        // Remove [**:] instruction blocks more carefully
        .replace(/\[\*\*:\][^[]*?\[\*\*::\]/g, '')
        // Remove [[instructions]] style blocks
        .replace(/\[\[[^\]]*\]\]/g, '')
        // Remove [BLANK] placeholders
        .replace(/\[BLANK\]/g, '')
        // Clean up extra whitespace and newlines
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    
    // Turkish stopwords (keep it minimal)
    const turkishStopwords = new Set([
        'bir', 'bu', 'şu', 'o', 've', 'ile', 'için', 'gibi', 'kadar', 
        'de', 'da', 'te', 'ta', 'nin', 'nın', 'nun', 'nün',
        'olan', 'olarak', 'var', 'yok', 'hem', 'ama', 'fakat',
        'ben', 'sen', 'biz', 'siz', 'onlar',
        'system', 'message', 'instructions', 'please', 'user', 'turkish'
    ]);
    
    // Simple word extraction
    const words = cleanedPrompt
        .split(/[\s.,!?;:\n\r"'"„"«»‹›\-–—]+/)
        .filter(word => {
            return word.length > 2 && 
                   !turkishStopwords.has(word) &&
                   /[a-zA-ZğüşıöçĞÜŞİÖÇ]/.test(word) && // Contains Turkish letters
                   word.length < 25;
        })
        .slice(0, 10); // Limit to 10 meaningful words
    
    return words.join(' ');
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
    console.log(`🚀 Starting to index ${assistants.length} assistants to Pinecone index: ${PINECONE_INDEX_NAME}`);
    
    try {
        const index = pinecone.index(PINECONE_INDEX_NAME);
        const vectors = [];
        
        for (const assistant of assistants) {
            const userGroups = assistantToGroups[assistant.id] || [];
            const preparedAssistant = prepareAssistantForIndexing(assistant, userGroups);
            
            // Skip assistants without meaningful content
            if (!preparedAssistant.content.trim()) {
                console.log(`⚠️  Skipping assistant ${assistant.id} - no searchable content`);
                continue;
            }
            
            // Generate embedding
            const embedding = await generateEmbedding(preparedAssistant.content);
            
            vectors.push({
                id: `${STAGE}_${assistant.id}`, // CRITICAL: Environment prefix for isolation
                values: embedding,
                metadata: preparedAssistant.metadata
            });
            
            console.log(`✅ Prepared vector for assistant: ${assistant.name} (${assistant.id})`);
        }
        
        // Batch upsert to Pinecone
        if (vectors.length > 0) {
            console.log(`📤 Upserting ${vectors.length} vectors to Pinecone...`);
            
            // Upsert in batches of 100 (Pinecone limit)
            const batchSize = 100;
            for (let i = 0; i < vectors.length; i += batchSize) {
                const batch = vectors.slice(i, i + batchSize);
                await index.upsert(batch);
                console.log(`📦 Upserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(vectors.length / batchSize)}`);
            }
            
            console.log(`🎉 Successfully indexed ${vectors.length} assistants to Pinecone!`);
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
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `./logs/assistants_full_${STAGE}_${timestamp}.json`;
        
        // Create logs directory if it doesn't exist
        const fs = await import('fs');
        await fs.promises.mkdir('./logs', { recursive: true });
        
        // Prepare essential assistant data (only fields used for embedding + critical metadata)
        const fullAssistantData = assistants.map(assistant => ({
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
            
            // Search optimization
            extractedKeywords: extractKeywordsFromPrompt(assistant.prompt || ''),
            searchableContent: [
                assistant.name || '',
                assistant.description || '',
                assistant.title || '',
                extractKeywordsFromPrompt(assistant.prompt || ''),
                assistant.type || '',
                assistant.category || ''
            ].filter(content => content.trim().length > 0).join(' ').substring(0, 300)
        }));
        
        // Save to JSON file
        await fs.promises.writeFile(filename, JSON.stringify(fullAssistantData, null, 2), 'utf8');
        
        console.log(`💾 Full assistant data saved to: ${filename}`);
        console.log(`📝 Contains ${fullAssistantData.length} assistants with complete metadata`);
        
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
    console.log(`🚀 Starting assistant indexing process for environment: ${STAGE}`);
    console.log(`📍 Target Pinecone index: ${PINECONE_INDEX_NAME}`);
    
    try {
        // Step 1: Fetch assistants from DynamoDB
        const assistants = await fetchAssistantsFromDynamoDB();
        
        // Step 2: Fetch user group mappings
        const assistantToGroups = await fetchUserGroupAssistants();
        
        // Step 3: Save full data to JSON for verification
        const jsonFile = await saveAssistantsToJSON(assistants, assistantToGroups);
        
        // Step 4: Index to Pinecone
        await indexAssistantsToPinecone(assistants, assistantToGroups);
        
        console.log(`🎉 Assistant indexing completed successfully!`);
        console.log(`📊 Summary:`);
        console.log(`   - Environment: ${STAGE}`);
        console.log(`   - Assistants processed: ${assistants.length}`);
        console.log(`   - User groups mapped: ${Object.keys(assistantToGroups).length}`);
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

export { main, fetchAssistantsFromDynamoDB, fetchUserGroupAssistants, prepareAssistantForIndexing };
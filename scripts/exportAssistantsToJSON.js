/**
 * WUP-858: Export assistants from DynamoDB to JSON (read-only)
 * Fetches assistants data without creating Pinecone vectors
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { config } from 'dotenv';
import fs from 'fs';

// Load environment variables
config();

// Environment configuration - CRITICAL: Must match deployment environment
const STAGE = process.env.STAGE || 'upwagmitec'; // myenv=UAT, upwagmitec=PROD

// Initialize AWS DynamoDB client
const dynamoClient = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1'
});
const dynamoDocClient = DynamoDBDocumentClient.from(dynamoClient);

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
 * Saves assistants data to JSON file with full fields for verification
 */
async function saveAssistantsToJSON(assistants, assistantToGroups) {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `./logs/assistants_full_${STAGE}_${timestamp}.json`;
        
        // Create logs directory if it doesn't exist
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
        
        // Also save a summary file
        const summaryFilename = `./logs/assistants_summary_${STAGE}_${timestamp}.json`;
        const summary = {
            environment: STAGE,
            timestamp: new Date().toISOString(),
            totalAssistants: fullAssistantData.length,
            assistantsByUserGroup: {},
            assistantsByType: {},
            assistantNames: fullAssistantData.map(a => ({ id: a.id, name: a.name, userGroups: a.userGroups }))
        };
        
        // Group by user groups
        fullAssistantData.forEach(assistant => {
            assistant.userGroups.forEach(group => {
                if (!summary.assistantsByUserGroup[group]) {
                    summary.assistantsByUserGroup[group] = [];
                }
                summary.assistantsByUserGroup[group].push({
                    id: assistant.id,
                    name: assistant.name
                });
            });
            
            // Group by type
            const type = assistant.type || 'unknown';
            if (!summary.assistantsByType[type]) {
                summary.assistantsByType[type] = 0;
            }
            summary.assistantsByType[type]++;
        });
        
        await fs.promises.writeFile(summaryFilename, JSON.stringify(summary, null, 2), 'utf8');
        console.log(`📊 Summary saved to: ${summaryFilename}`);
        
        return { fullDataFile: filename, summaryFile: summaryFilename };
        
    } catch (error) {
        console.error(`❌ Error saving assistants to JSON:`, error);
        return null;
    }
}

/**
 * Main function to export assistants data
 */
async function main() {
    console.log(`📋 Starting assistant data export for environment: ${STAGE}`);
    console.log(`🔍 READ-ONLY mode: No Pinecone vectors will be created`);
    
    try {
        // Step 1: Fetch assistants from DynamoDB
        const assistants = await fetchAssistantsFromDynamoDB();
        
        // Step 2: Fetch user group mappings
        const assistantToGroups = await fetchUserGroupAssistants();
        
        // Step 3: Save full data to JSON for verification
        const result = await saveAssistantsToJSON(assistants, assistantToGroups);
        
        console.log(`🎉 Assistant data export completed successfully!`);
        console.log(`📊 Summary:`);
        console.log(`   - Environment: ${STAGE}`);
        console.log(`   - Assistants exported: ${assistants.length}`);
        console.log(`   - User groups mapped: ${Object.keys(assistantToGroups).length}`);
        if (result) {
            console.log(`   - Full data file: ${result.fullDataFile}`);
            console.log(`   - Summary file: ${result.summaryFile}`);
        }
        
    } catch (error) {
        console.error(`💥 Assistant data export failed:`, error);
        process.exit(1);
    }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { main, fetchAssistantsFromDynamoDB, fetchUserGroupAssistants, saveAssistantsToJSON };
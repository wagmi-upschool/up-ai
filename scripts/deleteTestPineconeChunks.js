/**
 * Delete Pinecone chunks from 'assistant-documents' index
 * Targets assistantId containing 'yusuf' or 'test'
 */

import { Pinecone } from '@pinecone-database/pinecone';
import { config } from 'dotenv';

// Load environment variables
config();

// Configuration
const PINECONE_INDEX_NAME = 'assistant-documents';

// Initialize Pinecone client
const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY
});

/**
 * Deletes vectors from assistant-documents index where assistantId contains 'yusuf' or 'test'
 */
async function deleteTestPineconeChunks() {
    console.log(`🗑️  Deleting test chunks from Pinecone index: ${PINECONE_INDEX_NAME}`);
    console.log(`🎯 Target: yusuf, test, yusuf-test, yusuf-test1 to yusuf-test10`);
    
    try {
        const index = pinecone.index(PINECONE_INDEX_NAME);
        
        // Build list of all target assistantIds
        const targetIds = [
            'yusuf',
            'test', 
            'yusuf-test'
        ];
        
        // Add yusuf-test1 through yusuf-test10
        for (let i = 1; i <= 10; i++) {
            targetIds.push(`yusuf-test${i}`);
        }
        
        console.log(`🔍 Deleting chunks for each assistantId: [${targetIds.join(', ')}]`);
        
        // Delete vectors for each assistantId individually
        for (const assistantId of targetIds) {
            console.log(`   🗑️  Deleting chunks for assistantId: ${assistantId}`);
            await index.deleteAll({
                filter: {
                    assistantId: { "$eq": assistantId }
                }
            });
        }
        
        console.log(`✅ Successfully deleted test chunks from index: ${PINECONE_INDEX_NAME}`);
        console.log(`⏳ Waiting 5 seconds for deletion to propagate...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        console.log(`🎉 Deletion operation completed!`);
        
    } catch (error) {
        console.error(`❌ Error deleting test chunks from Pinecone index:`, error);
        throw error;
    }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    deleteTestPineconeChunks();
}

export { deleteTestPineconeChunks };
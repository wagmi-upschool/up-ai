/**
 * WUP-858: Clear all vectors from Pinecone index
 * Simple script to delete all existing vectors
 */

import { Pinecone } from '@pinecone-database/pinecone';
import { config } from 'dotenv';

// Load environment variables
config();

// Environment configuration
const STAGE = process.env.STAGE || 'upwagmitec';
const PINECONE_INDEX_NAME = 'assistant-recommend';

// Initialize Pinecone client
const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY
});

/**
 * Deletes all vectors from the Pinecone index for the current environment
 */
async function clearPineconeIndex() {
    console.log(`🗑️  Clearing all vectors from Pinecone index: ${PINECONE_INDEX_NAME}`);
    console.log(`⚠️  Environment: ${STAGE}`);
    
    try {
        const index = pinecone.index(PINECONE_INDEX_NAME);
        
        // Delete all vectors with environment prefix
        await index.deleteAll({
            filter: {
                environment: { "$eq": STAGE }
            }
        });
        
        console.log(`✅ Successfully cleared all vectors for environment: ${STAGE}`);
        console.log(`⏳ Waiting 5 seconds for deletion to propagate...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        console.log(`🎉 Clear operation completed!`);
        
    } catch (error) {
        console.error(`❌ Error clearing Pinecone index:`, error);
        throw error;
    }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    clearPineconeIndex();
}

export { clearPineconeIndex };
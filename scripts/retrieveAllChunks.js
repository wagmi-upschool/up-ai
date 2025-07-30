/**
 * Script to retrieve all chunks from Pinecone assistant-recommend index
 * Shows both metadata and embedded text content for analysis
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
 * Retrieve all chunks from the Pinecone index
 */
async function retrieveAllChunks() {
    console.log(`🔍 Retrieving all chunks from Pinecone index: ${PINECONE_INDEX_NAME}`);
    console.log(`📍 Environment filter: ${STAGE}`);
    
    try {
        const index = pinecone.index(PINECONE_INDEX_NAME);
        
        // Get index stats first
        const indexStats = await index.describeIndexStats();
        console.log(`📊 Index stats:`, {
            totalVectorCount: indexStats.totalVectorCount,
            dimension: indexStats.dimension
        });
        
        // Query with zero vector to get all vectors (sorted by ID)
        // We'll do multiple queries to get all vectors
        const allChunks = [];
        let hasMore = true;
        let lastId = '';
        
        while (hasMore) {
            const queryRequest = {
                vector: new Array(1536).fill(0), // Zero vector for getting all results
                topK: 10000, // Maximum allowed by Pinecone
                includeMetadata: true,
                includeValues: false, // We don't need the actual vector values
                filter: {
                    environment: STAGE
                }
            };
            
            const queryResults = await index.query(queryRequest);
            const matches = queryResults.matches || [];
            
            console.log(`📦 Retrieved ${matches.length} chunks in this batch`);
            
            if (matches.length === 0) {
                hasMore = false;
                break;
            }
            
            // Add to results
            allChunks.push(...matches);
            
            // Check if we got less than topK (means we're done)
            if (matches.length < 10000) {
                hasMore = false;
            }
            
            lastId = matches[matches.length - 1].id;
        }
        
        console.log(`✅ Total chunks retrieved: ${allChunks.length}`);
        
        // Process and display chunks with embedded content reconstruction
        const processedChunks = allChunks.map((chunk, index) => {
            const metadata = chunk.metadata || {};
            
            // Reconstruct the embedded text content based on our indexing logic
            const name = metadata.name || '';
            const extractedKeywords = metadata.extractedKeywords || '';
            const mainCategory = metadata.mainCategory || '';
            const subCategory = metadata.subCategory || '';
            const category = metadata.category || '';
            const semanticCluster = metadata.semanticCluster || '';
            const description = metadata.description || '';
            
            // Reconstruct keywords array and amplification
            const keywordsArray = extractedKeywords.split(' ').filter(k => k.trim().length > 0);
            const amplifiedKeywords = keywordsArray.length > 0 
                ? keywordsArray.concat(keywordsArray).concat(keywordsArray).join(' ')
                : '';
            
            // Reconstruct embedded content (same logic as indexing)
            const reconstructedEmbeddedText = [
                name + ' ' + name,                    // Agent name repeated twice
                amplifiedKeywords,                    // Keywords repeated 3x
                mainCategory + ' ' + subCategory,     // Enhanced category structure
                category,                             // Full category string
                semanticCluster,                      // Semantic clustering info
                description                           // Include description for context
            ].filter(content => content.trim().length > 0).join(' ').toLowerCase();
            
            return {
                chunkIndex: index + 1,
                id: chunk.id,
                score: chunk.score,
                
                // Agent Info
                agentId: metadata.assistantId || 'unknown',
                name: metadata.name || 'Unknown Agent',
                description: metadata.description || '',
                
                // Categories
                category: metadata.category || '',
                mainCategory: metadata.mainCategory || '',
                subCategory: metadata.subCategory || '',
                semanticCluster: metadata.semanticCluster || '',
                
                // Keywords
                extractedKeywords: metadata.extractedKeywords || '',
                keywordCount: keywordsArray.length,
                
                // Embedded Text Content (Reconstructed)
                embeddedTextContent: reconstructedEmbeddedText,
                embeddedTextLength: reconstructedEmbeddedText.length,
                
                // System Info
                environment: metadata.environment || '',
                userGroups: metadata.userGroups || [],
                type: metadata.type || '',
                
                // Additional metadata
                createdAt: metadata.createdAt || '',
                updatedAt: metadata.updatedAt || '',
                src: metadata.src || ''
            };
        });
        
        // Sort by agent name for better readability
        processedChunks.sort((a, b) => a.name.localeCompare(b.name));
        
        // Save to JSON file with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `./logs/pinecone_all_chunks_${STAGE}_${timestamp}.json`;
        
        const fs = await import('fs');
        await fs.promises.mkdir('./logs', { recursive: true });
        await fs.promises.writeFile(filename, JSON.stringify(processedChunks, null, 2), 'utf8');
        
        console.log(`💾 All chunks saved to: ${filename}`);
        
        // Display summary
        console.log(`\n📋 SUMMARY:`);
        console.log(`   - Total chunks: ${processedChunks.length}`);
        console.log(`   - Environment: ${STAGE}`);
        console.log(`   - Categories found: ${[...new Set(processedChunks.map(c => c.mainCategory))].join(', ')}`);
        console.log(`   - Semantic clusters: ${[...new Set(processedChunks.map(c => c.semanticCluster))].join(', ')}`);
        
        // Display first few chunks as examples
        console.log(`\n🔍 FIRST 3 CHUNKS (Example):`);
        processedChunks.slice(0, 3).forEach((chunk, idx) => {
            console.log(`\n--- Chunk ${idx + 1}: ${chunk.name} ---`);
            console.log(`ID: ${chunk.id}`);
            console.log(`Category: ${chunk.mainCategory} > ${chunk.subCategory}`);
            console.log(`Semantic Cluster: ${chunk.semanticCluster}`);
            console.log(`Keywords (${chunk.keywordCount}): ${chunk.extractedKeywords.substring(0, 100)}...`);
            console.log(`Embedded Text (${chunk.embeddedTextLength} chars): ${chunk.embeddedTextContent.substring(0, 200)}...`);
            console.log(`User Groups: ${chunk.userGroups.join(', ')}`);
        });
        
        return processedChunks;
        
    } catch (error) {
        console.error(`❌ Error retrieving chunks:`, error);
        throw error;
    }
}

/**
 * Main function
 */
async function main() {
    console.log(`🚀 Starting chunk retrieval for environment: ${STAGE}`);
    
    try {
        const chunks = await retrieveAllChunks();
        console.log(`🎉 Chunk retrieval completed successfully!`);
        console.log(`📊 Retrieved ${chunks.length} chunks with embedded text content`);
        
    } catch (error) {
        console.error(`💥 Chunk retrieval failed:`, error);
        process.exit(1);
    }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { retrieveAllChunks };
import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Pinecone client
async function initializePineconeClient() {
  const pc = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
  });
  
  const index = pc.index('assistant-documents');
  return index;
}

// Function to delete vectors by assistantId
async function deleteVectorsByAssistantId(assistantId) {
  console.log(`Starting deletion of vectors for assistantId: ${assistantId}`);
  
  try {
    const index = await initializePineconeClient();
    
    // Query vectors with the specific assistantId in metadata
    const queryResponse = await index.query({
      vector: new Array(1536).fill(0), // Dummy vector for querying
      filter: {
        assistantId: { "$eq": assistantId }
      },
      topK: 10000, // Get as many as possible
      includeMetadata: true,
      includeValues: false
    });
    
    if (queryResponse.matches && queryResponse.matches.length > 0) {
      console.log(`Found ${queryResponse.matches.length} vectors to delete`);
      
      // Extract the IDs
      const idsToDelete = queryResponse.matches.map(match => match.id);
      
      // Delete in batches (Pinecone has a limit on batch size)
      const batchSize = 1000;
      let deletedCount = 0;
      
      for (let i = 0; i < idsToDelete.length; i += batchSize) {
        const batch = idsToDelete.slice(i, i + batchSize);
        await index.deleteMany(batch);
        deletedCount += batch.length;
        console.log(`Deleted batch: ${deletedCount}/${idsToDelete.length} vectors`);
      }
      
      console.log(`✅ Successfully deleted ${deletedCount} vectors for assistantId: ${assistantId}`);
      return deletedCount;
    } else {
      console.log(`No vectors found for assistantId: ${assistantId}`);
      return 0;
    }
    
  } catch (error) {
    console.error('Error deleting vectors:', error);
    throw error;
  }
}

// Alternative method: Delete by namespace if using namespaces
async function deleteByNamespace(namespace) {
  console.log(`Deleting all vectors in namespace: ${namespace}`);
  
  try {
    const index = await initializePineconeClient();
    await index.deleteAll(namespace);
    console.log(`✅ Successfully deleted all vectors in namespace: ${namespace}`);
  } catch (error) {
    console.error('Error deleting namespace:', error);
    throw error;
  }
}

// Main execution
async function main() {
  const assistantId = "0186f1fa-ded1-45ff-a7cf-20d7807ac429";
  
  try {
    const deletedCount = await deleteVectorsByAssistantId(assistantId);
    console.log(`Deletion completed. Total vectors deleted: ${deletedCount}`);
  } catch (error) {
    console.error('Deletion script failed:', error);
    process.exit(1);
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { deleteVectorsByAssistantId, deleteByNamespace };
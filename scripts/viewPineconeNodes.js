import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const ASSISTANT_ID = "0186f1fa-ded1-45ff-a7cf-20d7807ac429";

// Initialize Pinecone client
async function initializePineconeClient() {
  const pc = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
  });
  
  const index = pc.index('assistant-documents');
  return index;
}

// Function to query and retrieve all vectors for the assistantId
async function getVectorsByAssistantId(assistantId, limit = 100) {
  console.log(`🔍 Querying vectors for assistantId: ${assistantId}`);
  
  try {
    const index = await initializePineconeClient();
    
    // Query vectors with the specific assistantId in metadata
    const queryResponse = await index.query({
      vector: new Array(1536).fill(0), // Dummy vector for embedding dimension
      filter: {
        assistantId: { "$eq": assistantId }
      },
      topK: limit,
      includeMetadata: true,
      includeValues: false
    });
    
    if (queryResponse.matches && queryResponse.matches.length > 0) {
      console.log(`✅ Found ${queryResponse.matches.length} vectors`);
      
      // Transform the data to a more readable format
      const nodes = queryResponse.matches.map((match, index) => {
        let text = "";
        
        // Extract text from _node_content if available
        if (match.metadata && match.metadata._node_content) {
          try {
            const nodeContent = JSON.parse(match.metadata._node_content);
            text = nodeContent.text || "";
          } catch (error) {
            console.warn(`Failed to parse _node_content for node ${match.id}:`, error.message);
          }
        }
        
        return {
          id: match.id,
          score: match.score,
          text: text,
          metadata: match.metadata || {},
          index: index + 1
        };
      });
      
      return nodes;
    } else {
      console.log(`ℹ️  No vectors found for assistantId: ${assistantId}`);
      return [];
    }
    
  } catch (error) {
    console.error("❌ Error querying vectors:", error);
    throw error;
  }
}

// Function to save nodes to JSON file
async function saveNodesToFile(nodes, filename) {
  try {
    const outputDir = path.join(process.cwd(), 'output');
    await fs.promises.mkdir(outputDir, { recursive: true });
    
    const filePath = path.join(outputDir, filename);
    
    const output = {
      timestamp: new Date().toISOString(),
      assistantId: ASSISTANT_ID,
      totalNodes: nodes.length,
      nodes: nodes
    };
    
    await fs.promises.writeFile(filePath, JSON.stringify(output, null, 2));
    console.log(`📄 Saved ${nodes.length} nodes to: ${filePath}`);
    return filePath;
    
  } catch (error) {
    console.error("❌ Error saving file:", error);
    throw error;
  }
}

// Function to display nodes summary
function displayNodesSummary(nodes) {
  console.log("\n📊 NODES SUMMARY:");
  console.log(`Total nodes: ${nodes.length}`);
  
  // Group by section_number if available
  const sectionGroups = {};
  const nonSectionNodes = [];
  
  nodes.forEach(node => {
    const sectionNumber = node.metadata.section_number;
    if (sectionNumber) {
      if (!sectionGroups[sectionNumber]) {
        sectionGroups[sectionNumber] = [];
      }
      sectionGroups[sectionNumber].push(node);
    } else {
      nonSectionNodes.push(node);
    }
  });
  
  console.log(`\n📋 SECTIONS FOUND:`);
  Object.keys(sectionGroups).sort().forEach(sectionNumber => {
    const sectionNodes = sectionGroups[sectionNumber];
    const firstNode = sectionNodes[0];
    const title = firstNode.metadata.section_title || 'No title';
    const category = firstNode.metadata.section_category || 'No category';
    
    console.log(`  ${sectionNumber}: ${title.substring(0, 60)}${title.length > 60 ? '...' : ''}`);
    console.log(`    Category: ${category}, Nodes: ${sectionNodes.length}`);
  });
  
  if (nonSectionNodes.length > 0) {
    console.log(`\n📄 NON-SECTION NODES: ${nonSectionNodes.length}`);
  }
}

// Function to display sample nodes
function displaySampleNodes(nodes, count = 3) {
  console.log(`\n🔍 SAMPLE NODES (showing first ${count}):`);
  
  nodes.slice(0, count).forEach((node, index) => {
    console.log(`\n--- Node ${index + 1} ---`);
    console.log(`ID: ${node.id}`);
    console.log(`Section: ${node.metadata.section_number || 'N/A'}`);
    console.log(`Title: ${node.metadata.section_title || 'N/A'}`);
    console.log(`Category: ${node.metadata.section_category || 'N/A'}`);
    console.log(`Text: ${node.text.substring(0, 150)}${node.text.length > 150 ? '...' : ''}`);
    console.log(`Metadata keys: ${Object.keys(node.metadata).join(', ')}`);
  });
}

// Main execution
async function main() {
  try {
    console.log(`🚀 Retrieving Pinecone nodes for assistant: ${ASSISTANT_ID}`);
    
    // Get all nodes
    const nodes = await getVectorsByAssistantId(ASSISTANT_ID, 1000);
    
    if (nodes.length === 0) {
      console.log("No nodes found!");
      return;
    }
    
    // Display summary
    displayNodesSummary(nodes);
    
    // Display sample nodes
    displaySampleNodes(nodes, 3);
    
    // Save to JSON file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `pinecone_nodes_${ASSISTANT_ID}_${timestamp}.json`;
    const savedFile = await saveNodesToFile(nodes, filename);
    
    console.log(`\n✅ Complete! JSON file saved to: ${savedFile}`);
    console.log(`📊 Total nodes exported: ${nodes.length}`);
    
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { getVectorsByAssistantId, saveNodesToFile };
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse";

// Load environment variables
dotenv.config();

// Configure AWS SDK v3
const configureAWS = (region = "us-east-1") => {
  const client = new DynamoDBClient({ region });
  return DynamoDBDocumentClient.from(client);
};

// Helper function to delay execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper function for exponential backoff
const getBackoffDelay = (attempt, baseDelay = 1000, maxDelay = 30000) => {
  const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  const jitter = Math.random() * 100;
  return exponentialDelay + jitter;
};

// Read CSV file and extract conversation IDs
const readConversationIdsFromCSV = async (csvFilePath) => {
  return new Promise((resolve, reject) => {
    const conversationIds = [];
    
    fs.createReadStream(csvFilePath)
      .pipe(parse({ 
        columns: true, 
        skip_empty_lines: true 
      }))
      .on('data', (row) => {
        if (row.idUpdatedAt) {
          conversationIds.push(row.idUpdatedAt);
        }
      })
      .on('end', () => {
        console.log(`Extracted ${conversationIds.length} conversation IDs from CSV`);
        resolve(conversationIds);
      })
      .on('error', (error) => {
        console.error('Error reading CSV file:', error);
        reject(error);
      });
  });
};

// Fetch conversations from DynamoDB using batch get
const fetchConversationsFromDynamoDB = async (conversationIds, tableName, stage) => {
  const docClient = configureAWS();
  const fullTableName = `${tableName}-${stage ?? process.env.STAGE ?? "upwagmitec"}`;
  
  console.log(`Fetching conversations from table: ${fullTableName}`);
  
  const BATCH_SIZE = 25; // DynamoDB batch get limit
  const allConversations = [];
  
  // Split conversation IDs into batches
  for (let i = 0; i < conversationIds.length; i += BATCH_SIZE) {
    const batch = conversationIds.slice(i, i + BATCH_SIZE);
    let attempt = 0;
    const maxAttempts = 3;
    
    while (attempt < maxAttempts) {
      try {
        console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(conversationIds.length / BATCH_SIZE)}`);
        
        const requestItems = {};
        requestItems[fullTableName] = {
          Keys: batch.map(id => ({ idUpdatedAt: id }))
        };
        
        const params = {
          RequestItems: requestItems
        };
        
        const response = await docClient.send(new BatchGetCommand(params));
        
        if (response.Responses && response.Responses[fullTableName]) {
          allConversations.push(...response.Responses[fullTableName]);
          console.log(`Fetched ${response.Responses[fullTableName].length} conversations from batch`);
        }
        
        // Handle unprocessed keys
        if (response.UnprocessedKeys && Object.keys(response.UnprocessedKeys).length > 0) {
          console.log(`${Object.keys(response.UnprocessedKeys).length} unprocessed keys, will retry...`);
          // You might want to handle unprocessed keys here
        }
        
        break; // Success, exit retry loop
        
      } catch (error) {
        attempt++;
        if (error.name === "ProvisionedThroughputExceededException" && attempt < maxAttempts) {
          const delayTime = getBackoffDelay(attempt);
          console.log(`Throughput exceeded. Retrying in ${delayTime}ms... (Attempt ${attempt}/${maxAttempts})`);
          await delay(delayTime);
        } else {
          console.error(`Error fetching batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error);
          throw error;
        }
      }
    }
    
    // Add delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < conversationIds.length) {
      await delay(200);
    }
  }
  
  return allConversations;
};

// Group conversations by user ID
const groupConversationsByUser = (conversations) => {
  const userGroups = {};
  
  conversations.forEach(conversation => {
    const userId = conversation.userId;
    if (!userId) return;
    
    if (!userGroups[userId]) {
      userGroups[userId] = {
        userId: userId,
        conversations: [],
        totalConversations: 0
      };
    }
    
    userGroups[userId].conversations.push(conversation);
    userGroups[userId].totalConversations++;
  });
  
  return userGroups;
};

// Save conversations to CSV
const saveConversationsToCSV = (conversations, outputPath) => {
  const csvHeaders = [
    'userId',
    'idUpdatedAt',
    'assistantGroupId',
    'assistantId',
    'createdAt',
    'iconUrl',
    'isArchived',
    'lastMessage',
    'title',
    'type',
    'updatedAt'
  ];
  
  const csvRows = [csvHeaders.join(',')];
  
  conversations.forEach(conv => {
    const row = csvHeaders.map(header => {
      const value = conv[header] || '';
      // Escape quotes and wrap in quotes if contains comma or quotes
      const stringValue = String(value).replace(/"/g, '""');
      return `"${stringValue}"`;
    });
    csvRows.push(row.join(','));
  });
  
  fs.writeFileSync(outputPath, csvRows.join('\n'));
  console.log(`Conversations saved to: ${outputPath}`);
};

// Main function to fetch conversations using CSV conversation IDs
const fetchConversationsFromCSV = async (csvFilePath, tableName = "UpConversations", stage = "upwagmitec") => {
  try {
    console.log(`Reading conversation IDs from: ${csvFilePath}`);
    
    // Read conversation IDs from CSV
    const conversationIds = await readConversationIdsFromCSV(csvFilePath);
    
    if (conversationIds.length === 0) {
      console.log("No conversation IDs found in CSV file");
      return null;
    }
    
    console.log(`Found ${conversationIds.length} conversation IDs`);
    
    // Fetch conversations from DynamoDB
    const conversations = await fetchConversationsFromDynamoDB(conversationIds, tableName, stage);
    
    console.log(`Successfully fetched ${conversations.length} conversations`);
    
    // Group by users
    const userGroups = groupConversationsByUser(conversations);
    
    console.log(`Conversations grouped into ${Object.keys(userGroups).length} users`);
    
    // Save to CSV
    const outputDir = path.join(process.cwd(), "exports");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }
    
    const outputPath = path.join(outputDir, `fetched_conversations_${new Date().toISOString().split('T')[0]}.csv`);
    saveConversationsToCSV(conversations, outputPath);
    
    return {
      totalConversations: conversations.length,
      totalUsers: Object.keys(userGroups).length,
      userGroups: userGroups,
      conversations: conversations,
      outputPath: outputPath
    };
    
  } catch (error) {
    console.error("Error fetching conversations from CSV:", error);
    throw error;
  }
};

// Main execution function
async function main() {
  const csvFilePath = "/Users/yusuf/Software/Projects/AI-ML/up-ai/files/satis-conv-prod.csv";
  const tableName = "UpConversations";
  const stage = "upwagmitec";
  
  try {
    const result = await fetchConversationsFromCSV(csvFilePath, tableName, stage);
    
    if (!result) {
      console.log("No conversations were fetched");
      return;
    }
    
    console.log("\n=== CONVERSATION FETCH RESULTS ===");
    console.log(`Total Conversations: ${result.totalConversations}`);
    console.log(`Total Users: ${result.totalUsers}`);
    console.log(`Output CSV: ${result.outputPath}`);
    
    console.log("\nUser Breakdown:");
    Object.keys(result.userGroups).forEach(userId => {
      const user = result.userGroups[userId];
      console.log(`User ${userId}: ${user.totalConversations} conversations`);
    });
    
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

// Run if this file is being executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { fetchConversationsFromCSV, groupConversationsByUser, readConversationIdsFromCSV };
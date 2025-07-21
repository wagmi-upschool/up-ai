import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
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
  const jitter = Math.random() * 100; // Add some randomness
  return exponentialDelay + jitter;
};

// Get messages for a specific assistant from DynamoDB with rate limiting
const getAssistantMessages = async (
  docClient,
  assistantId,
  tableName,
  stage
) => {
  const messages = [];
  let attempt = 0;
  const BATCH_SIZE = 25;
  const BASE_DELAY = 1000;

  try {
    const fullTableName = `${tableName}-${
      stage ?? process.env.STAGE ?? "upwagmitec"
    }`;
    console.log(
      `Fetching from table: ${fullTableName} for assistantId: ${assistantId}`
    );

    const params = {
      TableName: fullTableName,
      FilterExpression: "#aid = :assistantId",
      ExpressionAttributeNames: {
        "#aid": "assistantId",
      },
      ExpressionAttributeValues: {
        ":assistantId": assistantId,
      },
      Limit: BATCH_SIZE,
    };

    let lastEvaluatedKey = undefined;
    do {
      try {
        if (lastEvaluatedKey) {
          params.ExclusiveStartKey = lastEvaluatedKey;
        }

        console.log(
          "Sending DynamoDB request with params:",
          JSON.stringify(params, null, 2)
        );
        const response = await docClient.send(new ScanCommand(params));

        if (response.Items && response.Items.length > 0) {
          messages.push(...response.Items);
          console.log(
            `Fetched ${response.Items.length} messages. Total: ${messages.length}`
          );
          console.log(
            "Sample message:",
            JSON.stringify(response.Items[0], null, 2)
          );
        } else {
          console.log("No items found in this batch");
        }

        lastEvaluatedKey = response.LastEvaluatedKey;

        if (lastEvaluatedKey) {
          const delayTime = getBackoffDelay(attempt, BASE_DELAY);
          console.log(`Waiting ${delayTime}ms before next batch...`);
          await delay(delayTime);
        }

        attempt = 0;
      } catch (error) {
        if (error.name === "ProvisionedThroughputExceededException") {
          attempt++;
          const delayTime = getBackoffDelay(attempt);
          console.log(
            `Throughput exceeded. Retrying in ${delayTime}ms... (Attempt ${attempt})`
          );
          await delay(delayTime);
          lastEvaluatedKey = lastEvaluatedKey || undefined;
          continue;
        }
        throw error;
      }
    } while (lastEvaluatedKey);

    return messages;
  } catch (error) {
    console.error("Error fetching messages:", error);
    throw error;
  }
};

const saveMessagesToCSV = async (assistantId, tableName, stage) => {
  try {
    console.log("Starting to fetch messages...");
    const docClient = configureAWS();
    const messages = await getAssistantMessages(
      docClient,
      assistantId,
      tableName,
      stage
    );

    if (messages.length === 0) {
      console.log("No messages found for the specified assistant ID");
      return null;
    }

    // Group messages by conversationId
    const conversationGroups = messages.reduce((groups, msg) => {
      const group = groups[msg.conversationId] || [];
      group.push(msg);
      groups[msg.conversationId] = group;
      return groups;
    }, {});

    console.log(
      `Found ${Object.keys(conversationGroups).length} conversations`
    );

    // Create output directory if it doesn't exist
    const outputDir = path.join(process.cwd(), "exports");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    // Create CSV header
    const csvHeader =
      "ConversationId,CreatedAt,Role,Type,Content,IsGptSuitable,AssistantId,UserId\n";
    let allRows = [];

    // Process each conversation
    for (const [conversationId, conversationMessages] of Object.entries(
      conversationGroups
    )) {
      console.log(`Processing conversation: ${conversationId}`);

      // Sort messages by createdAt
      conversationMessages.sort(
        (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
      );

      // Add conversation messages to all rows
      const conversationRows = conversationMessages.map((msg) => {
        return [
          msg.conversationId,
          msg.createdAt,
          msg.role,
          msg.type,
          `"${(msg.content || "").replace(/"/g, '""')}"`,
          msg.isGptSuitable || false,
          msg.assistantId || "",
          msg.userId || "",
        ].join(",");
      });

      // Add a blank line between conversations
      if (allRows.length > 0) {
        allRows.push("");
      }
      allRows.push(...conversationRows);
    }

    // Combine header and all rows
    const csvContent = csvHeader + allRows.join("\n");

    // Save to a single file
    const filename = path.join(
      outputDir,
      `assistant_${assistantId}_all_conversations_${
        new Date().toISOString().split("T")[0]
      }.csv`
    );
    fs.writeFileSync(filename, csvContent);

    console.log(`All conversations saved to: ${filename}`);
    console.log(`Total messages exported: ${messages.length}`);
    console.log(
      `Total conversations: ${Object.keys(conversationGroups).length}`
    );

    return filename;
  } catch (error) {
    console.error("Error saving messages to CSV:", error);
    throw error;
  }
};

// Function to group messages by user ID
const groupMessagesByUsers = (messages) => {
  const userGroups = {};
  
  messages.forEach(message => {
    const userId = message.userId;
    if (!userId) return;
    
    if (!userGroups[userId]) {
      userGroups[userId] = {
        userId: userId,
        messages: [],
        totalMessages: 0,
        conversations: new Set()
      };
    }
    
    userGroups[userId].messages.push(message);
    userGroups[userId].totalMessages++;
    if (message.conversationId) {
      userGroups[userId].conversations.add(message.conversationId);
    }
  });
  
  // Convert conversations Set to Array and add conversation count
  Object.keys(userGroups).forEach(userId => {
    userGroups[userId].conversations = Array.from(userGroups[userId].conversations);
    userGroups[userId].totalConversations = userGroups[userId].conversations.length;
  });
  
  return userGroups;
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

// Get messages for specific conversations from DynamoDB
const getMessagesForConversations = async (docClient, conversationIds, tableName, stage) => {
  const messages = [];
  const BATCH_SIZE = 25;
  const BASE_DELAY = 1000;
  
  try {
    const fullTableName = `${tableName}-${stage ?? process.env.STAGE ?? "upwagmitec"}`;
    console.log(`Fetching messages from table: ${fullTableName} for ${conversationIds.length} conversations`);
    
    for (let i = 0; i < conversationIds.length; i += BATCH_SIZE) {
      const batch = conversationIds.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(conversationIds.length / BATCH_SIZE)}`);
      
      // Process each conversation in the batch
      for (const conversationId of batch) {
        let attempt = 0;
        
        try {
          const params = {
            TableName: fullTableName,
            KeyConditionExpression: "#cid = :conversationId",
            ExpressionAttributeNames: {
              "#cid": "conversationId",
            },
            ExpressionAttributeValues: {
              ":conversationId": conversationId,
            },
          };
          
          let lastEvaluatedKey = undefined;
          do {
            if (lastEvaluatedKey) {
              params.ExclusiveStartKey = lastEvaluatedKey;
            }
            
            const response = await docClient.send(new QueryCommand(params));
            
            if (response.Items && response.Items.length > 0) {
              messages.push(...response.Items);
              console.log(`  Fetched ${response.Items.length} messages for conversation ${conversationId}`);
            }
            
            lastEvaluatedKey = response.LastEvaluatedKey;
            
            if (lastEvaluatedKey) {
              await delay(100); // Small delay between pages
            }
          } while (lastEvaluatedKey);
          
        } catch (error) {
          if (error.name === "ProvisionedThroughputExceededException") {
            attempt++;
            const delayTime = getBackoffDelay(attempt, BASE_DELAY);
            console.log(`Throughput exceeded for conversation ${conversationId}. Retrying in ${delayTime}ms...`);
            await delay(delayTime);
            continue;
          }
          console.error(`Error fetching messages for conversation ${conversationId}:`, error);
          // Continue with other conversations instead of failing completely
        }
      }
      
      // Add delay between batches
      if (i + BATCH_SIZE < conversationIds.length) {
        await delay(500);
      }
    }
    
    console.log(`Total messages fetched: ${messages.length}`);
    return messages;
  } catch (error) {
    console.error("Error fetching messages for conversations:", error);
    throw error;
  }
};

// Function to fetch and group messages by users for conversations from CSV
const fetchMessagesGroupedByUsersFromCSV = async (csvFilePath, tableName, stage) => {
  try {
    console.log(`Reading conversation IDs from CSV: ${csvFilePath}`);
    
    // Read conversation IDs from CSV
    const conversationIds = await readConversationIdsFromCSV(csvFilePath);
    
    if (conversationIds.length === 0) {
      console.log("No conversation IDs found in CSV file");
      return null;
    }
    
    console.log(`Found ${conversationIds.length} conversation IDs`);
    
    // Fetch messages for these conversations
    const docClient = configureAWS();
    const messages = await getMessagesForConversations(docClient, conversationIds, tableName, stage);
    
    if (messages.length === 0) {
      console.log("No messages found for the conversations from CSV");
      return null;
    }
    
    console.log(`Total messages found: ${messages.length}`);
    
    // Group messages by users
    const userGroups = groupMessagesByUsers(messages);
    
    console.log(`Messages grouped into ${Object.keys(userGroups).length} users`);
    
    return {
      csvFilePath,
      totalConversations: conversationIds.length,
      totalMessages: messages.length,
      totalUsers: Object.keys(userGroups).length,
      userGroups: userGroups,
      messages: messages
    };
  } catch (error) {
    console.error("Error fetching messages grouped by users from CSV:", error);
    throw error;
  }
};

// Function to fetch and group messages by users for a specific assistant
const fetchMessagesGroupedByUsers = async (assistantId, tableName, stage) => {
  try {
    console.log(`Fetching messages for assistant: ${assistantId}`);
    const docClient = configureAWS();
    const messages = await getAssistantMessages(docClient, assistantId, tableName, stage);
    
    if (messages.length === 0) {
      console.log("No messages found for the specified assistant ID");
      return null;
    }
    
    console.log(`Total messages found: ${messages.length}`);
    
    // Group messages by users
    const userGroups = groupMessagesByUsers(messages);
    
    console.log(`Messages grouped into ${Object.keys(userGroups).length} users`);
    
    return {
      assistantId,
      totalMessages: messages.length,
      totalUsers: Object.keys(userGroups).length,
      userGroups: userGroups
    };
  } catch (error) {
    console.error("Error fetching messages grouped by users:", error);
    throw error;
  }
};

// Function to save messages from CSV to CSV file
const saveMessagesFromCSVToCSV = async (csvFilePath, tableName, stage) => {
  try {
    console.log("Starting to fetch messages from CSV conversations...");
    
    // Get messages grouped by users from CSV
    const result = await fetchMessagesGroupedByUsersFromCSV(csvFilePath, tableName, stage);
    
    if (!result) {
      console.log("No messages found for the conversations from CSV");
      return null;
    }
    
    // Create output directory if it doesn't exist
    const outputDir = path.join(process.cwd(), "exports");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }
    
    // Create CSV header
    const csvHeader = "ConversationId,CreatedAt,Role,Type,Content,IsGptSuitable,AssistantId,UserId\n";
    let allRows = [];
    
    // Group messages by conversationId for CSV output
    const conversationGroups = result.messages.reduce((groups, msg) => {
      const group = groups[msg.conversationId] || [];
      group.push(msg);
      groups[msg.conversationId] = group;
      return groups;
    }, {});
    
    // Process each conversation
    for (const [conversationId, conversationMessages] of Object.entries(conversationGroups)) {
      console.log(`Processing conversation: ${conversationId}`);
      
      // Sort messages by createdAt
      conversationMessages.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      
      // Add conversation messages to all rows
      const conversationRows = conversationMessages.map((msg) => {
        return [
          msg.conversationId,
          msg.createdAt,
          msg.role,
          msg.type,
          `"${(msg.content || "").replace(/"/g, '""')}"`,
          msg.isGptSuitable || false,
          msg.assistantId || "",
          msg.userId || "",
        ].join(",");
      });
      
      // Add a blank line between conversations
      if (allRows.length > 0) {
        allRows.push("");
      }
      allRows.push(...conversationRows);
    }
    
    // Combine header and all rows
    const csvContent = csvHeader + allRows.join("\n");
    
    // Save to a single file
    const filename = path.join(
      outputDir,
      `csv_conversations_messages_${new Date().toISOString().split("T")[0]}.csv`
    );
    fs.writeFileSync(filename, csvContent);
    
    console.log(`All messages from CSV conversations saved to: ${filename}`);
    console.log(`Total messages exported: ${result.totalMessages}`);
    console.log(`Total conversations: ${Object.keys(conversationGroups).length}`);
    console.log(`Total users: ${result.totalUsers}`);
    
    return filename;
  } catch (error) {
    console.error("Error saving messages from CSV to CSV:", error);
    throw error;
  }
};

// Main function
async function main() {
  const csvFilePath = "/Users/yusuf/Software/Projects/AI-ML/up-ai/files/satis-conv-prod.csv";
  const tableName = "UpConversationMessage";
  const stage = process.env.STAGE || "upwagmitec";

  if (!csvFilePath || !tableName) {
    console.error("Error: CSV file path and Table Name are required");
    process.exit(1);
  }

  try {
    // Get messages grouped by users from CSV conversations
    const result = await fetchMessagesGroupedByUsersFromCSV(csvFilePath, tableName, stage);
    if (!result) {
      console.log("No messages found for the conversations from CSV");
      process.exit(0);
    }
    
    console.log("\n=== MESSAGES GROUPED BY USERS (FROM CSV CONVERSATIONS) ===");
    console.log(`CSV File: ${result.csvFilePath}`);
    console.log(`Total Conversations: ${result.totalConversations}`);
    console.log(`Total Messages: ${result.totalMessages}`);
    console.log(`Total Users: ${result.totalUsers}`);
    console.log("\nUser Breakdown:");
    
    Object.keys(result.userGroups).forEach(userId => {
      const user = result.userGroups[userId];
      console.log(`\nUser ID: ${userId}`);
      console.log(`  - Total Messages: ${user.totalMessages}`);
      console.log(`  - Total Conversations: ${user.totalConversations}`);
      console.log(`  - Conversation IDs: ${user.conversations.slice(0, 3).join(', ')}${user.conversations.length > 3 ? '...' : ''}`);
    });
    
    // Also create CSV with messages from CSV conversations
    await saveMessagesFromCSVToCSV(csvFilePath, tableName, stage);
  } catch (error) {
    if (error.code === "AccessDeniedException") {
      console.error("Access Denied. Please check your AWS permissions:");
      console.error("Required permission: dynamodb:Query");
    } else {
      console.error("Error:", error.message);
    }
    process.exit(1);
  }
}

// Run if this file is being executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { 
  saveMessagesToCSV, 
  fetchMessagesGroupedByUsers, 
  groupMessagesByUsers, 
  fetchMessagesGroupedByUsersFromCSV,
  readConversationIdsFromCSV,
  getMessagesForConversations,
  saveMessagesFromCSVToCSV
};

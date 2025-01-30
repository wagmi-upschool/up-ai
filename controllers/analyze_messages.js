import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

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

// Main function
async function main() {
  const assistantId = "d80184f3-876b-4701-87e7-ad374418eb15";
  const tableName = "UpConversationMessage";
  const stage = process.env.STAGE || "upwagmitec";

  if (!assistantId || !tableName) {
    console.error("Error: Assistant ID and Table Name are required");
    process.exit(1);
  }

  try {
    const result = await saveMessagesToCSV(assistantId, tableName, stage);
    if (!result) {
      console.log("No CSV file was created as no messages were found");
      process.exit(0);
    }
  } catch (error) {
    if (error.code === "AccessDeniedException") {
      console.error("Access Denied. Please check your AWS permissions:");
      console.error("Required permission: dynamodb:Scan");
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

export { saveMessagesToCSV };

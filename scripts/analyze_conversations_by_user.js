import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import AWS from "aws-sdk";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

// Load environment variables
dotenv.config();

// Utility functions for backoff and retry
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getBackoffDelay = (attempt, baseDelay = 1000) => {
  return Math.min(baseDelay * Math.pow(2, attempt), 30000); // Max delay of 30 seconds
};

// Configure AWS SDK v3
const configureAWS = () => {
  const client = new DynamoDBClient({
    region: process.env.AWS_REGION || "us-east-1",
  });
  return DynamoDBDocumentClient.from(client);
};

// Configure AWS SDK for Cognito
const configureCognito = () => {
  return new CognitoIdentityProviderClient({
    region: process.env.AWS_REGION || "us-east-1",
  });
};

// Get all users from Cognito User Pool with their emails
const getCognitoUsers = async (cognito, userPoolId) => {
  const userEmailMap = new Map();
  let paginationToken = undefined;
  let totalUsers = 0;
  let usersWithoutEmail = 0;

  try {
    console.log(`Fetching users from Cognito pool: ${userPoolId}`);

    do {
      const params = {
        UserPoolId: userPoolId,
        ...(paginationToken && { PaginationToken: paginationToken }),
        AttributesToGet: ["email", "sub"],
      };

      const response = await cognito.send(new ListUsersCommand(params));

      if (response.Users) {
        totalUsers += response.Users.length;

        for (const user of response.Users) {
          const emailAttr = user.Attributes?.find(
            (attr) => attr.Name === "email"
          );

          if (emailAttr && user.Username) {
            userEmailMap.set(user.Username, emailAttr.Value);
          } else {
            usersWithoutEmail++;
            console.log(
              `User ${user.Username} has no email attribute:`,
              JSON.stringify(user.Attributes)
            );
          }
        }
      }

      paginationToken = response.PaginationToken;

      if (paginationToken) {
        console.log(`Fetched ${totalUsers} users so far...`);
      }
    } while (paginationToken);

    console.log(`Completed fetching Cognito users:
      - Total users processed: ${totalUsers}
      - Users with email: ${userEmailMap.size}
      - Users without email: ${usersWithoutEmail}
    `);

    return userEmailMap;
  } catch (error) {
    console.error("Error fetching Cognito users:", error);
    throw error;
  }
};

// Get all conversations from DynamoDB
const getConversations = async (docClient, tableName, stage) => {
  const conversations = [];
  let lastEvaluatedKey = undefined;
  let attempt = 0;
  const MAX_RETRIES = 5;

  try {
    const fullTableName = `${tableName}-${stage}`;
    console.log("Fetching from table:", fullTableName);

    do {
      try {
        const params = {
          TableName: fullTableName,
          ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
          Limit: 25, // Smaller batch size
        };

        const response = await docClient.send(new ScanCommand(params));

        if (response.Items) {
          conversations.push(...response.Items);
          console.log(
            `Fetched ${response.Items.length} conversations. Total: ${conversations.length}`
          );
        }

        lastEvaluatedKey = response.LastEvaluatedKey;

        if (lastEvaluatedKey) {
          console.log("More items exist, waiting before next batch...");
          await delay(1000); // Basic rate limiting
        }

        attempt = 0; // Reset attempt counter on success
      } catch (error) {
        if (error.name === "ProvisionedThroughputExceededException") {
          attempt++;
          if (attempt > MAX_RETRIES) {
            throw new Error(
              `Max retries (${MAX_RETRIES}) exceeded while fetching conversations`
            );
          }
          const delayTime = getBackoffDelay(attempt);
          console.log(
            `Throughput exceeded. Retrying in ${delayTime}ms... (Attempt ${attempt}/${MAX_RETRIES})`
          );
          await delay(delayTime);
          continue;
        }
        throw error;
      }
    } while (lastEvaluatedKey);

    return conversations;
  } catch (error) {
    console.error("Error fetching conversations:", error);
    throw error;
  }
};

// Get messages for a conversation
const getConversationMessages = async (
  docClient,
  tableName,
  stage,
  conversationId
) => {
  let attempt = 0;
  const MAX_RETRIES = 5;

  try {
    if (!conversationId) {
      console.warn("No conversation ID provided");
      return [];
    }

    const fullTableName = `${tableName}-${stage}`;
    console.log("Fetching messages from table:", fullTableName);

    while (true) {
      try {
        const params = {
          TableName: fullTableName,
          KeyConditionExpression: "conversationId = :conversationId",
          ExpressionAttributeValues: {
            ":conversationId": conversationId,
          },
        };

        const response = await docClient.send(new QueryCommand(params));
        return response.Items || [];
      } catch (error) {
        if (error.name === "ProvisionedThroughputExceededException") {
          attempt++;
          if (attempt > MAX_RETRIES) {
            throw new Error(
              `Max retries (${MAX_RETRIES}) exceeded while fetching messages`
            );
          }
          const delayTime = getBackoffDelay(attempt);
          console.log(
            `Throughput exceeded. Retrying in ${delayTime}ms... (Attempt ${attempt}/${MAX_RETRIES})`
          );
          await delay(delayTime);
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    console.error(
      `Error fetching messages for conversation ${conversationId}:`,
      error
    );
    throw error;
  }
};

// Get assistant details
const getAssistantDetails = async (docClient, assistantId, stage) => {
  let attempt = 0;
  const MAX_RETRIES = 5;

  try {
    if (!assistantId) {
      console.warn("No assistant ID provided");
      return null;
    }

    const fullTableName = `UpAssistant-${stage}`;
    console.log("Fetching assistant from table:", fullTableName);

    while (true) {
      try {
        const params = {
          TableName: fullTableName,
          Key: {
            id: assistantId,
          },
        };

        const response = await docClient.send(new GetCommand(params));
        return response.Item;
      } catch (error) {
        if (error.name === "ProvisionedThroughputExceededException") {
          attempt++;
          if (attempt > MAX_RETRIES) {
            throw new Error(
              `Max retries (${MAX_RETRIES}) exceeded while fetching assistant details`
            );
          }
          const delayTime = getBackoffDelay(attempt);
          console.log(
            `Throughput exceeded. Retrying in ${delayTime}ms... (Attempt ${attempt}/${MAX_RETRIES})`
          );
          await delay(delayTime);
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    console.error(`Error fetching assistant ${assistantId}:`, error);
    return null;
  }
};

// Save conversations to CSV
const saveConversationsToCSV = async (userPoolId, stage) => {
  try {
    console.log("Starting to fetch data...");
    const docClient = configureAWS();
    const cognito = configureCognito();

    // Get user email mapping from Cognito
    console.log("Fetching user emails from Cognito...");
    const userEmailMap = await getCognitoUsers(cognito, userPoolId);

    // Get conversations
    console.log("Fetching conversations...");
    const conversations = await getConversations(
      docClient,
      "UpConversations",
      stage
    );

    if (!conversations || conversations.length === 0) {
      console.log("No conversations found");
      return null;
    }

    // Create output directory if it doesn't exist
    const outputDir = path.join(process.cwd(), "exports");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    // Process each conversation
    const processedData = [];
    for (const conversation of conversations) {
      if (!conversation || !conversation.idUpdatedAt) {
        console.log("Skipping invalid conversation:", conversation);
        continue;
      }

      console.log(`Processing conversation: ${conversation.idUpdatedAt}`);

      try {
        // Get messages for this conversation
        const messages = await getConversationMessages(
          docClient,
          "UpConversationMessage",
          stage,
          conversation.idUpdatedAt
        );

        // Get assistant details
        const assistant = await getAssistantDetails(
          docClient,
          conversation.assistantId,
          stage
        );

        // Combine all messages into one string
        const relatedChatMessages = messages
          .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
          .map((msg) => `${msg.role}: ${msg.content}`)
          .join(" | ");

        const userEmail = userEmailMap.get(conversation.userId);
        if (!userEmail) {
          console.log(`No email found for user: ${conversation.userId}`);
        }

        processedData.push({
          conversationId: conversation.idUpdatedAt,
          userId: conversation.userId,
          userEmail: userEmail || "NO_EMAIL_FOUND",
          assistantId: conversation.assistantId,
          assistantName: assistant?.name || "",
          conversationCreatedAt: conversation.createdAt,
          relatedChatMessages,
        });
      } catch (error) {
        console.error(
          `Error processing conversation ${conversation.idUpdatedAt}:`,
          error
        );
        continue;
      }
    }

    if (processedData.length === 0) {
      console.log("No valid conversations were processed");
      return null;
    }

    // Create CSV content
    const csvHeader =
      "conversationId,userId,userEmail,assistantId,assistantName,conversationCreatedAt,relatedChatMessages\n";
    const csvRows = processedData.map((row) => {
      return [
        row.conversationId,
        row.userId,
        row.userEmail,
        row.assistantId,
        row.assistantName,
        row.conversationCreatedAt,
        `"${row.relatedChatMessages.replace(/"/g, '""')}"`,
      ].join(",");
    });

    // Save to file
    const currentDate = new Date().toISOString().split("T")[0];
    const filename = path.join(
      outputDir,
      `grouped_conversations_peruser_from${currentDate}.csv`
    );
    fs.writeFileSync(filename, csvHeader + csvRows.join("\n"));

    console.log(`Conversations saved to: ${filename}`);
    console.log(`Total conversations processed: ${processedData.length}`);
    console.log(
      `Total unique users: ${new Set(processedData.map((d) => d.userId)).size}`
    );

    return filename;
  } catch (error) {
    console.error("Error saving conversations to CSV:", error);
    throw error;
  }
};

// Main function
async function main() {
  const userPoolId = process.env.POOL_ID;
  const stage = process.env.STAGE || "upwagmitec"; // Use STAGE from env or default to upwagmitec

  if (!userPoolId) {
    console.error("Error: POOL_ID environment variable is not set");
    process.exit(1);
  }

  try {
    const result = await saveConversationsToCSV(userPoolId, stage);
    if (!result) {
      console.log("No CSV file was created as no conversations were found");
      process.exit(0);
    }
  } catch (error) {
    if (error.code === "AccessDeniedException") {
      console.error("Access Denied. Please check your AWS permissions:");
      console.error(
        "Required permissions: cognito-idp:ListUsers, dynamodb:Scan, dynamodb:GetItem"
      );
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

export { saveConversationsToCSV };

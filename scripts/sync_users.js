import { analyzeUsers } from "../controllers/analyze_users.js";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import dotenv from "dotenv";

dotenv.config();

const client = new DynamoDBClient({ region: "us-east-1" });
const docClient = DynamoDBDocumentClient.from(client);

// Get all users from DynamoDB
const getDynamoUsers = async () => {
  try {
    const params = {
      TableName: `User-${process.env.STAGE}`,
    };

    const users = [];
    let lastEvaluatedKey = undefined;

    do {
      if (lastEvaluatedKey) {
        params.ExclusiveStartKey = lastEvaluatedKey;
      }

      const response = await docClient.send(new ScanCommand(params));

      if (response.Items) {
        users.push(...response.Items);
      }

      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return users;
  } catch (error) {
    console.error("Error fetching DynamoDB users:", error);
    throw error;
  }
};

// Check if user exists in DynamoDB
const checkUserExists = async (userId) => {
  const params = {
    TableName: `User-${process.env.STAGE}`,
    Key: {
      userId: userId,
    },
  };

  try {
    const response = await docClient.send(new GetCommand(params));
    return !!response.Item;
  } catch (error) {
    console.error(`Error checking user ${userId}:`, error);
    throw error;
  }
};

// Add missing user to DynamoDB
const addUserToDynamo = async (userId) => {
  const now = new Date().toISOString();

  const newUser = {
    userId: userId,
    sk: now,
    createdAt: now,
    updatedAt: now,
    stats: {
      lastUpdatedAt: now,
      currentStreak: 0,
      longestStreak: 0,
      conversationCount: 0,
    },
    badges: [],
  };

  const params = {
    TableName: `User-${process.env.STAGE}`,
    Item: newUser,
    ConditionExpression: "attribute_not_exists(userId)",
  };

  try {
    await docClient.send(new PutCommand(params));
    console.log(`Added user ${userId} to DynamoDB`);
    return true;
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      console.log(`User ${userId} already exists in DynamoDB, skipping...`);
      return false;
    }
    console.error(`Error adding user ${userId} to DynamoDB:`, error);
    throw error;
  }
};

async function syncUsers() {
  console.log("Starting user synchronization...");
  console.log(`Environment: ${process.env.STAGE}`);
  console.log(`User Pool: ${process.env.POOL_ID}`);
  console.log("----------------------------------------");

  try {
    // Get users from both sources
    const { stats, users: cognitoUsers } = await analyzeUsers(
      process.env.POOL_ID
    );
    const dynamoUsers = await getDynamoUsers();

    // Find missing users
    const dynamoUserIds = new Set(dynamoUsers.map((user) => user.userId));
    const missingUsers = cognitoUsers.filter(
      (user) =>
        !dynamoUserIds.has(user.Attributes.find((a) => a.Name === "sub").Value)
    );

    // Add missing users to DynamoDB
    let addedCount = 0;
    if (missingUsers.length > 0) {
      console.log("\nSynchronizing missing users...");
      for (const user of missingUsers) {
        const userId = user.Attributes.find((a) => a.Name === "sub").Value;
        const wasAdded = await addUserToDynamo(userId);
        if (wasAdded) addedCount++;
      }
    }

    // Print summary
    console.log("\nSynchronization Summary:");
    console.log("----------------------------------------");
    console.log(`Total Cognito Users: ${stats.total}`);
    console.log(`Existing DynamoDB Users: ${dynamoUsers.length}`);
    console.log(`Users Added to DynamoDB: ${addedCount}`);
    console.log(`Final DynamoDB Users: ${dynamoUsers.length + addedCount}`);

    console.log("\nUser Distribution:");
    console.log(`- Email/Password: ${stats.emailUsers}`);
    console.log(`- Google Sign-in: ${stats.googleUsers}`);
    console.log(`- Apple Sign-in: ${stats.appleUsers}`);
  } catch (error) {
    console.error("\nError during synchronization:", error.message);
    process.exit(1);
  }
}

// Run if this file is being executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  syncUsers().catch(console.error);
}

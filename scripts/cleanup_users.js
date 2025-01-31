import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  DeleteCommand,
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

// Delete a user from DynamoDB
const deleteUser = async (user) => {
  const params = {
    TableName: `User-${process.env.STAGE}`,
    Key: {
      userId: user.userId,
      sk: user.sk,
    },
  };

  try {
    await docClient.send(new DeleteCommand(params));
    console.log(`Deleted user ${user.userId}`);
    return true;
  } catch (error) {
    console.error(`Error deleting user ${user.userId}:`, error);
    throw error;
  }
};

async function cleanupUsers() {
  console.log("Starting user cleanup...");
  console.log(`Environment: ${process.env.STAGE}`);
  console.log("----------------------------------------");

  try {
    // Get all users
    const users = await getDynamoUsers();
    console.log(`Total users found: ${users.length}`);

    // Filter users to delete
    const usersToDelete = users.filter(
      (user) =>
        user.userId.startsWith("google_") ||
        user.userId.startsWith("signinwithapple_")
    );

    console.log(`Found ${usersToDelete.length} users to delete`);
    console.log("\nStarting deletion...");

    // Delete users
    let deletedCount = 0;
    for (const user of usersToDelete) {
      try {
        await deleteUser(user);
        deletedCount++;
      } catch (error) {
        console.error(`Failed to delete user ${user.userId}:`, error.message);
      }
    }

    // Print summary
    console.log("\nCleanup Summary:");
    console.log("----------------------------------------");
    console.log(`Total Users: ${users.length}`);
    console.log(`Users Found for Deletion: ${usersToDelete.length}`);
    console.log(`Users Successfully Deleted: ${deletedCount}`);
    console.log(`Remaining Users: ${users.length - deletedCount}`);

    // Print breakdown of deleted users
    const googleUsers = usersToDelete.filter((u) =>
      u.userId.startsWith("google_")
    ).length;
    const appleUsers = usersToDelete.filter((u) =>
      u.userId.startsWith("signinwithapple_")
    ).length;
    console.log("\nDeleted User Breakdown:");
    console.log(`- Google Users: ${googleUsers}`);
    console.log(`- Apple Users: ${appleUsers}`);
  } catch (error) {
    console.error("\nError during cleanup:", error.message);
    process.exit(1);
  }
}

// Run if this file is being executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  cleanupUsers().catch(console.error);
}

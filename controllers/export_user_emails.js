import AWS from "aws-sdk";
import fs from "fs";
import { format } from "@fast-csv/format";
import dotenv from "dotenv";
// Load environment variables
dotenv.config();

// Configure AWS SDK
const configureAWS = (region = "us-east-1") => {
  AWS.config.update({ region });
  return new AWS.CognitoIdentityServiceProvider();
};

// Extract email from user attributes
const extractEmail = (user) => {
  const emailAttr = user.Attributes.find((attr) => attr.Name === "email");
  return emailAttr ? emailAttr.Value : "";
};

// Process users and prepare for CSV export
const processUsersForExport = (users) => {
  return users
    .map((user) => {
      // Ensure date is in YYYY-MM-DD format
      const createdDate = new Date(user.UserCreateDate)
        .toISOString()
        .split("T")[0];
      const lastModified = new Date(user.UserLastModifiedDate)
        .toISOString()
        .split("T")[0];

      return {
        email: extractEmail(user),
        username: user.Username,
        status: user.UserStatus,
        createdDate,
        lastModified,
      };
    })
    .filter((user) => user.email) // Only include users with email addresses
    .sort((a, b) => {
      // Explicit descending sort (newest dates first)
      if (a.createdDate > b.createdDate) return -1;
      if (a.createdDate < b.createdDate) return 1;
      return 0;
    });
};

// Process a batch of users
const processBatch = async (users, outputFile, isFirstBatch) => {
  const processedUsers = processUsersForExport(users);

  // For first batch, create new file with headers
  const writeOptions = {
    headers: isFirstBatch,
    includeEndRowDelimiter: true,
    writeHeaders: isFirstBatch,
    append: !isFirstBatch,
  };

  return new Promise((resolve, reject) => {
    try {
      const directory = outputFile.split("/").slice(0, -1).join("/");
      if (directory && !fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
      }

      const writeStream = fs.createWriteStream(outputFile, {
        flags: isFirstBatch ? "w" : "a",
      });
      const csvStream = format(writeOptions);

      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
      csvStream.on("error", reject);
      csvStream.pipe(writeStream);

      processedUsers.forEach((user) => {
        csvStream.write({
          email: user.email || "",
          username: user.username || "",
          status: user.status || "",
          createdDate: user.createdDate || "",
          lastModified: user.lastModified || "",
        });
      });

      csvStream.end();
    } catch (error) {
      reject(error);
    }
  });
};

// Get all users from Cognito User Pool
const getAllUsers = async (cognito, userPoolId, outputFile) => {
  const BATCH_SIZE = 50; // Adjust this value based on your needs
  let totalUsers = 0;
  let paginationToken = null;
  let isFirstBatch = true;

  try {
    do {
      const params = {
        UserPoolId: userPoolId,
        Limit: BATCH_SIZE,
        ...(paginationToken && { PaginationToken: paginationToken }),
      };

      console.log(`Fetching batch of up to ${BATCH_SIZE} users...`);
      const response = await cognito.listUsers(params).promise();

      if (response.Users.length > 0) {
        console.log(`Processing batch of ${response.Users.length} users...`);
        await processBatch(response.Users, outputFile, isFirstBatch);
        totalUsers += response.Users.length;
        console.log(`Processed ${totalUsers} users so far...`);
      }

      paginationToken = response.PaginationToken;
      isFirstBatch = false;
    } while (paginationToken);

    console.log(`Completed processing all ${totalUsers} users`);
    return totalUsers;
  } catch (error) {
    console.error("Error fetching users:", error);
    throw error;
  }
};

// Add this function before the exports
const exportToCSV = async (users, outputFile) => {
  try {
    const processedUsers = processUsersForExport(users);

    // Create directory if it doesn't exist
    const directory = outputFile.split("/").slice(0, -1).join("/");
    if (directory && !fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }

    const writeStream = fs.createWriteStream(outputFile);
    const csvStream = format({
      headers: true,
      includeEndRowDelimiter: true,
    });

    return new Promise((resolve, reject) => {
      writeStream.on("finish", () => {
        // Add logging after file is written
        if (fs.existsSync(outputFile)) {
          const stats = fs.statSync(outputFile);
          console.log("CSV file successfully created!");
          console.log(`File path: ${outputFile}`);
          console.log(`File size: ${stats.size} bytes`);
          console.log(`Number of users exported: ${processedUsers.length}`);
        }
        resolve();
      });
      writeStream.on("error", reject);
      csvStream.on("error", reject);

      csvStream.pipe(writeStream);

      processedUsers.forEach((user) => {
        csvStream.write({
          email: user.email || "",
          username: user.username || "",
          status: user.status || "",
          createdDate: user.createdDate || "",
          lastModified: user.lastModified || "",
        });
      });

      csvStream.end();
    });
  } catch (error) {
    console.error("Error exporting to CSV:", error);
    throw error;
  }
};

// Main function
async function main() {
  const poolId = "us-east-1_tTejiiLwi";

  if (!poolId) {
    console.error("Error: POOL_ID environment variable is not set");
    process.exit(1);
  }

  // Configuration
  const config = {
    userPoolId: poolId,
    region: process.env.AWS_REGION || "us-east-1",
    outputFile: "./exports/cognito_users.csv",
  };

  try {
    // Initialize Cognito client
    const cognito = configureAWS(config.region);

    // Get and process users in batches
    console.log(`Fetching users from User Pool ${config.userPoolId}...`);
    const totalUsers = await getAllUsers(
      cognito,
      config.userPoolId,
      config.outputFile
    );
    console.log(`Successfully processed ${totalUsers} users`);

    // Verify file was created
    if (fs.existsSync(config.outputFile)) {
      console.log("CSV file was successfully created!");
      const stats = fs.statSync(config.outputFile);
      console.log(`File size: ${stats.size} bytes`);
    } else {
      console.error("CSV file was not created!");
    }
  } catch (error) {
    if (error.code === "AccessDeniedException") {
      console.error("Access Denied. Please check your AWS permissions:");
      console.error("Required permission: cognito-idp:ListUsers");
    } else {
      console.error("Error:", error.message);
    }
    process.exit(1);
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { getAllUsers, processUsersForExport, exportToCSV };

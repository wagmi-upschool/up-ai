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

// Get all users from Cognito User Pool
const getAllUsers = async (cognito, userPoolId) => {
  const users = [];
  let paginationToken = null;

  try {
    do {
      const params = {
        UserPoolId: userPoolId,
        ...(paginationToken && { PaginationToken: paginationToken }),
      };

      const response = await cognito.listUsers(params).promise();
      users.push(...response.Users);
      paginationToken = response.PaginationToken;
    } while (paginationToken);

    return users;
  } catch (error) {
    console.error("Error fetching users:", error);
    throw error;
  }
};

// Extract email from user attributes
const extractEmail = (user) => {
  const emailAttr = user.Attributes.find((attr) => attr.Name === "email");
  return emailAttr ? emailAttr.Value : "";
};

// Process users and prepare for CSV export
const processUsersForExport = (users) => {
  return users
    .map((user) => ({
      email: extractEmail(user),
      username: user.Username,
      status: user.UserStatus,
      createdDate: user.UserCreateDate.toISOString().split("T")[0],
      lastModified: user.UserLastModifiedDate.toISOString().split("T")[0],
    }))
    .filter((user) => user.email); // Only include users with email addresses
};

// Export users to CSV
const exportToCSV = async (users, outputFile) => {
  return new Promise((resolve, reject) => {
    try {
      // Ensure directory exists
      const directory = outputFile.split("/").slice(0, -1).join("/");
      if (directory && !fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
      }

      const writeStream = fs.createWriteStream(outputFile);
      const csvStream = format({
        headers: ["email", "username", "status", "createdDate", "lastModified"],
        quoteColumns: true,
      });

      writeStream.on("finish", () => {
        console.log(
          `Successfully exported ${users.length} users to ${outputFile}`
        );
        resolve();
      });

      writeStream.on("error", (error) => {
        console.error("Error writing to CSV:", error);
        reject(error);
      });

      csvStream.on("error", (error) => {
        console.error("Error in CSV stream:", error);
        reject(error);
      });

      csvStream.pipe(writeStream);

      // Write each user record
      users.forEach((user) => {
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
      console.error("Error in exportToCSV:", error);
      reject(error);
    }
  });
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
    outputFile: "./cognito_users.csv",
  };

  try {
    // Initialize Cognito client
    const cognito = configureAWS(config.region);

    // Get all users
    console.log(`Fetching users from User Pool ${config.userPoolId}...`);
    const users = await getAllUsers(cognito, config.userPoolId);
    console.log(`Found ${users.length} users`);

    // Process users for export
    const processedUsers = processUsersForExport(users);
    console.log(`Processing ${processedUsers.length} users for export...`);

    // Export to CSV
    console.log(`Exporting to ${config.outputFile}...`);
    await exportToCSV(processedUsers, config.outputFile);

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

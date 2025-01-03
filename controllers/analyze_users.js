import AWS from "aws-sdk";
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

const analyzeUsers = async (userPoolId) => {
  try {
    const cognito = configureAWS();
    const users = await getAllUsers(cognito, userPoolId);

    const stats = {
      emailUsers: 0,
      googleUsers: 0,
      appleUsers: 0,
      total: users.length,
    };

    users.forEach((user) => {
      if (user.Username.startsWith("google_")) {
        stats.googleUsers++;
      } else if (user.Username.startsWith("signinwithapple_")) {
        stats.appleUsers++;
      } else {
        stats.emailUsers++;
      }
    });

    // Print analysis results
    console.log("\nUser Authentication Analysis:");
    console.log("----------------------------");
    console.log(`Total Users: ${stats.total}`);
    console.log(
      `Email/Password Users: ${stats.emailUsers} (${(
        (stats.emailUsers / stats.total) *
        100
      ).toFixed(2)}%)`
    );
    console.log(
      `Google Sign-in Users: ${stats.googleUsers} (${(
        (stats.googleUsers / stats.total) *
        100
      ).toFixed(2)}%)`
    );
    console.log(
      `Apple Sign-in Users: ${stats.appleUsers} (${(
        (stats.appleUsers / stats.total) *
        100
      ).toFixed(2)}%)`
    );

    return stats;
  } catch (error) {
    console.error("Error analyzing users:", error);
    throw error;
  }
};

// Main function
async function main() {
  const poolId = "us-east-1_tTejiiLwi"; // Your Cognito User Pool ID

  if (!poolId) {
    console.error("Error: User Pool ID is not set");
    process.exit(1);
  }

  try {
    await analyzeUsers(poolId);
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

// Run the analysis if this file is being executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { analyzeUsers };

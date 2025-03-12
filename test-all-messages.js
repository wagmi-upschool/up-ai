import AWS from "aws-sdk";
import fs from "fs";
import path from "path";

// Set AWS region
AWS.config.update({ region: "us-east-1" });

const dynamoDb = new AWS.DynamoDB.DocumentClient();

// Helper function to delay execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper function for exponential backoff
const getBackoffDelay = (attempt, baseDelay = 1000, maxDelay = 30000) => {
  const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  const jitter = Math.random() * 100; // Add some randomness
  return exponentialDelay + jitter;
};

// Helper function to execute DynamoDB operations with retry logic
const executeWithRetry = async (operation, params, maxAttempts = 5) => {
  let attempt = 0;

  while (attempt < maxAttempts) {
    try {
      return await operation(params);
    } catch (error) {
      attempt++;

      if (
        error.code === "ProvisionedThroughputExceededException" ||
        error.code === "ThrottlingException"
      ) {
        if (attempt < maxAttempts) {
          const delayTime = getBackoffDelay(attempt);
          console.log(
            `Rate limit exceeded. Retrying in ${delayTime}ms... (Attempt ${attempt}/${maxAttempts})`
          );
          await delay(delayTime);
          continue;
        }
      }

      // If not a throttling error or we've exhausted retries, rethrow
      throw error;
    }
  }
};

const getCognitoUserEmail = async (userId) => {
  try {
    const params = {
      UserPoolId: "us-east-1_tTejiiLwi", // Cognito User Pool ID
      Filter: `sub = "${userId}"`,
      Limit: 1,
    };

    const data = await executeWithRetry(
      (p) => new AWS.CognitoIdentityServiceProvider().listUsers(p).promise(),
      params
    );

    const user = data.Users[0];
    if (user) {
      return (
        user.Attributes.find((attr) => attr.Name === "email")?.Value || null
      );
    }
    return null;
  } catch (error) {
    console.error("Error fetching user email:", error);
    return null;
  }
};

const getRelatedChatMessages = async (conversationId) => {
  try {
    if (!conversationId) {
      console.warn("No conversation ID provided");
      return [];
    }

    console.log("Fetching messages for conversation ID:", conversationId);
    const params = {
      TableName: "UpConversationMessage-upwagmitec",
      KeyConditionExpression: "#conversationId = :conversationId",
      ExpressionAttributeNames: {
        "#conversationId": "conversationId",
      },
      ExpressionAttributeValues: {
        ":conversationId": conversationId,
      },
    };

    const data = await executeWithRetry(
      (p) => dynamoDb.query(p).promise(),
      params
    );

    if (data.Items && data.Items.length > 0) {
      console.log(
        `Found ${data.Items.length} messages for conversation ${conversationId}`
      );

      // Log roles present in the messages
      const roles = new Set();
      data.Items.forEach((msg) => {
        if (msg && msg.role) roles.add(msg.role);
      });
      console.log("Roles found:", Array.from(roles));

      return data.Items;
    }
    return [];
  } catch (error) {
    console.error(
      `Error fetching messages for conversationId ${conversationId}:`,
      error
    );
    return [];
  }
};

const testAllMessagesExport = async () => {
  try {
    // Get just 3 conversations to test
    const conversationsParams = {
      TableName: "UpConversations-upwagmitec",
      Limit: 3,
    };

    console.log("Fetching a few test conversations...");
    const conversationData = await executeWithRetry(
      (p) => dynamoDb.scan(p).promise(),
      conversationsParams
    );

    if (!conversationData.Items || conversationData.Items.length === 0) {
      console.log("No conversations found");
      return;
    }

    const conversations = conversationData.Items;
    console.log(`Found ${conversations.length} conversations to test`);

    // Process these conversations
    const results = await Promise.all(
      conversations.map(async (conv) => {
        const userEmail = await getCognitoUserEmail(conv.userId);
        const conversationId = conv.idUpdatedAt;
        const messages = await getRelatedChatMessages(conversationId);

        return {
          userId: conv.userId,
          conversationId,
          userEmail,
          assistantId: conv.assistantId,
          relatedChatMessages: messages,
        };
      })
    );

    // Group by user and format for the CSV structure
    const groupedData = {};
    results.forEach((item) => {
      if (!groupedData[item.userId]) {
        groupedData[item.userId] = {
          userId: item.userId,
          userEmail: item.userEmail || "",
          conversations: [],
        };
      }

      groupedData[item.userId].conversations.push({
        conversationId: item.conversationId,
        assistantId: item.assistantId,
        relatedChatMessages: item.relatedChatMessages,
      });
    });

    // Convert to array
    const groupedArray = Object.values(groupedData);

    // Now demonstrate processing like the main script does
    groupedArray.forEach((item) => {
      // Extract all messages
      const allMessages = item.conversations
        .flatMap((conv) => {
          const messages = conv.relatedChatMessages || [];

          // Log message roles
          const roles = new Set();
          messages.forEach((msg) => {
            if (msg && msg.role) roles.add(msg.role);
          });
          console.log(
            `Conversation ${conv.conversationId} has roles: ${Array.from(
              roles
            ).join(", ")}`
          );

          // Include ALL messages with role prefixes
          return messages
            .filter((msg) => msg && msg.content)
            .map((msg) => `[${msg.role || "unknown"}]: ${msg.content || ""}`);
        })
        .join(" | ");

      console.log("\n--- SAMPLE OUTPUT ---");
      console.log(`User: ${item.userId}`);
      console.log(`Email: ${item.userEmail}`);
      console.log(`Conversations: ${item.conversations.length}`);
      console.log("All Messages:");
      console.log(
        allMessages.substring(0, 1000) +
          (allMessages.length > 1000 ? "..." : "")
      );
      console.log("--- END SAMPLE ---\n");
    });

    console.log("Test completed successfully!");
  } catch (error) {
    console.error("Error in test:", error);
  }
};

// Run the test
console.log("Starting test for all-messages export...");
testAllMessagesExport()
  .then(() => console.log("Test completed"))
  .catch((error) => console.error("Test failed:", error));

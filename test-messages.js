import AWS from "aws-sdk";

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

// Function to test message retrieval for a single conversation
const testMessageRetrieval = async () => {
  try {
    // First, get the most recent conversation ID
    const conversationsParams = {
      TableName: "UpConversations-upwagmitec",
      Limit: 1, // Just get the most recent one
    };

    console.log("Fetching a recent conversation...");
    const conversationData = await executeWithRetry(
      (p) => dynamoDb.scan(p).promise(),
      conversationsParams
    );

    if (!conversationData.Items || conversationData.Items.length === 0) {
      console.log("No conversations found");
      return;
    }

    const conversation = conversationData.Items[0];
    console.log("Found conversation:", conversation.idUpdatedAt);

    // Now get messages for this conversation
    const messagesParams = {
      TableName: "UpConversationMessage-upwagmitec",
      KeyConditionExpression: "#conversationId = :conversationId",
      ExpressionAttributeNames: {
        "#conversationId": "conversationId",
      },
      ExpressionAttributeValues: {
        ":conversationId": conversation.idUpdatedAt,
      },
    };

    console.log(
      "Fetching messages for conversation:",
      conversation.idUpdatedAt
    );
    const messagesData = await executeWithRetry(
      (p) => dynamoDb.query(p).promise(),
      messagesParams
    );

    if (!messagesData.Items || messagesData.Items.length === 0) {
      console.log("No messages found for this conversation");
      return;
    }

    console.log(`Found ${messagesData.Items.length} messages`);

    // Analyze the messages structure
    const messages = messagesData.Items;

    // Check what roles exist in the messages
    const roles = new Set();
    messages.forEach((msg) => {
      if (msg && msg.role) roles.add(msg.role);
    });
    console.log("Roles found in messages:", Array.from(roles));

    // Count messages by role
    const roleCounts = {};
    messages.forEach((msg) => {
      const role = msg.role || "undefined";
      roleCounts[role] = (roleCounts[role] || 0) + 1;
    });
    console.log("Message counts by role:", roleCounts);

    // Show sample message for each role
    console.log("\nSample messages by role:");
    for (const role of roles) {
      const sampleMsg = messages.find((msg) => msg.role === role);
      console.log(`\n--- ${role} message sample ---`);
      console.log(JSON.stringify(sampleMsg, null, 2));

      // Check what the message content field is called
      const contentFields = ["content", "message", "text", "value"];
      for (const field of contentFields) {
        if (sampleMsg[field]) {
          console.log(`Content found in field: ${field}`);
        }
      }
    }

    // Test the filter that might be failing
    const userMessages = messages
      .filter((msg) => msg && msg.role === "human")
      .map((msg) => msg.content || "");

    console.log(`\nFound ${userMessages.length} messages with role="human"`);

    // Try the more flexible filter
    const possibleUserRoles = ["human", "user", "customer", "client", "sender"];
    const flexibleUserMessages = messages
      .filter((msg) => {
        if (!msg) return false;
        return (
          possibleUserRoles.includes(msg.role) ||
          msg.isUser === true ||
          msg.fromUser === true
        );
      })
      .map((msg) => msg.content || msg.message || msg.text || msg.value || "");

    console.log(
      `Found ${flexibleUserMessages.length} messages with flexible role check`
    );
  } catch (error) {
    console.error("Error testing message retrieval:", error);
  }
};

// Run the test
console.log("Starting message structure test...");
testMessageRetrieval()
  .then(() => console.log("Test completed"))
  .catch((error) => console.error("Test failed:", error));

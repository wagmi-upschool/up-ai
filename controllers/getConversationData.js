import AWS from "aws-sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Set AWS region at the very beginning
AWS.config.update({ region: "us-east-1" });

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const cognitoIdentityServiceProvider = new AWS.CognitoIdentityServiceProvider();

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
      UserPoolId: "us-east-1_tTejiiLwi", // Replace with your Cognito User Pool ID
      Filter: `sub = "${userId}"`,
      Limit: 1,
    };

    const data = await executeWithRetry(
      (p) => cognitoIdentityServiceProvider.listUsers(p).promise(),
      params
    );

    const user = data.Users[0];
    console.log("User:", user);
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

const getAssistantDetailsFromTable = async () => {
  try {
    const params = {
      TableName: "UpAssistant-upwagmitec", // Replace with your table name
    };

    const data = await executeWithRetry(
      (p) => dynamoDb.scan(p).promise(),
      params
    );

    const assistantDetails = {};
    data.Items.forEach((item) => {
      assistantDetails[item.id] = {
        name: item.name,
        createdAt: item.createdAt,
      };
    });
    return assistantDetails;
  } catch (error) {
    console.error("Error fetching assistant details:", error);
    throw error;
  }
};

const getRelatedChatMessages = async (conversationId) => {
  try {
    if (!conversationId) {
      console.warn("No conversation ID provided");
      return [];
    }

    console.log("Fetching messages for conversation ID:", conversationId);
    const baseParams = {
      TableName: "UpConversationMessage-upwagmitec", // Replace with your table name
      KeyConditionExpression: "#conversationId = :conversationId",
      ExpressionAttributeNames: {
        "#conversationId": "conversationId",
      },
      ExpressionAttributeValues: {
        ":conversationId": conversationId,
      },
      Limit: 50, // Fetch messages in batches of 50
    };

    let allMessages = [];
    let lastEvaluatedKey = undefined;
    let batchNumber = 0;

    do {
      const params = { ...baseParams };
      if (lastEvaluatedKey) {
        params.ExclusiveStartKey = lastEvaluatedKey;
      }

      console.log(
        `Fetching batch ${++batchNumber} of messages for conversation: ${conversationId}`
      );
      const data = await executeWithRetry(
        (p) => dynamoDb.query(p).promise(),
        params
      );

      if (data.Items && data.Items.length > 0) {
        // Log the structure of the first message to see what fields are available
        if (batchNumber === 1) {
          console.log(
            "Sample message structure:",
            JSON.stringify(data.Items[0], null, 2)
          );

          // Check what roles are present in the messages
          const roles = new Set();
          data.Items.forEach((msg) => {
            if (msg && msg.role) roles.add(msg.role);
          });
          console.log("Roles found in messages:", Array.from(roles));
        }

        allMessages = [...allMessages, ...data.Items];
        console.log(
          `Retrieved ${data.Items.length} messages. Total for conversation ${conversationId}: ${allMessages.length}`
        );
      }

      lastEvaluatedKey = data.LastEvaluatedKey;

      // Add a small delay between batches to avoid rate limiting
      if (lastEvaluatedKey) {
        await delay(200);
      }
    } while (lastEvaluatedKey);

    // Sort messages by createdAt to ensure they're in chronological order
    allMessages.sort((a, b) => {
      try {
        const dateA = new Date(a?.createdAt || 0);
        const dateB = new Date(b?.createdAt || 0);
        return dateA - dateB;
      } catch (error) {
        console.error("Error sorting messages:", error);
        return 0;
      }
    });

    return allMessages;
  } catch (error) {
    console.error(
      `Error fetching related messages for conversationId ${conversationId}:`,
      error
    );
    return [];
  }
};

const getConversationsByDateRange = async () => {
  const BATCH_SIZE = 25; // Limit scan operations to reduce load
  const baseParams = {
    TableName: "UpConversations-upwagmitec", // Replace with your table name
    // FilterExpression: "#updatedAt BETWEEN :startDate AND :endDate",
    // ExpressionAttributeNames: {
    //   "#updatedAt": "updatedAt",
    // },
    // ExpressionAttributeValues: {
    //   ":startDate": "2024-12-27T00:00:00.000Z", // Start date in ISO 8601 format
    //   ":endDate": "2025-01-10T00:00:00.000Z", // End date in ISO 8601 format
    // },
    Limit: BATCH_SIZE,
  };

  try {
    const assistantDetails = await getAssistantDetailsFromTable();

    // Implement pagination for large data sets
    let allItems = [];
    let lastEvaluatedKey = undefined;
    let batchCount = 0;

    do {
      const params = { ...baseParams };
      if (lastEvaluatedKey) {
        params.ExclusiveStartKey = lastEvaluatedKey;
      }

      console.log(`Fetching batch ${++batchCount} of conversations...`);
      const data = await executeWithRetry(
        (p) => dynamoDb.scan(p).promise(),
        params
      );

      if (data.Items && data.Items.length > 0) {
        allItems = [...allItems, ...data.Items];
        console.log(
          `Retrieved ${data.Items.length} items. Total so far: ${allItems.length}`
        );
      }

      lastEvaluatedKey = data.LastEvaluatedKey;

      // Add a small delay between batches to avoid rate limiting
      if (lastEvaluatedKey) {
        await delay(300);
      }
    } while (lastEvaluatedKey);

    console.log(`Total conversations retrieved: ${allItems.length}`);

    // Process conversations in batches to avoid overwhelming the system
    const PROCESS_BATCH_SIZE = 10;
    const results = [];

    for (let i = 0; i < allItems.length; i += PROCESS_BATCH_SIZE) {
      const batch = allItems.slice(i, i + PROCESS_BATCH_SIZE);
      console.log(
        `Processing conversation batch ${
          Math.floor(i / PROCESS_BATCH_SIZE) + 1
        }/${Math.ceil(allItems.length / PROCESS_BATCH_SIZE)}`
      );

      const batchResults = await Promise.all(
        batch.map(async (item, index) => {
          try {
            const userEmail = await getCognitoUserEmail(item.userId);
            const conversationId = item.idUpdatedAt;

            // Safely get assistant details
            let assistant = {};
            try {
              assistant = item.assistantId
                ? assistantDetails[item.assistantId] || {}
                : {};
            } catch (assistantError) {
              console.warn(
                `Error getting assistant details for item ${index}:`,
                assistantError
              );
            }

            // Safely get related chat messages
            let relatedChatMessages = [];
            try {
              if (item.idUpdatedAt) {
                relatedChatMessages = await getRelatedChatMessages(
                  item.idUpdatedAt
                );
              }
            } catch (messagesError) {
              console.warn(
                `Error getting chat messages for conversation ${item.idUpdatedAt}:`,
                messagesError
              );
            }

            return {
              userId: item.userId || "",
              conversationId: conversationId || "",
              userEmail: userEmail || "",
              assistantId: item.assistantId || "",
              assistantName: assistant.name || "Unknown",
              assistantCreatedAtDate: assistant.createdAt || null,
              conversationCreatedAt: item.createdAt || null,
              relatedChatMessages: relatedChatMessages || [],
              relatedAssistantGroupId: item.assistantGroupId || "",
            };
          } catch (itemError) {
            console.error(`Error processing batch item ${index}:`, itemError);
            // Return a minimal valid object to prevent Promise.all from failing
            return {
              userId: item.userId || "error-processing",
              conversationId: "error",
              userEmail: "",
              assistantId: "",
              assistantName: "Error",
              assistantCreatedAtDate: null,
              conversationCreatedAt: null,
              relatedChatMessages: [],
              relatedAssistantGroupId: "",
            };
          }
        })
      );

      results.push(...batchResults);

      // Add a delay between processing batches
      if (i + PROCESS_BATCH_SIZE < allItems.length) {
        const delayTime = 500;
        console.log(`Waiting ${delayTime}ms before processing next batch...`);
        await delay(delayTime);
      }
    }

    return results;
  } catch (error) {
    console.error("Error fetching conversations by date range:", error);
    throw error;
  }
};

const groupByUserId = (data) => {
  try {
    console.log("Starting to group data by userId...");
    const groupedData = {};

    data.forEach((item, index) => {
      try {
        if (!item || !item.userId) {
          console.warn(`Skipping item at index ${index} with missing userId`);
          return;
        }

        if (!groupedData[item.userId]) {
          groupedData[item.userId] = {
            userId: item.userId,
            userEmail: item.userEmail || "",
            conversations: [],
          };
        }

        // Ensure relatedChatMessages exists and is an array
        const relatedChatMessages = Array.isArray(item.relatedChatMessages)
          ? item.relatedChatMessages
          : [];

        groupedData[item.userId].conversations.push({
          conversationId: item.conversationId || `unknown-${index}`,
          assistantId: item.assistantId || "",
          assistantName: item.assistantName || "Unknown",
          assistantCreatedAtDate: item.assistantCreatedAtDate || null,
          conversationCreatedAt: item.conversationCreatedAt || null,
          relatedChatMessages: relatedChatMessages,
          relatedAssistantGroupId: item.relatedAssistantGroupId || "",
        });
      } catch (itemError) {
        console.error(`Error processing item at index ${index}:`, itemError);
      }
    });

    console.log(
      `Successfully grouped data into ${Object.keys(groupedData).length} users`
    );
    return Object.values(groupedData);
  } catch (error) {
    console.error("Error in groupByUserId:", error);
    // Return empty array as fallback
    return [];
  }
};

const convertToCSV = (data) => {
  try {
    const headers = [
      "userId",
      "userEmail",
      "totalConversations",
      "assistantIds",
      "assistantNames",
      "messageCount",
      "firstConversationDate",
      "lastConversationDate",
      "allMessages",
    ];
    const csvRows = [headers.join(",")];

    data.forEach((item) => {
      try {
        const assistantIds = [
          ...new Set(item.conversations.map((c) => c.assistantId)),
        ].join(";");
        const assistantNames = [
          ...new Set(item.conversations.map((c) => c.assistantName)),
        ].join(";");
        const messageCount = item.conversations.reduce(
          (total, conv) => total + (conv.relatedChatMessages?.length || 0),
          0
        );
        const conversationDates = item.conversations
          .map((c) => c.conversationCreatedAt)
          .filter(Boolean);
        const firstDate = conversationDates.length
          ? new Date(
              Math.min(...conversationDates.map((d) => new Date(d)))
            ).toISOString()
          : "";
        const lastDate = conversationDates.length
          ? new Date(
              Math.max(...conversationDates.map((d) => new Date(d)))
            ).toISOString()
          : "";

        // Extract and concatenate all messages - both user and assistant
        const allMessages = item.conversations
          .flatMap((conv) => {
            const messages = conv.relatedChatMessages || [];

            // Log message count to understand what we have
            if (messages.length > 0 && !item._logged) {
              const roles = messages.map((m) => m.role).filter(Boolean);
              console.log(
                `Conversation ${conv.conversationId} has ${
                  messages.length
                } messages with roles: ${roles.join(", ") || "none"}`
              );
              item._logged = true; // Prevent excessive logging
            }

            // Include ALL messages, prefixed by their role for clarity
            return messages
              .filter((msg) => msg && msg.content)
              .map((msg) => `[${msg.role || "unknown"}]: ${msg.content || ""}`);
          })
          .join(" | "); // Separate messages with pipe character

        // Ensure all values are strings before using replace
        const row = [
          item.userId || "",
          item.userEmail || "",
          (item.conversations?.length || 0).toString(),
          assistantIds || "",
          assistantNames || "",
          messageCount.toString(),
          firstDate || "",
          lastDate || "",
          allMessages || "", // Using all messages instead of just user messages
        ].map((value) => {
          // Ensure value is a string before using replace
          const stringValue = String(value);
          return `"${stringValue.replace(/"/g, '""')}"`;
        });

        csvRows.push(row.join(","));
      } catch (itemError) {
        console.error(
          "Error processing item:",
          itemError,
          "Item:",
          JSON.stringify(item).substring(0, 200) + "..."
        );
        // Still add a row with whatever data we can salvage
        const fallbackRow = [
          item.userId || "",
          item.userEmail || "",
          "0",
          "",
          "",
          "0",
          "",
          "",
          "Error processing user data",
        ].map((value) => `"${String(value).replace(/"/g, '""')}"`);
        csvRows.push(fallbackRow.join(","));
      }
    });

    return csvRows.join("\n");
  } catch (error) {
    console.error("Error converting to CSV:", error);
    // Return a basic CSV with error information
    return (
      'Error,Message\n"CSV Generation Error","' +
      String(error).replace(/"/g, '""') +
      '"'
    );
  }
};

const writeToCSV = (csvData, filename) => {
  try {
    const filePath = path.resolve(filename);
    fs.writeFileSync(filePath, csvData);
    console.log(`CSV file saved at: ${filePath}`);
    return filePath;
  } catch (error) {
    console.error("Error writing CSV file:", error);
    // Attempt to write to a different filename as fallback
    const fallbackPath = path.resolve(`fallback_${Date.now()}.csv`);
    try {
      fs.writeFileSync(
        fallbackPath,
        "Error occurred while generating original CSV"
      );
      console.log(`Fallback file saved at: ${fallbackPath}`);
      return fallbackPath;
    } catch (fallbackError) {
      console.error("Error writing fallback file:", fallbackError);
      return "error-writing-file";
    }
  }
};

export const handler = async (event) => {
  try {
    // Get conversations data
    console.log("Starting to fetch conversations data...");
    const conversationsData = await getConversationsByDateRange();
    console.log(`Fetched ${conversationsData.length} conversations`);

    // Group by user ID
    console.log("Grouping conversations by user ID...");
    const groupedData = groupByUserId(conversationsData);
    console.log(`Grouped into ${groupedData.length} users`);

    // Convert to CSV
    console.log("Converting to CSV...");
    const csvData = convertToCSV(groupedData);
    console.log(`Generated CSV with ${csvData.length} characters`);

    // For Lambda, you might want to return the CSV data
    // For local execution, you might want to save to file
    if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition":
            'attachment; filename="user_conversations.csv"',
        },
        body: csvData,
      };
    } else {
      // Local execution
      console.log("Writing CSV to file...");
      const csvFilePath = writeToCSV(csvData, "user_conversations.csv");
      console.log("CSV file written successfully");
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "CSV file generated successfully",
          path: csvFilePath,
          groupedUsersCount: groupedData.length,
          totalConversations: conversationsData.length,
        }),
      };
    }
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to fetch and process conversations",
        details: String(error),
      }),
    };
  }
};

// For local execution - ES Module compatible version
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  // Make sure AWS region is explicitly set for local execution
  AWS.config.update({ region: "us-east-1" });

  console.log("Starting data extraction with rate limiting...");
  handler()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => console.error("Error running locally:", error));
}

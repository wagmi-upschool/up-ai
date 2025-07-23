import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
import { BlankFieldReplacer } from "../utils/blankFieldReplacer.js";
import { AssistantDataService } from "../services/assistantDataService.js";

dotenv.config();

// Default configuration - can be overridden by command line arguments
const DEFAULT_CONFIG = {
  functionName: "saveConversationMessages-myenv", // Lambda function name
  getAssistantInputOptionsFunction: "getAssistantInputOptions", // Lambda function for options
  region: "us-east-1",
  stage: "myenv", // Default stage - can be overridden with --stage
  userId: "24c844c8-6031-702b-8de2-f521e7104fae", // Default userId - can be overridden with --userId
  maxConversations: 20, // Default max conversations - can be overridden with --max-count
  assistantGroupId: "7c68ad5d-6092-4a4a-98bc-235e4553e332",
  iconUrl:
    "https://upwagmidevcontent234355-upwagmitec.s3.us-east-1.amazonaws.com/public/assistant_group_icons/assistant_icons/Role+Play+600x600.png",
};

// This will be set by parseArguments()
let CONFIG = { ...DEFAULT_CONFIG };

// Initialize AWS Lambda client
const lambdaClient = new LambdaClient({ region: CONFIG.region });

// Initialize services - these will be configured dynamically based on assistant ID
let blankFieldReplacer;
let assistantDataService;
let conversationConfig;

// This will be dynamically generated based on assistant data
let CONVERSATIONS_TO_CREATE = [];

/**
 * Generate dynamic conversation scenarios using election options
 * @param {string} assistantId - The assistant ID to generate scenarios for
 * @param {number} maxCount - Maximum number of conversations to generate (optional)
 */
async function generateConversationScenarios(assistantId, maxCount) {
  console.log("🎯 Generating fully dynamic conversation scenarios...");
  console.log(`🤖 Assistant ID: ${assistantId}`);

  // Initialize services with assistant ID
  assistantDataService = new AssistantDataService({
    region: CONFIG.region,
    stage: CONFIG.stage,
  });

  blankFieldReplacer = new BlankFieldReplacer({
    region: CONFIG.region,
    stage: CONFIG.stage,
  });

  // Generate dynamic configuration from assistant data
  conversationConfig = await assistantDataService.generateConversationConfig(
    assistantId,
    {
      maxConversations: maxCount || CONFIG.maxConversations,
      variationsPerMessage: 2,
    }
  );

  console.log(
    `📊 Target: ${conversationConfig.conversationCount} conversations`
  );

  const scenarios = [];

  for (const introMessage of conversationConfig.messagesWithBlanks) {
    try {
      // Generate variations for this introduction message
      const variations = await blankFieldReplacer.generateMessageVariations(
        assistantId,
        introMessage.value,
        conversationConfig.variationsPerMessage
      );

      for (const variation of variations) {
        // Create conversation scenario
        const scenario = {
          type: determineConversationType(variation),
          userInput: conversationConfig.defaultIntroMessage,
          customerProfile: variation.processedMessage,
          title: generateScenarioTitle(variation),
          metadata: {
            originalMessage: introMessage.value,
            replacements: variation.replacements,
            generatedAt: variation.processedAt,
            assistantId: assistantId,
            assistantDescription: conversationConfig.assistantData.description,
          },
        };

        scenarios.push(scenario);

        // Stop when we reach the target count
        if (scenarios.length >= conversationConfig.conversationCount) {
          break;
        }
      }

      if (scenarios.length >= conversationConfig.conversationCount) {
        break;
      }
    } catch (error) {
      console.error(
        `❌ Error generating scenarios for message: ${introMessage.value.substring(
          0,
          50
        )}...`
      );
      console.error(`Error: ${error.message}`);
    }
  }

  console.log(`✅ Generated ${scenarios.length} conversation scenarios`);
  return scenarios;
}

/**
 * Determine conversation type based on the generated content
 */
function determineConversationType(variation) {
  const content = variation.processedMessage.toLowerCase();

  // Simple logic - could be enhanced based on actual content
  const types = ["mevcut_musteri", "yeni_musteri"];
  return types[Math.floor(Math.random() * types.length)];
}

/**
 * Generate a descriptive title for the scenario
 */
function generateScenarioTitle(variation) {
  const replacements = variation.replacements || [];

  if (replacements.length > 0) {
    const firstReplacement = replacements[0].replacementValue;
    const type = determineConversationType(variation);
    const icon = type === "mevcut_musteri" ? "2️⃣" : "1️⃣";
    const typeText =
      type === "mevcut_musteri" ? "Mevcut müşteri" : "Yeni müşteri";

    return `${icon} ${typeText} - ${firstReplacement}`;
  }

  return "🔄 Dinamik Senaryo";
}

/**
 * Create a new conversation using AWS Lambda invoke
 */
async function createConversation(scenario, assistantId) {
  const timestamp = new Date().toISOString();

  // Prepare the request body (will be stringified in the Lambda event)
  const requestBody = {
    messages: [
      {
        content: scenario.userInput,
        type: "text",
        role: "user",
        createdAt: timestamp,
        identifier: uuidv4(),
        isGptSuitable: true,
      },
      {
        content: scenario.customerProfile,
        type: "text",
        role: "assistant",
        createdAt: new Date(Date.now() + 1000).toISOString(), // 1 second later
        identifier: uuidv4(),
        isGptSuitable: true,
      },
    ],
    assistantId: assistantId,
    assistantGroupId: CONFIG.assistantGroupId,
    conversationId: null, // This will trigger new conversation creation
    userId: CONFIG.userId,
    iconUrl: CONFIG.iconUrl,
    localDateTime: timestamp,
    type: "chat",
    title: scenario.title,
    lastMessage: scenario.customerProfile,
  };

  // Prepare Lambda event payload (mimicking API Gateway structure)
  const lambdaEvent = {
    body: JSON.stringify(requestBody),
    headers: {
      "Content-Type": "application/json",
      // Note: Add Authorization header if JWT token is required
      // "Authorization": "Bearer <jwt_token>"
    },
    httpMethod: "POST",
    pathParameters: null,
    queryStringParameters: null,
    requestContext: {
      requestId: `create-conversation-${uuidv4()}`,
      stage: "prod",
    },
  };

  try {
    console.log(`🚀 Creating ${scenario.type} conversation...`);
    console.log(`📝 Title: ${scenario.title}`);
    console.log(`⚡ Invoking Lambda: ${CONFIG.functionName}`);

    const invokeCommand = new InvokeCommand({
      FunctionName: CONFIG.functionName,
      InvocationType: "RequestResponse", // Synchronous invocation
      Payload: JSON.stringify(lambdaEvent),
    });

    const response = await lambdaClient.send(invokeCommand);

    // Parse the Lambda response
    const responsePayload = JSON.parse(
      new TextDecoder().decode(response.Payload)
    );

    console.log(`📡 Lambda Response Status: ${responsePayload.statusCode}`);

    if (responsePayload.statusCode !== 200) {
      throw new Error(`Lambda error: ${responsePayload.body}`);
    }

    // Parse the response body
    const result = JSON.parse(responsePayload.body);

    console.log(`✅ Successfully created conversation`);
    console.log(`📋 Conversation ID: ${result.conversationId}`);

    return {
      ...result,
      scenario: scenario,
      userInput: scenario.userInput,
      lambdaResponse: responsePayload,
    };
  } catch (error) {
    console.error(
      `❌ Failed to create ${scenario.type} conversation:`,
      error.message
    );
    console.error(`📋 Error details:`, error);
    return null;
  }
}

/**
 * Create all required conversations
 * @param {string} assistantId - The assistant ID to create conversations for
 * @param {Object} options - Optional parameters for conversation creation
 * @param {number} options.maxCount - Maximum number of conversations to create (overrides default)
 * @param {string} options.stage - DynamoDB stage (overrides config)
 * @param {string} options.userId - User ID (overrides config)
 * @param {boolean} options.preview - Preview mode only (don't create actual conversations)
 */
async function createAllConversations(assistantId, options = {}) {
  // Override CONFIG with provided options temporarily
  const originalStage = CONFIG.stage;
  const originalUserId = CONFIG.userId;
  
  if (options.stage) CONFIG.stage = options.stage;
  if (options.userId) CONFIG.userId = options.userId;

  // Generate dynamic scenarios first
  console.log(
    "🎯 Generating dynamic conversation scenarios with election options..."
  );

  try {
    CONVERSATIONS_TO_CREATE = await generateConversationScenarios(assistantId, options.maxCount);
  } catch (error) {
    console.error(
      "❌ Failed to generate dynamic scenarios, falling back to static scenarios"
    );
    console.error(`Error: ${error.message}`);
    // Keep the existing static scenarios as fallback if they exist
    if (CONVERSATIONS_TO_CREATE.length === 0) {
      throw new Error(
        "No conversation scenarios available - both dynamic and static generation failed"
      );
    }
  }

  console.log(
    `📊 Total conversations to create: ${CONVERSATIONS_TO_CREATE.length}`
  );
  console.log("");

  // If preview mode, just return the scenarios without creating conversations
  if (options.preview) {
    console.log("👀 PREVIEW MODE - Returning scenarios without creating conversations");
    return CONVERSATIONS_TO_CREATE.map((scenario, index) => ({
      conversationId: `preview-${index + 1}`,
      scenario: scenario,
      userInput: scenario.userInput,
      preview: true
    }));
  }

  const results = [];

  for (let i = 0; i < CONVERSATIONS_TO_CREATE.length; i++) {
    const scenario = CONVERSATIONS_TO_CREATE[i];
    console.log(
      `\n--- Creating conversation ${i + 1}/${
        CONVERSATIONS_TO_CREATE.length
      } ---`
    );

    const result = await createConversation(scenario, assistantId);
    if (result) {
      results.push(result);
    }

    // Add delay between requests to avoid rate limiting
    if (i < CONVERSATIONS_TO_CREATE.length - 1) {
      console.log("⏳ Waiting 2 seconds...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  return results;
}

/**
 * Display summary of created conversations
 */
function displaySummary(results) {
  console.log(`\n${"=".repeat(60)}`);
  console.log("🏆 CONVERSATION CREATION SUMMARY");
  console.log(`${"=".repeat(60)}`);

  const successfulCreations = results.filter((r) => r !== null);
  const mevcut = successfulCreations.filter(
    (r) => r.scenario.type === "mevcut_musteri"
  );
  const yeni = successfulCreations.filter(
    (r) => r.scenario.type === "yeni_musteri"
  );

  console.log(`\n📊 Results:`);
  console.log(`• Total attempts: ${CONVERSATIONS_TO_CREATE.length}`);
  console.log(`• Successful: ${successfulCreations.length}`);
  console.log(
    `• Failed: ${CONVERSATIONS_TO_CREATE.length - successfulCreations.length}`
  );

  console.log(`\n👥 Customer Type Distribution:`);
  console.log(`• 2️⃣ Mevcut müşteri: ${mevcut.length}`);
  console.log(`• 1️⃣ Yeni müşteri: ${yeni.length}`);

  console.log(`\n📋 Created Conversation IDs:`);
  successfulCreations.forEach((result, index) => {
    const icon = result.scenario.type === "mevcut_musteri" ? "2️⃣" : "1️⃣";
    console.log(`${icon} ${result.conversationId} - ${result.scenario.type}`);
  });

  if (successfulCreations.length > 0) {
    console.log(`\n💡 Next Steps:`);
    console.log(`1. Use these conversation IDs in your RAG validation tests`);
    console.log(
      `2. Update your test configuration to use the new conversations`
    );
    console.log(`3. Run RAG validation tests on the new conversations`);
  }

  // Restore original config
  CONFIG.stage = originalStage;
  CONFIG.userId = originalUserId;

  return results;
}

/**
 * Preview generated scenarios without creating conversations (for testing)
 * @param {string} assistantId - The assistant ID to preview scenarios for
 */
async function previewScenarios(assistantId) {
  console.log(
    "👀 PREVIEW MODE - Generating scenarios without creating conversations"
  );
  console.log(`🤖 Assistant ID: ${assistantId}`);
  console.log(`${"=".repeat(70)}`);

  try {
    const scenarios = await generateConversationScenarios(assistantId);

    console.log(`\n📊 Generated ${scenarios.length} scenarios:`);

    scenarios.forEach((scenario, index) => {
      console.log(`\n--- Scenario ${index + 1} ---`);
      console.log(`📋 Type: ${scenario.type}`);
      console.log(`📝 Title: ${scenario.title}`);
      console.log(`👤 User Input: ${scenario.userInput.substring(0, 100)}...`);
      console.log(
        `🤖 Customer Profile: ${scenario.customerProfile.substring(0, 100)}...`
      );

      if (scenario.metadata?.replacements) {
        console.log(
          `🔄 Replacements made: ${scenario.metadata.replacements.length}`
        );
        scenario.metadata.replacements.forEach((replacement, idx) => {
          console.log(
            `   ${idx + 1}. "${replacement.context}" → "${
              replacement.replacementValue
            }"`
          );
        });
      }
    });

    console.log(`\n${"=".repeat(70)}`);
    console.log(
      `✅ Preview completed! Use the script with assistant ID to create actual conversations.`
    );
  } catch (error) {
    console.error("❌ Preview failed:", error.message);
    console.error("Error details:", error);
  }
}

/**
 * Parse command line arguments
 */
function parseArguments() {
  const args = process.argv.slice(2);

  // Find assistant ID (first non-flag argument or after --assistant-id)
  let assistantId = null;
  let isPreview = false;
  let stage = DEFAULT_CONFIG.stage;
  let userId = DEFAULT_CONFIG.userId;
  let maxConversations = DEFAULT_CONFIG.maxConversations;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--preview" || arg === "-p") {
      isPreview = true;
    } else if (arg === "--assistant-id" || arg === "-a") {
      assistantId = args[i + 1];
      i++; // Skip next argument as it's the assistant ID
    } else if (arg === "--stage" || arg === "-s") {
      stage = args[i + 1];
      i++; // Skip next argument as it's the stage
    } else if (arg === "--userId" || arg === "--user-id") {
      userId = args[i + 1];
      i++; // Skip next argument as it's the user ID
    } else if (arg === "--max-count" || arg === "--max" || arg === "-m") {
      maxConversations = parseInt(args[i + 1], 10);
      i++; // Skip next argument as it's the max count
    } else if (!arg.startsWith("-") && !assistantId) {
      // First non-flag argument is assistant ID
      assistantId = arg;
    }
  }

  // Validate max conversations
  if (isNaN(maxConversations) || maxConversations < 1) {
    console.error(`❌ Invalid max-count value: ${maxConversations}. Must be a positive integer.`);
    process.exit(1);
  }

  // Update CONFIG with parsed values
  CONFIG.stage = stage;
  CONFIG.userId = userId;
  CONFIG.maxConversations = maxConversations;

  return { assistantId, isPreview, stage, userId, maxConversations };
}

/**
 * Display usage information
 */
function displayUsage() {
  console.log("📋 UP School Dynamic Conversation Creator");
  console.log(`${"=".repeat(50)}`);
  console.log("Usage:");
  console.log(
    "  node scripts/create_conversations.js <assistant-id> [options]"
  );
  console.log(
    "  node scripts/create_conversations.js --assistant-id <assistant-id> [options]"
  );
  console.log("");
  console.log("Options:");
  console.log(
    "  -p, --preview         Preview scenarios without creating conversations"
  );
  console.log(
    "  -a, --assistant-id <id>  Assistant ID to generate conversations for"
  );
  console.log(
    "  -s, --stage <stage>   DynamoDB stage (default: myenv)"
  );
  console.log(
    "  --userId <userId>     User ID for conversations (default: 24c844c8...)"
  );
  console.log(
    "  -m, --max-count <num> Maximum conversations to create (default: 20)"
  );
  console.log("");
  console.log("Examples:");
  console.log(
    "  # Using defaults (stage: myenv, userId: 24c844c8..., max-count: 20)"
  );
  console.log(
    "  node scripts/create_conversations.js 0186f1fa-ded1-45ff-a7cf-20d7807ac429 --preview"
  );
  console.log("");
  console.log(
    "  # Override stage, userId, and max count"
  );
  console.log(
    "  node scripts/create_conversations.js 0186f1fa-ded1-45ff-a7cf-20d7807ac429 --stage myenv --userId 24c844c8-6031-702b-8de2-f521e7104fae --max-count 10"
  );
  console.log("");
  console.log(
    "  # Create limited number of conversations"
  );
  console.log(
    "  node scripts/create_conversations.js 0186f1fa-ded1-45ff-a7cf-20d7807ac429 --max-count 5"
  );
  console.log("");
  console.log(
    "  # Preview with custom max count"
  );
  console.log(
    "  node scripts/create_conversations.js 0186f1fa-ded1-45ff-a7cf-20d7807ac429 --preview -m 3"
  );
}

/**
 * Main execution function
 */
async function main() {
  try {
    const { assistantId, isPreview } = parseArguments();

    if (!assistantId) {
      console.error("❌ Assistant ID is required!");
      displayUsage();
      process.exit(1);
    }

    console.log("🚀 UP School Dynamic Conversation Creator");
    console.log(`${"=".repeat(50)}`);
    console.log(`🤖 Assistant ID: ${assistantId}`);
    console.log(`Save Lambda Function: ${CONFIG.functionName}`);
    console.log(
      `Options Lambda Function: ${CONFIG.getAssistantInputOptionsFunction}`
    );
    console.log(`DynamoDB Stage: ${CONFIG.stage}`);
    console.log(`AWS Region: ${CONFIG.region}`);
    console.log(`User ID: ${CONFIG.userId}`);
    console.log(`📊 Max Conversations: ${CONFIG.maxConversations}`);
    console.log("");

    if (isPreview) {
      await previewScenarios(assistantId);
      return;
    }

    const results = await createAllConversations(assistantId);
    displaySummary(results);
  } catch (error) {
    console.error("💥 Script failed:", error.message);
    process.exit(1);
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { createAllConversations };

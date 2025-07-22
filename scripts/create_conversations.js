import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";

dotenv.config();

// Configuration
const CONFIG = {
  functionName: "saveConversationMessages-myenv", // Lambda function name
  region: "us-east-1",
  userId: "24c844c8-6031-702b-8de2-f521e7104fae",
  assistantId: "0186f1fa-ded1-45ff-a7cf-20d7807ac429",
  assistantGroupId: "7c68ad5d-6092-4a4a-98bc-235e4553e332",
  iconUrl:
    "https://upwagmidevcontent234355-upwagmitec.s3.us-east-1.amazonaws.com/public/assistant_group_icons/assistant_icons/Role+Play+600x600.png",
};

// Initialize AWS Lambda client
const lambdaClient = new LambdaClient({ region: CONFIG.region });

// Conversation scenarios to create
const CONVERSATIONS_TO_CREATE = [
  {
    type: "mevcut_musteri",
    userInput:
      '## yusuf, kendini geliştirmeye hazır mısın?\nHazırladığım kişiselleştirilmiş araçlarla potansiyelini ortaya çıkarman çok kolay. Hadi, daha iyi bir "sen" için hemen başla!',
    customerProfile:
      "Hangi müşteri profili ile başlamak isterin?  2️⃣ Mevcut müşteri (Çalışma geçmişi var, yeni fırsatlar)",
    title: "2️⃣ Mevcut müşteri (Çalışma geçmişi var, yeni fırsatlar)",
  },
  {
    type: "mevcut_musteri",
    userInput:
      '## yusuf, kendini geliştirmeye hazır mısın?\nHazırladığım kişiselleştirilmiş araçlarla potansiyelini ortaya çıkarman çok kolay. Hadi, daha iyi bir "sen" için hemen başla!',
    customerProfile:
      "Hangi müşteri profili ile başlamak isterin?  2️⃣ Mevcut müşteri (Çalışma geçmişi var, yeni fırsatlar)",
    title: "2️⃣ Mevcut müşteri (Çalışma geçmişi var, yeni fırsatlar)",
  },
  {
    type: "mevcut_musteri",
    userInput:
      '## yusuf, kendini geliştirmeye hazır mısın?\nHazırladığım kişiselleştirilmiş araçlarla potansiyelini ortaya çıkarman çok kolay. Hadi, daha iyi bir "sen" için hemen başla!',
    customerProfile:
      "Hangi müşteri profili ile başlamak isterin?  2️⃣ Mevcut müşteri (Çalışma geçmişi var, yeni fırsatlar)",
    title: "2️⃣ Mevcut müşteri (Çalışma geçmişi var, yeni fırsatlar)",
  },
  {
    type: "mevcut_musteri",
    userInput:
      '## yusuf, kendini geliştirmeye hazır mısın?\nHazırladığım kişiselleştirilmiş araçlarla potansiyelini ortaya çıkarman çok kolay. Hadi, daha iyi bir "sen" için hemen başla!',
    customerProfile:
      "Hangi müşteri profili ile başlamak isterin?  2️⃣ Mevcut müşteri (Çalışma geçmişi var, yeni fırsatlar)",
    title: "2️⃣ Mevcut müşteri (Çalışma geçmişi var, yeni fırsatlar)",
  },
  {
    type: "mevcut_musteri",
    userInput:
      '## yusuf, kendini geliştirmeye hazır mısın?\nHazırladığım kişiselleştirilmiş araçlarla potansiyelini ortaya çıkarman çok kolay. Hadi, daha iyi bir "sen" için hemen başla!',
    customerProfile:
      "Hangi müşteri profili ile başlamak isterin?  2️⃣ Mevcut müşteri (Çalışma geçmişi var, yeni fırsatlar)",
    title: "2️⃣ Mevcut müşteri (Çalışma geçmişi var, yeni fırsatlar)",
  },
  {
    type: "yeni_musteri",
    userInput:
      '## yusuf, kendini geliştirmeye hazır mısın?\nHazırladığım kişiselleştirilmiş araçlarla potansiyelini ortaya çıkarman çok kolay. Hadi, daha iyi bir "sen" için hemen başla!',
    customerProfile:
      "Hangi müşteri profili ile başlamak isterin?   1️⃣ Yeni müşteri (İlk görüşme, bankayı tanımıyor)",
    title: "1️⃣ Yeni müşteri (İlk görüşme, bankayı tanımıyor)",
  },
  {
    type: "yeni_musteri",
    userInput:
      '## yusuf, kendini geliştirmeye hazır mısın?\nHazırladığım kişiselleştirilmiş araçlarla potansiyelini ortaya çıkarman çok kolay. Hadi, daha iyi bir "sen" için hemen başla!',
    customerProfile:
      "Hangi müşteri profili ile başlamak isterin?   1️⃣ Yeni müşteri (İlk görüşme, bankayı tanımıyor)",
    title: "1️⃣ Yeni müşteri (İlk görüşme, bankayı tanımıyor)",
  },
  {
    type: "yeni_musteri",
    userInput:
      '## yusuf, kendini geliştirmeye hazır mısın?\nHazırladığım kişiselleştirilmiş araçlarla potansiyelini ortaya çıkarman çok kolay. Hadi, daha iyi bir "sen" için hemen başla!',
    customerProfile:
      "Hangi müşteri profili ile başlamak isterin?   1️⃣ Yeni müşteri (İlk görüşme, bankayı tanımıyor)",
    title: "1️⃣ Yeni müşteri (İlk görüşme, bankayı tanımıyor)",
  },
  {
    type: "yeni_musteri",
    userInput:
      '## yusuf, kendini geliştirmeye hazır mısın?\nHazırladığım kişiselleştirilmiş araçlarla potansiyelini ortaya çıkarman çok kolay. Hadi, daha iyi bir "sen" için hemen başla!',
    customerProfile:
      "Hangi müşteri profili ile başlamak isterin?   1️⃣ Yeni müşteri (İlk görüşme, bankayı tanımıyor)",
    title: "1️⃣ Yeni müşteri (İlk görüşme, bankayı tanımıyor)",
  },
  {
    type: "yeni_musteri",
    userInput:
      '## yusuf, kendini geliştirmeye hazır mısın?\nHazırladığım kişiselleştirilmiş araçlarla potansiyelini ortaya çıkarman çok kolay. Hadi, daha iyi bir "sen" için hemen başla!',
    customerProfile:
      "Hangi müşteri profili ile başlamak isterin?   1️⃣ Yeni müşteri (İlk görüşme, bankayı tanımıyor)",
    title: "1️⃣ Yeni müşteri (İlk görüşme, bankayı tanımıyor)",
  },
];

/**
 * Create a new conversation using AWS Lambda invoke
 */
async function createConversation(scenario) {
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
    assistantId: CONFIG.assistantId,
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
 */
async function createAllConversations() {
  console.log("🎯 Creating conversations for balanced dataset:");
  console.log("• 1 Mevcut müşteri conversation");
  console.log("• 4 Yeni müşteri conversations");
  console.log("");

  const results = [];

  for (let i = 0; i < CONVERSATIONS_TO_CREATE.length; i++) {
    const scenario = CONVERSATIONS_TO_CREATE[i];
    console.log(
      `\n--- Creating conversation ${i + 1}/${
        CONVERSATIONS_TO_CREATE.length
      } ---`
    );

    const result = await createConversation(scenario);
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
}

/**
 * Main execution function
 */
async function main() {
  try {
    console.log("🚀 UP School Conversation Creator (AWS Lambda)");
    console.log(`${"=".repeat(50)}`);
    console.log(`Lambda Function: ${CONFIG.functionName}`);
    console.log(`AWS Region: ${CONFIG.region}`);
    console.log(`User ID: ${CONFIG.userId}`);
    console.log(`Assistant ID: ${CONFIG.assistantId}`);
    console.log("");

    const results = await createAllConversations();
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

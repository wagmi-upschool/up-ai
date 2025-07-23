import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import dotenv from "dotenv";

dotenv.config();

/**
 * Service for fetching assistant input options from getAssistantInputOptions Lambda function
 */
export class AssistantInputOptionsService {
  constructor(config = {}) {
    const stage = config.stage || process.env.STAGE || "myenv";
    this.functionName = config.functionName || `getAssistantInputOptions-${stage}`;
    this.region = config.region || "us-east-1";
    this.lambdaClient = new LambdaClient({ region: this.region });
  }

  /**
   * Fetch all input options for an assistant
   * @param {string} assistantId - The assistant ID
   * @returns {Promise<Array>} Array of input options
   */
  async getAllOptions(assistantId) {
    const event = {
      resource: "/assistant-input-options",
      path: "/assistant-input-options",
      httpMethod: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "aws-amplify/1.0",
      },
      queryStringParameters: {
        assistantId: assistantId,
      },
      pathParameters: null,
      stageVariables: null,
      requestContext: {
        requestId: `get-all-options-${Date.now()}`,
        stage: "prod",
        requestTime: new Date().toUTCString(),
        requestTimeEpoch: Date.now(),
        identity: {
          sourceIp: "127.0.0.1",
          userAgent: "AssistantInputOptionsService",
        },
        path: "/assistant-input-options",
        resourcePath: "/assistant-input-options",
        httpMethod: "GET",
        apiId: "1234567890",
        protocol: "HTTP/1.1",
        resourceId: "123456",
      },
      body: null,
      isBase64Encoded: false,
    };

    return this.invokeLambda(event);
  }

  /**
   * Fetch child options by parent ID
   * @param {string} assistantId - The assistant ID
   * @param {string} parentId - The parent option ID
   * @returns {Promise<Array>} Array of child input options
   */
  async getChildOptions(assistantId, parentId) {
    const event = {
      resource: "/assistant-input-options",
      path: "/assistant-input-options",
      httpMethod: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "aws-amplify/1.0",
      },
      queryStringParameters: {
        assistantId: assistantId,
        parentId: parentId,
      },
      pathParameters: null,
      requestContext: {
        requestId: `get-parent-options-${Date.now()}`,
        stage: "prod",
      },
      body: null,
      isBase64Encoded: false,
    };

    return this.invokeLambda(event);
  }

  /**
   * Invoke the Lambda function with the provided event
   * @param {Object} event - Lambda event object
   * @returns {Promise<Array>} Parsed response data
   * @private
   */
  async invokeLambda(event) {
    try {
      console.log(`🚀 Invoking Lambda: ${this.functionName}`);
      console.log(
        `📋 Assistant ID: ${event.queryStringParameters?.assistantId}`
      );
      if (event.queryStringParameters?.parentId) {
        console.log(`📂 Parent ID: ${event.queryStringParameters.parentId}`);
      }

      const invokeCommand = new InvokeCommand({
        FunctionName: this.functionName,
        InvocationType: "RequestResponse",
        Payload: JSON.stringify(event),
      });

      const response = await this.lambdaClient.send(invokeCommand);
      const responsePayload = JSON.parse(
        new TextDecoder().decode(response.Payload)
      );

      console.log(`📡 Lambda Response Status: ${responsePayload.statusCode}`);

      if (responsePayload.statusCode !== 200) {
        throw new Error(`Lambda error: ${responsePayload.body}`);
      }

      const options = JSON.parse(responsePayload.body);
      console.log(`✅ Retrieved ${options.length} input options`);

      return options;
    } catch (error) {
      console.error(`❌ Failed to fetch input options:`, error.message);

      // If it's a function not found error, return fallback options
      if (error.message.includes("Function not found")) {
        console.log(`🔄 Using fallback options due to missing Lambda function`);
        return this.getFallbackOptions(
          event.queryStringParameters?.assistantId
        );
      }

      throw error;
    }
  }

  /**
   * Get fallback options when Lambda function is not available
   * @param {string} assistantId - The assistant ID
   * @returns {Array} Array of fallback options
   */
  getFallbackOptions(assistantId) {
    // Generic fallback options for Turkish language learning
    const fallbackOptions = [
      { value: "Bir arkadaşım", text: "Bir arkadaşım", SK: "person-friend" },
      { value: "İş arkadaşım", text: "İş arkadaşım", SK: "person-colleague" },
      { value: "Yöneticim", text: "Yöneticim", SK: "person-manager" },
      { value: "Müşteri", text: "Müşteri", SK: "person-customer" },
      { value: "Takım üyesi", text: "Takım üyesi", SK: "person-team-member" },
      {
        value: "İletişim becerileri",
        text: "İletişim becerileri",
        SK: "topic-communication",
      },
      {
        value: "İş performansı",
        text: "İş performansı",
        SK: "topic-performance",
      },
      {
        value: "Proje yönetimi",
        text: "Proje yönetimi",
        SK: "topic-project-management",
      },
      { value: "Ekip çalışması", text: "Ekip çalışması", SK: "topic-teamwork" },
      { value: "Liderlik", text: "Liderlik", SK: "topic-leadership" },
      {
        value: "Teknik beceriler",
        text: "Teknik beceriler",
        SK: "topic-technical-skills",
      },
      {
        value: "Kişisel gelişim",
        text: "Kişisel gelişim",
        SK: "topic-personal-development",
      },
      {
        value: "Zaman yönetimi",
        text: "Zaman yönetimi",
        SK: "topic-time-management",
      },
      {
        value: "Problem çözme",
        text: "Problem çözme",
        SK: "topic-problem-solving",
      },
      { value: "Yaratıcılık", text: "Yaratıcılık", SK: "topic-creativity" },
    ];

    console.log(
      `🎯 Generated ${fallbackOptions.length} fallback options for assistant ${assistantId}`
    );
    return fallbackOptions;
  }

  /**
   * Get a random option from the provided options array
   * @param {Array} options - Array of options
   * @returns {Object|null} Random option or null if array is empty
   */
  getRandomOption(options) {
    if (!options || options.length === 0) {
      return null;
    }
    const randomIndex = Math.floor(Math.random() * options.length);
    return options[randomIndex];
  }

  /**
   * Generate a random user input by selecting from hierarchical options
   * @param {string} assistantId - The assistant ID
   * @param {number} maxDepth - Maximum depth for hierarchical selection (default: 2)
   * @returns {Promise<Object>} Generated input with text, value, and hierarchy path
   */
  async generateRandomUserInput(assistantId, maxDepth = 2) {
    try {
      console.log(
        `🎲 Generating random user input for assistant: ${assistantId}`
      );

      // Get all top-level options
      const topLevelOptions = await this.getAllOptions(assistantId);

      if (!topLevelOptions || topLevelOptions.length === 0) {
        throw new Error("No input options found for assistant");
      }

      // Select random top-level option
      const selectedTopLevel = this.getRandomOption(topLevelOptions);
      console.log(`📋 Selected top-level option: ${selectedTopLevel.text}`);

      let result = {
        text: selectedTopLevel.text,
        value: selectedTopLevel.value,
        hierarchy: [selectedTopLevel],
        fullPath: [selectedTopLevel.text],
      };

      // Try to get child options if we haven't reached max depth
      let currentDepth = 1;
      let currentParentId = selectedTopLevel.value;

      while (currentDepth < maxDepth) {
        try {
          const childOptions = await this.getChildOptions(
            assistantId,
            currentParentId
          );

          if (!childOptions || childOptions.length === 0) {
            console.log(
              `📂 No child options found for parent: ${currentParentId}`
            );
            break;
          }

          const selectedChild = this.getRandomOption(childOptions);
          console.log(
            `📋 Selected level ${currentDepth + 1} option: ${
              selectedChild.text
            }`
          );

          // Update result with deeper selection
          result.text = selectedChild.text;
          result.value = selectedChild.value;
          result.hierarchy.push(selectedChild);
          result.fullPath.push(selectedChild.text);

          currentParentId = selectedChild.value;
          currentDepth++;
        } catch (error) {
          console.log(
            `⚠️ No deeper options available at depth ${currentDepth + 1}`
          );
          break;
        }
      }

      console.log(
        `✅ Generated input: "${result.text}" (depth: ${result.hierarchy.length})`
      );
      return result;
    } catch (error) {
      console.error(`❌ Failed to generate random user input:`, error.message);
      throw error;
    }
  }

  /**
   * Generate multiple random user inputs
   * @param {string} assistantId - The assistant ID
   * @param {number} count - Number of inputs to generate
   * @param {number} maxDepth - Maximum depth for hierarchical selection
   * @returns {Promise<Array>} Array of generated inputs
   */
  async generateMultipleRandomInputs(assistantId, count = 5, maxDepth = 2) {
    const inputs = [];
    const usedValues = new Set();

    console.log(`🎲 Generating ${count} unique random user inputs...`);

    for (let i = 0; i < count; i++) {
      let attempts = 0;
      const maxAttempts = count * 3; // Allow multiple attempts to find unique values

      while (attempts < maxAttempts) {
        try {
          const input = await this.generateRandomUserInput(
            assistantId,
            maxDepth
          );

          // Ensure uniqueness based on the final selected value
          if (!usedValues.has(input.value)) {
            usedValues.add(input.value);
            inputs.push(input);
            console.log(
              `📝 Generated input ${i + 1}/${count}: "${input.text}"`
            );
            break;
          }

          attempts++;
          if (attempts < maxAttempts) {
            console.log(
              `🔄 Duplicate value detected, retrying... (${attempts}/${maxAttempts})`
            );
          }
        } catch (error) {
          console.error(`❌ Error generating input ${i + 1}:`, error.message);
          attempts++;
        }
      }

      if (attempts >= maxAttempts) {
        console.warn(
          `⚠️ Could not generate unique input ${
            i + 1
          } after ${maxAttempts} attempts`
        );
      }

      // Small delay between generations to avoid rate limiting
      if (i < count - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    console.log(`✅ Generated ${inputs.length}/${count} unique random inputs`);
    return inputs;
  }
}

export default AssistantInputOptionsService;

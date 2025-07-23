import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import dotenv from "dotenv";

dotenv.config();

/**
 * Service for fetching assistant data from UpAssistant DynamoDB table
 */
export class AssistantDataService {
  constructor(config = {}) {
    this.region = config.region || "us-east-1";
    this.stage = config.stage || process.env.STAGE || "dev";
    this.tableName = `UpAssistant-${this.stage}`;
    
    // Initialize DynamoDB client
    const dynamoClient = new DynamoDBClient({ region: this.region });
    this.docClient = DynamoDBDocumentClient.from(dynamoClient);
  }

  /**
   * Fetch assistant data including introductionMessages
   * @param {string} assistantId - The assistant ID (primary key)
   * @returns {Promise<Object>} Assistant data with introductionMessages
   */
  async getAssistantData(assistantId) {
    try {
      console.log(`🔍 Fetching assistant data from DynamoDB table: ${this.tableName}`);
      console.log(`🗝️ Assistant ID (PK): ${assistantId}`);

      const getCommand = new GetCommand({
        TableName: this.tableName,
        Key: {
          id: assistantId
        }
      });

      const response = await this.docClient.send(getCommand);

      if (!response.Item) {
        throw new Error(`Assistant not found with ID: ${assistantId}`);
      }

      const assistantData = response.Item;
      console.log(`✅ Retrieved assistant data: ${assistantData.description?.substring(0, 50)}...`);
      console.log(`📝 Introduction messages: ${assistantData.introductionMessages?.length || 0} found`);
      
      return assistantData;
    } catch (error) {
      console.error(`❌ Failed to fetch assistant data from DynamoDB:`, error.message);
      throw error;
    }
  }

  /**
   * Extract introduction messages with [BLANK] fields from assistant data
   * @param {Object} assistantData - The assistant data object
   * @returns {Array} Introduction messages that contain [BLANK] fields
   */
  extractIntroductionMessagesWithBlanks(assistantData) {
    const introMessages = assistantData.introductionMessages || [];
    
    // Filter for user-input type messages that contain [BLANK]
    const messagesWithBlanks = introMessages.filter(msg => 
      msg.type === "user-input" && 
      msg.value && 
      msg.value.includes("[BLANK]")
    );

    console.log(`📝 Found ${messagesWithBlanks.length} introduction messages with [BLANK] fields`);
    
    return messagesWithBlanks;
  }

  /**
   * Get default introduction message (non-user-input type)
   * @param {Object} assistantData - The assistant data object
   * @returns {string} Default introduction message
   */
  getDefaultIntroductionMessage(assistantData) {
    const introMessages = assistantData.introductionMessages || [];
    
    // Find the default type message
    const defaultMessage = introMessages.find(msg => msg.type === "default");
    
    if (defaultMessage) {
      console.log(`📄 Using default introduction message: ${defaultMessage.value.substring(0, 100)}...`);
      return defaultMessage.value;
    }

    // Fallback to assistant description if no default message
    console.log(`⚠️ No default introduction message found, using description as fallback`);
    return assistantData.description || "Merhaba! Size nasıl yardımcı olabilirim?";
  }

  /**
   * Determine conversation count based on available messages and variations
   * @param {Array} messagesWithBlanks - Introduction messages with blanks
   * @param {number} variationsPerMessage - Variations to generate per message
   * @param {number} maxConversations - Maximum conversations to create
   * @returns {number} Optimal conversation count
   */
  calculateOptimalConversationCount(messagesWithBlanks, variationsPerMessage = 2, maxConversations = 20) {
    const totalPossibleVariations = messagesWithBlanks.length * variationsPerMessage;
    const optimalCount = Math.min(totalPossibleVariations, maxConversations);
    
    console.log(`🎯 Calculating conversation count: ${messagesWithBlanks.length} messages × ${variationsPerMessage} variations = ${totalPossibleVariations} possible`);
    console.log(`📊 Optimal conversation count: ${optimalCount} (max: ${maxConversations})`);
    
    return optimalCount;
  }

  /**
   * Generate conversation configuration dynamically from assistant data
   * @param {string} assistantId - The assistant ID
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Dynamic conversation configuration
   */
  async generateConversationConfig(assistantId, options = {}) {
    const {
      maxConversations = 20,
      variationsPerMessage = 2,
      conversationTypes = ["mevcut_musteri", "yeni_musteri"]
    } = options;

    console.log(`⚙️ Generating dynamic conversation config for assistant: ${assistantId}`);

    try {
      // Fetch assistant data
      const assistantData = await this.getAssistantData(assistantId);
      
      // Extract messages with blanks
      const messagesWithBlanks = this.extractIntroductionMessagesWithBlanks(assistantData);
      
      if (messagesWithBlanks.length === 0) {
        throw new Error("No introduction messages with [BLANK] fields found for this assistant");
      }

      // Get default intro message
      const defaultIntroMessage = this.getDefaultIntroductionMessage(assistantData);
      
      // Calculate optimal conversation count
      const conversationCount = this.calculateOptimalConversationCount(
        messagesWithBlanks, 
        variationsPerMessage, 
        maxConversations
      );

      const config = {
        assistantId,
        assistantData,
        conversationCount,
        variationsPerMessage,
        conversationTypes,
        messagesWithBlanks,
        defaultIntroMessage,
        generatedAt: new Date().toISOString()
      };

      console.log(`✅ Generated conversation config with ${conversationCount} target conversations`);
      return config;
    } catch (error) {
      console.error(`❌ Failed to generate conversation config:`, error.message);
      throw error;
    }
  }

  /**
   * Preview the conversation configuration (for testing)
   * @param {string} assistantId - The assistant ID
   * @returns {Promise<void>} Logs preview to console
   */
  async previewConversationConfig(assistantId) {
    console.log(`👀 Previewing conversation config for assistant: ${assistantId}`);
    console.log(`${"=".repeat(60)}`);

    try {
      const config = await this.generateConversationConfig(assistantId);
      
      console.log(`📋 Assistant: ${config.assistantData.description?.substring(0, 100)}...`);
      console.log(`🎯 Target conversations: ${config.conversationCount}`);
      console.log(`🔄 Variations per message: ${config.variationsPerMessage}`);
      console.log(`📝 Messages with [BLANK] fields: ${config.messagesWithBlanks.length}`);
      
      console.log(`\n📄 Introduction messages with blanks:`);
      config.messagesWithBlanks.forEach((msg, index) => {
        console.log(`  ${index + 1}. ${msg.value.substring(0, 80)}...`);
      });
      
      console.log(`\n💬 Default introduction message:`);
      console.log(`${config.defaultIntroMessage.substring(0, 200)}...`);
      
      console.log(`\n${"=".repeat(60)}`);
      console.log(`✅ Configuration preview complete!`);
      
      return config;
    } catch (error) {
      console.error(`❌ Preview failed:`, error.message);
      throw error;
    }
  }
}

export default AssistantDataService;
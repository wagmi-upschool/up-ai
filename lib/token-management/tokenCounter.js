/**
 * @fileoverview Token management and counting utilities
 */

import { countTokens } from "gpt-tokenizer/model/gpt-4o-mini";
import { v4 as uuidv4 } from "uuid";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PutCommand } from "@aws-sdk/lib-dynamodb";

const dynamoDbClient = new DynamoDBClient({
  region: "us-east-1",
});

/**
 * Class for managing token counting and usage tracking
 */
export class TokenCounter {
  /**
   * Creates a new TokenCounter instance
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    this.options = options;
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
  }

  /**
   * Counts tokens in a text string
   * @param {string} text - Text to count tokens for
   * @returns {number} Number of tokens
   */
  static countTokens(text) {
    if (!text) return 0;
    return countTokens(text);
  }

  /**
   * Counts tokens in multiple text strings
   * @param {...string} texts - Text strings to count tokens for
   * @returns {number} Total number of tokens
   */
  static countMultipleTexts(...texts) {
    return texts.reduce(
      (total, text) => total + TokenCounter.countTokens(text),
      0
    );
  }

  /**
   * Adds input tokens to the total
   * @param {...string} texts - Text strings to count tokens for
   */
  addInputTokens(...texts) {
    this.totalInputTokens += TokenCounter.countMultipleTexts(...texts);
  }

  /**
   * Adds output tokens to the total
   * @param {...string} texts - Text strings to count tokens for
   */
  addOutputTokens(...texts) {
    this.totalOutputTokens += TokenCounter.countMultipleTexts(...texts);
  }

  /**
   * Gets the current token counts
   * @returns {Object} Object containing input and output token counts
   */
  getTokenCounts() {
    return {
      input: this.totalInputTokens,
      output: this.totalOutputTokens,
      total: this.totalInputTokens + this.totalOutputTokens,
    };
  }

  /**
   * Resets token counters to zero
   */
  reset() {
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
  }

  /**
   * Saves token usage data to DynamoDB
   * @param {Object} params - Parameters for saving token data
   * @param {string} params.userId - User's email or ID
   * @param {string} params.conversationId - Conversation ID
   * @param {string} params.stage - Environment stage
   * @returns {Promise<void>}
   */
  async saveTokenUsage({ userId, conversationId, stage }) {
    const timestamp = new Date().toISOString();
    const baseParams = {
      userId,
      conversationId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const savePromises = [];

    if (this.totalInputTokens > 0) {
      savePromises.push(
        this.saveTokenData({
          ...baseParams,
          type: "input",
          amount: this.totalInputTokens,
          stage,
        })
      );
    }

    if (this.totalOutputTokens > 0) {
      savePromises.push(
        this.saveTokenData({
          ...baseParams,
          type: "output",
          amount: this.totalOutputTokens,
          stage,
        })
      );
    }

    await Promise.all(savePromises);
  }

  /**
   * Saves individual token data entry to DynamoDB
   * @param {Object} data - Token data to save
   * @private
   */
  async saveTokenData(data) {
    const params = {
      TableName: `ConsumedToken-${data.stage}`,
      Item: {
        id: uuidv4(),
        ...data,
      },
    };

    try {
      await dynamoDbClient.send(new PutCommand(params));
    } catch (error) {
      console.error("Error saving token data:", error);
      throw error;
    }
  }
}

/**
 * @fileoverview RAG query engine for handling queries and responses
 */

import {
  OpenAI,
  PineconeVectorStore,
  VectorStoreIndex,
  Settings,
  OpenAIEmbedding,
  getResponseSynthesizer,
  RetrieverQueryEngine,
  VectorIndexRetriever,
} from "llamaindex";

/**
 * Class for handling RAG queries and responses
 */
export class RAGQueryEngine {
  /**
   * Creates a new RAGQueryEngine instance
   * @param {Object} index - Vector store index
   * @param {Object} config - Configuration for the query engine
   */
  constructor(index, config) {
    this.index = index;
    this.config = config;
    this.retriever = null;
    this.queryEngine = null;
  }

  /**
   * Initializes OpenAI settings
   * @private
   */
  async initializeSettings() {
    const { setEnvs } = await import("@llamaindex/env");
    setEnvs(process.env);

    Settings.llm = new OpenAI({
      azure: {
        endpoint: process.env.AZURE_OPENAI_ENDPOINT,
        deployment: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
        apiKey: process.env.AZURE_OPENAI_KEY,
      },
      model: process.env.MODEL,
      additionalChatOptions: {
        deployment: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
        frequency_penalty: this.config.frequencyPenalty,
        presence_penalty: this.config.presencePenalty,
        stream: true,
      },
      temperature: this.config.temperature,
      topP: this.config.topP,
    });

    Settings.embedModel = new OpenAIEmbedding({
      model: "text-embedding-3-small",
      azure: {
        endpoint: process.env.AZURE_OPENAI_ENDPOINT,
        deployment: "text-embedding-3-small",
        apiKey: process.env.AZURE_OPENAI_KEY,
      },
    });
  }

  /**
   * Initializes the retriever with filters
   * @param {Object[]} filters - Filters for the retriever
   * @returns {VectorIndexRetriever} Configured retriever
   */
  initializeRetriever(filters = []) {
    this.retriever = new VectorIndexRetriever({
      index: this.index,
      includeValues: true,
      filters: { filters },
      similarityTopK: 100,
    });
    return this.retriever;
  }

  /**
   * Initializes the OpenAI model with configuration
   * @returns {OpenAI} Configured OpenAI instance
   */
  initializeOpenAI() {
    return new OpenAI({
      azure: {
        endpoint: process.env.AZURE_OPENAI_ENDPOINT,
        deployment: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
        apiKey: process.env.AZURE_OPENAI_KEY,
      },
      model: process.env.MODEL,
      additionalChatOptions: {
        frequency_penalty: this.config.frequencyPenalty,
        presence_penalty: this.config.presencePenalty,
        stream: true,
      },
      temperature: this.config.temperature,
      topP: this.config.topP,
    });
  }

  /**
   * Initializes the query engine
   * @param {Object[]} filters - Filters for the retriever
   * @returns {RetrieverQueryEngine} Configured query engine
   */
  async initializeQueryEngine(filters = []) {
    await this.initializeSettings();

    if (!this.retriever) {
      this.initializeRetriever(filters);
    }

    const llm = this.initializeOpenAI();
    const responseSynthesizer = await getResponseSynthesizer("tree_summarize", {
      llm,
    });

    this.queryEngine = new RetrieverQueryEngine(
      this.retriever,
      responseSynthesizer
    );

    return this.queryEngine;
  }

  /**
   * Processes a query and returns a streaming response
   * @param {string} query - The query to process
   * @param {string} systemPrompt - System prompt for context
   * @returns {AsyncGenerator} Stream of response chunks
   * @throws {Error} If query processing fails
   */
  async *streamingQuery(query, systemPrompt) {
    try {
      if (!this.queryEngine) {
        throw new Error("Query engine not initialized");
      }

      // First check if we get any relevant results
      const testResults = await this.retriever.retrieve(query);
      testResults.map((result) => {
        console.log(result.node.text);
      });

      if (testResults.length === 0) {
        console.log("No relevant documents found");
        // If no relevant documents found, use direct LLM query
        const llm = this.initializeOpenAI();
        const response = await llm.chat({
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: query,
            },
          ],
          stream: true,
        });

        for await (const chunk of response) {
          yield chunk.delta;
        }
      } else {
        console.log("Relevant documents found");
        // Use RAG with retrieved documents
        const formattedQuery = `[System Prompts: 
          ${systemPrompt}]
          -----------------------------------
          User Query:
              ${query}
          `;

        const response = await this.queryEngine.query({
          query: formattedQuery,
          stream: true,
        });

        for await (const chunk of response) {
          yield chunk.delta;
        }
      }
    } catch (error) {
      console.error("Streaming query error:", error);
      throw error;
    }
  }

  /**
   * Processes a direct LLM query without retrieval
   * @param {string} query - The query to process
   * @param {string} systemPrompt - System prompt for context
   * @returns {AsyncGenerator} Stream of response chunks
   * @throws {Error} If query processing fails
   */
  async *directLLMQuery(query, systemPrompt) {
    try {
      const llm = this.initializeOpenAI();
      const response = await llm.chat({
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: query,
          },
        ],
        stream: true,
      });

      for await (const chunk of response) {
        yield chunk.delta;
      }
    } catch (error) {
      console.error("Direct LLM query error:", error);
      throw error;
    }
  }
}

/**
 * WUP-858: Agent Recommendation Service using RAG-based similarity search
 * Provides intelligent agent recommendations based on user queries using Pinecone vector DB
 */

import { Pinecone } from "@pinecone-database/pinecone";
import { OpenAIEmbedding } from "llamaindex";
import { config } from "dotenv";

// Load environment variables
config();

/**
 * Agent Recommendation Service Class
 * Handles semantic search and similarity matching for agent recommendations
 */
export class AgentRecommendationService {
  constructor(stage = process.env.STAGE || "myenv") {
    this.stage = stage;
    this.indexName = "assistant-recommend";
    this.minSimilarityThreshold = 0.45; // Minimum relevance score
    this.maxResults = 3; // Top 3 recommendations
    
    // Initialize Pinecone client
    this.pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });
    
    // Initialize embedding model (same as existing system)
    this.embeddingModel = new OpenAIEmbedding({
      model: "text-embedding-3-small",
      azure: this.getAzureEmbeddingOptions(),
    });
    
    console.log(`🤖 AgentRecommendationService initialized for environment: ${this.stage}`);
  }

  /**
   * Get Azure OpenAI embedding configuration
   */
  getAzureEmbeddingOptions() {
    return {
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      deployment: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME,
      apiKey: process.env.AZURE_OPENAI_KEY,
    };
  }

  /**
   * Preprocess user query for better matching
   * Handles Turkish and English queries
   * CRITICAL: This should match the same semantic approach used in indexing
   */
  preprocessQuery(query) {
    if (!query || typeof query !== 'string') {
      throw new Error('Query must be a non-empty string');
    }
    
    // Basic query preprocessing - keep natural language structure for semantic matching
    let processedQuery = query.trim();
    
    // Remove extra whitespaces but preserve natural language structure
    processedQuery = processedQuery.replace(/\s+/g, ' ');
    
    // CRITICAL: Convert to lowercase for consistent matching with indexed content
    processedQuery = processedQuery.toLowerCase();
    
    // Handle empty or very short queries
    if (processedQuery.length < 2) {
      throw new Error('Query too short. Please provide at least 2 characters.');
    }
    
    // Handle extremely long queries
    if (processedQuery.length > 500) {
      processedQuery = processedQuery.substring(0, 500);
      console.log('⚠️ Query truncated to 500 characters');
    }
    
    console.log(`🔧 Preprocessed query: "${processedQuery}"`);
    return processedQuery;
  }

  /**
   * Generate embedding for user query
   */
  async generateQueryEmbedding(query) {
    try {
      const processedQuery = this.preprocessQuery(query);
      console.log(`🔤 Generating embedding for query: "${processedQuery.substring(0, 50)}..."`);
      
      const embedding = await this.embeddingModel.getTextEmbedding(processedQuery);
      console.log(`✅ Generated embedding with dimension: ${embedding.length}`);
      
      return embedding;
    } catch (error) {
      console.error('❌ Error generating query embedding:', error);
      throw new Error(`Failed to generate embedding: ${error.message}`);
    }
  }

  /**
   * Perform similarity search in Pinecone
   */
  async performSimilaritySearch(queryEmbedding, topK = 10) {
    try {
      const index = this.pinecone.index(this.indexName);
      
      console.log(`🔍 Performing similarity search in ${this.indexName} (topK: ${topK})`);
      
      const queryRequest = {
        vector: queryEmbedding,
        topK: topK,
        includeMetadata: true,
        includeValues: false,
        filter: {
          environment: this.stage, // Filter by environment for data isolation
        },
      };
      
      const searchResults = await index.query(queryRequest);
      
      console.log(`📊 Found ${searchResults.matches?.length || 0} potential matches`);
      
      return searchResults.matches || [];
    } catch (error) {
      console.error('❌ Error performing similarity search:', error);
      throw new Error(`Similarity search failed: ${error.message}`);
    }
  }

  /**
   * Filter and rank results based on similarity threshold
   */
  filterAndRankResults(matches, showAll = false) {
    if (!matches || matches.length === 0) {
      return [];
    }
    
    // Sort by similarity score (descending) first
    const sortedMatches = matches.sort((a, b) => b.score - a.score);
    
    // Log all scores for debugging
    console.log(`📊 All similarity scores:`);
    sortedMatches.forEach((match, index) => {
      const metadata = match.metadata || {};
      console.log(`   ${index + 1}. ${metadata.name || 'Unknown'}: ${Math.round(match.score * 1000) / 10}% (${match.score.toFixed(4)})`);
    });
    
    if (showAll) {
      // Return all results without threshold filtering
      return sortedMatches.slice(0, 10); // Show top 10
    }
    
    // Filter by minimum similarity threshold
    const filteredMatches = sortedMatches.filter(match => 
      match.score >= this.minSimilarityThreshold
    );
    
    console.log(`🎯 Filtered to ${filteredMatches.length} matches above threshold ${this.minSimilarityThreshold}`);
    
    // Take top results
    const rankedResults = filteredMatches.slice(0, this.maxResults);
    
    return rankedResults;
  }

  /**
   * Get top 3 agents regardless of similarity threshold
   */
  getTop3Agents(matches) {
    if (!matches || matches.length === 0) {
      return [];
    }
    
    // Sort by similarity score (descending)
    const sortedMatches = matches.sort((a, b) => b.score - a.score);
    
    // Log all scores for debugging
    console.log(`📊 All similarity scores:`);
    sortedMatches.forEach((match, index) => {
      const metadata = match.metadata || {};
      console.log(`   ${index + 1}. ${metadata.name || 'Unknown'}: ${Math.round(match.score * 1000) / 10}% (${match.score.toFixed(4)})`);
    });
    
    // Always return top 3 regardless of threshold
    const top3 = sortedMatches.slice(0, 3);
    console.log(`🏆 Selected top 3 agents (no threshold filtering)`);
    
    return top3;
  }

  /**
   * Format agent recommendation response
   */
  formatRecommendationResponse(matches, originalQuery) {
    const recommendations = matches.map(match => {
      const metadata = match.metadata || {};
      
      return {
        agentId: metadata.assistantId || match.id?.replace(`${this.stage}_`, ''),
        name: metadata.name || 'Unknown Agent',
        description: metadata.description || 'No description available',
        category: metadata.category || 'General',
        keywords: metadata.keywords || [],
        relevanceScore: Math.round(match.score * 100) / 100, // Round to 2 decimal places
        environment: metadata.environment || this.stage,
      };
    });
    
    return {
      query: originalQuery,
      totalFound: recommendations.length,
      recommendations: recommendations,
      searchMetadata: {
        environment: this.stage,
        similarityThreshold: this.minSimilarityThreshold,
        maxResults: this.maxResults,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Get fallback recommendations when no agents meet threshold
   */
  async getFallbackRecommendations() {
    console.log('🔄 Providing fallback recommendations');
    
    try {
      const index = this.pinecone.index(this.indexName);
      
      // Get random sample of agents from the same environment
      const fallbackQuery = {
        vector: new Array(1536).fill(0), // Zero vector for random sampling
        topK: 5,
        includeMetadata: true,
        includeValues: false,
        filter: {
          environment: this.stage,
        },
      };
      
      const fallbackResults = await index.query(fallbackQuery);
      const fallbackMatches = fallbackResults.matches?.slice(0, 3) || [];
      
      // Set low relevance scores for fallback results
      const fallbackWithScores = fallbackMatches.map(match => ({
        ...match,
        score: 0.5, // Low score to indicate fallback
      }));
      
      return this.formatRecommendationResponse(fallbackWithScores, 'fallback');
    } catch (error) {
      console.error('❌ Error getting fallback recommendations:', error);
      return {
        query: 'fallback',
        totalFound: 0,
        recommendations: [],
        searchMetadata: {
          environment: this.stage,
          similarityThreshold: this.minSimilarityThreshold,
          maxResults: this.maxResults,
          timestamp: new Date().toISOString(),
          error: 'Fallback recommendations failed',
        },
      };
    }
  }

  /**
   * Get all recommendations without threshold filtering (for debugging)
   */
  async getAllRecommendations(query) {
    const startTime = Date.now();
    
    try {
      console.log(`🚀 Starting DEBUG agent recommendation for query: "${query}"`);
      
      // Step 1: Generate query embedding
      const queryEmbedding = await this.generateQueryEmbedding(query);
      
      // Step 2: Perform similarity search
      const matches = await this.performSimilaritySearch(queryEmbedding);
      
      // Step 3: Get all results without filtering
      const allMatches = this.filterAndRankResults(matches, true);
      
      // Step 4: Format response with all results
      const finalResponse = this.formatRecommendationResponse(allMatches, query);
      finalResponse.isFallback = false;
      finalResponse.debug = true;
      finalResponse.note = "All results shown without threshold filtering";
      
      // Add performance metrics
      const endTime = Date.now();
      finalResponse.searchMetadata.responseTimeMs = endTime - startTime;
      
      console.log(`✅ DEBUG Agent recommendation completed in ${endTime - startTime}ms`);
      console.log(`📋 Returning ${finalResponse.totalFound} recommendations (all results)`);
      
      return finalResponse;
      
    } catch (error) {
      console.error('💥 DEBUG Agent recommendation failed:', error);
      
      const endTime = Date.now();
      return {
        query: query,
        totalFound: 0,
        recommendations: [],
        error: error.message,
        isFallback: false,
        debug: true,
        searchMetadata: {
          environment: this.stage,
          similarityThreshold: this.minSimilarityThreshold,
          maxResults: this.maxResults,
          timestamp: new Date().toISOString(),
          responseTimeMs: endTime - startTime,
          error: error.message,
        },
      };
    }
  }

  /**
   * Main method to get agent recommendations
   */
  async getRecommendations(query) {
    const startTime = Date.now();
    
    try {
      console.log(`🚀 Starting agent recommendation for query: "${query}"`);
      
      // Step 1: Generate query embedding
      const queryEmbedding = await this.generateQueryEmbedding(query);
      
      // Step 2: Perform similarity search
      const matches = await this.performSimilaritySearch(queryEmbedding);
      
      // Step 3: Always return top 3 agents regardless of similarity threshold
      const topMatches = this.getTop3Agents(matches);
      
      // Step 4: Format response with top results
      const finalResponse = this.formatRecommendationResponse(topMatches, query);
      finalResponse.isFallback = false;
      
      // Add performance metrics
      const endTime = Date.now();
      finalResponse.searchMetadata.responseTimeMs = endTime - startTime;
      
      console.log(`✅ Agent recommendation completed in ${endTime - startTime}ms`);
      console.log(`📋 Returning ${finalResponse.totalFound} recommendations`);
      
      return finalResponse;
      
    } catch (error) {
      console.error('💥 Agent recommendation failed:', error);
      
      const endTime = Date.now();
      return {
        query: query,
        totalFound: 0,
        recommendations: [],
        error: error.message,
        isFallback: false,
        searchMetadata: {
          environment: this.stage,
          similarityThreshold: this.minSimilarityThreshold,
          maxResults: this.maxResults,
          timestamp: new Date().toISOString(),
          responseTimeMs: endTime - startTime,
          error: error.message,
        },
      };
    }
  }

  /**
   * Update similarity threshold for dynamic tuning
   */
  setSimilarityThreshold(threshold) {
    if (threshold < 0 || threshold > 1) {
      throw new Error('Similarity threshold must be between 0 and 1');
    }
    
    const oldThreshold = this.minSimilarityThreshold;
    this.minSimilarityThreshold = threshold;
    
    console.log(`🎛️ Similarity threshold updated: ${oldThreshold} → ${threshold}`);
  }

  /**
   * Update maximum results count
   */
  setMaxResults(maxResults) {
    if (maxResults < 1 || maxResults > 10) {
      throw new Error('Max results must be between 1 and 10');
    }
    
    const oldMaxResults = this.maxResults;
    this.maxResults = maxResults;
    
    console.log(`🔢 Max results updated: ${oldMaxResults} → ${maxResults}`);
  }

  /**
   * Health check method
   */
  async healthCheck() {
    try {
      const index = this.pinecone.index(this.indexName);
      const stats = await index.describeIndexStats();
      
      return {
        status: 'healthy',
        environment: this.stage,
        indexName: this.indexName,
        vectorCount: stats.totalVectorCount || 0,
        similarityThreshold: this.minSimilarityThreshold,
        maxResults: this.maxResults,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('❌ Health check failed:', error);
      return {
        status: 'unhealthy',
        error: error.message,
        environment: this.stage,
        indexName: this.indexName,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

// Export singleton instance
const recommendationService = new AgentRecommendationService();
export default recommendationService;
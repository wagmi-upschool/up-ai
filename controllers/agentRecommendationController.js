/**
 * WUP-858: Agent Recommendation Controller
 * Handles REST API endpoints for agent recommendations
 */

import recommendationService from "../services/agentRecommendationService.js";

/**
 * POST /api/agents/recommend/debug
 * Get ALL agent recommendations without threshold filtering (for debugging)
 */
export async function handleAgentRecommendationDebug(req, res) {
  const startTime = Date.now();
  
  try {
    // Extract query from request body
    const { query } = req.body;
    
    // Validate request payload
    if (!query) {
      return res.status(400).json({
        success: false,
        error: "Query is required",
        message: "Please provide a query string in the request body",
        timestamp: new Date().toISOString(),
      });
    }
    
    if (typeof query !== 'string') {
      return res.status(400).json({
        success: false,
        error: "Invalid query format",
        message: "Query must be a string",
        timestamp: new Date().toISOString(),
      });
    }
    
    // Log incoming request
    console.log(`🔍 DEBUG Agent recommendation request received:`, {
      query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
      timestamp: new Date().toISOString(),
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    
    // Get ALL recommendations from service (no filtering)
    const recommendations = await recommendationService.getAllRecommendations(query);
    
    // Calculate response time
    const responseTime = Date.now() - startTime;
    
    // Prepare success response
    const response = {
      success: true,
      data: recommendations,
      meta: {
        responseTimeMs: responseTime,
        apiVersion: "1.0",
        endpoint: "/api/agents/recommend/debug",
        timestamp: new Date().toISOString(),
      },
    };
    
    // Log successful response
    console.log(`✅ DEBUG Agent recommendation completed:`, {
      query: query.substring(0, 50) + (query.length > 50 ? '...' : ''),
      totalFound: recommendations.totalFound,
      responseTimeMs: responseTime,
    });
    
    // Return recommendations
    res.status(200).json(response);
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    
    console.error('💥 DEBUG Agent recommendation controller error:', error);
    
    // Return error response
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: "Failed to get debug agent recommendations",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      meta: {
        responseTimeMs: responseTime,
        apiVersion: "1.0",
        endpoint: "/api/agents/recommend/debug",
        timestamp: new Date().toISOString(),
      },
    });
  }
}

/**
 * POST /api/agents/recommend
 * Get agent recommendations based on user query
 */
export async function handleAgentRecommendation(req, res) {
  const startTime = Date.now();
  
  try {
    // Extract query from request body
    const { query } = req.body;
    
    // Validate request payload
    if (!query) {
      return res.status(400).json({
        success: false,
        error: "Query is required",
        message: "Please provide a query string in the request body",
        timestamp: new Date().toISOString(),
      });
    }
    
    if (typeof query !== 'string') {
      return res.status(400).json({
        success: false,
        error: "Invalid query format",
        message: "Query must be a string",
        timestamp: new Date().toISOString(),
      });
    }
    
    // Log incoming request
    console.log(`🔍 Agent recommendation request received:`, {
      query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
      timestamp: new Date().toISOString(),
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    
    // Get recommendations from service
    const recommendations = await recommendationService.getRecommendations(query);
    
    // Calculate response time
    const responseTime = Date.now() - startTime;
    
    // Prepare success response
    const response = {
      success: true,
      data: recommendations,
      meta: {
        responseTimeMs: responseTime,
        apiVersion: "1.0",
        endpoint: "/api/agents/recommend",
        timestamp: new Date().toISOString(),
      },
    };
    
    // Log successful response
    console.log(`✅ Agent recommendation completed:`, {
      query: query.substring(0, 50) + (query.length > 50 ? '...' : ''),
      totalFound: recommendations.totalFound,
      isFallback: recommendations.isFallback,
      responseTimeMs: responseTime,
    });
    
    // Return recommendations
    res.status(200).json(response);
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    
    console.error('💥 Agent recommendation controller error:', error);
    
    // Return error response
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: "Failed to get agent recommendations",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      meta: {
        responseTimeMs: responseTime,
        apiVersion: "1.0",
        endpoint: "/api/agents/recommend",
        timestamp: new Date().toISOString(),
      },
    });
  }
}

/**
 * GET /api/agents/recommend/health
 * Health check endpoint for the recommendation service
 */
export async function handleHealthCheck(req, res) {
  try {
    console.log('🔍 Health check request received');
    
    const healthStatus = await recommendationService.healthCheck();
    
    const statusCode = healthStatus.status === 'healthy' ? 200 : 503;
    
    res.status(statusCode).json({
      success: healthStatus.status === 'healthy',
      data: healthStatus,
      meta: {
        apiVersion: "1.0",
        endpoint: "/api/agents/recommend/health",
        timestamp: new Date().toISOString(),
      },
    });
    
    console.log(`✅ Health check completed: ${healthStatus.status}`);
    
  } catch (error) {
    console.error('💥 Health check error:', error);
    
    res.status(503).json({
      success: false,
      error: "Health check failed",
      message: "Unable to verify service health",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      meta: {
        apiVersion: "1.0",
        endpoint: "/api/agents/recommend/health",
        timestamp: new Date().toISOString(),
      },
    });
  }
}

/**
 * PUT /api/agents/recommend/config
 * Update recommendation service configuration
 */
export async function handleConfigUpdate(req, res) {
  try {
    const { similarityThreshold, maxResults } = req.body;
    
    console.log('🔧 Configuration update request received:', {
      similarityThreshold,
      maxResults,
    });
    
    // Update similarity threshold if provided
    if (similarityThreshold !== undefined) {
      recommendationService.setSimilarityThreshold(similarityThreshold);
    }
    
    // Update max results if provided
    if (maxResults !== undefined) {
      recommendationService.setMaxResults(maxResults);
    }
    
    res.status(200).json({
      success: true,
      message: "Configuration updated successfully",
      data: {
        similarityThreshold: recommendationService.minSimilarityThreshold,
        maxResults: recommendationService.maxResults,
      },
      meta: {
        apiVersion: "1.0",
        endpoint: "/api/agents/recommend/config",
        timestamp: new Date().toISOString(),
      },
    });
    
    console.log('✅ Configuration updated successfully');
    
  } catch (error) {
    console.error('💥 Configuration update error:', error);
    
    res.status(400).json({
      success: false,
      error: "Configuration update failed",
      message: error.message,
      meta: {
        apiVersion: "1.0",
        endpoint: "/api/agents/recommend/config",
        timestamp: new Date().toISOString(),
      },
    });
  }
}
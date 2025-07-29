/**
 * WUP-858: Agent Recommendation Routes
 * REST API routes for agent recommendation endpoints
 */

import express from "express";
import {
  handleAgentRecommendation,
  handleAgentRecommendationDebug,
  handleHealthCheck,
  handleConfigUpdate,
} from "../controllers/agentRecommendationController.js";

const router = express.Router();

/**
 * POST /api/agents/recommend
 * Get agent recommendations based on user query
 * 
 * Request body:
 * {
 *   "query": "user text query"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "query": "user text query",
 *     "totalFound": 3,
 *     "recommendations": [...],
 *     "isFallback": false,
 *     "searchMetadata": {...}
 *   },
 *   "meta": {...}
 * }
 */
router.post("/recommend", handleAgentRecommendation);

/**
 * POST /api/agents/recommend/debug
 * Get ALL agent recommendations without threshold filtering (for debugging)
 * Shows all similarity scores from high to low
 */
router.post("/recommend/debug", handleAgentRecommendationDebug);

/**
 * GET /api/agents/recommend/health
 * Health check endpoint for the recommendation service
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "status": "healthy",
 *     "environment": "production",
 *     "indexName": "assistant-recommend",
 *     "vectorCount": 22,
 *     "similarityThreshold": 0.7,
 *     "maxResults": 3
 *   }
 * }
 */
router.get("/recommend/health", handleHealthCheck);

/**
 * PUT /api/agents/recommend/config
 * Update recommendation service configuration
 * 
 * Request body:
 * {
 *   "similarityThreshold": 0.8,  // Optional: between 0-1
 *   "maxResults": 5              // Optional: between 1-10
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "message": "Configuration updated successfully",
 *   "data": {
 *     "similarityThreshold": 0.8,
 *     "maxResults": 5
 *   }
 * }
 */
router.put("/recommend/config", handleConfigUpdate);

export default router;
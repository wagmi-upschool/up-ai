# WUP-858 RAG-Based Agent Recommendation System with Vector DB Integration

**Started:** January 27, 2025 at 17:40
**Git Branch:** `WUP-858-rag-based-agent-recommendation-system-with-vector-db-integration`

## Session Overview

Development session for implementing backend RAG-based agent recommendation system using existing vector DB to provide intelligent agent suggestions based on user queries.

## Goals

Based on Jira acceptance criteria:

1. **Vector DB Agent Document Indexing:**
   - Index all agent data as documents in existing vector DB
   - Include agent name, description, category, and relevant keywords
   - Create embeddings for agent metadata using current embedding model
   - Implement document update/refresh mechanism for agent changes

2. **Query Processing System:**
   - Accept user text queries as input
   - Generate embeddings for user queries using same model as agent documents
   - Perform similarity search against agent document collection
   - Return top 3 most relevant agents with similarity scores

3. **Response Format:**
   - Return agent ID, name, description, and relevance score
   - Include similarity threshold filtering (minimum relevance score)
   - Provide fallback mechanism when no agents meet threshold
   - Support both Turkish and English query processing

4. **API Endpoint Implementation:**
   - Create REST endpoint: `POST /api/agents/recommend`
   - Accept JSON payload: `{"query": "user text query"}`
   - Return structured response with top 3 agent recommendations
   - Include error handling and validation

## Jira Context

- **Task:** [WUP-858](https://wagmitech.atlassian.net/browse/WUP-858)
- **Title:** Backend - RAG-Based Agent Recommendation System with Vector DB Integration
- **Status:** To Do
- **Assignee:** Yusuf Erdoğan
- **Priority:** Medium
- **Created:** July 21, 2025

### Key Requirements

- Utilize existing vector DB infrastructure (Pinecone)
- Maintain embedding consistency with current system
- Implement efficient similarity search algorithms
- Support bilingual queries (Turkish/English)
- Performance: <500ms response time, 100+ concurrent queries
- Accuracy: >80% relevance for test queries

### Agent Document Structure
```json
{
  "agent_id": "agent_123",
  "name": "SQL Mentor",
  "description": "Expert database consultant for SQL queries and optimization",
  "category": "Technical",
  "keywords": ["database", "SQL", "queries", "optimization", "data analysis"],
  "embedding": [vector_representation]
}
```

### Test Scenarios
- Technical queries (database, programming, data analysis)
- Soft skills queries (communication, time management, leadership)
- Turkish language queries
- Ambiguous queries and edge cases

## Progress

### Current Tasks
- [ ] Analyze existing vector DB setup and agent data structure
- [ ] Design agent indexing service
- [ ] Implement query embedding generation
- [ ] Create similarity search functionality
- [ ] Build API endpoint with validation
- [ ] Add Turkish/English language support
- [ ] Implement performance optimization
- [ ] Create comprehensive test suite

### Completed
- [x] Jira task analysis and requirements gathering
- [x] Git branch creation and session setup

## Technical Notes

*To be updated as development progresses...*

## Next Steps

1. Explore existing codebase to understand current vector DB integration
2. Identify agent data sources and structure
3. Design the agent recommendation service architecture
4. Begin implementation starting with agent document indexing

### Update - January 27, 2025 at 17:45 PM

**Summary**: Completed assistant indexing system with Turkish keyword extraction fixes

**Git Changes**:
- Added: scripts/indexAssistantsToVectorDB.js (main indexing script)
- Added: scripts/exportAssistantsToJSON.js (read-only data export)
- Added: scripts/clearPineconeIndex.js (vector cleanup script)
- Modified: .claude/sessions/.current-session
- Current branch: WUP-858-rag-based-agent-recommendation-system-with-vector-db-integration (commit: 4a9ab09)

**Todo Progress**: 7 completed, 0 in progress, 1 pending
- ✓ Completed: Check upAssistants table structure and fields using DynamoDB MCP
- ✓ Completed: Analyze userGroups and environment filtering requirements  
- ✓ Completed: Verify Pinecone 'assistant-recommend' index setup
- ✓ Completed: Design assistant data fetching script with env filtering
- ✓ Completed: Plan metadata structure for vector embeddings
- ✓ Completed: Implement OpenAI embedding integration
- ✓ Completed: Create JSON export script with full assistant fields
- ⏳ Pending: Create service for assistant recommendation queries

**Issues Encountered**:
- Turkish keyword extraction producing corrupted text with broken regex patterns
- Over-inclusion of unnecessary fields (temperature, topP, etc.) in JSON exports
- Complex regex failing to properly clean Turkish prompt instructions

**Solutions Implemented**:
- Fixed Turkish keyword extraction with simplified regex approach
- Streamlined JSON export to only include essential fields for embedding
- Created environment-safe Pinecone index clearing functionality
- Successfully indexed 22 assistants from upwagmitec environment
- Integrated with existing Azure OpenAI embedding model (text-embedding-3-small)

**Code Changes Made**:
- `indexAssistantsToVectorDB.js`: Main script with DynamoDB fetching, user group mapping, embedding generation, and Pinecone indexing
- `exportAssistantsToJSON.js`: Read-only export with cleaned metadata structure
- `clearPineconeIndex.js`: Environment-safe vector deletion utility
- All scripts include CRITICAL environment and userGroup filtering for data isolation

**Current Status**: Indexing system functional but keyword extraction still needs refinement for optimal Turkish text processing.

---
*Session active - use `/project:session-update` to update progress*
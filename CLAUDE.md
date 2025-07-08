# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **upwagmitech-rag**, a Node.js-based AI educational assistant system implementing a sophisticated 2-stage RAG (Retrieval-Augmented Generation) pipeline with conversation memory. The system is optimized for Turkish language SQL learning with AWS cloud integration.

## Architecture

### Core Components

**2-Stage RAG Pipeline** (`controllers/whatToAskController.js`):
- **Stage 1**: Document retrieval from Pinecone vector database, initial response generation
- **Stage 2**: Context refinement using conversation history and memory service
- Scenario-based prompts (Role-play, Mentorship, General) loaded from external JSON config
- Turkish language optimization with conversational keyword handling

**Conversation Memory System** (`services/conversationMemoryService.js`):
- WUP-806 memory fix implementation ensuring chronological message ordering
- User profile persistence (skill level, goals, interests detection)
- Topic continuity tracking across sessions
- Token budget optimization for extended conversations
- Eliminates vector similarity filtering issues that caused context loss

**AWS Integration**:
- DynamoDB: Conversation storage (`UpConversationMessage-{stage}`, `UpConversations-{stage}`)
- SQS: Asynchronous processing queues
- Lambda: Serverless function integration
- ECR: Container registry for deployment

### API Endpoints

```
POST /user/:userId/conversation/:conversationId/whatToAsk/stream    # Main 2-stage RAG
POST /user/:userId/conversation/:conversationId/reflection/stream   # Conversation reflection
POST /user/:userId/conversation/:conversationId/chat/stream         # Direct chat
POST /assistant/:assistantId/documents                              # Document upload
```

### Database Schema

**Conversations**: `UpConversations-{stage}`
- Primary Key: `idUpdatedAt` (conversation ID)
- Fields: `userId`, `lastMessage`, `updatedAt`, `title`

**Messages**: `UpConversationMessage-{stage}`
- Primary Key: `conversationId`
- Sort Key: `createdAt` (chronological ordering)
- Fields: `content`, `role`, `userId`, `assistantId`, `metadata`

## Common Commands

### Development
```bash
npm run dev              # Start development server (port 3000)
npm start               # Production start
```

### Testing
```bash
npm run test:memory     # WUP-806 memory persistence tests
npm run test:syntax     # Syntax validation for core files
```

### Docker Deployment
```bash
docker build -t up-ai .
docker run -p 3000:3000 up-ai
```

## Key Configuration

### Environment Variables
- `STAGE`: dev/uat/prod (determines DynamoDB table suffixes)
- `PORT`: Server port (default: 3000)
- `PINECONE_API_KEY`: Vector database access
- `OPENAI_API_KEY`: LLM provider access

### External Configuration
- RAG scenarios loaded from: `https://raw.githubusercontent.com/wagmi-upschool/mobile-texts/refs/heads/main/rag.json`
- Scenario override mechanism via `assistantIds` arrays
- Stage-specific instructions for different interaction types

## Memory System (WUP-806)

The ConversationMemoryService implements critical fixes for conversation continuity:

- **Chronological Retrieval**: Messages retrieved in actual conversation order (not vector similarity)
- **Context Preservation**: Maintains perfect context across 20+ message exchanges
- **Topic Tracking**: Detects and maintains discussion topics automatically
- **User Profile Persistence**: Extracts and remembers skill levels, goals, interests
- **Token Budget Management**: Intelligent context truncation within LLM limits

### Memory Integration
```javascript
const memoryService = new ConversationMemoryService(stage);
const context = await memoryService.getConversationContext(conversationId, 30, 3000);
const promptContext = memoryService.createConversationContextPrompt(context);
```

## Turkish Language Support

- Conversational keyword detection (`conversationalKeywords` array)
- Turkish prompt instructions in all scenarios
- Cultural context awareness in responses
- Educational content optimized for Turkish learners

## Testing Framework

Comprehensive testing for memory persistence:
- Context retrieval validation
- Topic continuity verification  
- User profile extraction tests
- Conversation flow analysis
- Token budget management validation

## Important Files

- `docs/2-step-rag.md`: Comprehensive Turkish documentation of RAG implementation
- `docs/WUP-806-memory-fix-implementation.md`: Memory system architecture and fixes
- `docs/mobile-app-memory-testing-session.md`: Mobile testing validation results
- `services/conversationMemoryService.js`: Core memory implementation
- `controllers/whatToAskController.js`: Main RAG pipeline controller

## AWS Deployment

The system is containerized and designed for AWS cloud deployment:
- Multi-stage Docker builds for optimization
- ECR integration for container registry
- DynamoDB for conversation persistence
- Environment-based configuration for dev/staging/prod

When working with this codebase, prioritize understanding the 2-stage RAG flow and conversation memory system, as these are the core innovations that differentiate this implementation.
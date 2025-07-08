import { ConversationMemoryService } from "../services/conversationMemoryService.js";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

/**
 * Test script for WUP-806 memory persistence validation
 * Tests conversation continuity across multiple exchanges
 */

async function testMemoryPersistence() {
  console.log("🧪 Starting WUP-806 Memory Persistence Tests...\n");

  const memoryService = new ConversationMemoryService(process.env.STAGE || 'dev');
  
  // Test conversation IDs (use existing conversations from your system)
  const testConversations = [
    "test-conversation-1", // Replace with actual conversation IDs
    "test-conversation-2",
    "test-conversation-3"
  ];

  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };

  for (const conversationId of testConversations) {
    await testConversationMemory(memoryService, conversationId, results);
  }

  // Summary
  console.log("\n📊 Test Results Summary:");
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`📈 Success Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);

  if (results.failed > 0) {
    console.log("\n❌ Failed Tests:");
    results.tests.filter(t => !t.passed).forEach(test => {
      console.log(`   - ${test.name}: ${test.error}`);
    });
  }

  return results.failed === 0;
}

async function testConversationMemory(memoryService, conversationId, results) {
  console.log(`🔍 Testing conversation: ${conversationId}`);

  try {
    // Test 1: Basic Context Retrieval
    const test1 = await testBasicContextRetrieval(memoryService, conversationId);
    recordTestResult(results, `${conversationId} - Basic Context Retrieval`, test1);

    // Test 2: Topic Continuity Detection
    const test2 = await testTopicContinuity(memoryService, conversationId);
    recordTestResult(results, `${conversationId} - Topic Continuity`, test2);

    // Test 3: User Profile Persistence
    const test3 = await testUserProfilePersistence(memoryService, conversationId);
    recordTestResult(results, `${conversationId} - User Profile Persistence`, test3);

    // Test 4: Conversation Flow Analysis
    const test4 = await testConversationFlow(memoryService, conversationId);
    recordTestResult(results, `${conversationId} - Conversation Flow`, test4);

    // Test 5: Memory Optimization
    const test5 = await testMemoryOptimization(memoryService, conversationId);
    recordTestResult(results, `${conversationId} - Memory Optimization`, test5);

  } catch (error) {
    console.log(`❌ Error testing ${conversationId}: ${error.message}`);
    recordTestResult(results, `${conversationId} - General Error`, { 
      passed: false, 
      error: error.message 
    });
  }

  console.log(""); // Add spacing between conversations
}

async function testBasicContextRetrieval(memoryService, conversationId) {
  try {
    const context = await memoryService.getConversationContext(conversationId, 20, 2000);
    
    // Validate basic structure
    if (!context.conversationId || !context.messages || !context.context) {
      return { passed: false, error: "Missing basic context structure" };
    }

    // Check if messages are in chronological order
    if (context.messages.length > 1) {
      for (let i = 1; i < context.messages.length; i++) {
        const prevTime = new Date(context.messages[i-1].timestamp);
        const currTime = new Date(context.messages[i].timestamp);
        if (currTime < prevTime) {
          return { passed: false, error: "Messages not in chronological order" };
        }
      }
    }

    console.log(`   ✅ Basic context retrieval: ${context.messages.length} messages, ${context.metadata.tokenEstimate} tokens`);
    return { passed: true };

  } catch (error) {
    return { passed: false, error: error.message };
  }
}

async function testTopicContinuity(memoryService, conversationId) {
  try {
    const context = await memoryService.getConversationContext(conversationId);
    
    // Check if topic tracking is working
    const { currentTopic, topicHistory } = context.context;
    
    if (!currentTopic) {
      return { passed: false, error: "No current topic detected" };
    }

    // Validate topic structure
    if (!currentTopic.topic || currentTopic.confidence === undefined) {
      return { passed: false, error: "Invalid topic structure" };
    }

    // Check topic history
    if (Array.isArray(topicHistory)) {
      console.log(`   ✅ Topic continuity: Current topic '${currentTopic.topic}' (${currentTopic.confidence}), ${topicHistory.length} topic segments`);
      return { passed: true };
    }

    return { passed: false, error: "Invalid topic history structure" };

  } catch (error) {
    return { passed: false, error: error.message };
  }
}

async function testUserProfilePersistence(memoryService, conversationId) {
  try {
    const context = await memoryService.getConversationContext(conversationId);
    const { userProfile } = context.context;
    
    if (!userProfile) {
      return { passed: false, error: "No user profile found" };
    }

    // Check profile structure
    const requiredFields = ['preferences', 'skillLevel', 'goals', 'interests'];
    for (const field of requiredFields) {
      if (!(field in userProfile)) {
        return { passed: false, error: `Missing user profile field: ${field}` };
      }
    }

    const profileInfo = {
      skillLevel: userProfile.skillLevel?.level || 'unknown',
      goals: userProfile.goals?.length || 0,
      interests: userProfile.interests?.length || 0
    };

    console.log(`   ✅ User profile persistence: Level=${profileInfo.skillLevel}, Goals=${profileInfo.goals}, Interests=${profileInfo.interests}`);
    return { passed: true };

  } catch (error) {
    return { passed: false, error: error.message };
  }
}

async function testConversationFlow(memoryService, conversationId) {
  try {
    const context = await memoryService.getConversationContext(conversationId);
    const { conversationFlow } = context.context;
    
    if (!conversationFlow) {
      return { passed: false, error: "No conversation flow data" };
    }

    // Check required flow fields
    if (!conversationFlow.phase || !conversationFlow.lastInteraction) {
      return { passed: false, error: "Missing conversation flow fields" };
    }

    // Validate message pattern detection
    if (context.messages.length > 5 && !conversationFlow.messagePattern) {
      return { passed: false, error: "Message pattern not detected for long conversation" };
    }

    console.log(`   ✅ Conversation flow: Phase=${conversationFlow.phase}, Interaction=${conversationFlow.lastInteraction}, Pattern=${conversationFlow.messagePattern || 'N/A'}`);
    return { passed: true };

  } catch (error) {
    return { passed: false, error: error.message };
  }
}

async function testMemoryOptimization(memoryService, conversationId) {
  try {
    // Test with different token limits
    const context1 = await memoryService.getConversationContext(conversationId, 50, 1000);
    const context2 = await memoryService.getConversationContext(conversationId, 50, 3000);
    
    // Verify token budgets are respected
    if (context1.metadata.tokenEstimate > 1000) {
      return { passed: false, error: `Token budget exceeded: ${context1.metadata.tokenEstimate} > 1000` };
    }

    if (context2.metadata.tokenEstimate > 3000) {
      return { passed: false, error: `Token budget exceeded: ${context2.metadata.tokenEstimate} > 3000` };
    }

    // Verify optimization is working (context2 should have more messages if available)
    if (context1.messages.length === context2.messages.length && context1.metadata.tokenEstimate < 500) {
      console.log(`   ⚠️  Memory optimization: May not be utilizing full token budget`);
    }

    console.log(`   ✅ Memory optimization: 1K limit=${context1.messages.length} msgs (${context1.metadata.tokenEstimate} tokens), 3K limit=${context2.messages.length} msgs (${context2.metadata.tokenEstimate} tokens)`);
    return { passed: true };

  } catch (error) {
    return { passed: false, error: error.message };
  }
}

function recordTestResult(results, testName, result) {
  results.tests.push({ name: testName, ...result });
  if (result.passed) {
    results.passed++;
  } else {
    results.failed++;
    console.log(`   ❌ ${testName}: ${result.error}`);
  }
}

// Test conversation context prompt generation
async function testConversationContextPrompt() {
  console.log("🔍 Testing conversation context prompt generation...\n");
  
  const memoryService = new ConversationMemoryService(process.env.STAGE || 'dev');
  
  // Create mock conversation context
  const mockContext = {
    conversationId: "test-123",
    messages: [
      { role: "user", content: "Merhaba, SQL öğrenmek istiyorum", timestamp: "2025-01-01T10:00:00Z" },
      { role: "assistant", content: "Merhaba! SQL öğrenmeye başlayalım. Hangi seviyedesiniz?", timestamp: "2025-01-01T10:01:00Z" },
      { role: "user", content: "Yeni başlayan seviyesindeyim", timestamp: "2025-01-01T10:02:00Z" }
    ],
    context: {
      currentTopic: { topic: "sql", confidence: 0.9, keywords: ["sql", "öğren"] },
      userProfile: { skillLevel: { level: "beginner" }, goals: ["SQL öğrenmek"] },
      conversationFlow: { phase: "learning", lastInteraction: "clarification" }
    }
  };

  const prompt = memoryService.createConversationContextPrompt(mockContext);
  
  console.log("Generated Conversation Context Prompt:");
  console.log("=" * 50);
  console.log(prompt);
  console.log("=" * 50);
  
  // Validate prompt contains key elements
  const requiredElements = [
    '<conversation_context>',
    '<current_topic>',
    '<user_profile>',
    '<conversation_flow>',
    '<topic_continuity_instructions>',
    '<recent_conversation>'
  ];

  let missingElements = [];
  for (const element of requiredElements) {
    if (!prompt.includes(element)) {
      missingElements.push(element);
    }
  }

  if (missingElements.length === 0) {
    console.log("✅ Conversation context prompt generation: All required elements present");
    return true;
  } else {
    console.log(`❌ Missing elements in prompt: ${missingElements.join(', ')}`);
    return false;
  }
}

// Main execution
async function runTests() {
  try {
    console.log("🚀 WUP-806 Memory Persistence Test Suite");
    console.log("==========================================\n");

    // Test 1: Conversation Context Prompt
    const promptTest = await testConversationContextPrompt();
    
    // Test 2: Memory Persistence (requires real data)
    console.log("\n📝 Note: To test with real conversation data, update the testConversations array with actual conversation IDs from your database.\n");
    
    // For demo purposes, test with empty/mock data
    const memoryTest = await testMemoryPersistence();

    console.log("\n🎯 Overall Results:");
    console.log(`Prompt Generation: ${promptTest ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Memory Persistence: ${memoryTest ? '✅ PASS' : '❌ FAIL'}`);

    if (promptTest && memoryTest) {
      console.log("\n🎉 All tests passed! WUP-806 implementation is ready.");
    } else {
      console.log("\n⚠️  Some tests failed. Please review the implementation.");
    }

  } catch (error) {
    console.error("💥 Test execution failed:", error);
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests();
}

export { testMemoryPersistence, testConversationContextPrompt };
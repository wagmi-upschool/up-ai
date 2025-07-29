#!/usr/bin/env node

/**
 * Simple example to test the updated logging functionality
 */

import { runQuickTest } from './tests/agentRecommendationTest.js';

async function testExample() {
  console.log('🧪 Testing simplified logging functionality...\n');
  
  try {
    // Test the query from your example
    const result = await runQuickTest('mülakata hazırlanıyom help plz');
    
    console.log('\n✅ Test completed successfully!');
    console.log('📁 Check the logs/ directory for simplified test-logs-*.json file');
    
    if (result.recommendations?.length > 0) {
      console.log('\n📊 Recommendations found:');
      result.recommendations.forEach((rec, index) => {
        console.log(`  ${index + 1}. ${rec.name} (${(rec.relevanceScore * 100).toFixed(1)}%)`);
      });
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testExample();
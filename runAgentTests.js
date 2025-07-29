#!/usr/bin/env node

/**
 * WUP-858: Agent Recommendation Test Runner
 * CLI script to execute agent recommendation tests with detailed logging
 * 
 * Usage:
 *   node runAgentTests.js                          # Run all tests
 *   node runAgentTests.js --categories technical   # Run specific category
 *   node runAgentTests.js --max 10                 # Limit number of tests
 *   node runAgentTests.js --quick "SQL öğren"      # Quick single test
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runTests, runQuickTest } from './tests/agentRecommendationTest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    categories: null,
    maxTests: null,
    stage: process.env.STAGE || 'myenv',
    quick: null,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--categories':
      case '-c':
        options.categories = args[++i]?.split(',') || null;
        break;
      case '--max':
      case '-m':
        options.maxTests = parseInt(args[++i]) || null;
        break;
      case '--stage':
      case '-s':
        options.stage = args[++i] || options.stage;
        break;
      case '--quick':
      case '-q':
        options.quick = args[++i] || null;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        if (!arg.startsWith('-')) {
          // Treat as quick test query if no --quick flag
          options.quick = arg;
        }
        break;
    }
  }

  return options;
}

// Show help information
function showHelp() {
  console.log(`
🤖 Agent Recommendation Test Runner (WUP-858)

USAGE:
  node runAgentTests.js [OPTIONS]

OPTIONS:
  -c, --categories <list>   Run specific test categories (comma-separated)
                           Available: technical, communicationSkills, productivity,
                           careerDevelopment, personalDevelopment, wellness,
                           learning, salesBusiness, mentoring, noteTaking,
                           lifePlanning, mixedLanguage, ambiguous, edgeCases

  -m, --max <number>       Maximum number of tests to run
  -s, --stage <stage>      Environment stage (myenv, upwagmitec)
  -q, --quick <query>      Run a single quick test with the given query
  -h, --help              Show this help message

EXAMPLES:
  node runAgentTests.js
  node runAgentTests.js --categories technical,productivity --max 20
  node runAgentTests.js --quick "SQL öğrenmek istiyorum"
  node runAgentTests.js --stage upwagmitec

LOGS:
  All test results are automatically saved to the ./logs directory:
  - test-session-<timestamp>.json    # Complete test session data
  - test-logs-<timestamp>.json       # Detailed execution logs
  - test-performance-<timestamp>.json # Performance metrics and analysis

ENVIRONMENT:
  Set STAGE environment variable to control test environment:
  export STAGE=upwagmitec  # For production testing
  export STAGE=myenv       # For UAT testing (default)
`);
}

// Main execution function
async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  console.log('🚀 Agent Recommendation Test Runner Starting...');
  console.log(`📍 Environment: ${options.stage}`);
  console.log(`📂 Logs will be saved to: ${join(process.cwd(), 'logs')}`);
  console.log('');

  try {
    if (options.quick) {
      // Run quick test
      console.log(`⚡ Running quick test for query: "${options.quick}"`);
      const result = await runQuickTest(options.quick, options.stage);
      
      console.log('\n✅ Quick test completed successfully!');
      if (result.recommendations?.length > 0) {
        console.log(`📊 Found ${result.recommendations.length} recommendations:`);
        result.recommendations.forEach((rec, index) => {
          console.log(`  ${index + 1}. ${rec.name} (${(rec.relevanceScore * 100).toFixed(1)}%)`);
        });
      } else {
        console.log('📋 No recommendations found or fallback mode activated');
      }
      
    } else {
      // Run full test suite
      console.log('🎯 Running comprehensive test suite...');
      if (options.categories) {
        console.log(`📂 Categories: ${options.categories.join(', ')}`);
      }
      if (options.maxTests) {
        console.log(`🔢 Max tests: ${options.maxTests}`);
      }
      console.log('');
      
      await runTests({
        categories: options.categories,
        maxTests: options.maxTests,
        stage: options.stage
      });
    }
    
  } catch (error) {
    console.error('\n💥 Test execution failed:');
    console.error(`❌ Error: ${error.message}`);
    
    if (process.env.NODE_ENV === 'development') {
      console.error('\n🔍 Stack trace:');
      console.error(error.stack);
    }
    
    console.error('\n💡 Troubleshooting tips:');
    console.error('  • Check your environment variables (PINECONE_API_KEY, AZURE_OPENAI_KEY, etc.)');
    console.error('  • Ensure the agent recommendation service is properly configured');
    console.error('  • Verify your network connection for API calls');
    console.error('  • Check the logs directory for detailed error information');
    
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('\n💥 Uncaught Exception:');
  console.error(error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n💥 Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
  process.exit(1);
});

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main, parseArgs, showHelp };
# Agent Recommendation Testing Guide (WUP-858)

## Overview

Comprehensive testing suite for the RAG-based Agent Recommendation System with detailed logging and JSON result export. The system validates Turkish language query processing, semantic similarity matching, and recommendation accuracy.

## Features

- 🔍 **1000+ Test Scenarios**: Comprehensive coverage across 15+ categories
- 📊 **Detailed Logging**: Real-time colored console output with structured data
- 💾 **JSON Export**: Automatic saving to logs directory with timestamped files
- ⚡ **Performance Tracking**: Response time monitoring and slow query detection
- 🎯 **Smart Validation**: Multi-dimensional scoring (categories, keywords, agents)
- 🌍 **Turkish Language Focus**: All queries converted to Turkish for consistency

## Quick Start

### Run All Tests
```bash
npm run test:agents
```

### Quick Single Test
```bash
npm run test:agents:quick "SQL öğrenmek istiyorum"
# or
node runAgentTests.js --quick "geri bildirim teknikleri"
```

### Category-Specific Testing
```bash
npm run test:agents:technical     # SQL, programming queries
npm run test:agents:communication # Communication skills
npm run test:agents:productivity  # Time management, priorities
```

### Limited Test Run
```bash
npm run test:agents:limited  # Run only 20 tests
node runAgentTests.js --max 10 --categories technical
```

### Production Environment Testing
```bash
npm run test:agents:prod  # Test against upwagmitec environment
```

## Test Categories

### Core Categories
- **technical**: SQL, programming, database queries
- **communicationSkills**: Active listening, feedback, questioning
- **productivity**: Time management, priority setting, energy
- **careerDevelopment**: Interview prep, performance reviews
- **personalDevelopment**: Habits, growth mindset, daily routines
- **wellness**: Meditation, gratitude, stress management
- **learning**: Reading habits, professional development
- **salesBusiness**: Sales conversations, customer relations
- **mentoring**: Guidance, coaching, professional support
- **noteTaking**: Meeting notes, organization, summarization

### Special Categories
- **mixedLanguage**: Turkish-English mixed queries
- **ambiguous**: General improvement requests
- **edgeCases**: Error handling, extreme inputs
- **semanticSimilarity**: Cross-language matching tests
- **contextAware**: Scenario-based queries
- **performance**: Response time validation
- **typos**: Misspelling tolerance
- **informal**: Casual language handling

## Generated Log Files

All results are automatically saved to `./logs/` directory:

### 1. Test Session Data
**File**: `test-session-<timestamp>.json`

```json
{
  "sessionId": "test-session-2024-01-15T10-30-45-abc123",
  "environment": "myenv",
  "totalTests": 150,
  "passedTests": 127,
  "successRate": 0.847,
  "performance": {
    "avgResponseTime": 445,
    "slowQueries": [...],
    "fastQueries": [...]
  },
  "topCategories": [
    ["Teknik Eğitim", 45],
    ["İletişim Becerileri", 32]
  ],
  "topAgents": [
    ["SQL Station: Orion", 15],
    ["Etkin Dinleme", 12]
  ]
}
```

### 2. Detailed Execution Logs
**File**: `test-logs-<timestamp>.json`

```json
[
  {
    "timestamp": "2024-01-15T10:30:45.123Z",
    "level": "INFO",
    "message": "🚀 Starting test 1/150: technical[0]",
    "sessionId": "test-session-..."
  },
  {
    "timestamp": "2024-01-15T10:30:45.567Z",
    "level": "SUCCESS",
    "message": "✅ Test passed: SQL learning query",
    "data": {
      "similarity": 0.724,
      "responseTime": 445
    }
  }
]
```

### 3. Performance Analysis
**File**: `test-performance-<timestamp>.json`

```json
{
  "performance": {
    "avgResponseTime": 445,
    "minResponseTime": 123,
    "maxResponseTime": 1234,
    "slowQueries": [
      {
        "query": "Büyük ölçekli uygulamalar için SQL optimizasyon",
        "responseTime": 1234,
        "scenario": "technical[15]"
      }
    ]
  },
  "categoryDistribution": {
    "Teknik Eğitim": 45,
    "İletişim Becerileri": 32
  }
}
```

## Test Validation Logic

### Scoring System (Weighted)
- **Category Match**: 40% - Does recommended agent category match expected?
- **Keyword Match**: 30% - Are expected keywords found in recommendations?
- **Agent Match**: 30% - Is specific expected agent recommended?

### Pass/Fail Thresholds
- **High Priority Tests**: 70% score required
- **Medium/Low Priority**: 60% score required
- **Minimum Similarity**: 0.3 relevance score (except fallback cases)

### Validation Examples

```javascript
// High priority test - requires 70% score
{
  query: "SQL öğrenmek istiyorum",
  expectedCategories: ["Teknik Eğitim"],
  expectedKeywords: ["SQL", "veritabanı"],
  expectedAgents: ["SQL Station: Orion"],
  priority: "high"
}

// Validation scores:
// ✅ Category match: +40% (Teknik Eğitim found)
// ✅ Keyword match: +30% (SQL keyword found)
// ✅ Agent match: +30% (SQL Station: Orion recommended)
// Final: 100% > 70% threshold → PASS
```

## Performance Monitoring

### Response Time Thresholds
- **Target**: < 500ms
- **Warning**: > 1000ms (logged as slow query)
- **Error**: > 2000ms (performance warning)

### Similarity Score Monitoring
- **Excellent**: > 0.8 (high confidence)
- **Good**: 0.5 - 0.8 (acceptable)
- **Warning**: < 0.5 (low similarity warning)
- **Minimum**: 0.3 (below this triggers failure)

## Advanced Usage

### Custom Test Execution

```javascript
import { AgentRecommendationTestRunner } from './tests/agentRecommendationTest.js';

const runner = new AgentRecommendationTestRunner('myenv');

// Run specific categories with custom limits
const results = await runner.runAllTests(['technical', 'productivity'], 50);

// Analyze results
const successRate = results.filter(r => r.passed).length / results.length;
console.log(`Success rate: ${(successRate * 100).toFixed(1)}%`);
```

### Quick Test Integration

```javascript
import { runQuickTest } from './tests/agentRecommendationTest.js';

const result = await runQuickTest('zaman yönetimi', 'upwagmitec');
console.log(`Found ${result.recommendations.length} recommendations`);
```

## Environment Variables

```bash
# Required for testing
export PINECONE_API_KEY=your_pinecone_key
export AZURE_OPENAI_KEY=your_azure_key
export AZURE_OPENAI_ENDPOINT=your_azure_endpoint
export AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME=text-embedding-3-small

# Environment selection
export STAGE=myenv        # UAT environment (default)
export STAGE=upwagmitec   # Production environment
```

## Troubleshooting

### Common Issues

1. **No recommendations returned**
   - Check Pinecone index status
   - Verify embedding generation
   - Ensure agents are properly indexed

2. **Low similarity scores**
   - Review keyword amplification in indexing
   - Check for Turkish character encoding
   - Validate lowercase processing

3. **Slow response times**
   - Monitor Pinecone API latency
   - Check Azure OpenAI embedding speed
   - Review network connectivity

### Debug Mode

```bash
NODE_ENV=development node runAgentTests.js --quick "test query"
```

This enables:
- Stack trace printing on errors
- Detailed debug logging
- Extended error context

## Integration with CI/CD

### Example GitHub Actions

```yaml
name: Agent Recommendation Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - run: npm install
      - run: npm run test:agents:limited
        env:
          PINECONE_API_KEY: ${{ secrets.PINECONE_API_KEY }}
          AZURE_OPENAI_KEY: ${{ secrets.AZURE_OPENAI_KEY }}
          STAGE: myenv
      
      - name: Upload test results
        uses: actions/upload-artifact@v3
        with:
          name: test-logs
          path: logs/
```

## Success Criteria

- **Overall Success Rate**: ≥ 80% for full test suite
- **High Priority Tests**: ≥ 90% success rate
- **Average Response Time**: < 500ms
- **Error Rate**: < 5%
- **Turkish Language Coverage**: 100% of queries
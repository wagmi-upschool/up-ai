import { runSimpleRAGValidation } from "./ragValidation.js";
import fs from "fs";
import path from "path";

/**
 * WUP-832 Baseline Testing Framework
 * 
 * Conducts significant number of tests using current structure to observe
 * and understand outputs before implementing further changes.
 * 
 * Features:
 * - Multiple test runs with different conversation contexts
 * - Comprehensive output collection and storage
 * - Individual and cumulative analysis
 * - Ranking structure evaluation
 */

const BASELINE_CONFIG = {
  testRuns: 10, // Number of baseline test runs
  outputDir: path.join(process.cwd(), "baseline-outputs"),
  reportDir: path.join(process.cwd(), "baseline-reports"),
  conversationVariations: [
    // Different conversation contexts for testing
    "f98f5c9d-108d-494f-9457-28c27677992a", // Current conversation
    "44613bc7-e0be-4b42-ad0f-a5736b7e0c6b", // Alternative conversation 1
    // Add more conversation IDs as needed
  ]
};

/**
 * Initialize baseline testing directories
 */
function initializeBaselineDirectories() {
  [BASELINE_CONFIG.outputDir, BASELINE_CONFIG.reportDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 Created directory: ${dir}`);
    }
  });
}

/**
 * Save individual test run output
 */
function saveTestRunOutput(runId, testResults, metadata) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `baseline_run_${runId}_${timestamp}.json`;
  const filepath = path.join(BASELINE_CONFIG.outputDir, filename);

  const output = {
    runId,
    timestamp: new Date().toISOString(),
    metadata,
    testResults,
    summary: {
      totalQuestions: testResults.questions?.length || 0,
      successfulResponses: testResults.questions?.filter(q => q.success).length || 0,
      averageFinalScore: testResults.summary?.average_final_score || 0,
      averageSemanticScore: testResults.summary?.average_semantic_score || 0,
      averageSimilarity: testResults.summary?.average_similarity || 0,
      scoreDistribution: {
        excellent: testResults.summary?.scores_8_to_10 || 0,
        good: testResults.summary?.scores_6_to_7 || 0,
        fair: testResults.summary?.scores_4_to_5 || 0,
        poor: testResults.summary?.scores_1_to_3 || 0,
      }
    }
  };

  try {
    fs.writeFileSync(filepath, JSON.stringify(output, null, 2), 'utf8');
    console.log(`💾 Baseline run ${runId} saved: ${filename}`);
    return filepath;
  } catch (error) {
    console.error(`❌ Error saving baseline run ${runId}: ${error.message}`);
    return null;
  }
}

/**
 * Analyze individual test run
 */
function analyzeTestRun(testResults) {
  const questions = testResults.questions || [];
  const analysis = {
    responsePatterns: {},
    factualAccuracyIssues: [],
    numericalAccuracyIssues: [],
    commonErrors: [],
    highPerformingQuestions: [],
    lowPerformingQuestions: []
  };

  questions.forEach((result, index) => {
    if (!result.success) return;

    const finalScore = result.final_score || 0;
    const similarity = result.semantic_evaluation?.similarity || 0;
    const numericalAccuracy = result.semantic_evaluation?.numerical_accuracy || 0;

    // High performing questions (score >= 8)
    if (finalScore >= 8) {
      analysis.highPerformingQuestions.push({
        questionId: result.question.id,
        question: result.question.question,
        finalScore,
        similarity,
        aiEvaluation: result.ai_evaluation?.evaluation
      });
    }

    // Low performing questions (score < 6)
    if (finalScore < 6) {
      analysis.lowPerformingQuestions.push({
        questionId: result.question.id,
        question: result.question.question,
        finalScore,
        similarity,
        issues: result.ai_evaluation?.evaluation,
        coaching: result.ai_evaluation?.coaching
      });
    }

    // Numerical accuracy issues
    if (numericalAccuracy < 0.8) {
      analysis.numericalAccuracyIssues.push({
        questionId: result.question.id,
        expectedAnswer: result.question.expectedAnswer,
        actualResponse: result.response?.content?.substring(0, 200) + "...",
        numericalAccuracy
      });
    }

    // Extract common error patterns from AI evaluation
    if (result.ai_evaluation?.evaluation) {
      const evaluation = result.ai_evaluation.evaluation.toLowerCase();
      if (evaluation.includes('yanlış') || evaluation.includes('hata')) {
        analysis.commonErrors.push({
          questionId: result.question.id,
          errorDescription: result.ai_evaluation.evaluation
        });
      }
    }
  });

  return analysis;
}

/**
 * Generate cumulative analysis report
 */
function generateCumulativeReport(allTestRuns) {
  const report = {
    testRunsSummary: {
      totalRuns: allTestRuns.length,
      totalQuestions: 0,
      totalSuccessfulResponses: 0,
      overallAverageFinalScore: 0,
      overallAverageSemanticScore: 0,
      overallAverageSimilarity: 0
    },
    performanceConsistency: {},
    questionLevelAnalysis: {},
    factualAccuracyTrends: {},
    rankingStructure: {},
    recommendations: []
  };

  // Calculate overall averages
  let totalFinalScores = 0;
  let totalSemanticScores = 0;
  let totalSimilarities = 0;
  let totalValidRuns = 0;

  allTestRuns.forEach(run => {
    if (run.summary.averageFinalScore > 0) {
      totalFinalScores += run.summary.averageFinalScore;
      totalSemanticScores += run.summary.averageSemanticScore;
      totalSimilarities += run.summary.averageSimilarity;
      totalValidRuns++;
    }
    report.testRunsSummary.totalQuestions += run.summary.totalQuestions;
    report.testRunsSummary.totalSuccessfulResponses += run.summary.successfulResponses;
  });

  if (totalValidRuns > 0) {
    report.testRunsSummary.overallAverageFinalScore = totalFinalScores / totalValidRuns;
    report.testRunsSummary.overallAverageSemanticScore = totalSemanticScores / totalValidRuns;
    report.testRunsSummary.overallAverageSimilarity = totalSimilarities / totalValidRuns;
  }

  // Question-level consistency analysis
  const questionPerformance = {};
  allTestRuns.forEach(run => {
    run.testResults.questions?.forEach(result => {
      if (!result.success) return;
      
      const qId = result.question.id;
      if (!questionPerformance[qId]) {
        questionPerformance[qId] = {
          question: result.question.question,
          scores: [],
          similarities: [],
          averageScore: 0,
          consistency: 0
        };
      }
      questionPerformance[qId].scores.push(result.final_score || 0);
      questionPerformance[qId].similarities.push(result.semantic_evaluation?.similarity || 0);
    });
  });

  // Calculate consistency metrics
  Object.keys(questionPerformance).forEach(qId => {
    const qData = questionPerformance[qId];
    qData.averageScore = qData.scores.reduce((a, b) => a + b, 0) / qData.scores.length;
    
    // Calculate standard deviation for consistency
    const variance = qData.scores.reduce((acc, score) => 
      acc + Math.pow(score - qData.averageScore, 2), 0) / qData.scores.length;
    qData.consistency = Math.sqrt(variance);
  });

  report.questionLevelAnalysis = questionPerformance;

  // Generate recommendations based on analysis
  const avgScore = report.testRunsSummary.overallAverageFinalScore;
  if (avgScore < 6) {
    report.recommendations.push("CRITICAL: Overall performance below acceptable threshold. Review prompt structure and evaluation criteria.");
  }
  if (avgScore >= 8) {
    report.recommendations.push("EXCELLENT: System performing well. Consider expanding test coverage.");
  }

  // Find most inconsistent questions
  const inconsistentQuestions = Object.values(questionPerformance)
    .filter(q => q.consistency > 2)
    .sort((a, b) => b.consistency - a.consistency);
  
  if (inconsistentQuestions.length > 0) {
    report.recommendations.push(`INCONSISTENCY DETECTED: ${inconsistentQuestions.length} questions show high variance. Review: ${inconsistentQuestions.slice(0, 3).map(q => `Q${Object.keys(questionPerformance).find(id => questionPerformance[id] === q)}`).join(', ')}`);
  }

  return report;
}

/**
 * Save comprehensive baseline report
 */
function saveBaselineReport(cumulativeReport, individualAnalyses) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `baseline_comprehensive_report_${timestamp}.json`;
  const filepath = path.join(BASELINE_CONFIG.reportDir, filename);

  const comprehensiveReport = {
    reportMetadata: {
      generatedAt: new Date().toISOString(),
      wupTaskReference: "WUP-832",
      description: "Baseline testing to observe current structure outputs before prompt changes",
      testRunsAnalyzed: individualAnalyses.length
    },
    cumulativeAnalysis: cumulativeReport,
    individualRunAnalyses: individualAnalyses,
    definitionOfDone: {
      baselineEstablished: true,
      outputsCollected: true,
      analysisCompleted: true,
      recommendationsGenerated: true,
      readyForPromptUpdates: cumulativeReport.testRunsSummary.overallAverageFinalScore > 0
    }
  };

  try {
    fs.writeFileSync(filepath, JSON.stringify(comprehensiveReport, null, 2), 'utf8');
    console.log(`📊 Comprehensive baseline report saved: ${filename}`);
    
    // Also create a summary markdown file
    const markdownSummary = generateMarkdownSummary(comprehensiveReport);
    const mdFilename = `baseline_summary_${timestamp}.md`;
    const mdFilepath = path.join(BASELINE_CONFIG.reportDir, mdFilename);
    fs.writeFileSync(mdFilepath, markdownSummary, 'utf8');
    console.log(`📝 Markdown summary saved: ${mdFilename}`);
    
    return filepath;
  } catch (error) {
    console.error(`❌ Error saving comprehensive report: ${error.message}`);
    return null;
  }
}

/**
 * Generate markdown summary for easy reading
 */
function generateMarkdownSummary(report) {
  const cum = report.cumulativeAnalysis;
  return `# WUP-832 Baseline Testing Report

## Executive Summary
- **Test Runs Completed**: ${cum.testRunsSummary.totalRuns}
- **Total Questions Tested**: ${cum.testRunsSummary.totalQuestions}
- **Overall Average Score**: ${cum.testRunsSummary.overallAverageFinalScore.toFixed(2)}/10
- **Overall Average Similarity**: ${cum.testRunsSummary.overallAverageSimilarity.toFixed(3)}

## Performance Analysis
${cum.testRunsSummary.overallAverageFinalScore >= 8 ? '✅ **EXCELLENT PERFORMANCE**' : 
  cum.testRunsSummary.overallAverageFinalScore >= 6 ? '⚠️ **ACCEPTABLE PERFORMANCE**' : 
  '❌ **REQUIRES IMPROVEMENT**'}

## Key Findings
${cum.recommendations.map(rec => `- ${rec}`).join('\n')}

## Question Performance
${Object.entries(cum.questionLevelAnalysis).slice(0, 5).map(([id, data]) => 
  `- **Q${id}**: Avg ${data.averageScore.toFixed(1)}/10 (σ=${data.consistency.toFixed(1)})`
).join('\n')}

## Next Steps
- ${report.definitionOfDone.readyForPromptUpdates ? 'Ready for prompt structure updates' : 'Additional baseline testing recommended'}
- Review inconsistent questions for prompt refinement
- Implement ranking structure improvements based on findings

*Generated: ${report.reportMetadata.generatedAt}*
`;
}

/**
 * Run comprehensive baseline testing
 */
async function runBaselineTestingFramework() {
  console.log("🚀 Starting WUP-832 Baseline Testing Framework");
  console.log("=" .repeat(70));
  
  initializeBaselineDirectories();
  
  const allTestRuns = [];
  const individualAnalyses = [];

  for (let runId = 1; runId <= BASELINE_CONFIG.testRuns; runId++) {
    console.log(`\n📊 Starting Baseline Test Run ${runId}/${BASELINE_CONFIG.testRuns}`);
    console.log("-".repeat(50));
    
    try {
      // Run the validation test
      const testResults = await runSimpleRAGValidation();
      
      // Save individual run output
      const metadata = {
        runId,
        timestamp: new Date().toISOString(),
        promptVersion: "WUP-832_enhanced",
        evaluationMethod: "semantic_with_ai_feedback"
      };
      
      const outputPath = saveTestRunOutput(runId, testResults, metadata);
      
      // Analyze this run
      const analysis = analyzeTestRun(testResults);
      individualAnalyses.push({
        runId,
        analysis,
        summary: {
          averageFinalScore: testResults.summary?.average_final_score || 0,
          averageSemanticScore: testResults.summary?.average_semantic_score || 0,
          averageSimilarity: testResults.summary?.average_similarity || 0,
          successfulResponses: testResults.summary?.successful_responses || 0,
          totalQuestions: testResults.summary?.total_questions || 0
        }
      });
      
      allTestRuns.push({
        runId,
        outputPath,
        testResults,
        summary: {
          totalQuestions: testResults.summary?.total_questions || 0,
          successfulResponses: testResults.summary?.successful_responses || 0,
          averageFinalScore: testResults.summary?.average_final_score || 0,
          averageSemanticScore: testResults.summary?.average_semantic_score || 0,
          averageSimilarity: testResults.summary?.average_similarity || 0
        }
      });
      
      console.log(`✅ Run ${runId} completed. Score: ${testResults.summary?.average_final_score?.toFixed(2) || 'N/A'}/10`);
      
      // Wait between runs to avoid rate limits
      if (runId < BASELINE_CONFIG.testRuns) {
        console.log("⏳ Waiting 5 seconds before next run...");
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
    } catch (error) {
      console.error(`❌ Error in baseline run ${runId}: ${error.message}`);
      // Continue with next run
    }
  }

  // Generate cumulative analysis
  console.log("\n📈 Generating cumulative analysis...");
  const cumulativeReport = generateCumulativeReport(allTestRuns);
  
  // Save comprehensive report
  const reportPath = saveBaselineReport(cumulativeReport, individualAnalyses);
  
  // Display final summary
  console.log("\n" + "=".repeat(70));
  console.log("🏆 WUP-832 BASELINE TESTING COMPLETED");
  console.log("=".repeat(70));
  console.log(`📊 Test Runs: ${allTestRuns.length}/${BASELINE_CONFIG.testRuns}`);
  console.log(`📈 Overall Average Score: ${cumulativeReport.testRunsSummary.overallAverageFinalScore.toFixed(2)}/10`);
  console.log(`📉 Overall Average Similarity: ${cumulativeReport.testRunsSummary.overallAverageSimilarity.toFixed(3)}`);
  console.log(`📁 Reports saved to: ${BASELINE_CONFIG.reportDir}`);
  console.log(`📁 Individual outputs: ${BASELINE_CONFIG.outputDir}`);
  
  console.log("\n🎯 Key Recommendations:");
  cumulativeReport.recommendations.forEach(rec => {
    console.log(`   • ${rec}`);
  });
  
  console.log("\n✅ Baseline testing framework completed!");
  console.log("Ready for prompt structure updates as per WUP-832 requirements.");
  
  return {
    cumulativeReport,
    individualAnalyses,
    reportPath,
    definitionOfDone: reportPath !== null
  };
}

// Export for use in other scripts
export { runBaselineTestingFramework, BASELINE_CONFIG };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runBaselineTestingFramework()
    .then((results) => {
      console.log("\n🎉 WUP-832 baseline testing framework execution completed!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Baseline testing failed:", error);
      process.exit(1);
    });
}
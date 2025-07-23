import { QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { createAllConversations } from "../scripts/create_conversations.js";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const dynamoDbClient = new DynamoDBClient({
  region: "us-east-1",
});

/**
 * Parse command line arguments
 */
function parseArguments() {
  const args = process.argv.slice(2);
  const config = {
    userId: "24c844c8-6031-702b-8de2-f521e7104fae",
    assistantId: "0186f1fa-ded1-45ff-a7cf-20d7807ac429", 
    baseUrl: "http://localhost:3005",
    stage: "myenv",
    maxRetries: 3,
    retryDelay: 2000,
    // New parameters for conversation creation
    maxConversations: 20, // --max-count / -m
    maxConversationsToTest: undefined, // --test-count / -t (test all by default)
    preview: false, // --preview / -p
    skipConversationCreation: false, // --skip-create / -s
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--assistant-id':
      case '-a':
        if (nextArg) config.assistantId = nextArg;
        i++;
        break;
      case '--user-id':
      case '-u':
        if (nextArg) config.userId = nextArg;
        i++;
        break;
      case '--stage':
      case '-s':
        if (nextArg) config.stage = nextArg;
        i++;
        break;
      case '--max-count':
      case '-m':
        if (nextArg) config.maxConversations = parseInt(nextArg);
        i++;
        break;
      case '--test-count':
      case '-t':
        if (nextArg) config.maxConversationsToTest = parseInt(nextArg);
        i++;
        break;
      case '--base-url':
      case '-b':
        if (nextArg) config.baseUrl = nextArg;
        i++;
        break;
      case '--preview':
      case '-p':
        config.preview = true;
        break;
      case '--skip-create':
      case '--skip-creation':
        config.skipConversationCreation = true;
        break;
      case '--help':
      case '-h':
        console.log(`
🚀 RAG Validation System - Command Line Options

USAGE:
  node tests/ragValidation.js [options]

OPTIONS:
  -a, --assistant-id <id>     Assistant ID to test (default: 0186f1fa-ded1-45ff-a7cf-20d7807ac429)
  -u, --user-id <id>          User ID for testing (default: 24c844c8-6031-702b-8de2-f521e7104fae)  
  -s, --stage <stage>         DynamoDB stage (default: myenv)
  -m, --max-count <num>       Max conversations to create (default: 20)
  -t, --test-count <num>      Max conversations to test (default: test all created)
  -b, --base-url <url>        RAG system base URL (default: http://localhost:3005)
  -p, --preview               Preview mode - don't create actual conversations
      --skip-create           Skip conversation creation, use existing conversations
  -h, --help                  Show this help message

EXAMPLES:
  # Run with default settings
  node tests/ragValidation.js

  # Create 5 conversations and test only 2 of them
  node tests/ragValidation.js --max-count 5 --test-count 2

  # Test different assistant with custom stage
  node tests/ragValidation.js -a 86804a79-61e4-408a-9623-2eac4b43fe97 -s dev

  # Preview mode (don't create conversations)
  node tests/ragValidation.js --preview --max-count 3

  # Skip conversation creation, test existing conversations
  node tests/ragValidation.js --skip-create --test-count 1
        `);
        process.exit(0);
        break;
    }
  }

  return config;
}

// Parse command line arguments and create CONFIG
const CONFIG = parseArguments();

// Embedding cache for expected answers (they don't change)
const EMBEDDING_CACHE = new Map();

// Banking questions based on "Ticari Müşterilerden Alınabilecek Azami Ücretler" tariff
const BANKING_QUESTIONS = [
  {
    id: 1,
    question:
      "Bir banka ticari krediler için ilk kredi tahsisi (Kredi Tahsis) sırasında azami hangi yüzde oranında ücret alabilir?",
    expectedAnswer: "%0,25 – onaylanan limitin %0,25'i",
    testType: "factual_recall",
    purpose: "Oturumu net bir gerçek bilgi ile başlatın",
  },
  {
    id: 2,
    question:
      "Aynı kredide limit yenileme durumunda uygulanabilecek ücret yüzdesi nedir?",
    expectedAnswer: "%0,125 – yenilenen limitin %0,125'i",
    testType: "short_term_memory",
    purpose: "Soru 1'e yakın; kısa süreli bellek kontrolü",
  },
  {
    id: 3,
    question:
      "Kredi Kullandırım Ücreti (kredi serbest bırakma) azami kaç yüzde olabilir?",
    expectedAnswer:
      "%1,1 – kullandırılan tutarın %1,1'i (≤ 1 yıl vadede yıllıklandırılmış)",
    testType: "topic_continuity",
    purpose: "Aynı alt başlıkta devam",
  },
  {
    id: 4,
    question:
      "Bir şirket İtibar / Niyet / Referans mektubu talep ettiğinde asgari ve azami ücretler nelerdir?",
    expectedAnswer: "Asgari ₺500, azami ₺10 000 (BSMV hariç)",
    testType: "fixed_fee_range",
    purpose: "Düz tutarlı ücret; konu değişmeden hatırlamayı test eder",
  },
  {
    id: 5,
    question:
      "Ekspertiz / Teminat Tesis hizmeti için uygulanabilecek ücret aralığı nedir?",
    expectedAnswer: "₺2 700 – ₺341 000, maliyet + %15'i aşmamak kaydıyla",
    testType: "numerical_accuracy",
    purpose: "Sayısal doğruluk testi",
  },
  {
    id: 6,
    question:
      "Kredi yapılandırma veya faiz oranı değişikliği için azami ücret yüzdesi kaçtır?",
    expectedAnswer: "%5 – kredi tutarı üzerinden yıllık",
    testType: "topic_retention",
    purpose: "Yanlış yönlendirme olmadan konuyu koruması beklenir",
  },
  {
    id: 7,
    question:
      "Müşteri taahhüt edilen krediyi kullanmazsa (Taahhüde Uymama) alınabilecek yıllık azami ücret yüzdesi nedir?",
    expectedAnswer: "%3 – kullanılmayan tutar üzerinden",
    testType: "logical_connection",
    purpose: "Soru 6 ile mantıksal eşleşme",
  },
  {
    id: 8,
    question:
      "Gayrinakdi Kredi – Dönem Ücreti için asgari ücret ve azami yıllık yüzde nedir?",
    expectedAnswer: "Asgari ₺1 000; azami %5 yıllık",
    testType: "topic_coherence",
    purpose: "Aynı bölümde konu bütünlüğünü sürdürür",
  },
  {
    id: 9,
    question:
      "1 Mart 2021'den önce kullandırılmış sabit faizli TL kredilerde (≤ 24 ay kalan) erken kapamada azami erken ödeme ücreti nedir?",
    expectedAnswer: "%1 – kalan anapara üzerinden",
    testType: "date_sensitive_logic",
    purpose: "Tarih duyarlı mantık testi",
  },
  {
    id: 10,
    question:
      "Mobil/İnternet bankacılığından, tutarı ₺6 300'a kadar olan EFT işlemleri için azami ücret ne kadardır?",
    expectedAnswer: "₺6,09 (BSMV hariç)",
    testType: "topic_transition",
    purpose: "Kredi konusundan ödemelere geçiş – konu takibi",
  },
  {
    id: 11,
    question:
      "Aynı kanal ve tutar aralığında yapılan Havale işlemlerinde azami ücret ne kadardır?",
    expectedAnswer: "₺3,05 (BSMV hariç)",
    testType: "concept_differentiation",
    purpose: "Benzer kavram, doğru ayırması beklenir",
  },
  {
    id: 12,
    question:
      "Fiziksel POS cihazı için donanım/yazılım yıllık bakım ücreti azami ne kadardır?",
    expectedAnswer: "₺489 (BSMV hariç)",
    testType: "long_term_memory",
    purpose:
      "Oturumu uzak bir konu ile sonlandırın, uzun vadeli bellek testi için",
  },
];

/**
 * Save results to logs
 */
function saveTestResults(userId, testType, results) {
  const timestamp = new Date();
  const dateStr = timestamp.toISOString().split("T")[0];
  const timeStr = timestamp
    .toISOString()
    .split("T")[1]
    .split(".")[0]
    .replace(/:/g, "-");
  const filename = `${testType}_${userId}_${dateStr}_${timeStr}.json`;
  const logsDir = path.join(process.cwd(), "logs");
  const filepath = path.join(logsDir, filename);

  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const logData = {
    testType,
    userId,
    timestamp: timestamp.toISOString(),
    testConfiguration: CONFIG,
    results,
    metadata: {
      nodeVersion: process.version,
      platform: process.platform,
      testDuration: results.executionTime || "N/A",
    },
  };

  try {
    fs.writeFileSync(filepath, JSON.stringify(logData, null, 2), "utf8");
    console.log(`📁 Results saved to: ${filepath}`);
    return filepath;
  } catch (error) {
    console.error(`❌ Error saving results: ${error.message}`);
    return null;
  }
}

/**
 * Send question to RAG system
 */
async function sendRAGQuestion(question, questionId, conversationId, userInput) {
  const messageId = uuidv4();
  const timestamp = new Date().toISOString();

  // Store user message
  const userMessage = {
    conversationId: conversationId,
    createdAt: timestamp,
    content: `TEST MODUNA GEC ${question}`,
    role: "user",
    userId: CONFIG.userId,
    assistantId: CONFIG.assistantId,
    identifier: messageId,
    type: "default",
    isGptSuitable: true,
    assistantGroupId: "7c68ad5d-6092-4a4a-98bc-235e4553e332",
    userInput: userInput,
  };

  try {
    await dynamoDbClient.send(
      new PutCommand({
        TableName: `UpConversationMessage-${CONFIG.stage}`,
        Item: userMessage,
      })
    );

    console.log(`📡 Question ${questionId}: ${question.substring(0, 80)}...`);

    const response = await fetch(
      `${CONFIG.baseUrl}/user/${CONFIG.userId}/conversation/${conversationId}/whatToAsk/stream`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `TEST MODUNA GEC ${question}`,
          assistantId: CONFIG.assistantId,
          stage: CONFIG.stage,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Request failed: ${response.status} ${response.statusText}`
      );
    }

    // Read streaming response
    let fullContent = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      fullContent += chunk;
      if (chunk.includes("[DONE-UP]")) break;
    }

    const cleanContent = fullContent.replace("[DONE-UP]", "").trim();
    console.log(`✅ Response received (${cleanContent.length} chars)`);

    // Save assistant response to messages table
    if (cleanContent) {
      const assistantMessageId = uuidv4();
      const assistantTimestamp = new Date().toISOString();

      const assistantMessage = {
        conversationId: conversationId,
        createdAt: assistantTimestamp,
        content: cleanContent,
        role: "assistant",
        userId: CONFIG.userId,
        assistantId: CONFIG.assistantId,
        identifier: assistantMessageId,
        type: "default",
        isGptSuitable: true,
        assistantGroupId: "7c68ad5d-6092-4a4a-98bc-235e4553e332",
        userInput: userInput,
        metadata: {
          questionId: questionId,
          testMode: true,
          responseType: "rag_validation",
        },
      };

      try {
        await dynamoDbClient.send(
          new PutCommand({
            TableName: `UpConversationMessage-${CONFIG.stage}`,
            Item: assistantMessage,
          })
        );
        console.log(`💾 Assistant response saved to messages table`);
      } catch (saveError) {
        console.error(
          `⚠️ Failed to save assistant response: ${saveError.message}`
        );
      }

      return {
        success: true,
        content: cleanContent,
        timestamp,
        userMessage,
        assistantMessage,
      };
    }

    return {
      success: true,
      content: cleanContent,
      timestamp,
      userMessage,
    };
  } catch (error) {
    console.error(`❌ Error for question ${questionId}: ${error.message}`);
    return {
      success: false,
      content: "",
      error: error.message,
      timestamp,
      userMessage,
    };
  }
}

/**
 * Generate text embeddings using Azure OpenAI with caching
 */
async function generateEmbedding(text, useCache = true) {
  // Check cache first
  if (useCache && EMBEDDING_CACHE.has(text)) {
    console.log("📋 Using cached embedding");
    return EMBEDDING_CACHE.get(text);
  }

  const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const azureApiKey = process.env.AZURE_OPENAI_KEY;
  const azureApiVersion = "2024-02-15-preview";

  if (!azureEndpoint || !azureApiKey) {
    throw new Error("Missing Azure OpenAI configuration for embeddings");
  }

  try {
    const url = `${azureEndpoint}/openai/deployments/text-embedding-ada-002/embeddings?api-version=${azureApiVersion}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": azureApiKey,
      },
      body: JSON.stringify({
        input: text,
        encoding_format: "float",
      }),
    });

    if (!response.ok) {
      throw new Error(`Azure Embedding API error: ${response.status}`);
    }

    const data = await response.json();
    const embedding = data.data[0].embedding;

    // Cache the result
    if (useCache) {
      EMBEDDING_CACHE.set(text, embedding);
    }

    return embedding;
  } catch (error) {
    console.error("Embedding generation error:", error);
    return null;
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
function calculateCosineSimilarity(vectorA, vectorB) {
  if (!vectorA || !vectorB || vectorA.length !== vectorB.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vectorA.length; i++) {
    dotProduct += vectorA[i] * vectorB[i];
    normA += vectorA[i] * vectorA[i];
    normB += vectorB[i] * vectorB[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Extract numerical values for exact matching
 */
function extractNumericalInfo(text) {
  const info = {
    percentages: [],
    amounts: [],
    hasBSMV: false,
    hasYillik: false,
  };

  // Extract percentages (%, yüzde)
  const percentageRegex = /%?\s*(\d+[,.]?\d*)\s*[%yüzde]/gi;
  let match;
  while ((match = percentageRegex.exec(text)) !== null) {
    info.percentages.push(parseFloat(match[1].replace(",", ".")));
  }

  // Extract amounts (₺, TL, lira)
  const amountRegex = /[₺TL]\s*(\d+[,.]?\d*)|(\d+[,.]?\d*)\s*[₺TLlira]/gi;
  while ((match = amountRegex.exec(text)) !== null) {
    const amount = match[1] || match[2];
    info.amounts.push(parseFloat(amount.replace(",", ".")));
  }

  // Check for BSMV mentions
  info.hasBSMV = /bsmv|bddk|vergi/gi.test(text);

  // Check for yearly mentions
  info.hasYillik = /yıllık|yılda|annual/gi.test(text);

  return info;
}

/**
 * Calculate numerical accuracy score
 */
function calculateNumericalAccuracy(expectedInfo, actualInfo) {
  let score = 0;
  let totalChecks = 0;

  // Check percentage accuracy
  if (expectedInfo.percentages.length > 0) {
    totalChecks++;
    const expectedPercentages = expectedInfo.percentages.sort();
    const actualPercentages = actualInfo.percentages.sort();

    if (expectedPercentages.length === actualPercentages.length) {
      let percentageMatches = 0;
      for (let i = 0; i < expectedPercentages.length; i++) {
        if (Math.abs(expectedPercentages[i] - actualPercentages[i]) < 0.01) {
          percentageMatches++;
        }
      }
      score += percentageMatches / expectedPercentages.length;
    }
  }

  // Check amount accuracy
  if (expectedInfo.amounts.length > 0) {
    totalChecks++;
    const expectedAmounts = expectedInfo.amounts.sort();
    const actualAmounts = actualInfo.amounts.sort();

    if (expectedAmounts.length === actualAmounts.length) {
      let amountMatches = 0;
      for (let i = 0; i < expectedAmounts.length; i++) {
        if (Math.abs(expectedAmounts[i] - actualAmounts[i]) < 1) {
          amountMatches++;
        }
      }
      score += amountMatches / expectedAmounts.length;
    }
  }

  // Check BSMV mention consistency
  if (expectedInfo.hasBSMV || actualInfo.hasBSMV) {
    totalChecks++;
    score += expectedInfo.hasBSMV === actualInfo.hasBSMV ? 1 : 0;
  }

  return totalChecks > 0 ? score / totalChecks : 1;
}

/**
 * Enhanced semantic evaluation with embeddings
 */
async function evaluateWithSemantics(expectedAnswer, actualAnswer) {
  try {
    // Generate embeddings (cache expected answers, don't cache actual answers)
    console.log("🔄 Generating embeddings...");
    const [expectedEmbedding, actualEmbedding] = await Promise.all([
      generateEmbedding(expectedAnswer, true), // Cache expected answer
      generateEmbedding(actualAnswer, false), // Don't cache actual answer
    ]);

    if (!expectedEmbedding || !actualEmbedding) {
      return {
        similarity: 0,
        score: 0,
        numerical_accuracy: 0,
        error: "Failed to generate embeddings",
      };
    }

    // Calculate cosine similarity
    const similarity = calculateCosineSimilarity(
      expectedEmbedding,
      actualEmbedding
    );

    // Extract and compare numerical information
    const expectedInfo = extractNumericalInfo(expectedAnswer);
    const actualInfo = extractNumericalInfo(actualAnswer);
    const numericalAccuracy = calculateNumericalAccuracy(
      expectedInfo,
      actualInfo
    );

    // Convert similarity to score (0-10)
    const semanticScore = Math.round(similarity * 10 * 10) / 10;

    // Weighted score: 70% semantic similarity + 30% numerical accuracy
    const combinedSemanticScore =
      Math.round((similarity * 0.7 + numericalAccuracy * 0.3) * 10 * 10) / 10;

    return {
      similarity: Math.round(similarity * 1000) / 1000,
      score: combinedSemanticScore,
      semantic_score: semanticScore,
      numerical_accuracy: Math.round(numericalAccuracy * 1000) / 1000,
      numerical_info: {
        expected: expectedInfo,
        actual: actualInfo,
      },
      threshold_met: similarity >= 0.6,
    };
  } catch (error) {
    console.error("Semantic evaluation error:", error);
    return {
      similarity: 0,
      score: 0,
      numerical_accuracy: 0,
      error: error.message,
    };
  }
}


/**
 * Semantic-only evaluation with AI feedback (no AI scoring)
 */
async function evaluateWithSemanticSystem(
  question,
  expectedAnswer,
  actualAnswer
) {
  console.log("🔄 Running semantic evaluation with AI feedback...");

  try {
    // Run both evaluations in parallel
    const [aiEvaluation, semanticEvaluation] = await Promise.all([
      evaluateWithAI(question, expectedAnswer, actualAnswer),
      evaluateWithSemantics(expectedAnswer, actualAnswer),
    ]);

    // Use semantic score as the primary score
    const finalScore = semanticEvaluation.score;

    // Determine overall assessment based on semantic score only
    const threshold_met = semanticEvaluation.threshold_met;

    return {
      ai_evaluation: {
        evaluation: aiEvaluation.evaluation,
        coaching: aiEvaluation.coaching,
        full_evaluation: aiEvaluation.full_evaluation,
      },
      semantic_evaluation: semanticEvaluation,
      final_score: finalScore,
      evaluation_breakdown: {
        semantic_score: semanticEvaluation.score,
        similarity: semanticEvaluation.similarity,
        numerical_accuracy: semanticEvaluation.numerical_accuracy,
        scoring_method: "semantic_only",
      },
      threshold_met: threshold_met,
      overall_assessment:
        finalScore >= 8
          ? "EXCELLENT"
          : finalScore >= 6
          ? "GOOD"
          : finalScore >= 4
          ? "FAIR"
          : "NEEDS IMPROVEMENT",
    };
  } catch (error) {
    console.error("Semantic evaluation error:", error);
    return {
      ai_evaluation: {
        evaluation: "AI evaluation failed",
        coaching: "",
        full_evaluation: "",
      },
      semantic_evaluation: { score: 0, similarity: 0, error: error.message },
      final_score: 0,
      error: error.message,
    };
  }
}

/**
 * AI-powered evaluation using Azure OpenAI
 */
async function evaluateWithAI(question, expectedAnswer, actualAnswer) {
  const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const azureApiKey = process.env.AZURE_OPENAI_KEY;
  const azureDeployment = process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME;
  const azureApiVersion = "2024-02-15-preview";

  if (!azureEndpoint || !azureApiKey || !azureDeployment) {
    console.error("❌ Missing Azure OpenAI configuration");
    return {
      score: 0,
      evaluation: "Azure configuration missing",
      full_evaluation: "Missing Azure OpenAI environment variables",
    };
  }

  const evaluationPrompt = `
Sen bir ticari bankacılık uzmanı ve mevzuat denetmenisin. Aşağıdaki müşteri temsilcisi cevabını "SADECE FAKTÜEL DOĞRULUK" açısından değerlendir:

MÜŞTERI SORUSU: ${question}
BEKLENEN YANIT (Resmi Tarife): ${expectedAnswer}
MÜŞTERI TEMSİLCİSİ CEVABI: ${actualAnswer}

FAKTÜEL DOĞRULUK KRİTERLERİ (WUP-832):
1. **RAKAMSAL DOĞRULUK**: Verilen yüzdeler, tutarlar, limitler tam olarak doğru mu?
   - Örn: "%0,25" yerine "%0,3" yazmış mı?
   - Örn: "₺6,09" yerine "₺6,10" yazmış mı?

2. **MEVZUAT UYGUNLUĞU**: "Ticari Müşterilerden Alınabilecek Azami Ücretler" tarifesine birebir uyumluluk
   - BSMV dahil/hariç bilgisi doğru mu?
   - Azami/asgari limitler doğru mu?
   - Vade/tutar aralıkları doğru mu?

3. **SPESİFİK BİLGİ VALİDASYONU**: Özellikle kesin oranlar ve tutarlar için
   - "6300 Lira altındaki nakit yönetimi ücreti nedir?" → "30,46 Lira"
   - Bu tür spesifik bilgiler tam doğru verilmiş mi?

4. **FAKTÜEL TUTARLILIK**: Beklenen yanıt ile gerçek yanıt arasında faktüel fark var mı?
   - Hiçbir sayısal hata tolere edilmez
   - Mevzuat terimlerinde kesinlik şart

**ÖNEMLİ**: Bu değerlendirme SADECE faktüel doğruluğa odaklanır. Dil kalitesi, müşteri deneyimi gibi faktörler değerlendirilmez.

FAKTÜEL DOĞRULUK PUANI: [1-10]
DEĞERLENDİRME: [Sadece faktüel doğruluk açısından kısa açıklama]
KOÇLUK: [Faktüel hatalar için düzeltme önerileri]`;

  try {
    const url = `${azureEndpoint}/openai/deployments/${azureDeployment}/chat/completions?api-version=${azureApiVersion}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": azureApiKey,
      },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content:
              "Sen bir ticari bankacılık uzmanısın ve müşteri temsilcisi yanıtlarını 'Ticari Müşterilerden Alınabilecek Azami Ücretler' tarifesine göre değerlendiriyorsun.",
          },
          { role: "user", content: evaluationPrompt },
        ],
        max_tokens: 800,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      throw new Error(`Azure API error: ${response.status}`);
    }

    const data = await response.json();
    const evaluation = data.choices[0].message.content;

    // Extract score, evaluation, and coaching (updated for WUP-832 prompt structure)
    const scoreMatch = evaluation.match(/\*?\*?FAKTÜEL DOĞRULUK PUANI:\*?\*?\s*(\d+)/) || 
                      evaluation.match(/\*?\*?PUAN:\*?\*?\s*(\d+)/);
    const evalMatch = evaluation.match(/\*?\*?DEĞERLENDİRME:\*?\*?\s*(.+?)(?=\*?\*?KOÇLUK:|$)/s);
    const coachingMatch = evaluation.match(/\*?\*?KOÇLUK:\*?\*?\s*(.+)/s);

    const score = scoreMatch ? parseInt(scoreMatch[1]) : 0;
    const evalText = evalMatch ? evalMatch[1].trim() : evaluation;
    const coaching = coachingMatch ? coachingMatch[1].trim() : "";

    return {
      score,
      evaluation: evalText,
      coaching: coaching,
      full_evaluation: evaluation,
    };
  } catch (error) {
    console.error("AI evaluation error:", error);
    return {
      score: 0,
      evaluation: "AI evaluation failed",
      full_evaluation: error.message,
    };
  }
}

/**
 * Pre-cache embeddings for expected answers
 */
async function preCacheExpectedAnswers() {
  console.log("📋 Pre-caching embeddings for expected answers...");
  const expectedAnswers = BANKING_QUESTIONS.map((q) => q.expectedAnswer);

  // Generate embeddings for all expected answers in parallel
  await Promise.all(
    expectedAnswers.map((answer) => generateEmbedding(answer, true))
  );

  console.log(`✅ Cached ${EMBEDDING_CACHE.size} embeddings`);
}

/**
 * Run simplified RAG validation with conversation creation
 */
async function runSimpleRAGValidation() {
  const startTime = Date.now();

  console.log("🚀 Starting Semantic RAG Validation with Conversation Creation");
  console.log("=".repeat(70));
  console.log(`Assistant ID: ${CONFIG.assistantId}`);
  console.log(`Questions to test: ${BANKING_QUESTIONS.length}`);
  console.log("");

  // Step 1: Create conversations first (if not skipped)
  let createdConversations = [];
  
  if (CONFIG.skipConversationCreation) {
    console.log("📋 Step 1: Skipping conversation creation (using existing conversations)");
    console.log("⚠️  WARNING: This assumes conversations already exist for testing");
    // For now, we'll create a placeholder - in real implementation you'd query existing conversations
    createdConversations = [{
      conversationId: `existing-conversation-${Date.now()}`,
      scenario: { type: "existing", title: "Existing conversation" },
      userInput: "Existing conversation for testing",
      existing: true
    }];
  } else {
    console.log("📋 Step 1: Creating conversations...");
    const options = {
      maxCount: CONFIG.maxConversations,
      stage: CONFIG.stage,
      userId: CONFIG.userId,
      preview: CONFIG.preview
    };
    
    console.log(`📊 Conversation creation options:`);
    console.log(`   • Max conversations: ${options.maxCount}`);
    console.log(`   • Stage: ${options.stage}`);
    console.log(`   • User ID: ${options.userId}`);
    console.log(`   • Preview mode: ${options.preview}`);
    console.log("");
    
    createdConversations = await createAllConversations(CONFIG.assistantId, options);
  }
  
  if (!createdConversations || createdConversations.length === 0) {
    throw new Error("Failed to create conversations for testing");
  }

  console.log(`✅ Created ${createdConversations.length} conversations`);
  console.log("");

  // Apply test count limit if specified
  const conversationsToTest = CONFIG.maxConversationsToTest 
    ? createdConversations.slice(0, CONFIG.maxConversationsToTest)
    : createdConversations;
    
  if (CONFIG.maxConversationsToTest && conversationsToTest.length < createdConversations.length) {
    console.log(`🎯 Testing only ${conversationsToTest.length} out of ${createdConversations.length} created conversations`);
    console.log("");
  }

  // Step 2: Pre-cache expected answer embeddings for performance
  console.log("📋 Step 2: Pre-caching embeddings...");
  await preCacheExpectedAnswers();
  console.log("");

  const results = {
    timestamp: new Date().toISOString(),
    testConfiguration: CONFIG,
    createdConversations: createdConversations.map(conv => ({
      conversationId: conv.conversationId,
      scenario: conv.scenario,
      userInput: conv.userInput
    })),
    conversationResults: [],
    summary: {
      total_conversations: conversationsToTest.length,
      total_questions: BANKING_QUESTIONS.length * conversationsToTest.length,
      successful_responses: 0,
      average_ai_score: 0,
      scores_8_to_10: 0,
      scores_6_to_7: 0,
      scores_4_to_5: 0,
      scores_1_to_3: 0,
    },
  };

  // Step 3: Test each conversation with all questions
  console.log("📋 Step 3: Running RAG validation tests...");
  
  for (let convIndex = 0; convIndex < conversationsToTest.length; convIndex++) {
    const conversation = conversationsToTest[convIndex];
    
    console.log(`\n${"*".repeat(80)}`);
    console.log(`🎯 Testing Conversation ${convIndex + 1}/${conversationsToTest.length}`);
    console.log(`📱 Conversation ID: ${conversation.conversationId}`);
    console.log(`👤 Customer Type: ${conversation.scenario.type}`);
    console.log(`📝 User Input: ${conversation.userInput}`);
    console.log(`${"*".repeat(80)}`);
    
    const conversationResult = {
      conversation: {
        conversationId: conversation.conversationId,
        scenario: conversation.scenario,
        userInput: conversation.userInput
      },
      questions: [],
      summary: {
        successful_responses: 0,
        scores_8_to_10: 0,
        scores_6_to_7: 0,
        scores_4_to_5: 0,
        scores_1_to_3: 0
      }
    };

    // Test each question on this conversation
    for (const question of BANKING_QUESTIONS) {
    console.log(`\n${"=".repeat(50)}`);
    console.log(
      `📋 Question ${question.id}: ${question.question.substring(0, 80)}...`
    );
    console.log(`📖 Expected: ${question.expectedAnswer}`);
    console.log(`🎯 Test Type: ${question.testType}`);
    console.log(`💡 Purpose: ${question.purpose}`);
    console.log(`${"=".repeat(50)}`);

    const questionResult = {
      question,
      response: null,
      ai_evaluation: null,
      success: false,
    };

    try {
      // Send question to RAG
      const response = await sendRAGQuestion(
        question.question, 
        question.id, 
        conversation.conversationId,
        conversation.userInput
      );
      questionResult.response = response;

      if (response.success && response.content) {
        // Semantic evaluation with AI feedback (no AI scoring)
        console.log(`🤖 Running semantic evaluation with AI feedback...`);
        const semanticEval = await evaluateWithSemanticSystem(
          question.question,
          question.expectedAnswer,
          response.content
        );

        questionResult.ai_evaluation = semanticEval.ai_evaluation;
        questionResult.semantic_evaluation = semanticEval.semantic_evaluation;
        questionResult.final_score = semanticEval.final_score;
        questionResult.evaluation_breakdown = semanticEval.evaluation_breakdown;
        questionResult.success = true;

        // Display results
        console.log(
          `📊 Semantic Similarity: ${semanticEval.semantic_evaluation.similarity} (${semanticEval.semantic_evaluation.score}/10)`
        );
        console.log(`🏆 Final Score: ${semanticEval.final_score}/10`);
        console.log(`💭 AI Evaluation: ${semanticEval.ai_evaluation.evaluation}`);

        if (semanticEval.semantic_evaluation.numerical_accuracy !== undefined) {
          console.log(
            `🔢 Numerical Accuracy: ${semanticEval.semantic_evaluation.numerical_accuracy}`
          );
        }

        if (semanticEval.ai_evaluation.coaching) {
          console.log(`🎓 Coaching: ${semanticEval.ai_evaluation.coaching}`);
        }

        console.log(`📈 Assessment: ${semanticEval.overall_assessment}`);

        // Update summary based on semantic score
        results.summary.successful_responses++;
        if (semanticEval.final_score >= 8) results.summary.scores_8_to_10++;
        else if (semanticEval.final_score >= 6)
          results.summary.scores_6_to_7++;
        else if (semanticEval.final_score >= 4)
          results.summary.scores_4_to_5++;
        else results.summary.scores_1_to_3++;
      } else {
        console.log(
          `❌ Failed to get response: ${response.error || "Unknown error"}`
        );
      }
    } catch (error) {
      console.error(`💥 Error in question ${question.id}: ${error.message}`);
      questionResult.error = error.message;
    }

      conversationResult.questions.push(questionResult);

      // Update conversation summary
      if (questionResult.success && questionResult.final_score !== undefined) {
        conversationResult.summary.successful_responses++;
        if (questionResult.final_score >= 8) conversationResult.summary.scores_8_to_10++;
        else if (questionResult.final_score >= 6) conversationResult.summary.scores_6_to_7++;
        else if (questionResult.final_score >= 4) conversationResult.summary.scores_4_to_5++;
        else conversationResult.summary.scores_1_to_3++;
      }

      // Wait between questions
      if (question.id < BANKING_QUESTIONS.length) {
        console.log("⏳ Waiting 3 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    } // End of question loop

    // Add conversation result to main results
    results.conversationResults.push(conversationResult);
    
    console.log(`\n📊 Conversation ${convIndex + 1} Summary:`);
    console.log(`• Questions tested: ${conversationResult.questions.length}`);
    console.log(`• Successful responses: ${conversationResult.summary.successful_responses}`);
    console.log(`• Excellent (8-10): ${conversationResult.summary.scores_8_to_10}`);
    console.log(`• Good (6-7): ${conversationResult.summary.scores_6_to_7}`);
    
    // Wait between conversations
    if (convIndex + 1 < conversationsToTest.length) {
      console.log("⏳ Waiting 5 seconds before next conversation...");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  } // End of conversation loop

  // Calculate final summary from all conversations
  const allQuestions = results.conversationResults.flatMap(conv => conv.questions);
  const validResults = allQuestions.filter(
    (q) => q.success && q.final_score !== undefined
  );
  const validFinalScores = validResults.map((q) => q.final_score);
  const validSemanticScores = validResults.map(
    (q) => q.semantic_evaluation?.score || 0
  );

  // Update overall summary totals
  results.summary.successful_responses = validResults.length;
  results.summary.scores_8_to_10 = results.conversationResults.reduce((sum, conv) => sum + conv.summary.scores_8_to_10, 0);
  results.summary.scores_6_to_7 = results.conversationResults.reduce((sum, conv) => sum + conv.summary.scores_6_to_7, 0);
  results.summary.scores_4_to_5 = results.conversationResults.reduce((sum, conv) => sum + conv.summary.scores_4_to_5, 0);
  results.summary.scores_1_to_3 = results.conversationResults.reduce((sum, conv) => sum + conv.summary.scores_1_to_3, 0);

  if (validFinalScores.length > 0) {
    results.summary.average_final_score =
      validFinalScores.reduce((sum, score) => sum + score, 0) /
      validFinalScores.length;
    results.summary.average_semantic_score =
      validSemanticScores.reduce((sum, score) => sum + score, 0) /
      validSemanticScores.length;

    // Calculate semantic similarity stats
    const validSimilarities = validResults
      .map((q) => q.semantic_evaluation?.similarity || 0)
      .filter((sim) => sim > 0);

    if (validSimilarities.length > 0) {
      results.summary.average_similarity =
        validSimilarities.reduce((sum, sim) => sum + sim, 0) /
        validSimilarities.length;
      results.summary.high_similarity_count = validSimilarities.filter(
        (sim) => sim >= 0.8
      ).length;
      results.summary.threshold_met_count = validResults.filter(
        (q) => q.semantic_evaluation?.threshold_met
      ).length;
    }
  }

  // Display final results
  console.log(`\n${"=".repeat(70)}`);
  console.log("🏆 SEMANTIC RAG VALIDATION RESULTS (WITH AI FEEDBACK)");
  console.log(`${"=".repeat(70)}`);

  console.log(`\n📊 Summary:`);
  console.log(`• Total Conversations: ${results.summary.total_conversations}`);
  console.log(`• Total Questions: ${results.summary.total_questions}`);
  console.log(
    `• Successful Responses: ${results.summary.successful_responses}`
  );

  if (results.summary.average_final_score !== undefined) {
    console.log(
      `• Average Final Score: ${results.summary.average_final_score.toFixed(
        2
      )}/10`
    );
    console.log(
      `• Average Semantic Score: ${results.summary.average_semantic_score.toFixed(
        2
      )}/10`
    );

    if (results.summary.average_similarity !== undefined) {
      console.log(
        `• Average Similarity: ${results.summary.average_similarity.toFixed(3)}`
      );
      console.log(
        `• High Similarity (≥0.8): ${results.summary.high_similarity_count}`
      );
      console.log(
        `• Threshold Met (≥0.6): ${results.summary.threshold_met_count}`
      );
    }
  }

  console.log(`• Excellent (8-10): ${results.summary.scores_8_to_10}`);
  console.log(`• Good (6-7): ${results.summary.scores_6_to_7}`);
  console.log(`• Fair (4-5): ${results.summary.scores_4_to_5}`);
  console.log(`• Poor (1-3): ${results.summary.scores_1_to_3}`);

  console.log(`\n📋 Conversation Results:`);
  results.conversationResults.forEach((convResult, convIndex) => {
    console.log(`\n🎯 Conversation ${convIndex + 1} (${convResult.conversation.scenario.type}):`);
    console.log(`   Conversation ID: ${convResult.conversation.conversationId}`);
    
    convResult.questions.forEach((result, qIndex) => {
      if (result.success && result.final_score !== undefined) {
        const status = result.final_score >= 6 ? "✅" : "⚠️";
        const semanticScore = result.semantic_evaluation?.score || 0;
        const similarity = result.semantic_evaluation?.similarity || 0;

        console.log(
          `   ${status} Q${qIndex + 1}. Final: ${result.final_score}/10 ` +
            `(Semantic: ${semanticScore}/10, Sim: ${similarity.toFixed(
              3
            )}) ` +
            `- ${result.question.question.substring(0, 50)}...`
        );
      } else {
        console.log(
          `   ❌ Q${qIndex + 1}. Failed - ${result.question.question.substring(
            0,
            60
          )}...`
        );
      }
    });
  });

  // Overall grade based on final score
  const avgScore = results.summary.average_final_score || 0;
  const overallGrade =
    avgScore >= 8
      ? "EXCELLENT"
      : avgScore >= 6
      ? "GOOD"
      : avgScore >= 4
      ? "FAIR"
      : "NEEDS IMPROVEMENT";

  console.log(`\n🎯 Overall Grade: ${overallGrade}`);

  const executionTime = Date.now() - startTime;
  results.executionTime = `${executionTime}ms`;
  results.overallGrade = overallGrade;

  console.log(`⏱️ Execution Time: ${executionTime}ms`);
  console.log("✅ Semantic RAG validation completed!");

  return results;
}

// Run the validation
if (import.meta.url === `file://${process.argv[1]}`) {
  runSimpleRAGValidation()
    .then((results) => {
      console.log("\n🎉 Semantic RAG validation completed!");

      // Save results to logs
      const logPath = saveTestResults(
        CONFIG.userId,
        "simpleRAGValidation",
        results
      );
      if (logPath) {
        console.log("💾 Results saved to logs directory.");
      }
    })
    .catch((error) => {
      console.error("💥 Validation failed:", error);
      process.exit(1);
    });
}

export { runSimpleRAGValidation };

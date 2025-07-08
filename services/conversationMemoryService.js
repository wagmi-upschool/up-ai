import { QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { VectorIndexRetriever } from "llamaindex";

const dynamoDbClient = new DynamoDBClient({
  region: "us-east-1",
});

/**
 * ConversationMemoryService - Enhanced for widget-based learning and Turkish language patterns
 * Addresses WUP-806 memory loss issues with improved context tracking
 */
export class ConversationMemoryService {
  constructor(stage = process.env.STAGE, vectorIndex = null) {
    this.stage = stage;
    this.messageTableName = `UpConversationMessage-${stage}`;
    this.vectorIndex = vectorIndex; // Chat messages vector index

    // Enhanced patterns based on results.csv analysis
    this.learningPatterns = {
      skillLevels: {
        beginner: [
          "🌱 yeni başlayan",
          "yeni",
          "başlangıç",
          "temel",
          "sql'e yeni adım",
        ],
        intermediate: [
          "🌟 orta seviye",
          "orta",
          "temelleri biliyorum",
          "ilerlemek istiyorum",
        ],
        advanced: [
          "🔥 ileri seviye",
          "uzmanlaşmaya hazırım",
          "gelişmiş",
          "ileri",
        ],
      },
      learningApproaches: {
        new_content: ["🚀 yeni bilgi ver", "bana yeni bir şey öğret", "yeni"],
        review: [
          "🧠 tekrar yapalım",
          "öğrendiklerimi hatırlamama yardım et",
          "tekrar",
        ],
      },
      struggleIndicators: [
        "bilmiyorum",
        "bilmem",
        "anlamadım",
        "zorlandım",
        "karışık",
        "çok zor",
      ],
      progressIndicators: [
        "harika",
        "mükemmel",
        "doğru",
        "çok iyi",
        "güzel",
        "evet",
      ],
    };
  }

  /**
   * Set vector index for message retrieval (called from controller)
   */
  setVectorIndex(vectorIndex) {
    this.vectorIndex = vectorIndex;
  }

  /**
   * Get recent messages using vector database with metadata filtering
   * This eliminates the need for separate DynamoDB calls
   */
  async getMessagesFromVector(conversationId, limit = 50) {
    if (!this.vectorIndex) {
      console.warn("Vector index not available, falling back to DynamoDB");
      return this.getChronologicalMessages(conversationId, limit);
    }

    try {
      console.log(
        `Fetching messages from vector DB for conversation: ${conversationId}`
      );

      // Create retriever with conversation metadata filter
      const retriever = new VectorIndexRetriever({
        index: this.vectorIndex,
        includeValues: true,
        filters: {
          filters: [
            {
              key: "conversationId",
              value: conversationId,
              operator: "==",
            },
          ],
        },
        similarityTopK: limit, // Get up to limit messages
      });

      // Use a broad query to get all messages for this conversation
      const broadQuery = "conversation message history context";
      const retrievedNodes = await retriever.retrieve(broadQuery);

      if (!retrievedNodes || retrievedNodes.length === 0) {
        console.log("No messages found in vector DB, falling back to DynamoDB");
        return this.getChronologicalMessages(
          conversationId,
          Math.min(limit, 20)
        );
      }

      // Convert vector results to our message format and sort chronologically
      const messages = retrievedNodes
        .map((nodeWithScore) => {
          const node = nodeWithScore.node;
          const metadata = node.metadata || {};

          return {
            id: metadata.messageId || metadata.id || node.id_,
            content: node.text || "",
            role: metadata.role || "user",
            timestamp: metadata.timestamp || metadata.createdAt,
            metadata: {
              messageType: metadata.messageType || "text",
              tokensUsed: metadata.tokensUsed || 0,
              score: nodeWithScore.score || 0,
            },
          };
        })
        .filter((msg) => msg.content && msg.content.trim().length > 0) // Filter out empty messages
        .sort((a, b) => {
          // Sort by timestamp (chronological order)
          const timeA = new Date(a.timestamp).getTime();
          const timeB = new Date(b.timestamp).getTime();
          return timeA - timeB;
        })
        .slice(-limit); // Keep only the most recent messages

      console.log(`Retrieved ${messages.length} messages from vector DB`);
      return messages;
    } catch (error) {
      console.error("Error fetching messages from vector DB:", error);
      console.log("Falling back to DynamoDB");
      return this.getChronologicalMessages(conversationId, Math.min(limit, 20));
    }
  }

  /**
   * Enhanced conversation context with vector-based message retrieval
   */
  async getConversationContext(
    conversationId,
    maxMessages = 30,
    maxTokens = 3000
  ) {
    try {
      console.log(
        `Fetching enhanced conversation context for: ${conversationId}`
      );

      // Get recent messages using vector database (primary) or DynamoDB (fallback)
      const messages = await this.getMessagesFromVector(
        conversationId,
        maxMessages
      );

      // Extract enhanced conversation metadata
      const context = this.extractEnhancedConversationContext(messages);

      // Optimize for token budget with widget awareness
      const optimizedHistory = this.optimizeForTokenBudgetWithWidgets(
        messages,
        maxTokens
      );

      return {
        conversationId,
        messages: optimizedHistory,
        context: {
          currentTopic: context.currentTopic,
          userProfile: context.userProfile,
          conversationFlow: context.conversationFlow,
          topicHistory: context.topicHistory,
          lastUserLevel: context.lastUserLevel,
          widgetSelections: context.widgetSelections,
          learningProgress: context.learningProgress,
          strugglePattern: context.strugglePattern,
          messageCount: messages.length,
        },
        metadata: {
          totalMessages: messages.length,
          retrievedMessages: optimizedHistory.length,
          tokenEstimate: this.estimateTokens(optimizedHistory),
          hasWidgetData: context.widgetSelections.length > 0,
          strugglingUser: context.strugglePattern.isStruggling,
          dataSource: this.vectorIndex ? "vector_db" : "dynamodb", // Track data source
        },
      };
    } catch (error) {
      console.error("Error fetching conversation context:", error);
      return this.getEmptyContext(conversationId);
    }
  }

  /**
   * Create semantic and chronological retrievers for different use cases
   */
  createDualRetrievers(conversationId) {
    if (!this.vectorIndex) {
      return null;
    }

    return {
      // Semantic retriever for context-aware queries
      semantic: new VectorIndexRetriever({
        index: this.vectorIndex,
        includeValues: true,
        filters: {
          filters: [
            {
              key: "conversationId",
              value: conversationId,
              operator: "==",
            },
          ],
        },
        similarityTopK: 5, // Get most relevant messages
      }),

      // Chronological retriever for full conversation context
      chronological: new VectorIndexRetriever({
        index: this.vectorIndex,
        includeValues: true,
        filters: {
          filters: [
            {
              key: "conversationId",
              value: conversationId,
              operator: "==",
            },
          ],
        },
        similarityTopK: 30, // Get more messages for full context
      }),
    };
  }

  /**
   * Get recent messages in chronological order (newest first)
   */
  async getChronologicalMessages(conversationId, limit = 20) {
    const params = {
      TableName: this.messageTableName,
      KeyConditionExpression: "conversationId = :conversationId",
      ExpressionAttributeValues: {
        ":conversationId": conversationId,
      },
      ScanIndexForward: false, // Get newest first
      Limit: limit,
    };

    try {
      const command = new QueryCommand(params);
      const result = await dynamoDbClient.send(command);

      if (result.Items && result.Items.length > 0) {
        // Reverse to get chronological order (oldest first)
        return result.Items.reverse().map((item) => ({
          id: item.id,
          content: item.content || item.message || "",
          role: item.role || "user",
          timestamp: item.createdAt || item.timestamp,
          metadata: {
            messageType: item.messageType || "text",
            tokensUsed: item.tokensUsed || 0,
          },
        }));
      }

      return [];
    } catch (error) {
      console.error("Error fetching chronological messages:", error);
      return [];
    }
  }

  /**
   * Extract conversation context and metadata
   */
  extractConversationContext(messages) {
    if (!messages || messages.length === 0) {
      return this.getEmptyContextData();
    }

    const context = {
      currentTopic: null,
      userProfile: {
        preferences: {},
        skillLevel: null,
        goals: [],
      },
      conversationFlow: {
        phase: "active",
        lastInteraction: "unknown",
      },
      topicHistory: [],
      lastUserLevel: null,
    };

    // Analyze recent messages for current topic and user profile
    const recentMessages = messages.slice(-10); // Last 10 messages

    // Extract current topic from recent exchanges
    context.currentTopic = this.extractCurrentTopic(recentMessages);

    // Extract user profile information
    context.userProfile = this.extractUserProfile(messages);

    // Track topic progression
    context.topicHistory = this.extractTopicHistory(messages);

    // Determine conversation flow
    context.conversationFlow = this.analyzeConversationFlow(recentMessages);

    return context;
  }

  /**
   * Enhanced conversation context extraction with widget data and learning patterns
   */
  extractEnhancedConversationContext(messages) {
    if (!messages || messages.length === 0) {
      return this.getEnhancedEmptyContextData();
    }

    const context = {
      currentTopic: null,
      userProfile: {
        preferences: {},
        skillLevel: null,
        goals: [],
        learningApproach: null,
      },
      conversationFlow: {
        phase: "active",
        lastInteraction: "unknown",
      },
      topicHistory: [],
      lastUserLevel: null,
      widgetSelections: [],
      learningProgress: {
        conceptsLearned: [],
        strugglingWith: [],
        masteredTopics: [],
      },
      strugglePattern: {
        isStruggling: false,
        struggleCount: 0,
        lastStruggleMessage: null,
        needsHelp: false,
      },
    };

    // Analyze recent messages for current topic and user profile
    const recentMessages = messages.slice(-15); // More context for enhanced analysis

    // Extract enhanced topic information
    context.currentTopic = this.extractEnhancedCurrentTopic(recentMessages);

    // Extract enhanced user profile with learning preferences
    context.userProfile = this.extractEnhancedUserProfile(messages);

    // Track topic progression with learning outcomes
    context.topicHistory = this.extractEnhancedTopicHistory(messages);

    // Analyze conversation flow with struggle patterns
    context.conversationFlow =
      this.analyzeEnhancedConversationFlow(recentMessages);

    // Extract widget selections for preference tracking
    context.widgetSelections = this.extractWidgetSelections(messages);

    // Analyze learning progress and struggles
    context.learningProgress = this.analyzeLearningProgress(messages);
    context.strugglePattern = this.analyzeStrugglePattern(recentMessages);

    return context;
  }

  /**
   * Extract current discussion topic from recent messages
   */
  extractCurrentTopic(recentMessages) {
    // Look for topic indicators in recent messages
    const topicKeywords = {
      sql: ["sql", "join", "select", "database", "query", "tablo"],
      javascript: ["javascript", "js", "function", "variable", "array"],
      python: ["python", "def", "list", "dictionary", "pandas"],
      general: ["öğren", "anla", "açıkla", "sorular"],
    };

    for (const message of recentMessages.slice(-5)) {
      // Check last 5 messages
      const content = message.content.toLowerCase();

      for (const [topic, keywords] of Object.entries(topicKeywords)) {
        if (keywords.some((keyword) => content.includes(keyword))) {
          return {
            topic,
            confidence: 0.8,
            detectedIn: message.id,
            keywords: keywords.filter((k) => content.includes(k)),
          };
        }
      }
    }

    return {
      topic: "general",
      confidence: 0.3,
      detectedIn: null,
      keywords: [],
    };
  }

  /**
   * Extract user profile information from conversation history
   */
  extractUserProfile(messages) {
    const profile = {
      preferences: {},
      skillLevel: null,
      goals: [],
      interests: [],
    };

    // Look for level indicators
    const levelPatterns = {
      beginner: ["yeni başlayan", "yeni", "başlangıç", "temel"],
      intermediate: ["orta", "orta seviye", "ara"],
      advanced: ["ileri", "ileri seviye", "gelişmiş"],
    };

    for (const message of messages) {
      if (message.role === "user") {
        const content = message.content.toLowerCase();

        // Check for level mentions
        for (const [level, patterns] of Object.entries(levelPatterns)) {
          if (patterns.some((pattern) => content.includes(pattern))) {
            profile.skillLevel = {
              level,
              confidence: 0.9,
              detectedAt: message.timestamp,
            };
            break;
          }
        }

        // Extract goals and interests
        if (
          content.includes("öğrenmek istiyorum") ||
          content.includes("hedefim")
        ) {
          profile.goals.push({
            goal: content,
            timestamp: message.timestamp,
          });
        }
      }
    }

    return profile;
  }

  /**
   * Track topic progression throughout conversation
   */
  extractTopicHistory(messages) {
    const topicHistory = [];
    let currentTopicSegment = null;

    for (const message of messages) {
      const messageTopics = this.extractCurrentTopic([message]);

      if (messageTopics.topic !== "general" && messageTopics.confidence > 0.5) {
        if (
          !currentTopicSegment ||
          currentTopicSegment.topic !== messageTopics.topic
        ) {
          // New topic segment
          if (currentTopicSegment) {
            currentTopicSegment.endedAt = message.timestamp;
            topicHistory.push(currentTopicSegment);
          }

          currentTopicSegment = {
            topic: messageTopics.topic,
            startedAt: message.timestamp,
            messageCount: 1,
            keywords: messageTopics.keywords,
          };
        } else {
          // Continue current topic
          currentTopicSegment.messageCount++;
          currentTopicSegment.keywords = [
            ...new Set([
              ...currentTopicSegment.keywords,
              ...messageTopics.keywords,
            ]),
          ];
        }
      }
    }

    // Close final segment
    if (currentTopicSegment) {
      topicHistory.push(currentTopicSegment);
    }

    return topicHistory;
  }

  /**
   * Enhanced current topic extraction with better SQL learning context
   */
  extractEnhancedCurrentTopic(recentMessages) {
    // Enhanced topic keywords for SQL learning context
    const topicKeywords = {
      sql_basics: [
        "sql",
        "veritabanı",
        "database",
        "tablo",
        "select",
        "sorgu",
        "query",
      ],
      sql_joins: [
        "join",
        "inner join",
        "left join",
        "right join",
        "birleştir",
        "eşleş",
      ],
      sql_grouping: ["group by", "gruplama", "count", "sum", "toplam", "sayı"],
      sql_advanced: [
        "window function",
        "pencere fonksiyonu",
        "row_number",
        "rank",
        "subquery",
      ],
      learning_meta: [
        "seviye",
        "level",
        "öğren",
        "anla",
        "açıkla",
        "örnek",
        "nasıl",
      ],
    };

    for (const message of recentMessages.slice(-7)) {
      // Check last 7 messages
      const content = message.content.toLowerCase();

      for (const [topic, keywords] of Object.entries(topicKeywords)) {
        const matchedKeywords = keywords.filter((keyword) =>
          content.includes(keyword)
        );
        if (matchedKeywords.length > 0) {
          return {
            topic,
            confidence: Math.min(0.9, 0.5 + matchedKeywords.length * 0.15),
            detectedIn: message.id,
            keywords: matchedKeywords,
            sqlContext: topic.startsWith("sql_"),
            lastMentioned: message.timestamp,
          };
        }
      }
    }

    return {
      topic: "general",
      confidence: 0.3,
      detectedIn: null,
      keywords: [],
      sqlContext: false,
      lastMentioned: null,
    };
  }

  /**
   * Enhanced user profile extraction with learning preferences and widget selections
   */
  extractEnhancedUserProfile(messages) {
    const profile = {
      preferences: {},
      skillLevel: null,
      goals: [],
      interests: [],
      learningApproach: null,
      preferredLanguage: "turkish",
      topicPreferences: [],
    };

    for (const message of messages) {
      if (message.role === "user") {
        const content = message.content.toLowerCase();

        // Enhanced level detection with emoji patterns
        for (const [level, patterns] of Object.entries(
          this.learningPatterns.skillLevels
        )) {
          if (
            patterns.some((pattern) => content.includes(pattern.toLowerCase()))
          ) {
            profile.skillLevel = {
              level,
              confidence: 0.95,
              detectedAt: message.timestamp,
              source: "user_selection",
            };
            break;
          }
        }

        // Learning approach detection
        for (const [approach, patterns] of Object.entries(
          this.learningPatterns.learningApproaches
        )) {
          if (
            patterns.some((pattern) => content.includes(pattern.toLowerCase()))
          ) {
            profile.learningApproach = {
              approach,
              confidence: 0.9,
              detectedAt: message.timestamp,
            };
            break;
          }
        }

        // Topic interest extraction
        if (content.includes("sql") || content.includes("veritabanı")) {
          if (!profile.topicPreferences.includes("sql")) {
            profile.topicPreferences.push("sql");
          }
        }

        // Goal extraction
        if (
          content.includes("öğrenmek istiyorum") ||
          content.includes("hedefim")
        ) {
          profile.goals.push({
            goal: content.substring(0, 100),
            timestamp: message.timestamp,
          });
        }
      }
    }

    return profile;
  }

  /**
   * Extract widget selections for preference tracking
   */
  extractWidgetSelections(messages) {
    const widgetSelections = [];

    for (const message of messages) {
      try {
        // Check if message content contains widget data
        if (
          message.content.includes("widgetType") &&
          message.content.includes("{")
        ) {
          const widgetData = JSON.parse(message.content);

          if (
            widgetData.widgetType === "TopicSelectionMessage" &&
            widgetData.selected
          ) {
            widgetSelections.push({
              type: "topic_selection",
              selection: widgetData.selected,
              timestamp: message.timestamp,
              options: widgetData.assistantGroups?.map((g) => g.title) || [],
            });
          }

          if (
            widgetData.widgetType === "InputMessageComponent" &&
            widgetData.userOptions
          ) {
            for (const [key, option] of Object.entries(
              widgetData.userOptions
            )) {
              widgetSelections.push({
                type: "input_selection",
                question: option.title,
                selection: option.value,
                timestamp: message.timestamp,
              });
            }
          }
        }
      } catch (error) {
        // Ignore JSON parsing errors
      }
    }

    return widgetSelections;
  }

  /**
   * Analyze learning progress based on user responses
   */
  analyzeLearningProgress(messages) {
    const progress = {
      conceptsLearned: [],
      strugglingWith: [],
      masteredTopics: [],
      progressScore: 0.5,
    };

    let correctResponses = 0;
    let totalQuestions = 0;
    let currentTopic = null;

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      if (message.role === "assistant" && message.content.includes("?")) {
        totalQuestions++;
        currentTopic = this.extractCurrentTopic([message]).topic;

        // Check next user response
        if (i + 1 < messages.length) {
          const userResponse = messages[i + 1];
          if (userResponse.role === "user") {
            const responseContent = userResponse.content.toLowerCase();

            // Check for struggle indicators
            if (
              this.learningPatterns.struggleIndicators.some((indicator) =>
                responseContent.includes(indicator)
              )
            ) {
              if (
                currentTopic &&
                !progress.strugglingWith.includes(currentTopic)
              ) {
                progress.strugglingWith.push(currentTopic);
              }
            }

            // Check for progress indicators
            else if (
              this.learningPatterns.progressIndicators.some((indicator) =>
                responseContent.includes(indicator)
              )
            ) {
              correctResponses++;
              if (
                currentTopic &&
                !progress.conceptsLearned.includes(currentTopic)
              ) {
                progress.conceptsLearned.push(currentTopic);
              }
            }
          }
        }
      }
    }

    if (totalQuestions > 0) {
      progress.progressScore = correctResponses / totalQuestions;
    }

    return progress;
  }

  /**
   * Analyze struggle patterns to detect when user needs help
   */
  analyzeStrugglePattern(recentMessages) {
    const pattern = {
      isStruggling: false,
      struggleCount: 0,
      lastStruggleMessage: null,
      needsHelp: false,
      strugglesInLastFive: 0,
    };

    const lastFiveUserMessages = recentMessages
      .filter((m) => m.role === "user")
      .slice(-5);

    for (const message of lastFiveUserMessages) {
      const content = message.content.toLowerCase();

      if (
        this.learningPatterns.struggleIndicators.some((indicator) =>
          content.includes(indicator)
        )
      ) {
        pattern.struggleCount++;
        pattern.strugglesInLastFive++;
        pattern.lastStruggleMessage = {
          content: message.content,
          timestamp: message.timestamp,
        };
      }
    }

    pattern.isStruggling = pattern.strugglesInLastFive >= 2;
    pattern.needsHelp = pattern.strugglesInLastFive >= 3;

    return pattern;
  }

  /**
   * Enhanced topic history tracking with learning outcomes
   */
  extractEnhancedTopicHistory(messages) {
    const topicHistory = [];
    let currentTopicSegment = null;

    for (const message of messages) {
      const messageTopics = this.extractEnhancedCurrentTopic([message]);

      if (messageTopics.topic !== "general" && messageTopics.confidence > 0.5) {
        if (
          !currentTopicSegment ||
          currentTopicSegment.topic !== messageTopics.topic
        ) {
          // New topic segment
          if (currentTopicSegment) {
            currentTopicSegment.endedAt = message.timestamp;
            topicHistory.push(currentTopicSegment);
          }

          currentTopicSegment = {
            topic: messageTopics.topic,
            startedAt: message.timestamp,
            messageCount: 1,
            keywords: messageTopics.keywords,
            sqlContext: messageTopics.sqlContext,
            userStruggled: false,
            completionLevel: "in_progress",
          };
        } else {
          // Continue current topic
          currentTopicSegment.messageCount++;
          currentTopicSegment.keywords = [
            ...new Set([
              ...currentTopicSegment.keywords,
              ...messageTopics.keywords,
            ]),
          ];

          // Check if user struggled with this topic
          if (message.role === "user") {
            const content = message.content.toLowerCase();
            if (
              this.learningPatterns.struggleIndicators.some((indicator) =>
                content.includes(indicator)
              )
            ) {
              currentTopicSegment.userStruggled = true;
            }
          }
        }
      }
    }

    // Close final segment
    if (currentTopicSegment) {
      topicHistory.push(currentTopicSegment);
    }

    return topicHistory;
  }

  /**
   * Enhanced conversation flow analysis with learning context
   */
  analyzeEnhancedConversationFlow(recentMessages) {
    if (!recentMessages || recentMessages.length === 0) {
      return {
        phase: "starting",
        lastInteraction: "none",
        learningContext: null,
      };
    }

    const lastMessage = recentMessages[recentMessages.length - 1];
    const lastUserMessage = recentMessages
      .filter((m) => m.role === "user")
      .slice(-1)[0];

    let phase = "active";
    let lastInteraction = "question";
    let learningContext = null;

    if (lastUserMessage) {
      const content = lastUserMessage.content.toLowerCase();

      // Detect learning context
      if (
        this.learningPatterns.struggleIndicators.some((indicator) =>
          content.includes(indicator)
        )
      ) {
        phase = "struggling";
        lastInteraction = "seeking_help";
        learningContext = "needs_clarification";
      } else if (
        this.learningPatterns.progressIndicators.some((indicator) =>
          content.includes(indicator)
        )
      ) {
        phase = "progressing";
        lastInteraction = "successful_response";
        learningContext = "ready_for_next";
      } else if (content.includes("devam") || content.includes("sonraki")) {
        phase = "advancing";
        lastInteraction = "progression_request";
        learningContext = "topic_completion";
      }
    }

    return {
      phase,
      lastInteraction,
      learningContext,
      messagePattern: this.detectEnhancedMessagePattern(recentMessages),
    };
  }

  /**
   * Enhanced message pattern detection with learning context
   */
  detectEnhancedMessagePattern(messages) {
    if (messages.length < 3) return "insufficient_data";

    const userMessages = messages.filter((m) => m.role === "user");

    // Check for repeated struggle patterns
    const struggleCount = userMessages.filter((m) =>
      this.learningPatterns.struggleIndicators.some((indicator) =>
        m.content.toLowerCase().includes(indicator)
      )
    ).length;

    if (struggleCount >= 3) {
      return "repeated_struggles";
    }

    // Check for widget selection repetition
    const widgetSelections = this.extractWidgetSelections(messages);
    const recentSelections = widgetSelections.slice(-3);

    if (recentSelections.length >= 2) {
      const similarSelections = recentSelections.filter(
        (selection) => selection.selection === recentSelections[0].selection
      );

      if (similarSelections.length >= 2) {
        return "repetitive_selections";
      }
    }

    return "normal_learning_flow";
  }

  /**
   * Optimize message history with widget awareness
   */
  optimizeForTokenBudgetWithWidgets(messages, maxTokens) {
    if (!messages || messages.length === 0) return [];

    let totalTokens = 0;
    const optimized = [];
    let widgetMessagesKept = 0;

    // Start from most recent messages
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      let messageTokens = this.estimateMessageTokens(message.content);

      // Reduce token count for widget messages but keep important selection data
      if (message.content.includes("widgetType")) {
        messageTokens = Math.min(messageTokens, 150); // Limit widget message tokens
        widgetMessagesKept++;
      }

      if (totalTokens + messageTokens <= maxTokens) {
        optimized.unshift(message); // Add to beginning to maintain order
        totalTokens += messageTokens;
      } else {
        // Always try to keep at least 2 widget messages for context
        if (message.content.includes("widgetType") && widgetMessagesKept < 2) {
          optimized.unshift(message);
          totalTokens += messageTokens;
          widgetMessagesKept++;
        } else {
          break;
        }
      }
    }

    // Ensure we keep at least the last 3 exchanges for learning context
    if (optimized.length < 6 && messages.length >= 6) {
      return messages.slice(-6);
    }

    return optimized;
  }

  /**
   * Detect repeating patterns that might indicate memory issues
   */
  detectMessagePattern(messages) {
    if (messages.length < 3) return "insufficient_data";

    const userMessages = messages.filter((m) => m.role === "user");
    const assistantMessages = messages.filter((m) => m.role === "assistant");

    // Check for repetitive questions (potential memory loss indicator)
    const questionPatterns = userMessages
      .map((m) => this.extractQuestionPattern(m.content))
      .filter((p) => p);

    const repeatedQuestions = questionPatterns.filter(
      (pattern, index) => questionPatterns.indexOf(pattern) !== index
    );

    if (repeatedQuestions.length > 0) {
      return "repetitive_questions";
    }

    // Check for topic jumping
    const topics = messages.map((m) => this.extractCurrentTopic([m]).topic);
    const uniqueTopics = [...new Set(topics)];

    if (uniqueTopics.length > 3 && messages.length < 10) {
      return "topic_jumping";
    }

    return "normal_flow";
  }

  /**
   * Analyze conversation flow and interaction patterns (legacy compatibility)
   */
  analyzeConversationFlow(recentMessages) {
    // For backward compatibility, delegate to enhanced version
    const enhanced = this.analyzeEnhancedConversationFlow(recentMessages);

    return {
      phase: enhanced.phase,
      lastInteraction: enhanced.lastInteraction,
      messagePattern: enhanced.messagePattern,
    };
  }

  /**
   * Extract question pattern for repetition detection
   */
  extractQuestionPattern(content) {
    const patterns = [
      "seviye.*nedir",
      "nasıl.*öğren",
      "ne.*demek",
      "hangi.*seviye",
    ];

    for (const pattern of patterns) {
      if (new RegExp(pattern, "i").test(content)) {
        return pattern;
      }
    }

    return null;
  }

  /**
   * Optimize message history for token budget
   */
  optimizeForTokenBudget(messages, maxTokens) {
    if (!messages || messages.length === 0) return [];

    let totalTokens = 0;
    const optimized = [];

    // Start from most recent messages
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      const messageTokens = this.estimateMessageTokens(message.content);

      if (totalTokens + messageTokens <= maxTokens) {
        optimized.unshift(message); // Add to beginning to maintain order
        totalTokens += messageTokens;
      } else {
        break;
      }
    }

    // Ensure we keep at least the last 2 exchanges
    if (optimized.length < 4 && messages.length >= 4) {
      return messages.slice(-4);
    }

    return optimized;
  }

  /**
   * Estimate tokens for a message
   */
  estimateMessageTokens(content) {
    if (!content) return 0;
    // Rough estimation: 1 token per 4 characters for Turkish
    return Math.ceil(content.length / 4);
  }

  /**
   * Estimate total tokens for message array
   */
  estimateTokens(messages) {
    return messages.reduce(
      (total, message) => total + this.estimateMessageTokens(message.content),
      0
    );
  }

  /**
   * Get empty context structure
   */
  getEmptyContext(conversationId) {
    return {
      conversationId,
      messages: [],
      context: this.getEmptyContextData(),
      metadata: {
        totalMessages: 0,
        retrievedMessages: 0,
        tokenEstimate: 0,
      },
    };
  }

  /**
   * Get empty context data structure
   */
  getEmptyContextData() {
    return {
      currentTopic: {
        topic: "general",
        confidence: 0,
        detectedIn: null,
        keywords: [],
      },
      userProfile: {
        preferences: {},
        skillLevel: null,
        goals: [],
        interests: [],
      },
      conversationFlow: { phase: "starting", lastInteraction: "none" },
      topicHistory: [],
      lastUserLevel: null,
    };
  }

  /**
   * Get enhanced empty context data structure
   */
  getEnhancedEmptyContextData() {
    return {
      currentTopic: {
        topic: "general",
        confidence: 0,
        detectedIn: null,
        keywords: [],
      },
      userProfile: {
        preferences: {},
        skillLevel: null,
        goals: [],
        interests: [],
        learningApproach: null,
      },
      conversationFlow: { phase: "starting", lastInteraction: "none" },
      topicHistory: [],
      lastUserLevel: null,
      widgetSelections: [],
      learningProgress: {
        conceptsLearned: [],
        strugglingWith: [],
        masteredTopics: [],
      },
      strugglePattern: {
        isStruggling: false,
        struggleCount: 0,
        lastStruggleMessage: null,
        needsHelp: false,
      },
    };
  }

  /**
   * Create conversation context for prompts
   */
  createConversationContextPrompt(conversationContext) {
    if (!conversationContext || !conversationContext.context) {
      return "";
    }

    const { context, messages, metadata } = conversationContext;
    let prompt = "\n<conversation_context>\n";

    // Current topic information
    if (context.currentTopic.topic !== "general") {
      prompt += "<current_topic>\n";
      prompt += `- Topic: ${context.currentTopic.topic}\n`;
      prompt += `- Confidence: ${context.currentTopic.confidence}\n`;
      prompt += `- Keywords: ${context.currentTopic.keywords.join(", ")}\n`;
      if (context.currentTopic.sqlContext) {
        prompt += "- Context: SQL Learning\n";
      }
      prompt += "</current_topic>\n";
    }

    // Enhanced user profile
    if (context.userProfile.skillLevel) {
      prompt += "<user_profile>\n";
      prompt += `- Skill Level: ${context.userProfile.skillLevel.level}\n`;
      if (context.userProfile.learningApproach) {
        prompt += `- Learning Approach: ${context.userProfile.learningApproach.approach}\n`;
      }
      if (context.userProfile.goals.length > 0) {
        prompt += `- Goals: ${context.userProfile.goals
          .map((g) => g.goal)
          .join("; ")}\n`;
      }
      if (context.userProfile.topicPreferences.length > 0) {
        prompt += `- Topic Interests: ${context.userProfile.topicPreferences.join(
          ", "
        )}\n`;
      }
      prompt += "</user_profile>\n";
    }

    // Learning progress and struggle analysis
    if (context.learningProgress && context.strugglePattern) {
      prompt += "<learning_status>\n";
      if (context.strugglePattern.isStruggling) {
        prompt += "- Status: User is currently struggling\n";
        prompt += `- Struggles in last 5 messages: ${context.strugglePattern.strugglesInLastFive}\n`;
        if (context.strugglePattern.needsHelp) {
          prompt +=
            "- PRIORITY: User needs additional help and clarification\n";
        }
        if (context.learningProgress.strugglingWith.length > 0) {
          prompt += `- Struggling with: ${context.learningProgress.strugglingWith.join(
            ", "
          )}\n`;
        }
      } else if (context.learningProgress.progressScore > 0.7) {
        prompt += "- Status: User is progressing well\n";
        prompt += `- Progress Score: ${Math.round(
          context.learningProgress.progressScore * 100
        )}%\n`;
        if (context.learningProgress.conceptsLearned.length > 0) {
          prompt += `- Recently learned: ${context.learningProgress.conceptsLearned.join(
            ", "
          )}\n`;
        }
      }
      prompt += "</learning_status>\n";
    }

    // Widget selections for personalization
    if (context.widgetSelections && context.widgetSelections.length > 0) {
      const recentSelections = context.widgetSelections.slice(-3);
      prompt += "<recent_preferences>\n";
      for (const selection of recentSelections) {
        if (selection.type === "topic_selection") {
          prompt += `- Selected Topic: ${selection.selection}\n`;
        } else if (selection.type === "input_selection") {
          prompt += `- ${selection.question}: ${selection.selection}\n`;
        }
      }
      prompt += "</recent_preferences>\n";
    }

    // Enhanced conversation flow
    prompt += "<conversation_flow>\n";
    prompt += `- Phase: ${context.conversationFlow.phase}\n`;
    prompt += `- Last Interaction: ${context.conversationFlow.lastInteraction}\n`;
    if (context.conversationFlow.learningContext) {
      prompt += `- Learning Context: ${context.conversationFlow.learningContext}\n`;
    }
    if (
      context.conversationFlow.messagePattern !== "normal_learning_flow" &&
      context.conversationFlow.messagePattern !== "normal_flow"
    ) {
      prompt += `- Pattern Alert: ${context.conversationFlow.messagePattern}\n`;
    }
    prompt += "</conversation_flow>\n";

    // Enhanced topic continuity instructions
    if (context.currentTopic.topic !== "general") {
      prompt += "<topic_continuity_instructions>\n";
      prompt += `- MAINTAIN TOPIC: Continue discussing ${context.currentTopic.topic}\n`;

      if (context.strugglePattern.isStruggling) {
        prompt += "- APPROACH: Use simpler explanations and more examples\n";
        prompt +=
          "- STRATEGY: Break down complex concepts into smaller steps\n";
        prompt += "- SUPPORT: Provide encouragement and reassurance\n";
      } else if (context.learningProgress.progressScore > 0.7) {
        prompt += "- APPROACH: User is ready for more advanced concepts\n";
        prompt += "- STRATEGY: Introduce new challenges and examples\n";
      }

      prompt +=
        "- If user gives incorrect/irrelevant response: Provide correction while staying on topic\n";
      prompt +=
        "- If user gives correct response: Provide examples that match their exact answer\n";
      prompt +=
        "- Do not abandon current topic unless user explicitly requests topic change\n";
      prompt += "</topic_continuity_instructions>\n";
    }

    // Memory and widget context
    if (metadata && metadata.hasWidgetData) {
      prompt += "<interaction_context>\n";
      prompt += "- Previous widget interactions available for context\n";
      prompt += "- Avoid repeating identical widget selections\n";
      prompt += "- Build upon previous user choices\n";
      prompt += "</interaction_context>\n";
    }

    // Recent conversation flow (adaptive based on struggle patterns)
    if (messages.length > 0) {
      const contextWindow = context.strugglePattern.isStruggling ? 8 : 6;
      const recentMessages = messages.slice(-contextWindow);
      prompt += "<recent_conversation>\n";
      recentMessages.forEach((msg) => {
        const truncated =
          msg.content.length > 150
            ? msg.content.substring(0, 150) + "..."
            : msg.content;
        prompt += `- ${msg.role}: ${truncated}\n`;
      });
      prompt += "</recent_conversation>\n";
    }

    prompt += "</conversation_context>\n";
    return prompt;
  }
}

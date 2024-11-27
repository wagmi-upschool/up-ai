// controllers/reflectionController.js
import {
    OpenAI,
    PineconeVectorStore,
    VectorStoreIndex,
    Settings,
    OpenAIEmbedding,
    ContextChatEngine,
    SummaryIndex,
    OpenAIContextAwareAgent,
    getResponseSynthesizer,
    RetrieverQueryEngine,
    VectorIndexRetriever
} from "llamaindex";
import {
    GetCommand
} from "@aws-sdk/lib-dynamodb";
import {
    DynamoDBClient
} from "@aws-sdk/client-dynamodb";
const dynamoDbClient = new DynamoDBClient({
    region: 'us-east-1'
});

const pcvs = new PineconeVectorStore({
    indexName: "chat-messages",
    chunkSize: 100,
    storesText: true
});

// Function to remove patterns from text
function replacePatterns(text) {
    const signs = ["\\]\\*\\*\\*\\]", "\\[\\*\\*\\*\\]", "\\*\\*", "\\[\\*\\*:\\]", "\\[\\*\\*::\\]", "\\[\\*\\*\\.\\]", "\\[\\*\\*\\.\\.\\]"];
    const regex = new RegExp(signs.join("|"), "g");
    return text.replace(regex, '');
}

// Helper function to configure Azure options
function getAzureEmbeddingOptions() {
    return {
        endpoint: process.env.AZURE_OPENAI_ENDPOINT,
        deployment: "text-embedding-3-small",
        apiKey: process.env.AZURE_OPENAI_KEY
    };
}

// Initialize OpenAI settings based on assistant configuration
async function initializeSettings(config) {
    const {
        setEnvs
    } = await import("@llamaindex/env");
    setEnvs(process.env);
    Settings.llm = new OpenAI({
        azure: {
            endpoint: process.env.AZURE_OPENAI_ENDPOINT,
            deployment: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
            apiKey: process.env.AZURE_OPENAI_KEY
        },
        model: "gpt-4o",
        // deployment: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
        additionalChatOptions: {
            // deployment: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
            // maxTokens: config.maxTokens,
            frequency_penalty: config.frequencyPenalty,
            presence_penalty: config.presencePenalty,
            stream: config.stream ? config.stream : undefined
        },
        temperature: config.temperature,
        topP: config.topP,
        // maxTokens: config.maxTokens,
    });
    Settings.embedModel = new OpenAIEmbedding({
        model: "text-embedding-3-small",
        azure: getAzureEmbeddingOptions()
    });
}

// Create and return a Pinecone-based index
async function createIndex(conversationId) {
    return await VectorStoreIndex.fromVectorStore(pcvs);
}

async function createSummaryIndex() {
    const pvcs = new PineconeVectorStore();
    return await SummaryIndex.fromDocuments([], {
        pvcs
    });
}

function createRetriever(index, conversationId, type) {
    const retriever = new VectorIndexRetriever({
        index: index,
        includeValues: true,
        filters: {
            filters: [{
                key: "conversationId",
                value: conversationId,
                operator: "==",
            }]
        },
        similarityTopK: 100,

    });
    return retriever;
}

// Fetch assistant configuration from DynamoDB
async function fetchAssistantConfig(assistantId) {
    const env = process.env.STAGE;
    const params = {
        TableName: `UpAssistant-${env}`,
        Key: {
            id: assistantId
        }
    };
    const result = await dynamoDbClient.send(new GetCommand(params));
    return result.Item ? result.Item : null;
}

// Controller to handle synchronous reflection requests
export async function handleReflection(req, res) {
    const {
        userId,
        conversationId
    } = req.params;
    const {
        query,
        assistantId,
        type
    } = req.body;
}

// Controller to handle streaming reflection requests
export async function handleReflectionStream(req, res) {
    const {
        userId,
        conversationId
    } = req.params;
    const {
        query,
        assistantId,
        contextRole,
        type
    } = req.body;

    try {
        const systemMessage = await fetchAssistantConfig(assistantId);
        if (!systemMessage) throw new Error('Assistant configuration not found');
        const replacedPatterns = replacePatterns(systemMessage.prompt);
        const assistantConfig = {
            temperature: parseInt(systemMessage.temperature.toString()) || 0.2,
            topP: parseInt(systemMessage.topP.toString()) || 0.95,
            maxTokens: parseInt(systemMessage.maxTokens.toString()) || 800,
            frequencyPenalty: parseInt(systemMessage.frequencyPenalty.toString()) || 0.0,
            presencePenalty: parseInt(systemMessage.presencePenalty.toString()) || 0.0,
            responseType: "text",
            stream: true
        };
        await initializeSettings(assistantConfig);
        const index = await createIndex(conversationId);
        const retriever = await createRetriever(index, conversationId, type);
        const responseSynthesizer = await getResponseSynthesizer("tree_summarize", {
            llm: new OpenAI({
                azure: {
                    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
                    deployment: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
                    apiKey: process.env.AZURE_OPENAI_KEY
                },
                model: "gpt-4o",
                additionalChatOptions: {
                    // maxTokens: config.maxTokens,
                    frequency_penalty: assistantConfig.frequencyPenalty,
                    presence_penalty: assistantConfig.presencePenalty,
                    stream: assistantConfig.stream ? assistantConfig.stream : undefined
                },
                temperature: assistantConfig.temperature,
                topP: assistantConfig.topP,
                // maxTokens: config.maxTokens,
            })
        });
        let stream;
        if (type == "chat") {
            const chatEngine = new ContextChatEngine({
                llm: new OpenAI({

                    azure: {
                        endpoint: process.env.AZURE_OPENAI_ENDPOINT,
                        deployment: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
                        apiKey: process.env.AZURE_OPENAI_KEY
                    },
                    model: "gpt-4o",
                    additionalChatOptions: {
                        // maxTokens: config.maxTokens,
                        frequency_penalty: assistantConfig.frequencyPenalty,
                        presence_penalty: assistantConfig.presencePenalty,
                        stream: assistantConfig.stream ? assistantConfig.stream : undefined
                    },
                    temperature: assistantConfig.temperature,
                    topP: assistantConfig.topP,
                    // maxTokens: config.maxTokens,
                }),
                retriever,
                contextRole: contextRole ?? "memory",
                systemPrompt: replacedPatterns,
            });
            // Start the chat stream with the provided prompt
            stream = await chatEngine.chat({
                message: query,
                stream: true
            });
        } else if (type == "rag") {
            const agent = new OpenAIContextAwareAgent({
                contextRetriever: retriever,
            });
            // Example query to the context-aware agent
            stream = await agent.chat({
                stream: true,
                message: query,
            });
        } else if (type == "summary") {
            // Create a query engine
            const queryEngine = index.asQueryEngine({
                retriever,
            });
            stream = await queryEngine.query({
                stream: true,
                query: query,
            });
        } else {
            const queryEngine = new RetrieverQueryEngine(retriever, responseSynthesizer);
            const query_ = `[System Prompts: 
            ${replacedPatterns}]
            -----------------------------------
            User Query:
                ${query}
            `
            stream = await queryEngine.query({
                stream: true,
                query: query_,
            });
        }
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Transfer-Encoding', 'chunked');
        // Stream each chunk of the response
        for await (const chunk of stream) {
            res.write(chunk.response);
        }
        // End the response after all chunks are sent
        res.end();
    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: err.message
        });
    }
}
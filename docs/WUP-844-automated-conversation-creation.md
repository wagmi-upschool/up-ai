# WUP-844: Automated Conversation Initiation with Dynamic User Input Generation

## Overview

This implementation creates a fully automated system for generating conversation scenarios with dynamic user inputs based on assistant data and election options. The system is **completely dynamic** - you only need to provide an assistant ID, and it will:

1. Fetch assistant data from UpAssistant DynamoDB table
2. Extract introduction messages with `[BLANK]` fields  
3. Fetch election options from ElectionOptions DynamoDB table
4. Replace `[BLANK]` fields with randomly selected options
5. Generate diverse conversation scenarios
6. Create actual conversations via Lambda functions

## Architecture

### Core Components

**AssistantDataService** (`services/assistantDataService.js`):
- Fetches assistant data from UpAssistant table
- Extracts introduction messages with `[BLANK]` fields
- Calculates optimal conversation counts
- Generates dynamic configuration

**AssistantInputOptionsService** (`services/assistantInputOptionsService.js`):
- Fetches hierarchical election options from ElectionOptions table
- Supports parent-child option relationships
- Generates random option selections

**BlankFieldReplacer** (`utils/blankFieldReplacer.js`):
- Parses introduction messages to find `[BLANK]` fields
- Replaces blanks with appropriate election options
- Generates multiple message variations

**Dynamic Conversation Creator** (`scripts/create_conversations.js`):
- Orchestrates the entire process
- Creates actual conversations via Lambda
- Provides preview mode for testing

### Database Integration

**UpAssistant Table** (`UpAssistant-{env}`):
```json
{
  "id": "86804a79-61e4-408a-9623-2eac4b43fe97",
  "description": "Assistant description...",
  "introductionMessages": [
    {
      "type": "default", 
      "value": "Default greeting message..."
    },
    {
      "type": "user-input",
      "value": "Field 1:[BLANK]Field 2:[BLANK]"
    }
  ]
}
```

**ElectionOptions Table** (`ElectionOptions-{env}`):
```json
{
  "PK": "ASSISTANT#86804a79-61e4-408a-9623-2eac4b43fe97",
  "SK": "PARENT#null#OPTION#option-id",
  "value": "Option text",
  "priority": 1
}
```

## Usage

### Command Line Interface

```bash
# Basic usage - create conversations for assistant
node scripts/create_conversations.js 86804a79-61e4-408a-9623-2eac4b43fe97

# Preview mode - see generated scenarios without creating conversations  
node scripts/create_conversations.js 86804a79-61e4-408a-9623-2eac4b43fe97 --preview

# Alternative syntax
node scripts/create_conversations.js --assistant-id 86804a79-61e4-408a-9623-2eac4b43fe97 -p
```

### Configuration

The system automatically configures itself based on:
- Assistant's introduction messages
- Available election options
- Dynamic conversation count calculation

**Lambda Functions Required**:
- `getAssistant` - Fetch assistant data
- `getAssistantInputOptions` - Fetch election options  
- `saveConversationMessages-myenv` - Create conversations

## Dynamic Generation Process

### Step 1: Assistant Data Fetching
```javascript
// Automatically fetches assistant data
const assistantData = await assistantDataService.getAssistantData(assistantId);

// Extracts messages with [BLANK] fields
const messagesWithBlanks = assistantDataService.extractIntroductionMessagesWithBlanks(assistantData);
```

### Step 2: Election Options Retrieval
```javascript
// Fetches all available options for assistant
const options = await assistantService.getAllOptions(assistantId);

// Gets hierarchical child options
const childOptions = await assistantService.getChildOptions(assistantId, parentId);
```

### Step 3: Dynamic Replacement
```javascript
// Replaces [BLANK] fields with election options
const variations = await blankFieldReplacer.generateMessageVariations(
  assistantId,
  introMessage.value,
  variationsPerMessage
);
```

### Step 4: Conversation Creation
```javascript
// Creates actual conversations via Lambda
const result = await createConversation(scenario, assistantId);
```

## Example Flow

**Input**: Assistant ID `86804a79-61e4-408a-9623-2eac4b43fe97`

**Assistant Introduction Message**:
```
"Geri bildirim vermek istediğim kişi:[BLANK]Hangi konuda geri bildirim vermek istiyorum: [BLANK]"
```

**Available Election Options**:
- "Müşteri Temsilcisi", "Takım Lideri", "Proje Yöneticisi"
- "Hedefler ve Gelecek Planı", "İletişim Becerileri", "Problem Çözme"

**Generated Variations**:
```
Variation 1: "Geri bildirim vermek istediğim kişi: Müşteri Temsilcisi Hangi konuda geri bildirim vermek istiyorum: Hedefler ve Gelecek Planı"

Variation 2: "Geri bildirim vermek istediğim kişi: Takım Lideri Hangi konuda geri bildirim vermek istiyorum: İletişim Becerileri"
```

**Created Conversations**:
- Each variation becomes a full conversation with user/assistant messages
- Conversations are saved to DynamoDB via Lambda
- Unique conversation IDs are generated for tracking

## Key Features

### 🔄 Fully Dynamic
- No hardcoded messages or options
- Adapts to any assistant configuration
- Automatic conversation count optimization

### 🎯 Intelligent Replacement
- Context-aware option selection
- Hierarchical option support (parent → child)
- Unique variation generation

### 🚀 Production Ready
- Error handling and fallbacks
- Rate limiting between requests
- Comprehensive logging

### 🧪 Testing Support  
- Preview mode for validation
- Detailed scenario inspection
- No actual conversations created in preview

## Error Handling

**Common Scenarios**:
- Assistant not found → Clear error message
- No introduction messages with blanks → Graceful failure
- Lambda function errors → Retry logic
- No election options → Warning with fallback

**Fallback Strategy**:
```javascript
try {
  CONVERSATIONS_TO_CREATE = await generateConversationScenarios(assistantId);
} catch (error) {
  console.error("❌ Failed to generate dynamic scenarios, falling back to static scenarios");
  // Uses existing static scenarios if available
}
```

## Configuration Options

**Environment Variables**:
- `STAGE`: Environment stage (dev/uat/prod)
- `AWS_REGION`: AWS region for Lambda functions
- Other standard AWS SDK configuration

**Runtime Options** (automatically calculated):
- `conversationCount`: Based on available messages × variations
- `variationsPerMessage`: Default 2, optimizes for uniqueness
- `maxConversations`: Cap at 20 to prevent excessive generation

## Integration with Existing Systems

**RAG Pipeline Integration**:
- Generated conversations work with existing 2-stage RAG
- Conversation memory service (WUP-806) compatibility
- Turkish language support maintained

**Database Compatibility**:
- Uses existing conversation storage format
- Compatible with `UpConversations-{stage}` table
- Maintains conversation message structure

## Benefits

### For WUP-844 Implementation
✅ **Automated conversation initiation** - Fully automated based on assistant ID
✅ **Random user input generation** - Dynamic selection from election options  
✅ **Scalable architecture** - Works with any assistant configuration
✅ **Testing capabilities** - Preview mode for validation

### For System Maintenance
✅ **Reduced manual work** - No more hardcoded scenarios
✅ **Easy assistant onboarding** - Just add election options
✅ **Consistent quality** - Standardized generation process
✅ **Better test coverage** - Diverse conversation scenarios

## Usage Examples

### Development Testing
```bash
# Preview scenarios for feedback assistant
node scripts/create_conversations.js 86804a79-61e4-408a-9623-2eac4b43fe97 --preview
```

### Production Deployment  
```bash
# Create conversations for banking assistant
node scripts/create_conversations.js banking-assistant-id-here

# Create conversations for customer service assistant  
node scripts/create_conversations.js customer-service-assistant-id
```

### Batch Processing
```bash
# Script can be wrapped for multiple assistants
for assistant_id in assistant1 assistant2 assistant3; do
  node scripts/create_conversations.js $assistant_id
done
```

## Monitoring and Logs

The system provides comprehensive logging:
- 🔍 Assistant data fetching progress
- 📝 Message parsing and blank field detection  
- 🎲 Random option selection details
- ✅ Conversation creation success/failure
- 📊 Summary statistics and conversation IDs

**Log Example**:
```
🚀 UP School Dynamic Conversation Creator
🤖 Assistant ID: 86804a79-61e4-408a-9623-2eac4b43fe97
🔍 Fetching assistant data for: 86804a79-61e4-408a-9623-2eac4b43fe97  
📝 Found 3 introduction messages with [BLANK] fields
🎯 Calculating conversation count: 3 messages × 2 variations = 6 possible
📊 Optimal conversation count: 6 (max: 20)
✅ Generated 6 conversation scenarios
📊 Total conversations to create: 6
✅ Successfully created conversation: conv-id-123
📊 Results: Total attempts: 6, Successful: 6, Failed: 0
```

This completes the WUP-844 implementation for automated conversation initiation with dynamic user input generation!
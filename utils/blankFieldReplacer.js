import { AssistantInputOptionsService } from "../services/assistantInputOptionsService.js";

/**
 * Service for replacing [BLANK] fields in introductionMessages with election options
 */
export class BlankFieldReplacer {
  constructor(config = {}) {
    this.assistantService = new AssistantInputOptionsService(config);
  }

  /**
   * Parse introduction message to find [BLANK] fields and their context
   * @param {string} introMessage - The introduction message with [BLANK] fields
   * @returns {Array} Array of blank field contexts
   */
  parseBlankFields(introMessage) {
    const lines = introMessage.split('\n');
    const blankFields = [];
    
    lines.forEach((line, index) => {
      if (line.includes('[BLANK]')) {
        // Extract the context before [BLANK]
        const beforeBlank = line.substring(0, line.indexOf('[BLANK]')).trim();
        const afterBlank = line.substring(line.indexOf('[BLANK]') + 7).trim();
        
        blankFields.push({
          lineIndex: index,
          originalLine: line,
          contextBefore: beforeBlank,
          contextAfter: afterBlank,
          fullContext: beforeBlank + afterBlank
        });
      }
    });
    
    return blankFields;
  }

  /**
   * Get appropriate election options for a blank field based on context
   * @param {string} assistantId - The assistant ID
   * @param {Object} blankField - The blank field context
   * @returns {Promise<Array>} Array of appropriate options
   */
  async getOptionsForBlankField(assistantId, blankField) {
    try {
      // Get all available options for the assistant
      const allOptions = await this.assistantService.getAllOptions(assistantId);
      
      if (!allOptions || allOptions.length === 0) {
        console.warn(`No options found for assistant: ${assistantId}`);
        return [];
      }

      // Filter options based on context keywords
      const contextKeywords = this.extractKeywordsFromContext(blankField.fullContext);
      
      // If we can identify relevant options by context, filter them
      const relevantOptions = this.filterOptionsByContext(allOptions, contextKeywords);
      
      if (relevantOptions.length > 0) {
        console.log(`🎯 Found ${relevantOptions.length} relevant options for context: "${blankField.contextBefore}"`);
        return relevantOptions;
      }

      // If no specific context match, return all root options
      console.log(`📋 Using all available options for context: "${blankField.contextBefore}"`);
      return allOptions;
    } catch (error) {
      console.error(`❌ Error getting options for blank field:`, error.message);
      return [];
    }
  }

  /**
   * Extract keywords from context for option matching
   * @param {string} context - The context text
   * @returns {Array} Array of keywords
   */
  extractKeywordsFromContext(context) {
    const turkishKeywordMap = {
      // Person-related keywords
      'kişi': ['person', 'individual', 'people'],
      'müşteri': ['customer', 'client'],
      'çalışan': ['employee', 'worker', 'staff'],
      'yönetici': ['manager', 'supervisor'],
      'ekip': ['team', 'group'],
      'arkadaş': ['friend', 'colleague'],
      
      // Topic-related keywords
      'konu': ['topic', 'subject', 'issue'],
      'hedef': ['goal', 'target', 'objective'],
      'plan': ['plan', 'planning'],
      'geri bildirim': ['feedback', 'response'],
      'iletişim': ['communication', 'contact'],
      'gelişim': ['development', 'improvement'],
      'beceri': ['skill', 'ability'],
      'öğrenme': ['learning', 'education'],
      'deneyim': ['experience'],
      'problem': ['problem', 'issue', 'challenge'],
      'çözüm': ['solution', 'resolution'],
      
      // Action-related keywords
      'vermek': ['give', 'provide'],
      'almak': ['take', 'receive'],
      'yapmak': ['do', 'make'],
      'başlamak': ['start', 'begin'],
      'devam': ['continue', 'ongoing']
    };

    const contextLower = context.toLowerCase();
    const foundKeywords = [];

    // Find Turkish keywords in context
    Object.keys(turkishKeywordMap).forEach(turkishKeyword => {
      if (contextLower.includes(turkishKeyword)) {
        foundKeywords.push(turkishKeyword);
        foundKeywords.push(...turkishKeywordMap[turkishKeyword]);
      }
    });

    return foundKeywords;
  }

  /**
   * Filter options based on context keywords
   * @param {Array} options - All available options
   * @param {Array} keywords - Context keywords
   * @returns {Array} Filtered options
   */
  filterOptionsByContext(options, keywords) {
    if (!keywords || keywords.length === 0) {
      return options;
    }

    const keywordsLower = keywords.map(k => k.toLowerCase());
    
    return options.filter(option => {
      const optionText = option.value?.toLowerCase() || '';
      const optionSK = option.SK?.toLowerCase() || '';
      
      // Check if any keyword appears in the option text or SK
      return keywordsLower.some(keyword => 
        optionText.includes(keyword) || optionSK.includes(keyword)
      );
    });
  }

  /**
   * Replace [BLANK] fields in an introduction message with random selections from election options
   * @param {string} assistantId - The assistant ID
   * @param {string} introMessage - Introduction message with [BLANK] fields
   * @returns {Promise<Object>} Processed message with replacements and metadata
   */
  async replaceBlanksWithOptions(assistantId, introMessage) {
    try {
      console.log(`🔄 Processing introduction message for assistant: ${assistantId}`);
      
      const blankFields = this.parseBlankFields(introMessage);
      
      if (blankFields.length === 0) {
        console.log(`ℹ️ No [BLANK] fields found in introduction message`);
        return {
          processedMessage: introMessage,
          replacements: [],
          originalMessage: introMessage
        };
      }

      console.log(`📝 Found ${blankFields.length} [BLANK] fields to replace`);

      let processedMessage = introMessage;
      const replacements = [];

      // Process each blank field
      for (let i = 0; i < blankFields.length; i++) {
        const blankField = blankFields[i];
        console.log(`🎯 Processing blank field ${i + 1}: "${blankField.contextBefore}[BLANK]${blankField.contextAfter}"`);

        const availableOptions = await this.getOptionsForBlankField(assistantId, blankField);
        
        if (availableOptions.length === 0) {
          console.warn(`⚠️ No options available for blank field ${i + 1}, skipping`);
          continue;
        }

        // Select a random option
        const selectedOption = this.assistantService.getRandomOption(availableOptions);
        const replacementValue = selectedOption.value || selectedOption.text || 'Unknown Option';

        console.log(`✅ Selected option for blank field ${i + 1}: "${replacementValue}"`);

        // Replace the first occurrence of [BLANK] with the selected value
        processedMessage = processedMessage.replace('[BLANK]', replacementValue);

        replacements.push({
          fieldIndex: i,
          context: blankField.fullContext,
          selectedOption: selectedOption,
          replacementValue: replacementValue,
          availableOptionsCount: availableOptions.length
        });
      }

      console.log(`🎉 Successfully replaced ${replacements.length} [BLANK] fields`);

      return {
        processedMessage,
        replacements,
        originalMessage: introMessage,
        assistantId,
        processedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error(`❌ Error replacing blank fields:`, error.message);
      throw error;
    }
  }

  /**
   * Generate multiple variations of an introduction message by replacing blanks differently
   * @param {string} assistantId - The assistant ID
   * @param {string} introMessage - Introduction message with [BLANK] fields
   * @param {number} variationCount - Number of variations to generate
   * @returns {Promise<Array>} Array of processed message variations
   */
  async generateMessageVariations(assistantId, introMessage, variationCount = 5) {
    console.log(`🎭 Generating ${variationCount} variations of introduction message`);
    
    const variations = [];
    const usedCombinations = new Set();

    for (let i = 0; i < variationCount; i++) {
      const variation = await this.replaceBlanksWithOptions(assistantId, introMessage);
      
      // Create a key to track unique combinations
      const combinationKey = variation.replacements
        .map(r => r.replacementValue)
        .join('|');

      // Ensure uniqueness
      if (!usedCombinations.has(combinationKey)) {
        usedCombinations.add(combinationKey);
        variations.push({
          ...variation,
          variationIndex: i + 1
        });
        console.log(`📝 Generated variation ${i + 1}/${variationCount}`);
      } else {
        console.log(`🔄 Duplicate combination, retrying variation ${i + 1}...`);
        i--; // Retry this iteration
      }

      // Prevent infinite loops
      if (variations.length >= variationCount || i >= variationCount * 2) {
        break;
      }
    }

    console.log(`✅ Generated ${variations.length} unique message variations`);
    return variations;
  }

  /**
   * Preview how blank fields would be replaced (for testing)
   * @param {string} assistantId - The assistant ID
   * @param {string} introMessage - Introduction message with [BLANK] fields
   * @returns {Promise<void>} Logs preview to console
   */
  async previewBlankReplacement(assistantId, introMessage) {
    console.log(`👀 Previewing blank field replacement...`);
    console.log(`${"=".repeat(60)}`);
    
    const blankFields = this.parseBlankFields(introMessage);
    
    console.log(`📝 Original message:`);
    console.log(introMessage);
    console.log(`\n📋 Found ${blankFields.length} [BLANK] fields:`);

    for (let i = 0; i < blankFields.length; i++) {
      const blankField = blankFields[i];
      console.log(`\n--- Blank Field ${i + 1} ---`);
      console.log(`Context: "${blankField.fullContext}"`);
      
      const options = await this.getOptionsForBlankField(assistantId, blankField);
      console.log(`Available options (${options.length}):`);
      
      options.slice(0, 5).forEach((option, idx) => {
        console.log(`  ${idx + 1}. ${option.value || option.text}`);
      });
      
      if (options.length > 5) {
        console.log(`  ... and ${options.length - 5} more options`);
      }
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`✅ Preview complete!`);
  }
}

export default BlankFieldReplacer;
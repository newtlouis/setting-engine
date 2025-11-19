/**
 * Utility Functions
 * 
 * Helper functions for validation, sanitization, and formatting.
 */

/**
 * Validate conversation history format
 */
export function validateConversation(conversationHistory) {
  if (!Array.isArray(conversationHistory)) {
    throw new Error('conversationHistory must be an array');
  }

  if (conversationHistory.length === 0) {
    throw new Error('conversationHistory cannot be empty');
  }

  for (let i = 0; i < conversationHistory.length; i++) {
    const message = conversationHistory[i];

    if (!message.role || !message.text) {
      throw new Error(`Message ${i} must have 'role' and 'text' properties`);
    }

    if (!['user', 'assistant'].includes(message.role)) {
      throw new Error(`Message ${i} role must be 'user' or 'assistant'`);
    }

    if (typeof message.text !== 'string') {
      throw new Error(`Message ${i} text must be a string`);
    }
  }

  return true;
}

/**
 * Sanitize message output
 * - Remove excessive whitespace
 * - Limit message length
 * - Remove potentially problematic characters
 */
export function sanitizeMessage(message) {
  let sanitized = message.trim();

  // Remove multiple spaces
  sanitized = sanitized.replace(/\s+/g, ' ');

  // Remove excessive newlines (max 2)
  sanitized = sanitized.replace(/\n{3,}/g, '\n\n');

  // Limit message length (Instagram DM best practice: ~500 chars)
  const MAX_LENGTH = 500;
  if (sanitized.length > MAX_LENGTH) {
    sanitized = sanitized.substring(0, MAX_LENGTH - 3) + '...';
  }

  return sanitized;
}

/**
 * Calculate message sentiment score
 * Simple positive/negative word counting
 */
export function calculateSentiment(text) {
  const positiveWords = ['great', 'good', 'excellent', 'amazing', 'wonderful', 'perfect', 'love', 'yes', 'interested', 'excited'];
  const negativeWords = ['bad', 'no', 'can\'t', 'don\'t', 'won\'t', 'never', 'hate', 'frustrated', 'angry', 'disappointed'];

  const lowerText = text.toLowerCase();
  
  let score = 0;
  positiveWords.forEach(word => {
    if (lowerText.includes(word)) score++;
  });
  
  negativeWords.forEach(word => {
    if (lowerText.includes(word)) score--;
  });

  return score;
}

/**
 * Format conversation for display
 */
export function formatConversationForDisplay(conversationHistory) {
  return conversationHistory.map((msg, i) => {
    const role = msg.role === 'user' ? 'PROSPECT' : 'YOU';
    return `[${i + 1}] ${role}: ${msg.text}`;
  }).join('\n\n');
}

/**
 * Detect if message is too short/low-effort
 */
export function isLowEffortMessage(text) {
  const trimmed = text.trim();
  
  // Very short messages
  if (trimmed.length < 10) return true;
  
  // Single word responses
  if (trimmed.split(/\s+/).length === 1) return true;
  
  // Only emojis
  if (/^[\p{Emoji}\s]+$/u.test(trimmed)) return true;
  
  return false;
}

/**
 * Extract questions from message
 */
export function extractQuestions(text) {
  // Split by question marks and filter non-empty
  const questions = text.split('?').map(q => q.trim()).filter(q => q.length > 5);
  return questions.map(q => q + '?');
}

/**
 * Get message character count (useful for Instagram limits)
 */
export function getCharacterCount(text) {
  return text.length;
}

/**
 * Check if message is appropriate (basic profanity filter)
 */
export function isAppropriate(text) {
  const profanity = ['fuck', 'shit', 'ass', 'damn', 'hell', 'bitch'];
  const lowerText = text.toLowerCase();
  
  return !profanity.some(word => lowerText.includes(word));
}

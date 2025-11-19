/**
 * Conversation State Machine
 * 
 * Analyzes conversation history to determine current stage and intent.
 */

/**
 * Analyze conversation to determine current stage
 * 
 * @param {Array} conversationHistory - Array of message objects
 * @param {Object} leadContext - Lead data from prospector (optional)
 * @returns {string} Current conversation stage
 */
export function analyzeConversationStage(conversationHistory, leadContext) {
  const messageCount = conversationHistory.length;
  const latestMessage = conversationHistory[messageCount - 1];

  // Check for explicit stage signals
  if (isSchedulingStage(conversationHistory)) {
    return 'scheduling';
  }

  if (isCTAStage(conversationHistory)) {
    return 'call_to_action';
  }

  if (isObjectionStage(latestMessage.text)) {
    return 'objection_handling';
  }

  if (isQualificationStage(conversationHistory)) {
    return 'qualification';
  }

  if (isValueStage(conversationHistory)) {
    return 'value_demonstration';
  }

  // Early stage: empathy and rapport
  if (messageCount <= 2) {
    return 'initial_rapport';
  }

  if (messageCount <= 4) {
    return 'empathy_building';
  }

  // Default: qualification
  return 'qualification';
}

/**
 * Detect user intent from message
 */
export function detectIntent(messageText) {
  const text = messageText.toLowerCase();

  // Objections
  if (/too expensive|can't afford|don't have money|price|cost/i.test(text)) {
    return { type: 'objection', objection: 'price' };
  }

  if (/don't have time|too busy|no time/i.test(text)) {
    return { type: 'objection', objection: 'time' };
  }

  if (/doesn't work|tried before|scam|skeptical|doubt/i.test(text)) {
    return { type: 'objection', objection: 'skepticism' };
  }

  // Questions
  if (/how|what|when|where|why|can you|\?/i.test(text)) {
    return { type: 'asking_question' };
  }

  // Positive signals
  if (/interested|yes|sounds good|tell me more|when can we|book|schedule/i.test(text)) {
    return { type: 'positive_signal' };
  }

  // Pain expression
  if (/struggling|help|lost|frustrated|stuck|don't know|need|problem/i.test(text)) {
    return { type: 'expressing_pain' };
  }

  // Neutral
  return { type: 'neutral' };
}

/**
 * Extract pain points mentioned in message
 */
export function extractPainPoints(messageText) {
  const painPoints = [];

  const painPatterns = [
    { pattern: /struggl(e|ing) with ([^.,!?]+)/i, group: 2 },
    { pattern: /can't (seem to )?([^.,!?]+)/i, group: 2 },
    { pattern: /problem with ([^.,!?]+)/i, group: 1 },
    { pattern: /frustrated (with|about) ([^.,!?]+)/i, group: 2 },
    { pattern: /don't know how to ([^.,!?]+)/i, group: 1 },
    { pattern: /need help (with )?([^.,!?]+)/i, group: 2 },
    { pattern: /stuck (with|on) ([^.,!?]+)/i, group: 2 }
  ];

  for (const { pattern, group } of painPatterns) {
    const match = messageText.match(pattern);
    if (match && match[group]) {
      painPoints.push(match[group].trim());
    }
  }

  return painPoints;
}

/**
 * Check if conversation is in scheduling stage
 */
function isSchedulingStage(conversationHistory) {
  const recentMessages = conversationHistory.slice(-3).map(m => m.text).join(' ');
  return /schedule|book|calendar|when are you free|what time|available/i.test(recentMessages);
}

/**
 * Check if conversation is ready for CTA
 */
function isCTAStage(conversationHistory) {
  const recentMessages = conversationHistory.slice(-3).map(m => m.text).join(' ');
  return /interested|tell me more|sounds good|yes|i'm in|sign me up/i.test(recentMessages);
}

/**
 * Check if message contains objection
 */
function isObjectionStage(messageText) {
  return /but |however |expensive|can't|don't|too |not sure|skeptical|tried before/i.test(messageText);
}

/**
 * Check if conversation is in qualification stage
 */
function isQualificationStage(conversationHistory) {
  // If we've exchanged 3+ messages and no CTA yet, likely qualifying
  if (conversationHistory.length >= 3 && conversationHistory.length <= 6) {
    return true;
  }
  return false;
}

/**
 * Check if conversation is in value demonstration stage
 */
function isValueStage(conversationHistory) {
  const hasQualificationQuestions = conversationHistory.some(msg =>
    /when|how soon|ready|commit|invest|timeline/i.test(msg.text)
  );

  const hasPositiveSignals = conversationHistory.some(msg =>
    /interested|yes|sounds good|tell me more/i.test(msg.text)
  );

  return hasQualificationQuestions && hasPositiveSignals;
}

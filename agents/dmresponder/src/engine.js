/**
 * DM Responder Conversation Engine
 * 
 * Core logic for generating contextual follow-up messages based on conversation state.
 */

import { analyzeConversationStage, detectIntent, extractPainPoints } from './state_machine.js';
import { 
  EMPATHY_TEMPLATES, 
  QUALIFICATION_TEMPLATES, 
  OBJECTION_TEMPLATES,
  CTA_TEMPLATES,
  generatePersonalizedMessage 
} from './templates.js';
import { sanitizeMessage, validateConversation } from './utils.js';

/**
 * Generate response for a conversation
 * 
 * @param {Object} params
 * @param {Array} params.conversationHistory - Array of {role, text} objects
 * @param {Object} params.leadContext - Optional lead data from prospector
 * @param {Object} params.businessContext - Optional business details
 * @returns {Promise<Object>} Response object with next_message, stage, reasoning, etc.
 */
export async function generateResponse({ conversationHistory, leadContext, businessContext }) {
  // Validate input
  validateConversation(conversationHistory);

  // Get the latest user message
  const latestMessage = conversationHistory[conversationHistory.length - 1];
  
  if (latestMessage.role !== 'user') {
    throw new Error('Latest message must be from user (prospect)');
  }

  // Analyze conversation stage
  const stage = analyzeConversationStage(conversationHistory, leadContext);

  // Detect user intent
  const intent = detectIntent(latestMessage.text);

  // Extract pain points mentioned
  const painPoints = extractPainPoints(latestMessage.text);

  // Build context for message generation
  const context = {
    userMessage: latestMessage.text,
    conversationHistory,
    stage,
    intent,
    painPoints,
    leadContext,
    businessContext
  };

  // Generate response based on stage and intent
  let response;

  switch (stage) {
    case 'initial_rapport':
    case 'empathy_building':
      response = generateEmpathyResponse(context);
      break;

    case 'qualification':
      response = generateQualificationResponse(context);
      break;

    case 'objection_handling':
      response = generateObjectionResponse(context);
      break;

    case 'value_demonstration':
      response = generateValueResponse(context);
      break;

    case 'call_to_action':
    case 'scheduling':
      response = generateCTAResponse(context);
      break;

    default:
      response = generateDefaultResponse(context);
  }

  // Sanitize output
  response.next_message = sanitizeMessage(response.next_message);

  return response;
}

/**
 * Generate empathy-focused response
 */
function generateEmpathyResponse(context) {
  const { userMessage, painPoints, intent } = context;

  // Select appropriate template
  let template;
  let reasoning = '';

  if (intent.type === 'expressing_pain') {
    template = EMPATHY_TEMPLATES.pain_acknowledgment;
    reasoning = 'User is expressing emotional pain or struggle. Respond with empathy and validation.';
  } else if (intent.type === 'asking_question') {
    template = EMPATHY_TEMPLATES.curiosity_response;
    reasoning = 'User is asking a question. Show empathy while gently guiding toward qualification.';
  } else {
    template = EMPATHY_TEMPLATES.general;
    reasoning = 'Building initial rapport with empathetic, human tone.';
  }

  const message = generatePersonalizedMessage(template, {
    painPoints: painPoints.length > 0 ? painPoints[0] : 'this challenge',
    userMessage
  });

  return {
    next_message: message,
    conversation_stage: 'empathy_building',
    message_type: 'empathy',
    reasoning,
    alternative_approaches: [
      'Ask a follow-up question about their specific situation',
      'Share a brief relatable story (1-2 sentences)',
      'Validate their feelings and offer hope'
    ],
    next_steps: [
      'Wait for their response',
      'Look for qualification signals (timeline, commitment level)',
      'Continue building trust before pitching'
    ]
  };
}

/**
 * Generate qualification question
 */
function generateQualificationResponse(context) {
  const { conversationHistory, painPoints, leadContext } = context;

  // Determine what to qualify
  const needsToQualify = determineQualificationNeeds(conversationHistory, leadContext);

  let template;
  let reasoning = '';

  if (needsToQualify.includes('timeline')) {
    template = QUALIFICATION_TEMPLATES.timeline;
    reasoning = 'Need to understand their timeline and urgency.';
  } else if (needsToQualify.includes('budget')) {
    template = QUALIFICATION_TEMPLATES.investment_readiness;
    reasoning = 'Qualify their readiness to invest (without mentioning price directly).';
  } else if (needsToQualify.includes('commitment')) {
    template = QUALIFICATION_TEMPLATES.commitment_level;
    reasoning = 'Assess their commitment level and seriousness.';
  } else {
    template = QUALIFICATION_TEMPLATES.pain_depth;
    reasoning = 'Deepen understanding of their pain points.';
  }

  const message = generatePersonalizedMessage(template, {
    painPoint: painPoints.length > 0 ? painPoints[0] : 'your situation'
  });

  return {
    next_message: message,
    conversation_stage: 'qualification',
    message_type: 'qualification',
    reasoning,
    alternative_approaches: [
      'Use a curiosity-based question instead of direct qualification',
      'Share a relevant client success story to gauge interest',
      'Ask about their biggest obstacle right now'
    ],
    next_steps: [
      'Listen for buying signals (urgency, frustration with current state)',
      'If qualified, transition to value demonstration',
      'If not qualified, nurture with value content'
    ]
  };
}

/**
 * Generate objection handling response
 */
function generateObjectionResponse(context) {
  const { userMessage, intent } = context;

  let template;
  let reasoning = '';

  if (intent.objection === 'price') {
    template = OBJECTION_TEMPLATES.price;
    reasoning = 'User is concerned about price. Reframe to value and ROI.';
  } else if (intent.objection === 'time') {
    template = OBJECTION_TEMPLATES.time;
    reasoning = 'User says they don\'t have time. Address with efficiency and prioritization.';
  } else if (intent.objection === 'skepticism') {
    template = OBJECTION_TEMPLATES.skepticism;
    reasoning = 'User is skeptical. Use social proof and understanding.';
  } else {
    template = OBJECTION_TEMPLATES.general;
    reasoning = 'General objection detected. Acknowledge and reframe.';
  }

  const message = generatePersonalizedMessage(template, { userMessage });

  return {
    next_message: message,
    conversation_stage: 'objection_handling',
    message_type: 'objection_response',
    reasoning,
    alternative_approaches: [
      'Use a "feel, felt, found" framework',
      'Ask a clarifying question to understand the real objection',
      'Share a specific client transformation story'
    ],
    next_steps: [
      'Wait for their response to the reframe',
      'If objection persists, qualify harder (may not be right fit)',
      'If objection resolves, move to CTA'
    ]
  };
}

/**
 * Generate value-focused response
 */
function generateValueResponse(context) {
  const { leadContext, painPoints, businessContext } = context;

  const message = generatePersonalizedMessage(
    'Based on what you\'ve shared, I think I can help. [Insert specific value prop based on their pain]. Would you be open to a quick call to see if this could work for you?',
    { 
      painPoint: painPoints.length > 0 ? painPoints[0] : 'your goals',
      service: businessContext?.service || 'my program'
    }
  );

  return {
    next_message: message,
    conversation_stage: 'value_demonstration',
    message_type: 'value_prop',
    reasoning: 'User is qualified and interested. Present clear value tied to their pain points.',
    alternative_approaches: [
      'Share a before/after case study matching their situation',
      'Offer a free resource or assessment first',
      'Ask what success would look like for them in 90 days'
    ],
    next_steps: [
      'If interested, transition to call scheduling',
      'If hesitant, address remaining objections',
      'If not ready, offer to stay in touch'
    ]
  };
}

/**
 * Generate call-to-action response
 */
function generateCTAResponse(context) {
  const { stage } = context;

  let template;
  let reasoning = '';

  if (stage === 'scheduling') {
    template = CTA_TEMPLATES.scheduling;
    reasoning = 'User agreed to a call. Make scheduling easy and low-pressure.';
  } else {
    template = CTA_TEMPLATES.soft_cta;
    reasoning = 'User is interested but not fully committed. Use soft CTA.';
  }

  const message = generatePersonalizedMessage(template, {});

  return {
    next_message: message,
    conversation_stage: stage,
    message_type: 'call_to_action',
    reasoning,
    alternative_approaches: [
      'Offer 2-3 specific time slots instead of open-ended ask',
      'Send calendar link directly (if already using scheduling tool)',
      'Suggest a short 15-min clarity call first'
    ],
    next_steps: [
      'Send calendar link or confirm time',
      'Send pre-call prep questions if they book',
      'Follow up in 24-48h if no response'
    ]
  };
}

/**
 * Generate default/fallback response
 */
function generateDefaultResponse(context) {
  const message = 'Thanks for sharing that. Can you tell me more about what you\'re looking to achieve?';

  return {
    next_message: message,
    conversation_stage: 'initial_rapport',
    message_type: 'rapport',
    reasoning: 'Default response: gathering more information to understand their needs.',
    alternative_approaches: [
      'Ask about their biggest challenge right now',
      'Ask what they\'ve already tried',
      'Ask what would make this conversation valuable for them'
    ],
    next_steps: [
      'Listen for pain points and goals',
      'Transition to qualification when appropriate',
      'Build rapport before pitching'
    ]
  };
}

/**
 * Determine what still needs to be qualified
 */
function determineQualificationNeeds(conversationHistory, leadContext) {
  const needs = [];

  // Check if timeline has been discussed
  const hasTimeline = conversationHistory.some(msg => 
    /when|timeline|how soon|urgent|asap/i.test(msg.text)
  );
  if (!hasTimeline) needs.push('timeline');

  // Check if commitment has been discussed
  const hasCommitment = conversationHistory.some(msg =>
    /ready|commit|serious|willing|invest/i.test(msg.text)
  );
  if (!hasCommitment) needs.push('commitment');

  // Check if budget/investment readiness discussed
  const hasBudget = conversationHistory.some(msg =>
    /afford|price|cost|budget|invest|pay/i.test(msg.text)
  );
  if (!hasBudget) needs.push('budget');

  // Default to pain depth if all else covered
  if (needs.length === 0) needs.push('pain_depth');

  return needs;
}

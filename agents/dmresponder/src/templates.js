/**
 * Message Templates
 * 
 * Pre-written message templates organized by type and stage.
 */

export const EMPATHY_TEMPLATES = {
  pain_acknowledgment: 'I hear you. {painPoints} can be really tough, especially when you feel like you\'ve tried everything. You\'re not alone in this. Can I ask you something that might help me understand better?',
  
  curiosity_response: 'That\'s a great question. Before I answer, can I ask—what made you reach out about this now? I want to make sure I give you the most helpful response.',
  
  general: 'Thanks for sharing that with me. It sounds like this has been on your mind for a while. What would change for you if you could solve this?'
};

export const QUALIFICATION_TEMPLATES = {
  timeline: 'I appreciate you sharing that. Just curious—how soon are you looking to make a change? Is this something you want to tackle in the next few weeks, or are you still exploring?',
  
  commitment_level: 'I get it. Let me ask you something: if I could show you a way to {achieve their goal}, what would hold you back from starting?',
  
  investment_readiness: 'Makes sense. Quick question—if this was the right fit for you, are you in a position to invest in yourself right now, or is this more of a "someday" thing?',
  
  pain_depth: 'I hear you. On a scale of 1-10, how much is {painPoint} affecting your life right now? And what happens if nothing changes?'
};

export const OBJECTION_TEMPLATES = {
  price: 'I totally understand. Most people I work with felt the same way at first. What they realized is that the cost of staying stuck is way higher than the investment in solving it. Can I ask—what\'s it costing you to not fix this right now?',
  
  time: 'I get it—you\'re busy. Here\'s the thing: this is designed for people who don\'t have time. That\'s exactly why it works. What if I could show you how to get results without adding hours to your week?',
  
  skepticism: 'That\'s fair. You\'ve probably seen a lot of people promise things and not deliver. I respect that you\'re cautious. What would you need to see to feel confident this is different?',
  
  general: 'I understand where you\'re coming from. A lot of people I work with had the same concern. Can you tell me more about what\'s making you hesitate?'
};

export const CTA_TEMPLATES = {
  soft_cta: 'Based on what you\'ve shared, I think I can help. Would you be open to a quick 15-minute call to see if this could work for you? No pressure—just a conversation.',
  
  scheduling: 'Perfect! Let me send you my calendar link. Pick a time that works for you, and we\'ll hop on a call. Sound good?',
  
  direct_cta: 'Got it. Here\'s what I suggest: let\'s set up a call to go over your specific situation and see if this is a fit. Worst case, you get some free insights. Best case, we map out a plan to solve this. What do you think?'
};

export const VALUE_TEMPLATES = {
  results_focused: 'Here\'s what I\'ve seen work: when someone in your situation {takes specific action}, they usually see {specific result} within {timeframe}. Would that kind of result be valuable to you?',
  
  case_study: 'I had a client in a similar spot. They were {pain point}, and after {timeframe}, they {specific outcome}. Would you like to hear how they did it?',
  
  framework: 'The way I approach this is simple: {3-step framework}. Does that approach make sense for what you\'re dealing with?'
};

/**
 * Generate personalized message from template
 * 
 * @param {string} template - Template string with {placeholders}
 * @param {Object} variables - Key-value pairs to replace placeholders
 * @returns {string} Personalized message
 */
export function generatePersonalizedMessage(template, variables) {
  let message = template;

  for (const [key, value] of Object.entries(variables)) {
    const placeholder = new RegExp(`\\{${key}\\}`, 'gi');
    message = message.replace(placeholder, value);
  }

  // Remove any unreplaced placeholders
  message = message.replace(/\{[^}]+\}/g, '[specific detail]');

  return message;
}

/**
 * Get empathy message based on pain type
 */
export function getEmpathyMessage(painType) {
  const empathyMap = {
    'fitness': 'I know how frustrating it can be when you\'re putting in effort but not seeing results.',
    'business': 'Building a business is hard, especially when you feel like you\'re doing everything alone.',
    'relationship': 'Relationship challenges can feel isolating. You\'re not alone in this.',
    'career': 'Career transitions are stressful, especially when you\'re not sure what the next step is.',
    'default': 'I hear you. That sounds really challenging.'
  };

  return empathyMap[painType] || empathyMap.default;
}

/**
 * Get qualification question based on missing info
 */
export function getQualificationQuestion(missingInfo) {
  const qualificationMap = {
    'timeline': QUALIFICATION_TEMPLATES.timeline,
    'budget': QUALIFICATION_TEMPLATES.investment_readiness,
    'commitment': QUALIFICATION_TEMPLATES.commitment_level,
    'pain': QUALIFICATION_TEMPLATES.pain_depth
  };

  return qualificationMap[missingInfo] || QUALIFICATION_TEMPLATES.pain_depth;
}

/**
 * Configuration Constants
 */

export const CONFIG = {
  // Message limits
  MAX_MESSAGE_LENGTH: 500,
  MIN_MESSAGE_LENGTH: 10,

  // Conversation stages
  STAGES: [
    'initial_rapport',
    'empathy_building',
    'qualification',
    'objection_handling',
    'value_demonstration',
    'call_to_action',
    'scheduling',
    'closed_won',
    'closed_lost'
  ],

  // Message types
  MESSAGE_TYPES: [
    'empathy',
    'qualification',
    'rapport',
    'objection_response',
    'value_prop',
    'call_to_action',
    'scheduling'
  ],

  // Qualification criteria
  QUALIFICATION_FACTORS: [
    'timeline',
    'budget',
    'commitment',
    'pain_depth',
    'decision_authority'
  ],

  // Default business context
  DEFAULT_BUSINESS_CONTEXT: {
    service: 'coaching',
    niche: 'transformation',
    timeline: '90 days',
    format: '1-on-1 coaching'
  }
};

/**
 * Shared Constants
 * 
 * Common constants used across multiple agents.
 */

/**
 * Lead warmth classifications
 */
export const WARMTH = {
  WARM: 'warm',
  COLD: 'cold',
  IRRELEVANT: 'irrelevant'
};

/**
 * Conversation stages
 */
export const CONVERSATION_STAGES = {
  INITIAL_RAPPORT: 'initial_rapport',
  EMPATHY_BUILDING: 'empathy_building',
  QUALIFICATION: 'qualification',
  OBJECTION_HANDLING: 'objection_handling',
  VALUE_DEMONSTRATION: 'value_demonstration',
  CALL_TO_ACTION: 'call_to_action',
  SCHEDULING: 'scheduling',
  CLOSED_WON: 'closed_won',
  CLOSED_LOST: 'closed_lost'
};

/**
 * Message types
 */
export const MESSAGE_TYPES = {
  EMPATHY: 'empathy',
  QUALIFICATION: 'qualification',
  RAPPORT: 'rapport',
  OBJECTION_RESPONSE: 'objection_response',
  VALUE_PROP: 'value_prop',
  CALL_TO_ACTION: 'call_to_action',
  SCHEDULING: 'scheduling'
};

/**
 * Message purposes
 */
export const MESSAGE_PURPOSES = {
  RAPPORT: 'rapport',
  PAIN_POINT: 'pain_point',
  CTA: 'cta',
  QUALIFICATION: 'qualification'
};

/**
 * Instagram URL patterns
 */
export const INSTAGRAM_URLS = {
  BASE: 'https://www.instagram.com',
  LOGIN: 'https://www.instagram.com/accounts/login/',
  HASHTAG: (tag) => `https://www.instagram.com/explore/tags/${tag}/`,
  PROFILE: (username) => `https://www.instagram.com/${username}/`,
  POST_PATTERN: /^https:\/\/www\.instagram\.com\/(p|reel)\/[^/]+\/?$/,
  PROFILE_PATTERN: /^https:\/\/www\.instagram\.com\/[^/]+\/?$/
};

/**
 * Score thresholds
 */
export const SCORE_THRESHOLDS = {
  WARM_MIN: 70,
  COLD_MIN: 40,
  IRRELEVANT_MAX: 39
};

/**
 * CSV column definitions
 */
export const CSV_COLUMNS = {
  POSTS: [
    'source_type',
    'source_name',
    'post_url',
    'post_date',
    'likes',
    'comments_count',
    'caption_excerpt'
  ],
  COMMENTS: [
    'post_url',
    'username',
    'profile_url',
    'comment_text',
    'comment_date',
    'followers_estimate'
  ]
};

/**
 * Default configuration values
 */
export const DEFAULTS = {
  MAX_POSTS_PER_SOURCE: 50,
  MAX_COMMENTS_PER_POST: 100,
  MIN_DELAY: 3000,
  MAX_DELAY: 7000,
  MAX_MESSAGE_LENGTH: 500,
  MIN_MESSAGE_LENGTH: 10,
  TOP_PROSPECTS_COUNT: 5
};

/**
 * Error messages
 */
export const ERRORS = {
  INVALID_USERNAME: 'Invalid Instagram username format',
  INVALID_POST_URL: 'Invalid Instagram post URL',
  INVALID_PROFILE_URL: 'Invalid Instagram profile URL',
  INVALID_WARMTH: 'Warmth must be warm, cold, or irrelevant',
  INVALID_SCORE: 'Score must be between 0 and 100',
  INVALID_ROLE: 'Role must be user or assistant',
  EMPTY_CONVERSATION: 'Conversation history cannot be empty',
  LAST_MESSAGE_NOT_USER: 'Last message must be from user',
  FILE_NOT_FOUND: 'File not found',
  PARSE_ERROR: 'Failed to parse file'
};

/**
 * Success messages
 */
export const SUCCESS = {
  COLLECTION_COMPLETE: 'Collection complete',
  POSTS_SAVED: 'Posts saved successfully',
  COMMENTS_SAVED: 'Comments saved successfully',
  LEADS_GENERATED: 'Leads generated successfully',
  MESSAGES_GENERATED: 'Messages generated successfully',
  RESPONSE_GENERATED: 'Response generated successfully'
};

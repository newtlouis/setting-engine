/**
 * First Message Templates
 * 
 * Templates for initial outreach DMs.
 * Each template is designed to be personalized based on lead data.
 */

/**
 * Template categories based on lead warmth and context
 */
export const TEMPLATES = {
  // For leads who showed pain/frustration in comments
  pain_based: [
    {
      id: 'pain_empathy',
      template: `Hey {{firstName}}! I saw your comment on that post about {{topic}} - sounds like you're dealing with some real challenges there. I work with people going through the same thing. Would love to hear more about what you're struggling with if you're open to it!`,
      variables: ['firstName', 'topic'],
      tone: 'empathetic',
      best_for: ['expressing_pain', 'frustrated']
    },
    {
      id: 'pain_solution',
      template: `Hey! Noticed your comment about {{painPoint}}. I've helped a lot of people work through exactly that. No pitch - just curious what you've tried so far?`,
      variables: ['painPoint'],
      tone: 'helpful',
      best_for: ['seeking_advice', 'stuck']
    }
  ],
  
  // For leads who asked questions in comments
  question_based: [
    {
      id: 'question_answer',
      template: `Hey {{firstName}}! Saw your question about {{topic}}. Great question btw. The short answer is {{shortAnswer}}... but there's more to it. Happy to share what's worked for me if you're interested!`,
      variables: ['firstName', 'topic', 'shortAnswer'],
      tone: 'helpful',
      best_for: ['asking_question', 'curious']
    },
    {
      id: 'question_curiosity',
      template: `Hey! Your question about {{topic}} caught my eye - it's something I get asked a lot. Mind if I ask what made you curious about that?`,
      variables: ['topic'],
      tone: 'curious',
      best_for: ['asking_question']
    }
  ],
  
  // For leads who showed interest/engagement
  engagement_based: [
    {
      id: 'engagement_connection',
      template: `Hey {{firstName}}! I noticed you're super engaged in the {{niche}} space. Love your energy. What's your current focus/goal?`,
      variables: ['firstName', 'niche'],
      tone: 'friendly',
      best_for: ['high_engagement', 'active']
    },
    {
      id: 'engagement_value',
      template: `Hey! Saw you commenting on {{creatorName}}'s post. I share similar content - thought you might find some of it helpful. What's your biggest challenge with {{topic}} right now?`,
      variables: ['creatorName', 'topic'],
      tone: 'value-first',
      best_for: ['medium_engagement']
    }
  ],
  
  // Generic templates (use sparingly)
  generic: [
    {
      id: 'generic_intro',
      template: `Hey {{firstName}}! Noticed your comment and thought I'd reach out. I help people with {{topic}} - would love to connect if that's something you're working on!`,
      variables: ['firstName', 'topic'],
      tone: 'friendly',
      best_for: ['any']
    },
    {
      id: 'generic_question',
      template: `Hey! Quick question - what's your biggest challenge with {{topic}} right now? Curious because I work with people on exactly that.`,
      variables: ['topic'],
      tone: 'curious',
      best_for: ['any']
    }
  ]
};

/**
 * Select the best template based on lead data
 * 
 * @param {Object} lead - Lead data from database
 * @param {Array} comments - Lead's comments
 * @returns {Object} Selected template with reasoning
 */
export function selectTemplate(lead, comments = []) {
  // Analyze comments to determine intent
  const commentTexts = comments.map(c => c.comment_text || '').join(' ').toLowerCase();
  
  // Check for pain signals
  const painSignals = [
    'struggling', 'help', 'frustrated', 'stuck', "can't", 'lost', 
    'problem', 'issue', 'failing', 'need advice', 'any tips'
  ];
  const hasPainSignals = painSignals.some(signal => commentTexts.includes(signal));
  
  // Check for questions
  const hasQuestion = commentTexts.includes('?') || 
    /how (do|can|should)|what (is|are|should)|why (is|do)|where (can|do)/i.test(commentTexts);
  
  // Select category
  let category;
  let reasoning;
  
  if (hasPainSignals) {
    category = 'pain_based';
    reasoning = 'Lead expressed pain/frustration in comments';
  } else if (hasQuestion) {
    category = 'question_based';
    reasoning = 'Lead asked questions in comments';
  } else if (lead.engagement_level === 'HIGH' || (lead.total_comments && lead.total_comments >= 3)) {
    category = 'engagement_based';
    reasoning = 'Lead has high engagement level';
  } else {
    category = 'generic';
    reasoning = 'Using generic template (no strong signals detected)';
  }
  
  // Select random template from category
  const templates = TEMPLATES[category];
  const template = templates[Math.floor(Math.random() * templates.length)];
  
  return {
    ...template,
    category,
    reasoning
  };
}

/**
 * Fill template variables with lead data
 * 
 * @param {string} template - Template string with {{variables}}
 * @param {Object} data - Data to fill variables
 * @returns {string} Filled template
 */
export function fillTemplate(template, data) {
  let result = template;
  
  // Replace all {{variable}} patterns
  const variablePattern = /\{\{(\w+)\}\}/g;
  
  result = result.replace(variablePattern, (match, varName) => {
    if (data[varName] !== undefined && data[varName] !== null) {
      return data[varName];
    }
    // Return placeholder if variable not provided
    return `[${varName}]`;
  });
  
  return result;
}

/**
 * Generate a personalized first message
 * 
 * @param {Object} lead - Lead data
 * @param {Array} comments - Lead's comments
 * @param {Object} options - Generation options
 * @returns {Object} Generated message with metadata
 */
export function generateFirstMessage(lead, comments = [], options = {}) {
  const {
    niche = 'fitness',
    topic = 'their goals',
    creatorName = null,
    customTemplate = null
  } = options;
  
  // Use custom template if provided
  let selectedTemplate;
  if (customTemplate) {
    selectedTemplate = {
      template: customTemplate,
      variables: [],
      reasoning: 'Using custom template provided'
    };
  } else {
    selectedTemplate = selectTemplate(lead, comments);
  }
  
  // Extract first name from full_name or username
  let firstName = '';
  if (lead.full_name) {
    firstName = lead.full_name.split(' ')[0];
  } else {
    // Capitalize username, remove underscores/numbers
    firstName = lead.username
      .replace(/[_0-9]+/g, ' ')
      .trim()
      .split(' ')[0];
    firstName = firstName.charAt(0).toUpperCase() + firstName.slice(1);
  }
  
  // Extract pain point from most recent comment
  let painPoint = 'what you mentioned';
  if (comments.length > 0) {
    const latestComment = comments[0].comment_text || '';
    // Try to extract specific pain point
    const painMatch = latestComment.match(/struggl\w* with ([^.,!?]+)/i) ||
                      latestComment.match(/can't ([^.,!?]+)/i) ||
                      latestComment.match(/need help with ([^.,!?]+)/i);
    if (painMatch) {
      painPoint = painMatch[1].trim();
    }
  }
  
  // Fill template
  const templateData = {
    firstName,
    topic,
    niche,
    painPoint,
    creatorName: creatorName || 'that creator',
    shortAnswer: '[your answer]'  // Placeholder - user should fill this
  };
  
  const message = fillTemplate(selectedTemplate.template, templateData);
  
  return {
    message,
    template_id: selectedTemplate.id,
    template_category: selectedTemplate.category,
    reasoning: selectedTemplate.reasoning,
    variables_used: templateData,
    needs_review: message.includes('[')  // Has unfilled placeholders
  };
}

/**
 * Validate message before sending
 * 
 * @param {string} message - Message to validate
 * @returns {Object} { valid: boolean, issues: string[] }
 */
export function validateMessage(message) {
  const issues = [];
  
  // Check length (Instagram DM limit is ~1000 chars)
  if (message.length > 1000) {
    issues.push(`Message too long: ${message.length} chars (max 1000)`);
  }
  
  if (message.length < 20) {
    issues.push('Message too short (min 20 chars)');
  }
  
  // Check for unfilled placeholders
  if (/\[\w+\]/.test(message)) {
    issues.push('Contains unfilled placeholders [like this]');
  }
  
  if (/\{\{\w+\}\}/.test(message)) {
    issues.push('Contains unfilled variables {{like_this}}');
  }
  
  // Check for spammy patterns
  const spammyPatterns = [
    /\$\d+/,  // Dollar amounts
    /free money/i,
    /click (here|this link)/i,
    /limited time offer/i,
    /act now/i,
    /buy now/i
  ];
  
  for (const pattern of spammyPatterns) {
    if (pattern.test(message)) {
      issues.push(`Contains spammy pattern: ${pattern}`);
    }
  }
  
  return {
    valid: issues.length === 0,
    issues
  };
}

export default TEMPLATES;

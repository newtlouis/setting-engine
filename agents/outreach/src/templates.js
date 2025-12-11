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
  // Leads expressing struggle (pain)
  pain_based: [
    {
      id: 'pain_empathy_fr',
      template: `Salut {{firstName}}, ton commentaire sur {{topic}} m'a interpellé. C'est pas évident comme situation... Tu tiens le coup ?`,
      variables: ['firstName', 'topic'],
      tone: 'empathetic',
      best_for: ['expressing_pain', 'frustrated']
    },
    {
      id: 'pain_support_fr',
      template: `Hello {{firstName}}, j'ai lu ce que tu disais sur la dépendance affective. Je connais bien ce sujet, courage à toi !`,
      variables: ['firstName'],
      tone: 'supportive',
      best_for: ['seeking_advice', 'stuck']
    }
  ],
  
  // Leads engaging/asking questions
  question_based: [
    {
      id: 'question_curiosity_fr',
      template: `Salut {{firstName}}, ta question sur la confiance en soi est super pertinente. C'est un sujet qui te préoccupe en ce moment ?`,
      variables: ['firstName'],
      tone: 'curious',
      best_for: ['asking_question', 'curious']
    },
    {
      id: 'question_direct_fr',
      template: `Hello {{firstName}}, je rebondis sur ta question. J'aide justement des personnes à dépasser ça. Tu as déjà testé des méthodes ?`,
      variables: ['firstName'],
      tone: 'helpful',
      best_for: ['asking_question']
    }
  ],
  
  // High engagement leads
  engagement_based: [
    {
      id: 'engagement_common_fr',
      template: `Salut {{firstName}}, je vois qu'on suit les mêmes comptes de dev perso. Au plaisir d'échanger !`,
      variables: ['firstName'],
      tone: 'friendly',
      best_for: ['high_engagement', 'active']
    }
  ],
  
  // Generic / Fallback
  generic: [
    {
      id: 'generic_intro_fr',
      template: `Salut {{firstName}}, je suis tombé sur ton profil via les commentaires. Je partage pas mal de conseils sur la confiance en soi, ça pourrait t'intéresser !`,
      variables: ['firstName'],
      tone: 'friendly',
      best_for: ['any']
    },
    {
      id: 'generic_short_fr',
      template: `Hello {{firstName}}, simple petit message pour t'envoyer de la force dans ton parcours ! 💪`,
      variables: ['firstName'],
      tone: 'supportive',
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
  
  // Check for pain signals (FRENCH)
  const painSignals = [
    'dur', 'difficile', 'triste', 'peur', 'angoisse', 'seul', 
    'besoin d\'aide', 'marre', 'fatigué', 'dépendance', 'toxique',
    'struggling', 'help' // Keep a few English ones just in case
  ];
  const hasPainSignals = painSignals.some(signal => commentTexts.includes(signal));
  
  // Check for questions
  const hasQuestion = commentTexts.includes('?');
  
  // Select category
  let category;
  let reasoning;
  
  if (hasPainSignals) {
    category = 'pain_based';
    reasoning = 'Lead expressed pain/frustration (FR signals detected)';
  } else if (hasQuestion) {
    category = 'question_based';
    reasoning = 'Lead asked questions';
  } else if (lead.engagement_level === 'HIGH') {
    category = 'engagement_based';
    reasoning = 'Lead has high engagement level';
  } else {
    category = 'generic';
    reasoning = 'Using generic short template';
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
  
  // Extract first name from username (full_name removed)
  let firstName = lead.username
      .replace(/[_0-9]+/g, ' ')
      .trim()
      .split(' ')[0];
  firstName = firstName.charAt(0).toUpperCase() + firstName.slice(1);
  
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
  
  if (message.length < 10) {
    issues.push('Message too short (min 10 chars)');
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

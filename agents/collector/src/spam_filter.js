/**
 * Spam Filter Module
 * 
 * Filters out low-quality comments and bot accounts to improve lead quality.
 * Returns both the filtered result and the spam classification for tracking.
 */

// Generic/spam comment patterns
const SPAM_PATTERNS = {
  // Single emoji or emoji-only comments
  emojiOnly: /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\s]+$/u,
  
  // Very short generic comments
  tooShort: /^.{1,3}$/,
  
  // Generic praise (low effort)
  genericPraise: /^(nice|cool|wow|amazing|awesome|great|love it|love this|beautiful|perfect|super|magnifique|génial|trop bien|j'adore|bravo|top|fire|lit|dope|sick|insane|crazy|omg|lol|lmao|haha|yes|yess|yesss|no way|facts|real|true|same|mood|vibe|goals|slay|queen|king|legend|goat|beast|❤️|🔥|👏|💪|😍|🙌|💯|👌|✨|🤩|😎|💕|🥰|😊|👍)+[!?.]*$/i,
  
  // Promo/spam indicators
  promoSpam: /(check.*profile|link.*bio|dm.*collab|follow.*back|f4f|follow4follow|l4l|like4like|dm me|check my|visit my|see my|look at my|promo code|discount|giveaway|free.*followers|gain.*followers|buy.*followers)/i,
  
  // Bot-like usernames (excessive numbers, random chars)
  botUsername: /^[a-z]{2,4}[0-9]{5,}$|^[a-z]+_[0-9]{4,}$|^user[0-9]+$/i,
  
  // Just tagging someone
  justTag: /^@[a-zA-Z0-9._]+\s*$/,
  
  // Random letters/keyboard spam
  keyboardSpam: /^[asdfghjkl]+$|^[qwerty]+$|^[zxcvbnm]+$/i
};

// Quality indicators (if present, likely NOT spam)
const QUALITY_INDICATORS = {
  // Contains a question (shows interest)
  hasQuestion: /\?/,
  
  // Mentions a specific topic/problem
  hasProblem: /(struggle|problem|issue|help|how do|can you|what is|why|when|where|comment|pourquoi|comment faire|aide|besoin)/i,
  
  // Shows personal experience
  personalExperience: /(i've been|i have|i am|i was|my|mine|je suis|j'ai|mon|ma|mes)/i,
  
  // Longer thoughtful comment
  isLong: (text) => text.length > 50,
  
  // Multiple sentences
  multipleSentences: /[.!?]\s+[A-Z]/
};

/**
 * Analyze a comment for spam indicators
 * 
 * @param {Object} comment - Comment object with username and comment_text
 * @returns {Object} { isSpam: boolean, reason: string|null, qualityScore: number }
 */
export function analyzeComment(comment) {
  const text = (comment.comment_text || '').trim();
  const username = (comment.username || '').trim();
  
  // Check for spam patterns
  for (const [patternName, pattern] of Object.entries(SPAM_PATTERNS)) {
    if (patternName === 'botUsername') {
      if (pattern.test(username)) {
        return { isSpam: true, reason: 'bot_username', qualityScore: 0 };
      }
    } else if (pattern instanceof RegExp) {
      if (pattern.test(text)) {
        return { isSpam: true, reason: patternName, qualityScore: 0 };
      }
    }
  }
  
  // Calculate quality score based on positive indicators
  let qualityScore = 5; // Base score
  
  if (QUALITY_INDICATORS.hasQuestion.test(text)) qualityScore += 3;
  if (QUALITY_INDICATORS.hasProblem.test(text)) qualityScore += 4;
  if (QUALITY_INDICATORS.personalExperience.test(text)) qualityScore += 2;
  if (QUALITY_INDICATORS.isLong(text)) qualityScore += 2;
  if (QUALITY_INDICATORS.multipleSentences.test(text)) qualityScore += 2;
  
  return { isSpam: false, reason: null, qualityScore };
}

/**
 * Filter an array of comments, marking spam but keeping all for tracking
 * 
 * @param {Array} comments - Array of comment objects
 * @returns {Object} { filtered: Array, stats: Object }
 */
export function filterComments(comments) {
  const stats = {
    total: comments.length,
    spam: 0,
    quality: 0,
    spamReasons: {}
  };
  
  const processed = comments.map(comment => {
    const analysis = analyzeComment(comment);
    
    if (analysis.isSpam) {
      stats.spam++;
      stats.spamReasons[analysis.reason] = (stats.spamReasons[analysis.reason] || 0) + 1;
    } else if (analysis.qualityScore >= 8) {
      stats.quality++;
    }
    
    return {
      ...comment,
      is_spam: analysis.isSpam,
      spam_reason: analysis.reason,
      quality_score: analysis.qualityScore
    };
  });
  
  // Return all comments (spam flagged but not removed) for transparency
  // The Excel builder can then filter or highlight as needed
  return {
    all: processed,
    filtered: processed.filter(c => !c.is_spam),
    stats
  };
}

/**
 * Quick check if a comment is likely spam (for real-time filtering)
 * 
 * @param {string} text - Comment text
 * @param {string} username - Username
 * @returns {boolean}
 */
export function isLikelySpam(text, username) {
  const analysis = analyzeComment({ comment_text: text, username });
  return analysis.isSpam;
}

/**
 * Get quality tier for a comment
 * 
 * @param {Object} comment - Comment object
 * @returns {string} 'high' | 'medium' | 'low' | 'spam'
 */
export function getQualityTier(comment) {
  const analysis = analyzeComment(comment);
  
  if (analysis.isSpam) return 'spam';
  if (analysis.qualityScore >= 10) return 'high';
  if (analysis.qualityScore >= 6) return 'medium';
  return 'low';
}

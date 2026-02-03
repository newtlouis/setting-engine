/**
 * SpamDetector Domain Service
 *
 * Detects spam and low-quality comments to filter out bot/generic interactions.
 * Pure business logic with no external dependencies.
 */

/**
 * Spam patterns - comments matching these are marked as spam
 */
export const SPAM_PATTERNS = {
  // Single emoji or emoji-only comments
  emojiOnly: /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\s]+$/u,

  // Very short generic comments (1-3 chars)
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
  keyboardSpam: /^[asdfghjkl]+$|^[qwerty]+$|^[zxcvbnm]+$/i,

  // Competitor keywords in username
  competitorUsername: /(psychologue|thérapeute|therapeute|psy|coach|lifestyle|thérapie|therapie|hypno|sophro|psycho|mentale|bien-etre|bienetre)/i
};

/**
 * Quality indicators - positive signals that increase quality score
 */
export const QUALITY_INDICATORS = {
  // Contains a question (shows interest)
  hasQuestion: /\?/,

  // Mentions a specific topic/problem
  hasProblem: /(struggle|problem|issue|help|how do|can you|what is|why|when|where|comment|pourquoi|comment faire|aide|besoin)/i,

  // Shows personal experience
  personalExperience: /(i've been|i have|i am|i was|my|mine|je suis|j'ai|mon|ma|mes)/i,

  // Multiple sentences
  multipleSentences: /[.!?]\s+[A-Z]/
};

/**
 * Quality score thresholds
 */
export const QUALITY_THRESHOLDS = {
  HIGH: 10,
  MEDIUM: 6,
  BASE_SCORE: 5
};

/**
 * SpamDetector Service
 */
export const SpamDetector = {
  /**
   * Analyze a comment for spam indicators
   *
   * @param {Object} params
   * @param {string} params.text - Comment text
   * @param {string} params.username - Username of commenter
   * @returns {{ isSpam: boolean, reason: string|null, qualityScore: number }}
   */
  analyze({ text, username }) {
    const cleanText = (text || '').trim();
    const cleanUsername = (username || '').trim();

    // Check username-based patterns
    if (SPAM_PATTERNS.botUsername.test(cleanUsername)) {
      return { isSpam: true, reason: 'bot_username', qualityScore: 0 };
    }

    if (SPAM_PATTERNS.competitorUsername.test(cleanUsername)) {
      return { isSpam: true, reason: 'competitor_username', qualityScore: 0 };
    }

    // Check text-based spam patterns
    const textPatterns = ['emojiOnly', 'tooShort', 'genericPraise', 'promoSpam', 'justTag', 'keyboardSpam'];

    for (const patternName of textPatterns) {
      const pattern = SPAM_PATTERNS[patternName];
      if (pattern.test(cleanText)) {
        return { isSpam: true, reason: patternName, qualityScore: 0 };
      }
    }

    // Calculate quality score based on positive indicators
    let qualityScore = QUALITY_THRESHOLDS.BASE_SCORE;

    if (QUALITY_INDICATORS.hasQuestion.test(cleanText)) {
      qualityScore += 3;
    }

    if (QUALITY_INDICATORS.hasProblem.test(cleanText)) {
      qualityScore += 4;
    }

    if (QUALITY_INDICATORS.personalExperience.test(cleanText)) {
      qualityScore += 2;
    }

    if (cleanText.length > 50) {
      qualityScore += 2;
    }

    if (QUALITY_INDICATORS.multipleSentences.test(cleanText)) {
      qualityScore += 2;
    }

    return { isSpam: false, reason: null, qualityScore };
  },

  /**
   * Quick check if text is likely spam
   *
   * @param {string} text - Comment text
   * @param {string} username - Username
   * @returns {boolean}
   */
  isSpam(text, username) {
    return this.analyze({ text, username }).isSpam;
  },

  /**
   * Get quality tier from analysis
   *
   * @param {{ qualityScore: number, isSpam: boolean }} analysis
   * @returns {'high' | 'medium' | 'low' | 'spam'}
   */
  getQualityTier(analysis) {
    if (analysis.isSpam) return 'spam';
    if (analysis.qualityScore >= QUALITY_THRESHOLDS.HIGH) return 'high';
    if (analysis.qualityScore >= QUALITY_THRESHOLDS.MEDIUM) return 'medium';
    return 'low';
  },

  /**
   * Filter an array of comments
   *
   * @param {Array<{comment_text: string, username: string}>} comments
   * @returns {{ all: Array, filtered: Array, stats: Object }}
   */
  filterComments(comments) {
    const stats = {
      total: comments.length,
      spam: 0,
      quality: 0,
      spamReasons: {}
    };

    const processed = comments.map(comment => {
      const analysis = this.analyze({
        text: comment.comment_text,
        username: comment.username
      });

      if (analysis.isSpam) {
        stats.spam++;
        stats.spamReasons[analysis.reason] = (stats.spamReasons[analysis.reason] || 0) + 1;
      } else if (analysis.qualityScore >= QUALITY_THRESHOLDS.HIGH) {
        stats.quality++;
      }

      return {
        ...comment,
        is_spam: analysis.isSpam,
        spam_reason: analysis.reason,
        quality_score: analysis.qualityScore
      };
    });

    return {
      all: processed,
      filtered: processed.filter(c => !c.is_spam),
      stats
    };
  }
};

export default SpamDetector;

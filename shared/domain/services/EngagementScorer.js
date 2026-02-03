/**
 * EngagementScorer Domain Service
 *
 * Calculates engagement scores for leads based on their interactions.
 * Pure business logic with no external dependencies.
 */

import { Warmth, calculateWarmth } from '../value-objects/Warmth.js';

/**
 * Scoring weights for different engagement types
 */
export const SCORING_WEIGHTS = {
  COMMENT: {
    BASE: 5,
    HIGH_QUALITY: 10,
    MEDIUM_QUALITY: 7,
    LOW_QUALITY: 3
  },
  MESSAGE: {
    RECEIVED: 15,  // Lead replied
    SENT: 2        // We reached out
  },
  FOLLOW: 10,
  LIKE: 1,
  MENTION: 8
};

/**
 * Engagement thresholds
 */
export const ENGAGEMENT_THRESHOLDS = {
  HIGH: 80,
  MEDIUM: 40,
  LOW: 0
};

/**
 * EngagementScorer Service
 */
export const EngagementScorer = {
  /**
   * Calculate engagement score from lead data
   *
   * @param {Object} params
   * @param {number} params.totalComments - Total non-spam comments
   * @param {number} params.totalMessagesSent - Messages we sent
   * @param {number} params.totalMessagesReceived - Replies from lead
   * @param {number} params.avgCommentQuality - Average quality score of comments
   * @returns {{ score: number, warmth: string, breakdown: Object }}
   */
  calculate({
    totalComments = 0,
    totalMessagesSent = 0,
    totalMessagesReceived = 0,
    avgCommentQuality = 5
  }) {
    // Calculate comment contribution
    let commentScore = 0;
    if (totalComments > 0) {
      const qualityMultiplier = this._getQualityMultiplier(avgCommentQuality);
      commentScore = totalComments * SCORING_WEIGHTS.COMMENT.BASE * qualityMultiplier;
    }

    // Calculate message contribution
    const sentScore = totalMessagesSent * SCORING_WEIGHTS.MESSAGE.SENT;
    const receivedScore = totalMessagesReceived * SCORING_WEIGHTS.MESSAGE.RECEIVED;

    // Total score
    const totalScore = Math.round(commentScore + sentScore + receivedScore);

    // Cap at 100 for consistency
    const score = Math.min(totalScore, 100);

    return {
      score,
      warmth: calculateWarmth(score),
      breakdown: {
        comments: Math.round(commentScore),
        messagesSent: sentScore,
        messagesReceived: receivedScore,
        total: totalScore
      }
    };
  },

  /**
   * Calculate warmth based on comment count (simpler metric)
   *
   * @param {number} commentCount
   * @returns {string}
   */
  calculateWarmthFromComments(commentCount) {
    if (commentCount >= 3) return Warmth.HOT;
    if (commentCount >= 1) return Warmth.WARM;
    return Warmth.COLD;
  },

  /**
   * Check if lead should be prioritized for outreach
   *
   * @param {{ engagementScore: number, totalComments: number, hasReplied: boolean }} lead
   * @returns {boolean}
   */
  shouldPrioritize(lead) {
    // Already replied = high priority
    if (lead.hasReplied) return true;

    // High engagement = high priority
    if (lead.engagementScore >= ENGAGEMENT_THRESHOLDS.HIGH) return true;

    // Multiple quality comments = priority
    if (lead.totalComments >= 2) return true;

    return false;
  },

  /**
   * Rank leads by engagement priority
   *
   * @param {Array} leads
   * @returns {Array} Sorted by priority (highest first)
   */
  rankByPriority(leads) {
    return [...leads].sort((a, b) => {
      // Replied leads first
      const aReplied = a.totalMessagesReceived > 0 ? 1 : 0;
      const bReplied = b.totalMessagesReceived > 0 ? 1 : 0;
      if (aReplied !== bReplied) return bReplied - aReplied;

      // Then by engagement score
      return (b.engagementScore || 0) - (a.engagementScore || 0);
    });
  },

  /**
   * Get engagement tier label
   *
   * @param {number} score
   * @returns {'high' | 'medium' | 'low'}
   */
  getTier(score) {
    if (score >= ENGAGEMENT_THRESHOLDS.HIGH) return 'high';
    if (score >= ENGAGEMENT_THRESHOLDS.MEDIUM) return 'medium';
    return 'low';
  },

  /**
   * Get quality multiplier based on average comment quality
   * @private
   */
  _getQualityMultiplier(avgQuality) {
    if (avgQuality >= 10) return 2.0;
    if (avgQuality >= 7) return 1.5;
    if (avgQuality >= 5) return 1.0;
    return 0.5;
  }
};

export default EngagementScorer;

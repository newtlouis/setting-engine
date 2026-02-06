/**
 * LeadQualifier Domain Service
 *
 * Determines lead qualification status based on business rules.
 * Identifies high-value prospects for prioritized outreach.
 */

import { LeadStatus } from '../value-objects/LeadStatus.js';
import { Warmth, isHot } from '../value-objects/Warmth.js';

/**
 * Qualification criteria weights
 */
export const QUALIFICATION_CRITERIA = {
  // Minimum requirements
  MIN_ENGAGEMENT_SCORE: 10,
  MIN_COMMENTS: 1,

  // Ideal profile indicators
  HAS_BIO: 5,
  HAS_EMAIL: 10,
  HAS_REPLIED: 20,
  IS_HOT: 15,
  IS_ACTIVE_CONVERSATION: 10,
  MULTIPLE_COMMENTS: 8
};

/**
 * Qualification tiers
 */
export const QUALIFICATION_TIERS = {
  HIGHLY_QUALIFIED: 50,
  QUALIFIED: 30,
  POTENTIAL: 10
};

/**
 * Disqualification reasons
 */
export const DISQUALIFICATION_REASONS = {
  IGNORED: 'Lead marked as ignored',
  FAILED: 'Previous contact attempt failed',
  COMPETITOR: 'Identified as competitor',
  NO_ENGAGEMENT: 'No engagement detected',
  SPAM_ACCOUNT: 'Account flagged as spam'
};

/**
 * LeadQualifier Service
 */
export const LeadQualifier = {
  /**
   * Qualify a lead and return qualification result
   *
   * @param {Object} lead - Lead data
   * @returns {{ qualified: boolean, score: number, tier: string, reasons: string[] }}
   */
  qualify(lead) {
    const reasons = [];
    let score = 0;

    // Check for disqualification first
    const disqualification = this._checkDisqualification(lead);
    if (disqualification) {
      return {
        qualified: false,
        score: 0,
        tier: 'disqualified',
        reasons: [disqualification]
      };
    }

    // Calculate qualification score
    if (lead.bio) {
      score += QUALIFICATION_CRITERIA.HAS_BIO;
      reasons.push('Has bio');
    }

    if (lead.email) {
      score += QUALIFICATION_CRITERIA.HAS_EMAIL;
      reasons.push('Has email');
    }

    if (lead.totalMessagesReceived > 0 || lead.total_messages_received > 0) {
      score += QUALIFICATION_CRITERIA.HAS_REPLIED;
      reasons.push('Has replied to messages');
    }

    if (isHot(lead.warmth)) {
      score += QUALIFICATION_CRITERIA.IS_HOT;
      reasons.push('High engagement (hot)');
    }

    const funnelStep = lead.funnelStep || lead.funnel_step || 0;
    if (funnelStep >= 1 && funnelStep < 9) {
      score += QUALIFICATION_CRITERIA.IS_ACTIVE_CONVERSATION;
      reasons.push('Active conversation');
    }

    const comments = lead.totalComments || lead.total_comments || 0;
    if (comments >= 2) {
      score += QUALIFICATION_CRITERIA.MULTIPLE_COMMENTS;
      reasons.push(`Multiple comments (${comments})`);
    }

    // Add engagement score contribution
    const engagementScore = lead.engagementScore || lead.engagement_score || 0;
    score += Math.min(engagementScore / 5, 10); // Cap at 10 points from engagement

    // Determine tier
    const tier = this._getTier(score);

    return {
      qualified: score >= QUALIFICATION_TIERS.POTENTIAL,
      score: Math.round(score),
      tier,
      reasons
    };
  },

  /**
   * Check if lead is qualified (simple boolean)
   *
   * @param {Object} lead
   * @returns {boolean}
   */
  isQualified(lead) {
    return this.qualify(lead).qualified;
  },

  /**
   * Filter leads to only qualified ones
   *
   * @param {Array} leads
   * @returns {Array}
   */
  filterQualified(leads) {
    return leads.filter(lead => this.isQualified(lead));
  },

  /**
   * Rank leads by qualification score
   *
   * @param {Array} leads
   * @returns {Array} Sorted by qualification (highest first)
   */
  rankByQualification(leads) {
    return [...leads]
      .map(lead => ({
        lead,
        qualification: this.qualify(lead)
      }))
      .sort((a, b) => b.qualification.score - a.qualification.score)
      .map(item => item.lead);
  },

  /**
   * Get leads ready for outreach (qualified + not yet contacted)
   *
   * @param {Array} leads
   * @returns {Array}
   */
  getReadyForOutreach(leads) {
    return leads.filter(lead => {
      const status = lead.status;
      const isNew = status === LeadStatus.NEW;
      return isNew && this.isQualified(lead);
    });
  },

  /**
   * Check for disqualification reasons
   * @private
   */
  _checkDisqualification(lead) {
    if (lead.isIgnored || lead.is_ignored) {
      return DISQUALIFICATION_REASONS.IGNORED;
    }

    if (lead.status === 'failed') {
      return DISQUALIFICATION_REASONS.FAILED;
    }

    // No engagement at all
    const hasEngagement =
      (lead.totalComments || lead.total_comments || 0) > 0 ||
      (lead.totalMessagesSent || lead.total_messages_sent || 0) > 0;

    if (!hasEngagement && (lead.engagementScore || lead.engagement_score || 0) === 0) {
      return DISQUALIFICATION_REASONS.NO_ENGAGEMENT;
    }

    return null;
  },

  /**
   * Get qualification tier from score
   * @private
   */
  _getTier(score) {
    if (score >= QUALIFICATION_TIERS.HIGHLY_QUALIFIED) return 'highly_qualified';
    if (score >= QUALIFICATION_TIERS.QUALIFIED) return 'qualified';
    if (score >= QUALIFICATION_TIERS.POTENTIAL) return 'potential';
    return 'unqualified';
  }
};

export default LeadQualifier;

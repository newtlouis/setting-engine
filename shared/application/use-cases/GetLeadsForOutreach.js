/**
 * GetLeadsForOutreach Use Case
 *
 * Retrieves and prioritizes leads for outreach campaigns.
 * Applies qualification and engagement scoring to rank leads.
 */

import { LeadQualifier } from '../../domain/services/LeadQualifier.js';
import { LeadStatus } from '../../domain/value-objects/LeadStatus.js';
import { Warmth } from '../../domain/value-objects/Warmth.js';

/**
 * @typedef {Object} OutreachLeadDTO
 * @property {number} id
 * @property {string} username
 * @property {string} profileUrl
 * @property {string} dmUrl
 * @property {string} [firstName]
 * @property {string} warmth
 * @property {number} engagementScore
 * @property {number} qualificationScore
 * @property {string} qualificationTier
 */

/**
 * GetLeadsForOutreach Use Case
 */
export class GetLeadsForOutreach {
  /**
   * @param {Object} deps - Dependencies
   * @param {ILeadRepository} deps.leadRepository
   */
  constructor({ leadRepository }) {
    this.leadRepository = leadRepository;
  }

  /**
   * Execute the use case - get prioritized leads for outreach
   *
   * @param {number} accountId
   * @param {Object} [options]
   * @param {number} [options.limit=50] - Maximum leads to return
   * @param {string} [options.warmth] - Filter by warmth level
   * @param {boolean} [options.onlyQualified=true] - Only return qualified leads
   * @returns {Promise<OutreachLeadDTO[]>}
   */
  async execute(accountId, options = {}) {
    const {
      limit = 50,
      warmth = null,
      onlyQualified = true
    } = options;

    // Get new leads (not yet contacted)
    const filters = {
      accountId,
      status: LeadStatus.NEW,
      includeIgnored: false,
      limit: limit * 3 // Fetch more to filter
    };

    if (warmth) {
      filters.warmth = warmth;
    }

    const leads = await this.leadRepository.findAll(filters);

    // Score and filter leads
    const scoredLeads = leads
      .map(lead => {
        const qualification = LeadQualifier.qualify(lead);
        return {
          lead,
          qualification,
          priority: this._calculatePriority(lead, qualification)
        };
      })
      .filter(item => !onlyQualified || item.qualification.qualified)
      .sort((a, b) => b.priority - a.priority)
      .slice(0, limit);

    // Transform to DTOs
    return scoredLeads.map(({ lead, qualification }) => ({
      id: lead.id,
      username: lead.username,
      profileUrl: lead.profileUrl,
      dmUrl: lead.dmUrl || lead.getDmUrl(),
      firstName: lead.firstName,
      warmth: lead.warmth,
      engagementScore: lead.engagementScore,
      qualificationScore: qualification.score,
      qualificationTier: qualification.tier
    }));
  }

  /**
   * Get hot leads (high engagement, ready for outreach)
   *
   * @param {number} accountId
   * @param {number} [limit=20]
   * @returns {Promise<OutreachLeadDTO[]>}
   */
  async getHotLeads(accountId, limit = 20) {
    return this.execute(accountId, {
      limit,
      warmth: Warmth.HOT,
      onlyQualified: true
    });
  }

  /**
   * Get warm leads
   *
   * @param {number} accountId
   * @param {number} [limit=30]
   * @returns {Promise<OutreachLeadDTO[]>}
   */
  async getWarmLeads(accountId, limit = 30) {
    return this.execute(accountId, {
      limit,
      warmth: Warmth.WARM,
      onlyQualified: true
    });
  }

  /**
   * Get next batch for automated outreach
   *
   * @param {number} accountId
   * @param {number} batchSize
   * @returns {Promise<OutreachLeadDTO[]>}
   */
  async getNextBatch(accountId, batchSize) {
    // Prioritize hot, then warm, then cold
    const hot = await this.getHotLeads(accountId, batchSize);
    if (hot.length >= batchSize) {
      return hot.slice(0, batchSize);
    }

    const warm = await this.getWarmLeads(accountId, batchSize - hot.length);
    const combined = [...hot, ...warm];

    if (combined.length >= batchSize) {
      return combined.slice(0, batchSize);
    }

    // Fill with cold leads if needed
    const cold = await this.execute(accountId, {
      limit: batchSize - combined.length,
      warmth: Warmth.COLD,
      onlyQualified: true
    });

    return [...combined, ...cold].slice(0, batchSize);
  }

  /**
   * Calculate priority score for sorting
   * @private
   */
  _calculatePriority(lead, qualification) {
    let priority = qualification.score;

    // Boost for warmth
    if (lead.warmth === Warmth.HOT) priority += 30;
    else if (lead.warmth === Warmth.WARM) priority += 15;

    // Boost for high engagement
    priority += Math.min(lead.engagementScore / 2, 25);

    // Boost for having first name (better personalization)
    if (lead.firstName) priority += 5;

    // Boost for having bio (more context)
    if (lead.bio) priority += 3;

    return priority;
  }
}

export default GetLeadsForOutreach;

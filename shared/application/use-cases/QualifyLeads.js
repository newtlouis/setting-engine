/**
 * QualifyLeads Use Case
 *
 * Runs qualification logic on leads to identify high-value prospects.
 * Updates lead qualification status based on business rules.
 */

import { LeadQualifier } from '../../domain/services/LeadQualifier.js';
import { LeadStatus } from '../../domain/value-objects/LeadStatus.js';

/**
 * @typedef {Object} QualifyLeadsResult
 * @property {number} total - Total leads processed
 * @property {number} highlyQualified - Count of highly qualified leads
 * @property {number} qualified - Count of qualified leads
 * @property {number} potential - Count of potential leads
 * @property {number} unqualified - Count of unqualified leads
 * @property {Lead[]} topLeads - Top qualified leads
 */

/**
 * QualifyLeads Use Case
 */
export class QualifyLeads {
  /**
   * @param {Object} deps - Dependencies
   * @param {ILeadRepository} deps.leadRepository
   */
  constructor({ leadRepository }) {
    this.leadRepository = leadRepository;
  }

  /**
   * Execute the use case
   *
   * @param {number} accountId - Account ID
   * @param {Object} [options]
   * @param {number} [options.limit] - Max leads to process
   * @param {boolean} [options.onlyNew] - Only process new leads
   * @returns {Promise<QualifyLeadsResult>}
   */
  async execute(accountId, options = {}) {
    const { limit = 100, onlyNew = false } = options;

    // Get leads to qualify
    const filters = {
      accountId,
      limit,
      includeIgnored: false
    };

    if (onlyNew) {
      filters.status = LeadStatus.NEW;
    }

    const leads = await this.leadRepository.findAll(filters);

    const result = {
      total: leads.length,
      highlyQualified: 0,
      qualified: 0,
      potential: 0,
      unqualified: 0,
      topLeads: []
    };

    const qualifiedLeads = [];

    for (const lead of leads) {
      const qualification = LeadQualifier.qualify(lead);

      // Update counts
      switch (qualification.tier) {
        case 'highly_qualified':
          result.highlyQualified++;
          qualifiedLeads.push({ lead, score: qualification.score });
          break;
        case 'qualified':
          result.qualified++;
          qualifiedLeads.push({ lead, score: qualification.score });
          break;
        case 'potential':
          result.potential++;
          break;
        default:
          result.unqualified++;
      }
    }

    // Sort by qualification score and get top leads
    qualifiedLeads.sort((a, b) => b.score - a.score);
    result.topLeads = qualifiedLeads.slice(0, 10).map(q => q.lead);

    return result;
  }

  /**
   * Get leads ready for outreach (qualified + new status)
   *
   * @param {number} accountId
   * @param {number} [limit=50]
   * @returns {Promise<Lead[]>}
   */
  async getReadyForOutreach(accountId, limit = 50) {
    const leads = await this.leadRepository.findForOutreach(accountId, limit * 2);

    // Filter to only qualified leads
    const qualified = leads.filter(lead => LeadQualifier.isQualified(lead));

    // Rank by qualification
    return LeadQualifier.rankByQualification(qualified).slice(0, limit);
  }

  /**
   * Get qualification summary for dashboard
   *
   * @param {number} accountId
   * @returns {Promise<Object>}
   */
  async getSummary(accountId) {
    const leads = await this.leadRepository.findAll({
      accountId,
      includeIgnored: false
    });

    const tiers = {
      highly_qualified: [],
      qualified: [],
      potential: [],
      unqualified: [],
      disqualified: []
    };

    for (const lead of leads) {
      const { tier } = LeadQualifier.qualify(lead);
      tiers[tier]?.push(lead);
    }

    return {
      total: leads.length,
      breakdown: {
        highlyQualified: tiers.highly_qualified.length,
        qualified: tiers.qualified.length,
        potential: tiers.potential.length,
        unqualified: tiers.unqualified.length,
        disqualified: tiers.disqualified.length
      },
      readyForOutreach: [...tiers.highly_qualified, ...tiers.qualified]
        .filter(l => l.status === LeadStatus.NEW)
        .length
    };
  }
}

export default QualifyLeads;

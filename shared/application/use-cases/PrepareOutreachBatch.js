/**
 * PrepareOutreachBatch Use Case
 *
 * Prepares a batch of leads for outreach by generating personalized messages.
 * Adds prepared leads to the outreach queue.
 */

import { LeadQualifier } from '../../domain/services/LeadQualifier.js';
import { LeadStatus } from '../../domain/value-objects/LeadStatus.js';
import { buildDmUrl } from '../../domain/value-objects/Username.js';

/**
 * @typedef {Object} PreparedOutreach
 * @property {string} username
 * @property {string} profileUrl
 * @property {string} dmUrl
 * @property {string} firstName
 * @property {string} preparedMessage
 * @property {string} source
 */

/**
 * @typedef {Object} PrepareOutreachResult
 * @property {number} total - Leads processed
 * @property {number} prepared - Leads added to queue
 * @property {number} skipped - Leads skipped (already in queue or unqualified)
 * @property {PreparedOutreach[]} batch - Prepared outreach entries
 */

/**
 * PrepareOutreachBatch Use Case
 */
export class PrepareOutreachBatch {
  /**
   * @param {Object} deps - Dependencies
   * @param {ILeadRepository} deps.leadRepository
   * @param {IOutreachQueueRepository} deps.outreachQueueRepository
   * @param {Function} deps.messageGenerator - Function to generate personalized message
   */
  constructor({ leadRepository, outreachQueueRepository, messageGenerator = null }) {
    this.leadRepository = leadRepository;
    this.outreachQueueRepository = outreachQueueRepository;
    this.messageGenerator = messageGenerator || this._defaultMessageGenerator;
  }

  /**
   * Execute the use case
   *
   * @param {number} accountId
   * @param {Object} [options]
   * @param {number} [options.batchSize=20] - Number of leads to prepare
   * @param {string} [options.template] - Message template with {{placeholders}}
   * @param {string} [options.source] - Source for tracking
   * @returns {Promise<PrepareOutreachResult>}
   */
  async execute(accountId, options = {}) {
    const {
      batchSize = 20,
      template = null,
      source = 'outreach'
    } = options;

    const result = {
      total: 0,
      prepared: 0,
      skipped: 0,
      batch: []
    };

    // Get qualified leads for outreach
    const leads = await this.leadRepository.findForOutreach(accountId, batchSize * 2);
    result.total = leads.length;

    for (const lead of leads) {
      if (result.prepared >= batchSize) break;

      // Check if already in queue
      const inQueue = await this.outreachQueueRepository.exists(lead.username);
      if (inQueue) {
        result.skipped++;
        continue;
      }

      // Check qualification
      if (!LeadQualifier.isQualified(lead)) {
        result.skipped++;
        continue;
      }

      // Generate personalized message
      const message = await this._generateMessage(lead, template);

      // Prepare queue entry
      const entry = {
        username: lead.username,
        profileUrl: lead.profileUrl,
        dmUrl: lead.dmUrl || buildDmUrl(lead.username),
        firstName: lead.firstName,
        preparedMessage: message,
        source,
        status: 'pending'
      };

      // Add to queue
      await this.outreachQueueRepository.add(entry);
      result.batch.push(entry);
      result.prepared++;
    }

    return result;
  }

  /**
   * Prepare follow-up batch for leads that haven't replied
   *
   * @param {number} accountId
   * @param {Object} [options]
   * @param {number} [options.batchSize=10]
   * @param {string} [options.template]
   * @returns {Promise<PrepareOutreachResult>}
   */
  async prepareFollowUps(accountId, options = {}) {
    const { batchSize = 10, template = null } = options;

    // Get leads needing follow-up
    const leads = await this.leadRepository.findNeedingFollowUp(accountId, batchSize * 2);

    const result = {
      total: leads.length,
      prepared: 0,
      skipped: 0,
      batch: []
    };

    for (const lead of leads) {
      if (result.prepared >= batchSize) break;

      const inQueue = await this.outreachQueueRepository.exists(lead.username);
      if (inQueue) {
        result.skipped++;
        continue;
      }

      const message = await this._generateMessage(lead, template, true);

      const entry = {
        username: lead.username,
        profileUrl: lead.profileUrl,
        dmUrl: lead.dmUrl || buildDmUrl(lead.username),
        firstName: lead.firstName,
        preparedMessage: message,
        source: 'followup',
        status: 'pending'
      };

      await this.outreachQueueRepository.add(entry);
      result.batch.push(entry);
      result.prepared++;
    }

    return result;
  }

  /**
   * Generate personalized message
   * @private
   */
  async _generateMessage(lead, template, isFollowUp = false) {
    if (this.messageGenerator !== this._defaultMessageGenerator) {
      return this.messageGenerator(lead, { template, isFollowUp });
    }
    return this._defaultMessageGenerator(lead, { template, isFollowUp });
  }

  /**
   * Default message generator with template substitution
   * @private
   */
  _defaultMessageGenerator(lead, { template, isFollowUp }) {
    const defaultTemplate = isFollowUp
      ? "Coucou {{firstName}} 🌸 Je me permets de te relancer tout doucement — parfois les messages se perdent dans la boîte Instagram 😅"
      : "Salut {{firstName}} ! 👋 J'ai vu ton commentaire et je voulais te contacter directement...";

    const messageTemplate = template || defaultTemplate;

    // Replace placeholders
    return messageTemplate
      .replace(/\{\{firstName\}\}/g, lead.firstName || '')
      .replace(/\{\{username\}\}/g, lead.username)
      .trim();
  }
}

export default PrepareOutreachBatch;

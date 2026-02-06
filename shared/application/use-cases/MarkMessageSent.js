/**
 * MarkMessageSent Use Case
 *
 * Marks a message as sent, updates lead status, and records in conversation.
 * Central point for tracking successful outreach.
 */

import { LeadStatus } from '../../domain/value-objects/LeadStatus.js';
import { Message, MessageRole, MessageType } from '../../domain/entities/Message.js';
import { calculateStep } from '../../domain/value-objects/ConversationStep.js';

/**
 * @typedef {Object} MarkSentInput
 * @property {string} username
 * @property {string} [messageText] - The message that was sent
 * @property {string} [dmUrl] - DM URL if discovered
 * @property {number} [accountId]
 */

/**
 * @typedef {Object} MarkSentResult
 * @property {boolean} success
 * @property {Lead} [lead]
 * @property {string} [error]
 */

/**
 * MarkMessageSent Use Case
 */
export class MarkMessageSent {
  /**
   * @param {Object} deps - Dependencies
   * @param {ILeadRepository} deps.leadRepository
   * @param {IConversationRepository} deps.conversationRepository
   * @param {IOutreachQueueRepository} deps.outreachQueueRepository
   */
  constructor({ leadRepository, conversationRepository, outreachQueueRepository }) {
    this.leadRepository = leadRepository;
    this.conversationRepository = conversationRepository;
    this.outreachQueueRepository = outreachQueueRepository;
  }

  /**
   * Execute the use case
   *
   * @param {MarkSentInput} input
   * @returns {Promise<MarkSentResult>}
   */
  async execute(input) {
    const { username, messageText = null, dmUrl = null, accountId = null } = input;

    try {
      // Get lead
      const lead = await this.leadRepository.findByUsername(username, accountId);
      if (!lead) {
        return { success: false, error: 'Lead not found' };
      }

      // Update lead
      lead.totalMessagesSent++;
      lead.lastContactAt = new Date().toISOString();

      if (lead.status === LeadStatus.NEW) {
        lead.status = LeadStatus.CONTACTED;
      }

      if (dmUrl) {
        lead.dmUrl = dmUrl;
      }

      // Sync funnel step
      lead.funnelStep = calculateStep(
        lead.totalMessagesSent,
        lead.totalMessagesReceived
      );

      // Save lead
      await this.leadRepository.save(lead);

      // Record message in conversation
      if (messageText && this.conversationRepository) {
        const message = new Message({
          leadId: lead.id,
          role: MessageRole.ASSISTANT,
          text: messageText,
          type: lead.totalMessagesSent === 1 ? MessageType.GREETING : MessageType.FOLLOWUP
        });
        await this.conversationRepository.addMessage(lead.id, message);
      }

      // Update outreach queue
      if (this.outreachQueueRepository) {
        await this.outreachQueueRepository.markSent(username);
      }

      return { success: true, lead };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Mark message as failed
   *
   * @param {string} username
   * @param {string} reason
   * @param {number} [accountId]
   * @returns {Promise<MarkSentResult>}
   */
  async markFailed(username, reason, accountId = null) {
    try {
      // Update lead
      await this.leadRepository.markFailed(username, reason);

      // Update queue
      if (this.outreachQueueRepository) {
        await this.outreachQueueRepository.markFailed(username, reason);
      }

      const lead = await this.leadRepository.findByUsername(username, accountId);
      return { success: true, lead };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Batch mark multiple messages as sent
   *
   * @param {Array<{username: string, messageText?: string, dmUrl?: string}>} entries
   * @param {number} [accountId]
   * @returns {Promise<{success: number, failed: number, errors: string[]}>}
   */
  async batchMarkSent(entries, accountId = null) {
    const result = { success: 0, failed: 0, errors: [] };

    for (const entry of entries) {
      const markResult = await this.execute({
        username: entry.username,
        messageText: entry.messageText,
        dmUrl: entry.dmUrl,
        accountId
      });

      if (markResult.success) {
        result.success++;
      } else {
        result.failed++;
        result.errors.push(`${entry.username}: ${markResult.error}`);
      }
    }

    return result;
  }
}

export default MarkMessageSent;

/**
 * RecordMessage Use Case
 *
 * Records sent and received messages in conversations.
 * Updates lead status based on message direction.
 */

import { Message, MessageRole, MessageType } from '../../domain/entities/Message.js';
import { Lead } from '../../domain/entities/Lead.js';
import { LeadStatus } from '../../domain/value-objects/LeadStatus.js';
import { calculateStep } from '../../domain/value-objects/ConversationStep.js';
import {
  parseFunnelStep,
  isNotInterested,
  needsManualIntervention
} from '../../domain/services/FunnelStepParser.js';

/**
 * @typedef {Object} RecordMessageInput
 * @property {string} username - Lead username
 * @property {string} text - Message content
 * @property {'incoming'|'outgoing'} direction - Message direction
 * @property {string} [type] - Message type (greeting, cta, etc.)
 * @property {number} [accountId] - Account ID
 */

/**
 * @typedef {Object} RecordMessageResult
 * @property {Message} message - Recorded message
 * @property {Lead} lead - Updated lead
 * @property {boolean} isFirstContact - Whether this was first contact
 * @property {boolean} isFirstReply - Whether this was first reply from lead
 */

/**
 * RecordMessage Use Case
 */
export class RecordMessage {
  /**
   * @param {Object} deps - Dependencies
   * @param {ILeadRepository} deps.leadRepository
   * @param {IConversationRepository} deps.conversationRepository
   */
  constructor({ leadRepository, conversationRepository }) {
    this.leadRepository = leadRepository;
    this.conversationRepository = conversationRepository;
  }

  /**
   * Execute the use case
   *
   * @param {RecordMessageInput} input
   * @returns {Promise<RecordMessageResult>}
   */
  async execute(input) {
    const { username, text, direction, type = null, accountId = null, sentAt = null } = input;

    // Get or create lead
    let lead = await this.leadRepository.findByUsername(username, accountId);
    const isNewLead = !lead;

    if (!lead) {
      lead = Lead.create(username, accountId, 'dm');
      lead = await this.leadRepository.save(lead);
    }

    // Determine message role
    const role = direction === 'outgoing' ? MessageRole.ASSISTANT : MessageRole.USER;

    // Track state before update
    const wasContacted = lead.totalMessagesSent > 0;
    const hadReplies = lead.totalMessagesReceived > 0;

    // Create message
    const message = new Message({
      leadId: lead.id,
      role,
      text,
      type,
      sentAt
    });

    // Save message
    await this.conversationRepository.addMessage(lead.id, message);

    // Update lead based on direction
    if (direction === 'outgoing') {
      lead.totalMessagesSent++;
      lead.lastContactAt = new Date().toISOString();

      if (lead.status === LeadStatus.NEW) {
        lead.status = LeadStatus.CONTACTED;
      }

      // Parse funnel step from [STEP_X] labels in LLM response
      const funnelStep = parseFunnelStep(text);
      if (funnelStep) {
        lead.advanceFunnelStep(funnelStep);
      }

      // Handle special tags
      if (isNotInterested(text)) {
        lead.status = LeadStatus.IGNORED;
        lead.isIgnored = true;
      } else if (needsManualIntervention(text)) {
        lead.status = LeadStatus.MANUAL;
      }
    } else {
      lead.totalMessagesReceived++;

      if (lead.status === LeadStatus.CONTACTED) {
        lead.status = LeadStatus.REPLIED;
      }
    }

    // Sync funnel step
    lead.funnelStep = calculateStep(
      lead.totalMessagesSent,
      lead.totalMessagesReceived
    );

    // Save updated lead
    lead = await this.leadRepository.save(lead);

    return {
      message,
      lead,
      isFirstContact: !wasContacted && direction === 'outgoing',
      isFirstReply: !hadReplies && direction === 'incoming'
    };
  }

  /**
   * Record outgoing message (convenience method)
   *
   * @param {string} username
   * @param {string} text
   * @param {string} [type]
   * @param {number} [accountId]
   * @returns {Promise<RecordMessageResult>}
   */
  async recordOutgoing(username, text, type = MessageType.RESPONSE, accountId = null) {
    return this.execute({
      username,
      text,
      direction: 'outgoing',
      type,
      accountId
    });
  }

  /**
   * Record incoming message (convenience method)
   *
   * @param {string} username
   * @param {string} text
   * @param {number} [accountId]
   * @returns {Promise<RecordMessageResult>}
   */
  async recordIncoming(username, text, accountId = null) {
    return this.execute({
      username,
      text,
      direction: 'incoming',
      accountId
    });
  }
}

export default RecordMessage;

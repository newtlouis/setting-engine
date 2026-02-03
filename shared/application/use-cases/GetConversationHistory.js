/**
 * GetConversationHistory Use Case
 *
 * Retrieves conversation history for a lead.
 * Provides formatted output for AI context and display.
 */

import { Conversation } from '../../domain/entities/Conversation.js';

/**
 * @typedef {Object} ConversationDTO
 * @property {number} leadId
 * @property {string} username
 * @property {Message[]} messages
 * @property {Object} metrics
 * @property {Array<{role: string, content: string}>} aiContext
 */

/**
 * GetConversationHistory Use Case
 */
export class GetConversationHistory {
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
   * Execute the use case - get conversation for a lead
   *
   * @param {string} username
   * @param {number} [accountId]
   * @returns {Promise<ConversationDTO|null>}
   */
  async execute(username, accountId = null) {
    // Get lead
    const lead = await this.leadRepository.findByUsername(username, accountId);
    if (!lead) {
      return null;
    }

    // Get conversation
    const conversation = await this.conversationRepository.getByLeadId(lead.id);

    return {
      leadId: lead.id,
      username: lead.username,
      messages: conversation.messages,
      metrics: conversation.getMetrics(),
      aiContext: conversation.getSummaryForAI()
    };
  }

  /**
   * Get conversation by lead ID
   *
   * @param {number} leadId
   * @returns {Promise<Conversation>}
   */
  async getByLeadId(leadId) {
    return this.conversationRepository.getByLeadId(leadId);
  }

  /**
   * Get AI-formatted context for a lead
   *
   * @param {string} username
   * @param {number} [maxMessages=10]
   * @param {number} [accountId]
   * @returns {Promise<Array<{role: string, content: string}>>}
   */
  async getAIContext(username, maxMessages = 10, accountId = null) {
    const lead = await this.leadRepository.findByUsername(username, accountId);
    if (!lead) {
      return [];
    }

    return this.conversationRepository.getMessagesForAI(lead.id, maxMessages);
  }

  /**
   * Check if a lead has unanswered messages
   *
   * @param {string} username
   * @param {number} [accountId]
   * @returns {Promise<boolean>}
   */
  async hasUnanswered(username, accountId = null) {
    const lead = await this.leadRepository.findByUsername(username, accountId);
    if (!lead) {
      return false;
    }

    return this.conversationRepository.hasUnansweredMessage(lead.id);
  }

  /**
   * Get all leads with unanswered messages
   *
   * @param {number} accountId
   * @returns {Promise<Array<{lead: Lead, lastMessage: Message}>>}
   */
  async getUnansweredLeads(accountId) {
    const unanswered = await this.conversationRepository.getUnansweredConversations(accountId);

    const results = [];
    for (const item of unanswered) {
      const lead = await this.leadRepository.findById(item.leadId);
      if (lead) {
        results.push({
          lead,
          lastMessage: item.lastMessage
        });
      }
    }

    return results;
  }
}

export default GetConversationHistory;

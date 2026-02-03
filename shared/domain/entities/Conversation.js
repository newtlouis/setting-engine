/**
 * Conversation Entity
 *
 * Represents a DM conversation with a lead.
 * Aggregates messages and provides conversation-level operations.
 */

import { Message, MessageRole, MessageType } from './Message.js';

/**
 * Conversation Entity Class
 */
export class Conversation {
  constructor(leadId, messages = []) {
    this.leadId = leadId;
    this.messages = messages.map(m => m instanceof Message ? m : new Message(m));
  }

  /**
   * Get message count
   */
  get length() {
    return this.messages.length;
  }

  /**
   * Check if conversation is empty
   */
  isEmpty() {
    return this.messages.length === 0;
  }

  /**
   * Get messages from lead
   */
  getLeadMessages() {
    return this.messages.filter(m => m.isFromLead());
  }

  /**
   * Get messages from assistant
   */
  getAssistantMessages() {
    return this.messages.filter(m => m.isFromAssistant());
  }

  /**
   * Get last message
   */
  getLastMessage() {
    return this.messages[this.messages.length - 1] || null;
  }

  /**
   * Get last message from lead
   */
  getLastLeadMessage() {
    const leadMessages = this.getLeadMessages();
    return leadMessages[leadMessages.length - 1] || null;
  }

  /**
   * Get last message from assistant
   */
  getLastAssistantMessage() {
    const assistantMessages = this.getAssistantMessages();
    return assistantMessages[assistantMessages.length - 1] || null;
  }

  /**
   * Check if we're waiting for lead reply
   */
  isWaitingForReply() {
    const last = this.getLastMessage();
    return last && last.isFromAssistant();
  }

  /**
   * Check if lead has unanswered message
   */
  hasUnansweredMessage() {
    const last = this.getLastMessage();
    return last && last.isFromLead();
  }

  /**
   * Add message to conversation
   */
  addMessage(message) {
    const msg = message instanceof Message ? message : new Message(message);
    msg.leadId = this.leadId;
    this.messages.push(msg);
    return msg;
  }

  /**
   * Add outgoing message (from assistant)
   */
  addOutgoing(text, type = null) {
    return this.addMessage(Message.createOutgoing(this.leadId, text, type));
  }

  /**
   * Add incoming message (from lead)
   */
  addIncoming(text) {
    return this.addMessage(Message.createIncoming(this.leadId, text));
  }

  /**
   * Get conversation summary for AI context
   */
  getSummaryForAI(maxMessages = 10) {
    const recent = this.messages.slice(-maxMessages);
    return recent.map(m => ({
      role: m.role,
      content: m.text
    }));
  }

  /**
   * Get full text of conversation
   */
  getFullText() {
    return this.messages
      .map(m => `${m.role === MessageRole.ASSISTANT ? 'Nous' : 'Lead'}: ${m.text}`)
      .join('\n');
  }

  /**
   * Calculate engagement metrics
   */
  getMetrics() {
    const leadMsgs = this.getLeadMessages();
    const assistantMsgs = this.getAssistantMessages();

    return {
      totalMessages: this.messages.length,
      leadMessages: leadMsgs.length,
      assistantMessages: assistantMsgs.length,
      avgLeadMessageLength: leadMsgs.length > 0
        ? leadMsgs.reduce((sum, m) => sum + m.text.length, 0) / leadMsgs.length
        : 0,
      hasGreeting: this.messages.some(m => m.isGreeting()),
      hasCta: this.messages.some(m => m.isCta()),
      responseRate: assistantMsgs.length > 0
        ? leadMsgs.length / assistantMsgs.length
        : 0
    };
  }

  /**
   * Convert to plain object
   */
  toJSON() {
    return {
      leadId: this.leadId,
      messages: this.messages.map(m => m.toJSON()),
      metrics: this.getMetrics()
    };
  }

  /**
   * Create Conversation from database rows
   */
  static fromDbRows(leadId, rows) {
    const messages = rows.map(row => Message.fromDbRow(row));
    return new Conversation(leadId, messages);
  }

  /**
   * Create empty conversation
   */
  static create(leadId) {
    return new Conversation(leadId, []);
  }
}

export default Conversation;

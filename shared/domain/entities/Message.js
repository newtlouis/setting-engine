/**
 * Message Entity
 *
 * Represents a single message in a conversation (DM).
 */

export const MessageRole = Object.freeze({
  USER: 'user',         // Message from the lead
  ASSISTANT: 'assistant' // Message from our bot/user
});

export const MessageType = Object.freeze({
  GREETING: 'greeting',
  QUESTION: 'question',
  RESPONSE: 'response',
  CTA: 'cta',
  FOLLOWUP: 'followup',
  CLOSING: 'closing'
});

/**
 * Message Entity Class
 */
export class Message {
  constructor(data = {}) {
    this.id = data.id || null;
    this.leadId = data.lead_id || data.leadId || null;
    this.role = data.role || MessageRole.USER;
    this.text = data.message_text || data.text || '';
    this.type = data.message_type || data.type || null;
    this.sentAt = data.sent_at || data.sentAt || new Date().toISOString();
  }

  /**
   * Check if message is from lead
   */
  isFromLead() {
    return this.role === MessageRole.USER;
  }

  /**
   * Check if message is from assistant
   */
  isFromAssistant() {
    return this.role === MessageRole.ASSISTANT;
  }

  /**
   * Check if message is a greeting
   */
  isGreeting() {
    return this.type === MessageType.GREETING;
  }

  /**
   * Check if message is a CTA
   */
  isCta() {
    return this.type === MessageType.CTA;
  }

  /**
   * Get message preview (truncated)
   */
  getPreview(maxLength = 50) {
    if (this.text.length <= maxLength) {
      return this.text;
    }
    return this.text.substring(0, maxLength - 3) + '...';
  }

  /**
   * Convert to database row format
   */
  toDbRow() {
    return {
      id: this.id,
      lead_id: this.leadId,
      role: this.role,
      message_text: this.text,
      message_type: this.type,
      sent_at: this.sentAt
    };
  }

  /**
   * Convert to plain object
   */
  toJSON() {
    return {
      id: this.id,
      leadId: this.leadId,
      role: this.role,
      text: this.text,
      type: this.type,
      sentAt: this.sentAt
    };
  }

  /**
   * Create Message from database row
   */
  static fromDbRow(row) {
    if (!row) return null;
    return new Message(row);
  }

  /**
   * Create outgoing message (from assistant)
   */
  static createOutgoing(leadId, text, type = null) {
    return new Message({
      leadId,
      role: MessageRole.ASSISTANT,
      text,
      type
    });
  }

  /**
   * Create incoming message (from lead)
   */
  static createIncoming(leadId, text) {
    return new Message({
      leadId,
      role: MessageRole.USER,
      text
    });
  }
}

export default Message;

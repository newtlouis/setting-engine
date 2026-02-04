/**
 * AccountPersona Entity
 *
 * Represents the persona configuration for an account.
 * Contains the LLM persona definition, communication rules, and knowledge base.
 */

export class AccountPersona {
  constructor(data = {}) {
    this.id = data.id || null;
    this.accountId = data.account_id || data.accountId || null;
    this.personaName = data.persona_name || data.personaName || '';
    this.niche = data.niche || '';
    this.communicationRules = data.communication_rules || data.communicationRules || null;
    this.objectionsScript = data.objections_script || data.objectionsScript || null;
    this.knowledgeBase = data.knowledge_base || data.knowledgeBase || null;
    this.postBookingMessage = data.post_booking_message || data.postBookingMessage || null;
    this.createdAt = data.created_at || data.createdAt || null;
    this.updatedAt = data.updated_at || data.updatedAt || null;
  }

  toDbRow() {
    return {
      id: this.id,
      account_id: this.accountId,
      persona_name: this.personaName,
      niche: this.niche,
      communication_rules: this.communicationRules,
      objections_script: this.objectionsScript,
      knowledge_base: this.knowledgeBase,
      post_booking_message: this.postBookingMessage
    };
  }

  toJSON() {
    return {
      id: this.id,
      accountId: this.accountId,
      personaName: this.personaName,
      niche: this.niche,
      communicationRules: this.communicationRules,
      objectionsScript: this.objectionsScript,
      knowledgeBase: this.knowledgeBase,
      postBookingMessage: this.postBookingMessage,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  static fromDbRow(row) {
    if (!row) return null;
    return new AccountPersona(row);
  }

  static create(accountId, personaName, options = {}) {
    return new AccountPersona({
      account_id: accountId,
      persona_name: personaName,
      niche: options.niche || '',
      communication_rules: options.communicationRules || null,
      objections_script: options.objectionsScript || null,
      knowledge_base: options.knowledgeBase || null,
      post_booking_message: options.postBookingMessage || null
    });
  }
}

export default AccountPersona;

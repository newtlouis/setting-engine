/**
 * FollowupTemplate Entity
 *
 * Represents a follow-up message template for a specific funnel stage.
 * Templates can have placeholders like {{firstName}} that get replaced at send time.
 */

export class FollowupTemplate {
  constructor(data = {}) {
    this.id = data.id || null;
    this.stageId = data.stage_id || data.stageId || null;
    this.accountId = data.account_id || data.accountId || null;
    this.templateOrder = data.template_order || data.templateOrder || 0; // Which followup (1st, 2nd, 3rd)
    this.templateText = data.template_text || data.templateText || '';
    this.templateName = data.template_name || data.templateName || ''; // e.g., "Relance douce"
    this.isActive = data.is_active !== undefined ? Boolean(data.is_active) : true;
    this.usageCount = data.usage_count || data.usageCount || 0;
    this.successCount = data.success_count || data.successCount || 0; // Got a reply
    this.createdAt = data.created_at || data.createdAt || null;
    this.updatedAt = data.updated_at || data.updatedAt || null;
  }

  /**
   * Replace placeholders in template text
   * @param {Object} context - { firstName, username, ... }
   */
  render(context = {}) {
    let text = this.templateText;

    for (const [key, value] of Object.entries(context)) {
      const placeholder = new RegExp(`{{${key}}}`, 'g');
      text = text.replace(placeholder, value || '');
    }

    // Clean up any remaining placeholders
    text = text.replace(/\{\{[^}]+\}\}/g, '').trim();
    // Clean up double spaces
    text = text.replace(/\s+/g, ' ').trim();

    return text;
  }

  /**
   * Get success rate as percentage
   */
  getSuccessRate() {
    if (this.usageCount === 0) return 0;
    return Math.round((this.successCount / this.usageCount) * 100);
  }

  /**
   * Record usage of this template
   */
  recordUsage(gotReply = false) {
    this.usageCount++;
    if (gotReply) {
      this.successCount++;
    }
    return this;
  }

  toDbRow() {
    return {
      id: this.id,
      stage_id: this.stageId,
      account_id: this.accountId,
      template_order: this.templateOrder,
      template_text: this.templateText,
      template_name: this.templateName,
      is_active: this.isActive ? 1 : 0,
      usage_count: this.usageCount,
      success_count: this.successCount
    };
  }

  toJSON() {
    return {
      id: this.id,
      stageId: this.stageId,
      accountId: this.accountId,
      templateOrder: this.templateOrder,
      templateText: this.templateText,
      templateName: this.templateName,
      isActive: this.isActive,
      usageCount: this.usageCount,
      successCount: this.successCount,
      successRate: this.getSuccessRate(),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  static fromDbRow(row) {
    if (!row) return null;
    return new FollowupTemplate(row);
  }

  static create(stageId, accountId, templateOrder, templateText, templateName = '') {
    return new FollowupTemplate({
      stage_id: stageId,
      account_id: accountId,
      template_order: templateOrder,
      template_text: templateText,
      template_name: templateName || `Relance ${templateOrder + 1}`
    });
  }
}

export default FollowupTemplate;

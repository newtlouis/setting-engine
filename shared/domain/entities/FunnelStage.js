/**
 * FunnelStage Entity
 *
 * Represents a stage in the sales funnel for a specific profile.
 * Each profile can have its own set of stages with custom follow-up rules.
 */

export class FunnelStage {
  constructor(data = {}) {
    this.id = data.id || null;
    this.accountId = data.account_id || data.accountId || null;
    this.stageOrder = data.stage_order || data.stageOrder || 0;
    this.stageName = data.stage_name || data.stageName || '';
    this.stageLabel = data.stage_label || data.stageLabel || ''; // e.g., "STEP_1"
    this.description = data.description || '';
    this.maxFollowups = data.max_followups || data.maxFollowups || 0;
    this.followupDelayHours = data.followup_delay_hours || data.followupDelayHours || 24;
    this.autoIgnoreAfterMax = Boolean(data.auto_ignore_after_max || data.autoIgnoreAfterMax);
    this.isActive = data.is_active !== undefined ? Boolean(data.is_active) : true;
    this.createdAt = data.created_at || data.createdAt || null;
    this.updatedAt = data.updated_at || data.updatedAt || null;
  }

  /**
   * Get the step number from the label (e.g., "STEP_3" -> 3)
   */
  getStepNumber() {
    const match = this.stageLabel.match(/STEP_(\d+)/i);
    return match ? parseInt(match[1], 10) : this.stageOrder;
  }

  /**
   * Check if this stage allows follow-ups
   */
  allowsFollowups() {
    return this.maxFollowups > 0;
  }

  toDbRow() {
    return {
      id: this.id,
      account_id: this.accountId,
      stage_order: this.stageOrder,
      stage_name: this.stageName,
      stage_label: this.stageLabel,
      description: this.description,
      max_followups: this.maxFollowups,
      followup_delay_hours: this.followupDelayHours,
      auto_ignore_after_max: this.autoIgnoreAfterMax ? 1 : 0,
      is_active: this.isActive ? 1 : 0
    };
  }

  toJSON() {
    return {
      id: this.id,
      accountId: this.accountId,
      stageOrder: this.stageOrder,
      stageName: this.stageName,
      stageLabel: this.stageLabel,
      description: this.description,
      maxFollowups: this.maxFollowups,
      followupDelayHours: this.followupDelayHours,
      autoIgnoreAfterMax: this.autoIgnoreAfterMax,
      isActive: this.isActive,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  static fromDbRow(row) {
    if (!row) return null;
    return new FunnelStage(row);
  }

  static create(accountId, stageOrder, stageName, stageLabel, options = {}) {
    return new FunnelStage({
      account_id: accountId,
      stage_order: stageOrder,
      stage_name: stageName,
      stage_label: stageLabel,
      max_followups: options.maxFollowups || 0,
      followup_delay_hours: options.followupDelayHours || 24,
      auto_ignore_after_max: options.autoIgnoreAfterMax || false,
      description: options.description || ''
    });
  }
}

export default FunnelStage;

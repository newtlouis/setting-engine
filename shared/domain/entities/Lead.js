/**
 * Lead Entity
 *
 * Core domain entity representing a potential customer (Instagram user).
 * Encapsulates business logic for lead lifecycle management.
 */

import {
  LeadStatus,
  isValidStatus,
  canTransitionTo,
  parseStatus
} from '../value-objects/LeadStatus.js';
import {
  ConversationStep,
  calculateStep,
  isActiveConversation,
  needsFollowUp,
  parseStep
} from '../value-objects/ConversationStep.js';
import {
  Warmth,
  calculateWarmth,
  isValidWarmth,
  parseWarmth
} from '../value-objects/Warmth.js';
import {
  normalizeUsername,
  isValidUsername,
  buildProfileUrl,
  buildDmUrl
} from '../value-objects/Username.js';

/**
 * Lead Entity Class
 */
export class Lead {
  constructor(data = {}) {
    // Identity
    this.id = data.id || null;
    this.username = normalizeUsername(data.username);
    this.accountId = data.account_id || data.accountId || null;

    // Profile
    this.fullName = data.full_name || data.fullName || null;
    this.firstName = data.first_name || data.firstName || this._extractFirstName();
    this.bio = data.bio || null;
    this.email = data.email || null;
    this.profileUrl = data.profile_url || data.profileUrl || buildProfileUrl(this.username);
    this.dmUrl = data.dm_url || data.dmUrl || null;

    // Status
    this.status = parseStatus(data.status);
    this.warmth = parseWarmth(data.warmth);
    this.isIgnored = Boolean(data.is_ignored || data.isIgnored);

    // Engagement metrics
    this.engagementScore = Number(data.engagement_score || data.engagementScore || 0);
    this.totalComments = Number(data.total_comments || data.totalComments || 0);
    this.totalMessagesSent = Number(data.total_messages_sent || data.totalMessagesSent || 0);
    this.totalMessagesReceived = Number(data.total_messages_received || data.totalMessagesReceived || 0);

    // Conversation tracking - auto-calculated from message counts
    this.conversationStep = parseStep(data.conversation_step || data.conversationStep);
    this.lastFollowupTemplateId = data.last_followup_template_id || data.lastFollowupTemplateId || null;
    this.lastContactAt = data.last_contact_at || data.lastContactAt || null;

    // Source
    this.leadSource = data.lead_source || data.leadSource || null;
    this.leadType = data.lead_type || data.leadType || 'cold';

    // Qualification
    this.bookingStatus = data.booking_status || data.bookingStatus || null;
    this.painPoints = this._parsePainPoints(data.pain_points || data.painPoints);
    this.notes = data.notes || null;

    // Timestamps
    this.createdAt = data.created_at || data.createdAt || null;
    this.updatedAt = data.updated_at || data.updatedAt || null;
  }

  // ============ COMPUTED PROPERTIES ============

  /**
   * Check if lead is valid
   */
  isValid() {
    return isValidUsername(this.username);
  }

  /**
   * Check if lead has been contacted
   */
  hasBeenContacted() {
    return this.totalMessagesSent > 0 || this.status !== LeadStatus.NEW;
  }

  /**
   * Check if lead has replied
   */
  hasReplied() {
    return this.totalMessagesReceived > 0;
  }

  /**
   * Check if conversation is active
   */
  hasActiveConversation() {
    return isActiveConversation(this.conversationStep);
  }

  /**
   * Check if lead needs follow-up
   */
  requiresFollowUp() {
    return needsFollowUp(this.conversationStep);
  }

  /**
   * Check if lead is contactable (has DM URL or can build one)
   */
  isContactable() {
    return !this.isIgnored && this.status !== 'failed';
  }

  /**
   * Get DM URL (build if not set)
   */
  getDmUrl() {
    return this.dmUrl || buildDmUrl(this.username);
  }

  // ============ STATUS TRANSITIONS ============

  /**
   * Check if status transition is allowed
   */
  canTransitionTo(newStatus) {
    return canTransitionTo(this.status, newStatus);
  }

  /**
   * Mark as contacted
   */
  markContacted() {
    if (this.canTransitionTo(LeadStatus.CONTACTED)) {
      this.status = LeadStatus.CONTACTED;
      this.totalMessagesSent++;
      this.lastContactAt = new Date().toISOString();
      this._syncConversationStep();
    }
    return this;
  }

  /**
   * Mark as replied (lead responded)
   */
  markReplied() {
    if (this.canTransitionTo(LeadStatus.REPLIED)) {
      this.status = LeadStatus.REPLIED;
      this.totalMessagesReceived++;
      this._syncConversationStep();
    }
    return this;
  }

  /**
   * Mark as qualified
   */
  markQualified() {
    if (this.canTransitionTo(LeadStatus.QUALIFIED)) {
      this.status = LeadStatus.QUALIFIED;
    }
    return this;
  }

  /**
   * Mark as converted
   */
  markConverted() {
    if (this.canTransitionTo(LeadStatus.CONVERTED)) {
      this.status = LeadStatus.CONVERTED;
      this.bookingStatus = 'completed';
    }
    return this;
  }

  /**
   * Mark as ignored
   */
  ignore() {
    this.status = LeadStatus.IGNORED;
    this.isIgnored = true;
    return this;
  }

  // ============ ENGAGEMENT ============

  /**
   * Add comment and update engagement
   */
  addComment(qualityScore = 0, isSpam = false) {
    if (!isSpam) {
      this.totalComments++;
      this.engagementScore += qualityScore;
      this._recalculateWarmth();
    }
    return this;
  }

  /**
   * Set engagement score directly
   */
  setEngagement(score) {
    this.engagementScore = Number(score) || 0;
    this._recalculateWarmth();
    return this;
  }

  // ============ SERIALIZATION ============

  /**
   * Convert to database row format
   */
  toDbRow() {
    return {
      id: this.id,
      username: this.username,
      account_id: this.accountId,
      full_name: this.fullName,
      first_name: this.firstName,
      bio: this.bio,
      email: this.email,
      profile_url: this.profileUrl,
      dm_url: this.dmUrl,
      status: this.status,
      warmth: this.warmth,
      is_ignored: this.isIgnored ? 1 : 0,
      engagement_score: this.engagementScore,
      total_comments: this.totalComments,
      total_messages_sent: this.totalMessagesSent,
      total_messages_received: this.totalMessagesReceived,
      conversation_step: this.conversationStep,
      last_followup_template_id: this.lastFollowupTemplateId,
      last_contact_at: this.lastContactAt,
      lead_source: this.leadSource,
      lead_type: this.leadType,
      booking_status: this.bookingStatus,
      pain_points: JSON.stringify(this.painPoints),
      notes: this.notes,
      created_at: this.createdAt,
      updated_at: this.updatedAt
    };
  }

  /**
   * Convert to plain object
   */
  toJSON() {
    return {
      id: this.id,
      username: this.username,
      accountId: this.accountId,
      fullName: this.fullName,
      firstName: this.firstName,
      bio: this.bio,
      email: this.email,
      profileUrl: this.profileUrl,
      dmUrl: this.dmUrl,
      status: this.status,
      warmth: this.warmth,
      isIgnored: this.isIgnored,
      engagementScore: this.engagementScore,
      totalComments: this.totalComments,
      totalMessagesSent: this.totalMessagesSent,
      totalMessagesReceived: this.totalMessagesReceived,
      conversationStep: this.conversationStep,
      lastFollowupTemplateId: this.lastFollowupTemplateId,
      lastContactAt: this.lastContactAt,
      leadSource: this.leadSource,
      leadType: this.leadType,
      bookingStatus: this.bookingStatus,
      painPoints: this.painPoints,
      notes: this.notes,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  // ============ STATIC FACTORIES ============

  /**
   * Create Lead from database row
   */
  static fromDbRow(row) {
    if (!row) return null;
    return new Lead(row);
  }

  /**
   * Create new Lead from username
   */
  static create(username, accountId = null, source = null) {
    return new Lead({
      username,
      account_id: accountId,
      lead_source: source,
      status: LeadStatus.NEW,
      warmth: Warmth.COLD,
      conversation_step: ConversationStep.NO_CONTACT
    });
  }

  // ============ PRIVATE HELPERS ============

  _extractFirstName() {
    if (this.fullName) {
      return this.fullName.split(' ')[0];
    }
    return null;
  }

  _parsePainPoints(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return [];
      }
    }
    return [];
  }

  _syncConversationStep() {
    this.conversationStep = calculateStep(
      this.totalMessagesSent,
      this.totalMessagesReceived
    );
  }

  _recalculateWarmth() {
    this.warmth = calculateWarmth(this.engagementScore);
  }
}

export default Lead;

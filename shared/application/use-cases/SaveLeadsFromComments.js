/**
 * SaveLeadsFromComments Use Case
 *
 * Processes scraped comments and creates/updates leads in the database.
 * Applies spam filtering and engagement scoring.
 */

import { Lead } from '../../domain/entities/Lead.js';
import { SpamDetector } from '../../domain/services/SpamDetector.js';
import { EngagementScorer } from '../../domain/services/EngagementScorer.js';
import { normalizeUsername } from '../../domain/value-objects/Username.js';

/**
 * @typedef {Object} CommentInput
 * @property {string} username - Instagram username
 * @property {string} comment_text - Comment content
 * @property {string} [post_url] - Source post URL
 * @property {string} [source] - Source identifier (e.g., "hashtag:fitness")
 * @property {number} [account_id] - Account ID
 */

/**
 * @typedef {Object} SaveLeadsResult
 * @property {number} total - Total comments processed
 * @property {number} saved - New leads created
 * @property {number} updated - Existing leads updated
 * @property {number} spam - Comments filtered as spam
 * @property {Object} spamReasons - Breakdown of spam reasons
 */

/**
 * SaveLeadsFromComments Use Case
 */
export class SaveLeadsFromComments {
  /**
   * @param {Object} deps - Dependencies
   * @param {ILeadRepository} deps.leadRepository
   * @param {ICommentRepository} [deps.commentRepository]
   */
  constructor({ leadRepository, commentRepository = null }) {
    this.leadRepository = leadRepository;
    this.commentRepository = commentRepository;
  }

  /**
   * Execute the use case
   *
   * @param {CommentInput[]} comments - Raw scraped comments
   * @param {number} accountId - Account ID for multi-account support
   * @returns {Promise<SaveLeadsResult>}
   */
  async execute(comments, accountId) {
    const result = {
      total: comments.length,
      saved: 0,
      updated: 0,
      spam: 0,
      spamReasons: {}
    };

    // Group comments by username
    const byUsername = this._groupByUsername(comments);

    for (const [username, userComments] of Object.entries(byUsername)) {
      // Analyze all comments from this user
      const analyses = userComments.map(c => ({
        comment: c,
        analysis: SpamDetector.analyze({
          text: c.comment_text,
          username
        })
      }));

      // Count spam
      const spamComments = analyses.filter(a => a.analysis.isSpam);
      result.spam += spamComments.length;
      spamComments.forEach(a => {
        result.spamReasons[a.analysis.reason] = (result.spamReasons[a.analysis.reason] || 0) + 1;
      });

      // Get quality comments
      const qualityComments = analyses.filter(a => !a.analysis.isSpam);

      if (qualityComments.length === 0) {
        continue; // Skip users with only spam comments
      }

      // Calculate engagement
      const avgQuality = qualityComments.reduce((sum, a) => sum + a.analysis.qualityScore, 0) / qualityComments.length;
      const engagement = EngagementScorer.calculate({
        totalComments: qualityComments.length,
        avgCommentQuality: avgQuality
      });

      // Check if lead exists
      const existingLead = await this.leadRepository.findByUsername(username, accountId);

      if (existingLead) {
        // Update existing lead
        existingLead.totalComments += qualityComments.length;
        existingLead.setEngagement(existingLead.engagementScore + engagement.score);

        await this.leadRepository.save(existingLead);
        result.updated++;
      } else {
        // Create new lead
        const firstComment = qualityComments[0].comment;
        const lead = Lead.create(username, accountId, firstComment.source);
        lead.totalComments = qualityComments.length;
        lead.setEngagement(engagement.score);

        await this.leadRepository.save(lead);
        result.saved++;
      }

      // Optionally save individual comments
      if (this.commentRepository) {
        for (const { comment, analysis } of analyses) {
          await this.commentRepository.save({
            username,
            accountId,
            text: comment.comment_text,
            postUrl: comment.post_url,
            isSpam: analysis.isSpam,
            spamReason: analysis.reason,
            qualityScore: analysis.qualityScore
          });
        }
      }
    }

    return result;
  }

  /**
   * Group comments by normalized username
   * @private
   */
  _groupByUsername(comments) {
    const grouped = {};

    for (const comment of comments) {
      const username = normalizeUsername(comment.username);
      if (!username) continue;

      if (!grouped[username]) {
        grouped[username] = [];
      }
      grouped[username].push(comment);
    }

    return grouped;
  }
}

export default SaveLeadsFromComments;

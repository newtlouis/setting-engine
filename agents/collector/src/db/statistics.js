/**
 * Statistics Database Module
 *
 * Handles database statistics and engagement metrics calculations.
 */

import { getDb } from './core.js';
import { getCommentsForLead } from './comments.js';
import { updateLeadEngagement } from './leads.js';

/**
 * Get database statistics
 */
export function getStats(accountId = null) {
  const db = getDb();
  const stats = {};
  const accountFilter = accountId ? ' WHERE account_id = ?' : '';
  const accountParam = accountId ? [accountId] : [];

  stats.total_leads = db.prepare('SELECT COUNT(*) as count FROM leads' + accountFilter).get(...accountParam).count;
  stats.total_comments = db.prepare(`
    SELECT COUNT(*) as count FROM comments c
    JOIN leads l ON c.lead_id = l.id
    ${accountId ? 'WHERE l.account_id = ?' : ''}
  `).get(...accountParam).count;
  stats.total_posts = db.prepare('SELECT COUNT(*) as count FROM posts' + accountFilter).get(...accountParam).count;
  stats.spam_comments = db.prepare(`
    SELECT COUNT(*) as count FROM comments c
    JOIN leads l ON c.lead_id = l.id
    WHERE c.is_spam = 1 ${accountId ? 'AND l.account_id = ?' : ''}
  `).get(...accountParam).count;

  stats.leads_by_status = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM leads
    ${accountId ? 'WHERE account_id = ?' : ''}
    GROUP BY status
  `).all(...accountParam);

  stats.leads_by_engagement = db.prepare(`
    SELECT warmth as level, COUNT(*) as count
    FROM leads
    ${accountId ? 'WHERE account_id = ?' : ''}
    GROUP BY warmth
  `).all(...accountParam);

  stats.comments_by_source = db.prepare(`
    SELECT c.source, COUNT(*) as count
    FROM comments c
    JOIN leads l ON c.lead_id = l.id
    ${accountId ? 'WHERE l.account_id = ?' : ''}
    GROUP BY c.source
  `).all(...accountParam);

  return stats;
}

/**
 * Recalculate engagement scores for all leads
 */
export function recalculateAllEngagement() {
  const db = getDb();
  const leads = db.prepare('SELECT id, username FROM leads').all();

  for (const lead of leads) {
    // Filter out spam comments (is_spam is stored as 1 or 0 in SQLite)
    const allComments = getCommentsForLead(lead.id);
    const nonSpamComments = allComments.filter(c => c.is_spam !== 1 && c.is_spam !== '1');
    const metrics = calculateEngagementMetrics(nonSpamComments);
    updateLeadEngagement(lead.username, metrics);
  }

  return leads.length;
}

/**
 * Calculate engagement metrics from comments
 */
export function calculateEngagementMetrics(comments) {
  if (!comments || comments.length === 0) {
    return {
      total_comments: 0,
      engagement_score: 0,
      avg_comment_quality: 0
    };
  }

  const now = new Date();
  let score = 0;
  let totalQuality = 0;

  // Frequency score (0-10)
  score += Math.min(comments.length * 2, 10);

  // Recency score (0-15)
  let recentScore = 0;
  for (const comment of comments) {
    const commentDate = new Date(comment.comment_date || 0);
    const daysAgo = (now - commentDate) / (1000 * 60 * 60 * 24);

    if (daysAgo < 7) recentScore += 5;
    else if (daysAgo < 30) recentScore += 3;
    else if (daysAgo < 90) recentScore += 1;

    totalQuality += comment.quality_score || 0;
  }
  score += Math.min(recentScore, 15);

  // Quality score (0-10)
  let qualityScore = 0;
  for (const comment of comments) {
    const text = comment.comment_text || '';
    if (text.length > 100) qualityScore += 3;
    else if (text.length > 50) qualityScore += 2;
    else if (text.length > 20) qualityScore += 1;
  }
  score += Math.min(qualityScore, 10);

  // Pattern score (0-10)
  let patternScore = 0;
  for (const comment of comments) {
    const text = comment.comment_text || '';
    if (text.includes('?')) patternScore += 2;
    if (/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/u.test(text)) patternScore += 1;
    if (text.includes('!')) patternScore += 1;
  }
  score += Math.min(patternScore, 10);

  // Classification
  let level;
  if (score >= 25) level = 'HIGH';
  else if (score >= 12) level = 'MEDIUM';
  else level = 'LOW';

  return {
    total_comments: comments.length,
    engagement_score: score,
    engagement_level: level,
    avg_comment_quality: comments.length > 0 ? totalQuality / comments.length : 0
  };
}

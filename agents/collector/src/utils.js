/**
 * Utility Functions
 *
 * Helper functions for file I/O, detection, and data formatting.
 * Browser-related utilities (delay, gotoWithRetry, etc.) are re-exported
 * from shared/browser for backward compatibility.
 */

import { createObjectCsvWriter } from 'csv-writer';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

// Re-export browser utilities for backward compatibility
export { delay, gotoWithRetry } from '../../../shared/browser/index.js';

/**
 * Ensure output directory exists
 */
export async function ensureOutputDir(dir) {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  // Create context subdirectory
  const contextDir = join(dir, 'context');
  if (!existsSync(contextDir)) {
    await mkdir(contextDir, { recursive: true });
  }
}

/**
 * Write posts to CSV
 *
 * CSV columns: source_type,source_name,post_url,post_date,likes,comments_count,caption_excerpt
 */
export async function writePosts(posts, outputDir) {
  const csvWriter = createObjectCsvWriter({
    path: join(outputDir, 'posts.csv'),
    header: [
      { id: 'source_type', title: 'source_type' },
      { id: 'source_name', title: 'source_name' },
      { id: 'post_url', title: 'post_url' },
      { id: 'post_date', title: 'post_date' },
      { id: 'likes', title: 'likes' },
      { id: 'comments_count', title: 'comments_count' },
      { id: 'caption_excerpt', title: 'caption_excerpt' }
    ]
  });

  await csvWriter.writeRecords(posts);
}

/**
 * Save comments to CSV
 *
 * CSV columns: post_url,username,profile_url,comment_text,comment_date,followers_estimate,source,is_spam,spam_reason,quality_score
 */
export async function writeComments(comments, outputDir) {
  const csvWriter = createObjectCsvWriter({
    path: join(outputDir, 'comments.csv'),
    header: [
      { id: 'post_url', title: 'post_url' },
      { id: 'username', title: 'username' },
      { id: 'profile_url', title: 'profile_url' },
      { id: 'comment_text', title: 'comment_text' },
      { id: 'comment_date', title: 'comment_date' },
      { id: 'followers_estimate', title: 'followers_estimate' },
      { id: 'source', title: 'source' },
      { id: 'is_spam', title: 'is_spam' },
      { id: 'spam_reason', title: 'spam_reason' },
      { id: 'quality_score', title: 'quality_score' },
      { id: 'account_id', title: 'account_id' }
    ]
  });

  await csvWriter.writeRecords(comments);
}

/**
 * Save post context as JSON
 */
export async function saveContextJSON(postUrl, context) {
  const outputDir = process.env.OUTPUT_DIR || './output';
  const contextDir = join(outputDir, 'context');

  // Generate filename from post URL
  const postId = postUrl.split('/').filter(Boolean).pop().replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `${postId}.json`;

  await writeFile(
    join(contextDir, filename),
    JSON.stringify(context, null, 2)
  );
}

/**
 * Detect Instagram challenge or rate limit page
 * AND pause for manual resolution if detected.
 *
 * @param {Page} page - Playwright page object
 * @returns {Promise<boolean>} True if challenge persists (script should stop), False if resolved (continue)
 */
export async function detectChallenge(page) {
  const { checkForChallenge } = await import('../../../shared/pageVerification.js');
  return checkForChallenge(page);
}

/**
 * Extract post metadata (placeholder for future enhancement)
 */
export function extractPostMetadata(postElement) {
  // Future: extract likes, comments count, date from post grid thumbnail
  return {};
}

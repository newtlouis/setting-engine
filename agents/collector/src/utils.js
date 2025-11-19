/**
 * Utility Functions
 * 
 * Helper functions for file I/O, delays, detection, and data formatting.
 */

import { createObjectCsvWriter } from 'csv-writer';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

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
 * Write comments to CSV
 * 
 * CSV columns: post_url,username,profile_url,comment_text,comment_date,followers_estimate
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
      { id: 'followers_estimate', title: 'followers_estimate' }
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
 * Delay execution
 * 
 * @param {number} ms - Milliseconds to delay
 */
export async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Detect Instagram challenge or rate limit page
 * 
 * @param {Page} page - Playwright page object
 * @returns {Promise<boolean>} True if challenge detected
 */
export async function detectChallenge(page) {
  const url = page.url();
  
  // Check URL patterns
  if (url.includes('/challenge/') || url.includes('/accounts/suspended/')) {
    return true;
  }

  // Check for challenge text content
  // FIX NOTE: Challenge detection text may vary by locale - add more patterns if needed
  const challengeText = await page.$('text=/suspicious activity|verify|challenge|confirm/i').catch(() => null);
  
  return challengeText !== null;
}

/**
 * Extract post metadata (placeholder for future enhancement)
 */
export function extractPostMetadata(postElement) {
  // Future: extract likes, comments count, date from post grid thumbnail
  return {};
}

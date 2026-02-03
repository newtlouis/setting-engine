/**
 * Posts Database Module
 *
 * Handles all post-related database operations.
 */

import { getDb } from './core.js';

/**
 * Insert or update a post
 */
export function upsertPost(post) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO posts (
      post_url, source_type, source_name, post_date,
      likes, comments_count, caption_excerpt
    ) VALUES (
      @post_url, @source_type, @source_name, @post_date,
      @likes, @comments_count, @caption_excerpt
    )
    ON CONFLICT(post_url) DO UPDATE SET
      likes = COALESCE(@likes, likes),
      comments_count = COALESCE(@comments_count, comments_count)
    RETURNING *
  `);

  return stmt.get({
    post_url: post.post_url,
    source_type: post.source_type || null,
    source_name: post.source_name || null,
    post_date: post.post_date || null,
    likes: post.likes || null,
    comments_count: post.comments_count || null,
    caption_excerpt: post.caption_excerpt || null
  });
}

/**
 * Mark a post as scraped
 */
export function markPostScraped(postUrl) {
  const db = getDb();
  return db.prepare(`
    UPDATE posts SET
      scraped_at = datetime('now'),
      comments_scraped = 1
    WHERE post_url = ?
  `).run(postUrl);
}

/**
 * Get posts that haven't been scraped
 */
export function getUnscrapedPosts(limit = 50) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM posts
    WHERE comments_scraped = 0
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}

/**
 * Check if a post has been scraped
 */
export function isPostScraped(postUrl) {
  const db = getDb();
  const result = db.prepare('SELECT comments_scraped FROM posts WHERE post_url = ?').get(postUrl);
  return result && result.comments_scraped === 1;
}

/**
 * Get posts scraped within the last X hours
 */
export function getRecentlyScrapedPosts(hours = 24) {
  const db = getDb();
  return db.prepare(`
    SELECT post_url FROM posts
    WHERE scraped_at >= datetime('now', ?)
  `).all(`-${hours} hours`).map(p => p.post_url);
}

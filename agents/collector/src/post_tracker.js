/**
 * Post Tracker Module
 * 
 * Tracks which posts have been scraped and when, to enable intelligent
 * re-scraping and avoid duplicates while maximizing prospect discovery.
 */

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export class PostTracker {
  constructor(outputDir = './output') {
    this.outputDir = outputDir;
    this.trackingFile = join(outputDir, 'tracking.json');
    this.data = {
      posts: {},
      stats: {
        total_prospects: 0,
        new_today: 0,
        last_run: null
      }
    };
  }

  /**
   * Load tracking data from file
   */
  async load() {
    if (existsSync(this.trackingFile)) {
      try {
        const content = await readFile(this.trackingFile, 'utf-8');
        this.data = JSON.parse(content);
      } catch (error) {
        console.error('Error loading tracking file:', error);
      }
    }
    return this;
  }

  /**
   * Save tracking data to file
   */
  async save() {
    await writeFile(this.trackingFile, JSON.stringify(this.data, null, 2));
  }

  /**
   * Check if a post should be scraped based on intelligent rules
   * 
   * @param {string} postUrl - The post URL to check
   * @param {Object} options - Scraping options
   * @returns {boolean} - Whether to scrape this post
   */
  shouldScrapePost(postUrl, options = {}) {
    const post = this.data.posts[postUrl];
    
    // Never scraped before? Always scrape
    if (!post) {
      return true;
    }

    const now = new Date();
    const lastScraped = new Date(post.last_scraped);
    const hoursSinceLastScrape = (now - lastScraped) / (1000 * 60 * 60);
    
    // Re-scraping rules based on post age and scraping history
    if (post.times_scraped === 1) {
      // First re-scrape: wait at least 24 hours
      return hoursSinceLastScrape >= 24;
    } else if (post.times_scraped < 5) {
      // 2-4 re-scrapes: wait 3 days
      return hoursSinceLastScrape >= 72;
    } else {
      // 5+ scrapes: wait 7 days (post is getting old)
      return hoursSinceLastScrape >= 168;
    }
  }

  /**
   * Mark a post as scraped
   * 
   * @param {string} postUrl - The post URL
   * @param {Object} metadata - Additional metadata about the scraping
   */
  markPostScraped(postUrl, metadata = {}) {
    const now = new Date().toISOString();
    
    if (!this.data.posts[postUrl]) {
      // First time scraping this post
      this.data.posts[postUrl] = {
        first_scraped: now,
        last_scraped: now,
        times_scraped: 1,
        last_comment_count: metadata.commentCount || 0,
        source: metadata.source || 'unknown'
      };
    } else {
      // Update existing post
      this.data.posts[postUrl].last_scraped = now;
      this.data.posts[postUrl].times_scraped++;
      this.data.posts[postUrl].last_comment_count = metadata.commentCount || 0;
    }
  }

  /**
   * Get posts by priority for intelligent scraping
   * 
   * @param {Array} allPosts - All discovered posts
   * @param {string} source - Source identifier (e.g., "hashtag:fitness")
   * @returns {Object} - Posts categorized by priority
   */
  prioritizePosts(allPosts, source) {
    const now = new Date();
    const categories = {
      never_scraped: [],
      recent_rescrape: [],     // < 24h since last scrape
      medium_rescrape: [],     // 1-7 days since last scrape
      old_rescrape: []         // > 7 days since last scrape
    };

    for (const postUrl of allPosts) {
      const post = this.data.posts[postUrl];
      
      if (!post) {
        categories.never_scraped.push(postUrl);
      } else {
        const lastScraped = new Date(post.last_scraped);
        const daysSinceLastScrape = (now - lastScraped) / (1000 * 60 * 60 * 24);
        
        if (daysSinceLastScrape < 1) {
          categories.recent_rescrape.push(postUrl);
        } else if (daysSinceLastScrape <= 7) {
          categories.medium_rescrape.push(postUrl);
        } else {
          categories.old_rescrape.push(postUrl);
        }
      }
    }

    return categories;
  }

  /**
   * Update statistics
   * 
   * @param {number} newProspects - Number of new prospects found
   */
  updateStats(newProspects) {
    const today = new Date().toDateString();
    const lastRun = this.data.stats.last_run ? new Date(this.data.stats.last_run).toDateString() : null;
    
    if (today !== lastRun) {
      // New day, reset daily counter
      this.data.stats.new_today = newProspects;
    } else {
      // Same day, increment counter
      this.data.stats.new_today += newProspects;
    }
    
    this.data.stats.total_prospects += newProspects;
    this.data.stats.last_run = new Date().toISOString();
  }

  /**
   * Get scraping statistics
   */
  getStats() {
    return {
      ...this.data.stats,
      total_posts_tracked: Object.keys(this.data.posts).length,
      posts_scraped_multiple_times: Object.values(this.data.posts)
        .filter(p => p.times_scraped > 1).length
    };
  }
}
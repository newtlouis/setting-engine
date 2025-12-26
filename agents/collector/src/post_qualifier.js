/**
 * Post Qualifier Module
 * 
 * Pre-qualifies posts before scraping to save time and focus on high-value content.
 * Analyzes comment count, recency, and engagement metrics.
 */

import { delay, detectChallenge } from './utils.js';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Quick-qualify a post by checking its comment count and recency
 * without doing a full scrape
 * 
 * @param {Page} page - Playwright page object
 * @param {string} postUrl - URL of the post
 * @returns {Promise<Object>} Qualification data
 */
export async function qualifyPost(page, postUrl) {
  const qualification = {
    post_url: postUrl,
    is_qualified: false,
    comments_count: 0,
    likes_count: 0,
    post_age_days: null,
    disqualify_reason: null,
    engagement_estimate: 'unknown'
  };

  try {
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(2000 + Math.random() * 1000);

    if (await detectChallenge(page)) {
      qualification.disqualify_reason = 'challenge_detected';
      return qualification;
    }

    // Extract post metrics
    const metrics = await page.evaluate(() => {
      const data = {
        comments: 0,
        likes: 0,
        postDate: null,
        debug: []
      };

      const bodyText = document.body.innerText;
      
      // Try to get comment count - Multiple methods
      
      // Method 1: "View all X comments" (English)
      const viewAllComments = bodyText.match(/View all (\d[\d,]*) comments/i);
      if (viewAllComments) {
        data.comments = parseInt(viewAllComments[1].replace(/,/g, ''), 10);
        data.debug.push(`Method1: ${data.comments}`);
      }

      // Method 2: "Voir les X commentaires" (French)
      if (data.comments === 0) {
        const voirComments = bodyText.match(/Voir les (\d[\d\s]*) commentaires/i);
        if (voirComments) {
          data.comments = parseInt(voirComments[1].replace(/\s/g, ''), 10);
          data.debug.push(`Method2: ${data.comments}`);
        }
      }
      
      // Method 3: "Afficher les X commentaires" (French alternative)
      if (data.comments === 0) {
        const afficherComments = bodyText.match(/Afficher les (\d[\d\s]*) commentaires/i);
        if (afficherComments) {
          data.comments = parseInt(afficherComments[1].replace(/\s/g, ''), 10);
          data.debug.push(`Method3: ${data.comments}`);
        }
      }

      // Method 4: Look for "X comments" anywhere
      if (data.comments === 0) {
        const commentsPattern = bodyText.match(/(\d[\d,\s]*)\s*comments?/i);
        if (commentsPattern) {
          data.comments = parseInt(commentsPattern[1].replace(/[,\s]/g, ''), 10);
          data.debug.push(`Method4: ${data.comments}`);
        }
      }
      
      // Method 5: Look for "X commentaires" anywhere (French)
      if (data.comments === 0) {
        const commentairesPattern = bodyText.match(/(\d[\d\s]*)\s*commentaires?/i);
        if (commentairesPattern) {
          data.comments = parseInt(commentairesPattern[1].replace(/\s/g, ''), 10);
          data.debug.push(`Method5: ${data.comments}`);
        }
      }

      // Method 6: Count comment containers (DIV-based structure)
      if (data.comments === 0) {
        // Look for comment-like structures with username + text + time
        const commentLikeDivs = document.querySelectorAll('div[role="button"]');
        let commentCount = 0;
        commentLikeDivs.forEach(div => {
          const hasTime = div.querySelector('time[datetime]');
          const hasProfileLink = div.querySelector('a[href^="/"][href$="/"]');
          if (hasTime && hasProfileLink) {
            commentCount++;
          }
        });
        if (commentCount > 0) {
          data.comments = commentCount;
          data.debug.push(`Method6: ${data.comments}`);
        }
      }
      
      // Method 7: If we see ANY comments text/elements, assume there are some
      if (data.comments === 0) {
        const hasCommentsSection = bodyText.includes('comment') || bodyText.includes('commentaire');
        if (hasCommentsSection) {
          // Can't determine count, but there might be comments - set to 1 to not disqualify
          data.comments = 1;
          data.debug.push('Method7: hasCommentsSection');
        }
      }

      // Get likes count
      // Method 1: Look for likes link
      const likesLink = document.querySelector('a[href$="/liked_by/"]');
      if (likesLink) {
        const likesText = likesLink.textContent;
        const likesMatch = likesText.match(/([\d,]+)/);
        if (likesMatch) {
          data.likes = parseInt(likesMatch[1].replace(/,/g, ''), 10);
        }
      }

      // Method 2: Look for "X likes" or "X j'aime" text
      if (data.likes === 0) {
        const likesText = bodyText.match(/([\d,\s]+)\s*(likes?|j'aime)/i);
        if (likesText) {
          data.likes = parseInt(likesText[1].replace(/[,\s]/g, ''), 10);
        }
      }

      // Get post date
      const timeElement = document.querySelector('time[datetime]');
      if (timeElement) {
        data.postDate = timeElement.getAttribute('datetime');
      }

      return data;
    });

    qualification.comments_count = metrics.comments;
    qualification.likes_count = metrics.likes;

    // Calculate post age
    if (metrics.postDate) {
      const postDate = new Date(metrics.postDate);
      const now = new Date();
      qualification.post_age_days = Math.floor((now - postDate) / (1000 * 60 * 60 * 24));
    }

    // Determine engagement estimate
    if (metrics.likes > 1000 || metrics.comments > 100) {
      qualification.engagement_estimate = 'high';
    } else if (metrics.likes > 100 || metrics.comments > 20) {
      qualification.engagement_estimate = 'medium';
    } else {
      qualification.engagement_estimate = 'low';
    }

    // Qualification rules
    const MIN_COMMENTS = 5; // Don't scrape posts with less than 5 comments
    const MAX_AGE_DAYS = 90; // Don't scrape posts older than 90 days

    if (metrics.comments < MIN_COMMENTS) {
      qualification.disqualify_reason = `too_few_comments (${metrics.comments} < ${MIN_COMMENTS})`;
    } else if (qualification.post_age_days !== null && qualification.post_age_days > MAX_AGE_DAYS) {
      qualification.disqualify_reason = `too_old (${qualification.post_age_days} days > ${MAX_AGE_DAYS})`;
    } else {
      qualification.is_qualified = true;
    }

  } catch (error) {
    qualification.disqualify_reason = `error: ${error.message}`;
  }

  return qualification;
}

/**
 * Batch qualify posts and return only qualified ones
 * 
 * @param {Page} page - Playwright page object
 * @param {Array} posts - Array of post objects
 * @param {Object} options - Qualification options
 * @returns {Promise<Object>} { qualified: Array, disqualified: Array, stats: Object }
 */
export async function batchQualifyPosts(page, posts, options = {}) {
  const {
    minComments = 5,
    maxAgeDays = 90,
    skipQualification = false
  } = options;

  if (skipQualification) {
    return {
      qualified: posts,
      disqualified: [],
      stats: { total: posts.length, qualified: posts.length, skipped: 0 }
    };
  }

  const qualified = [];
  const disqualified = [];
  const stats = {
    total: posts.length,
    qualified: 0,
    tooFewComments: 0,
    tooOld: 0,
    errors: 0
  };

  console.log(`\n🔍 Pre-qualifying ${posts.length} posts...`);

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    process.stdout.write(`   [${i + 1}/${posts.length}] Checking: ${post.post_url.substring(0, 50)}...`);

    const qualification = await qualifyPost(page, post.post_url);

    if (qualification.is_qualified) {
      qualified.push({
        ...post,
        estimated_comments: qualification.comments_count,
        estimated_likes: qualification.likes_count,
        post_age_days: qualification.post_age_days
      });
      stats.qualified++;
      console.log(` ✅ (${qualification.comments_count} comments)`);
    } else {
      disqualified.push({
        ...post,
        disqualify_reason: qualification.disqualify_reason
      });
      
      if (qualification.disqualify_reason?.includes('too_few_comments')) {
        stats.tooFewComments++;
      } else if (qualification.disqualify_reason?.includes('too_old')) {
        stats.tooOld++;
      } else {
        stats.errors++;
      }
      console.log(` ❌ ${qualification.disqualify_reason}`);
    }

    // Small delay between qualifications
    await delay(1000 + Math.random() * 1000);
  }

  console.log(`\n📊 Qualification results:`);
  console.log(`   ✅ Qualified: ${stats.qualified}/${stats.total}`);
  console.log(`   ❌ Too few comments: ${stats.tooFewComments}`);
  console.log(`   ❌ Too old: ${stats.tooOld}`);
  console.log(`   ❌ Errors: ${stats.errors}`);

  return { qualified, disqualified, stats };
}

/**
 * Load already-scraped posts from tracking file
 * Returns a Map where key=url, value=timestamp (ms)
 * 
 * @param {string} trackingFile - Path to tracking file
 * @returns {Promise<Map<string, number>>} Map of scraped info
 */
export async function loadScrapedPosts(trackingFile) {
  try {
    const data = await fs.readFile(trackingFile, 'utf-8');
    const parsed = JSON.parse(data);
    
    // Handle legacy format (array of strings)
    if (Array.isArray(parsed.posts)) {
      const map = new Map();
      // If we don't have timestamps, use file modified time or existing last_updated
      // defaulting to now to prevent immediate re-scrape of everything
      const defaultTime = parsed.last_updated ? new Date(parsed.last_updated).getTime() : Date.now();
      
      parsed.posts.forEach(url => {
        map.set(url, defaultTime);
      });
      return map;
    }
    
    // Handle new format (object: url -> timestamp)
    if (parsed.posts && typeof parsed.posts === 'object') {
       return new Map(Object.entries(parsed.posts));
    }
    
    return new Map();
  } catch {
    return new Map();
  }
}

/**
 * Save scraped posts to tracking file
 * 
 * @param {string} trackingFile - Path to tracking file
 * @param {Map<string, number>|Set<string>} scrapedPosts - Map of url->timestamp (or legacy Set)
 */
export async function saveScrapedPosts(trackingFile, scrapedPosts) {
  let postsObj = {};
  
  if (scrapedPosts instanceof Set) {
    // Convert legacy Set to new format
    const now = Date.now();
    for (const url of scrapedPosts) {
      postsObj[url] = now;
    }
  } else if (scrapedPosts instanceof Map) {
    // Convert Map to Object
    postsObj = Object.fromEntries(scrapedPosts);
  }

  const data = {
    last_updated: new Date().toISOString(),
    count: Object.keys(postsObj).length,
    posts: postsObj
  };
  
  await fs.writeFile(trackingFile, JSON.stringify(data, null, 2));
}

/**
 * Filter out already-scraped posts
 * 
 * @param {Array} posts - Array of post objects
 * @param {Map<string, number>|Set<string>} scrapedPosts - Map of url->timestamp
 * @returns {Object} { newPosts: Array, skippedCount: number }
 */
export function filterAlreadyScraped(posts, scrapedPosts) {
  const RE_SCRAPE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
  
  const newPosts = posts.filter(post => {
    // If using legacy Set
    if (scrapedPosts instanceof Set) {
      return !scrapedPosts.has(post.post_url);
    }
    
    // If using new Map
    if (scrapedPosts.has(post.post_url)) {
      const lastScraped = scrapedPosts.get(post.post_url);
      const now = Date.now();
      // If scraped recently (< 24h), skip it
      if (now - lastScraped < RE_SCRAPE_INTERVAL_MS) {
        return false;
      }
      // Else (older than 24h), treat as "new" (allow re-scrape)
      return true;
    }
    
    return true; // Not in history, definitely new
  });

  return {
    newPosts,
    skippedCount: posts.length - newPosts.length
  };
}

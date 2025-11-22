/**
 * Post Scraper Module
 * 
 * Scrapes comments and metadata from individual Instagram posts.
 */

import { delay, detectChallenge, saveContextJSON } from './utils.js';
import { CONFIG } from './config.js';

/**
 * Scrape comments from a single post
 * 
 * @param {Page} page - Playwright page object
 * @param {string} postUrl - URL of the Instagram post
 * @param {number} maxComments - Maximum number of comments to scrape
 * @returns {Promise<Array>} Array of comment objects
 */
export async function scrapePostComments(page, postUrl, maxComments) {
  await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await delay(3000 + Math.random() * 3000);

  // Check for challenge
  if (await detectChallenge(page)) {
    throw new Error('Challenge detected while loading post');
  }

  const comments = [];
  const postContext = {
    post_url: postUrl,
    scraped_at: new Date().toISOString(),
    caption: '',
    likes: '',
    comments_count: '',
    post_date: ''
  };

  try {
    // Wait for post content to load
    await page.waitForSelector('article', { timeout: 10000 }).catch(() => null);
    
    // Extract post caption
    // FIX NOTE: Caption selector may change - look for <h1> in article or meta tags
    const caption = await page.$eval(
      'article h1',
      el => el.textContent
    ).catch(() => '');
    postContext.caption = caption;

    // Extract likes count
    // FIX NOTE: Likes format varies (text like "1,234 likes") - selector may need update
    const likesText = await page.$eval(
      'section a[href$="/liked_by/"] span, section span:has-text("likes")',
      el => el.textContent
    ).catch(() => '');
    postContext.likes = likesText;

    // Wait for comments section to load
    await delay(2000);
    
    // Scroll to comments section
    await page.evaluate(() => {
      const article = document.querySelector('article');
      if (article) {
        article.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    await delay(1000);

    // Load more comments by clicking "View more comments" if available
    let loadMoreAttempts = 0;
    const maxLoadAttempts = Math.ceil(maxComments / 20); // Instagram loads ~20 comments at a time

    while (loadMoreAttempts < maxLoadAttempts) {
      // FIX NOTE: "View more comments" button text or structure may change
      const loadMoreButton = await page.$('button:has-text("View more comments"), button:has-text("more comments")').catch(() => null);
      
      if (!loadMoreButton) break;

      await loadMoreButton.click().catch(() => {});
      await delay(1500 + Math.random() * 1000);
      loadMoreAttempts++;
    }

    // Extract all visible comments - try multiple selectors
    // FIX NOTE: Comment structure selector - update if Instagram changes comment HTML layout
    let commentElements = await page.$$('article ul li[role="menuitem"]');
    
    if (commentElements.length === 0) {
      // Try alternative selector 1: any li in article
      commentElements = await page.$$('article ul li');
    }
    
    if (commentElements.length === 0) {
      // Try alternative selector 2: divs with comment-like structure
      commentElements = await page.$$('article div[role="button"]').then(elems => 
        elems.filter(async (elem) => {
          const text = await elem.textContent();
          return text && text.length > 5;
        })
      );
    }
    
    // Debug: log what we found
    console.log(`      → Found ${commentElements.length} comment elements`);

    for (let i = 0; i < Math.min(commentElements.length, maxComments); i++) {
      const elem = commentElements[i];

      try {
        // Extract username - try multiple methods
        let username = await elem.$eval(
          'a[role="link"]', 
          el => el.textContent
        ).catch(() => null);
        
        if (!username) {
          username = await elem.evaluate(el => {
            const link = el.querySelector('a');
            return link ? link.textContent : null;
          }).catch(() => 'unknown');
        }

        // Extract profile URL
        let profileUrl = await elem.$eval(
          'a[role="link"]',
          el => el.href
        ).catch(() => null);
        
        if (!profileUrl) {
          profileUrl = await elem.evaluate(el => {
            const link = el.querySelector('a');
            return link ? link.href : '';
          }).catch(() => '');
        }

        // Extract comment text - try multiple methods
        let commentText = await elem.evaluate(el => {
          // Method 1: Look for all spans and find the longest one (likely the comment)
          const spans = Array.from(el.querySelectorAll('span'));
          const textSpans = spans
            .map(s => s.textContent.trim())
            .filter(t => t.length > 0)
            .sort((a, b) => b.length - a.length);
          return textSpans[0] || '';
        }).catch(() => '');
        
        // Method 2: If still no text, get all text content and filter out username
        if (!commentText || commentText.length < 2) {
          commentText = await elem.evaluate((el, user) => {
            const fullText = el.textContent.trim();
            // Remove username from text if present
            return fullText.replace(user, '').trim();
          }, username).catch(() => '');
        }

        // Extract date
        const commentDate = await elem.$eval(
          'time',
          el => el.getAttribute('datetime')
        ).catch(() => '');

        // Estimate followers (not available in comments, leave empty for now)
        const followersEstimate = '';

        // Only add if we have meaningful data
        if (commentText && commentText.trim().length > 2 && username && username !== 'unknown') {
          comments.push({
            post_url: postUrl,
            username: username.trim(),
            profile_url: profileUrl,
            comment_text: commentText.trim(),
            comment_date: commentDate,
            followers_estimate: followersEstimate
          });
        }

      } catch (error) {
        // Skip malformed comment elements
        continue;
      }
    }
    
    // Debug: show sample of what we collected
    if (comments.length > 0) {
      console.log(`      → Sample comment: "${comments[0].comment_text.substring(0, 50)}..." by @${comments[0].username}`);
    } else {
      console.log(`      ⚠️  No comments extracted - selectors may need updating`);
    }

    // Save context JSON for this post
    postContext.comments_count = comments.length.toString();
    await saveContextJSON(postUrl, postContext);

  } catch (error) {
    console.error(`   Error extracting post metadata: ${error.message}`);
  }

  return comments;
}

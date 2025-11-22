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

    // Extract all visible comments
    // FIX NOTE: Comment structure selector - update if Instagram changes comment HTML layout
    const commentElements = await page.$$('article ul li[role="menuitem"]');
    
    if (commentElements.length === 0) {
      // Try alternative selectors
      const altComments = await page.$$('ul ul li').catch(() => []);
      commentElements.push(...altComments);
    }

    for (let i = 0; i < Math.min(commentElements.length, maxComments); i++) {
      const elem = commentElements[i];

      try {
        const username = await elem.$eval(
          'a[role="link"]', 
          el => el.textContent
        ).catch(() => 'unknown');

        const profileUrl = await elem.$eval(
          'a[role="link"]',
          el => el.href
        ).catch(() => '');

        const commentText = await elem.$eval(
          'span',
          el => {
            // Get the span that contains the actual comment text
            const spans = [...el.parentElement.querySelectorAll('span')];
            return spans.find(s => s.textContent.length > 0)?.textContent || '';
          }
        ).catch(() => '');

        const commentDate = await elem.$eval(
          'time',
          el => el.getAttribute('datetime')
        ).catch(() => '');

        // Estimate followers (not available in comments, leave empty for now)
        const followersEstimate = '';

        if (commentText.trim()) {
          comments.push({
            post_url: postUrl,
            username,
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

    // Save context JSON for this post
    postContext.comments_count = comments.length.toString();
    await saveContextJSON(postUrl, postContext);

  } catch (error) {
    console.error(`   Error extracting post metadata: ${error.message}`);
  }

  return comments;
}

/**
 * Post Scraper Module V5 - Based on Real Instagram Structure (Nov 2025)
 * 
 * Uses actual class names from Instagram's current HTML structure:
 * - ul._a9ym (comments container)
 * - li._a9zj (individual comment)
 * - span._ap3a._aaco._aacu._aacx._aad7._aade (comment text)
 */

import { delay, detectChallenge, saveContextJSON } from './utils.js';
import { CONFIG } from './config.js';

/**
 * Scrape comments using real Instagram structure (2025)
 */
export async function scrapePostComments(page, postUrl, maxComments) {
  await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await delay(3000 + Math.random() * 3000);

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
    console.log(`      → Waiting for page to load...`);
    await delay(3000);
    
    // Aggressive scrolling to load comments
    console.log(`      → Scrolling to load comments...`);
    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => {
        window.scrollBy({ top: 400, behavior: 'smooth' });
      });
      await delay(1200);
    }

    // Click "View more comments" / "View replies" buttons
    console.log(`      → Clicking load-more buttons...`);
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
      let count = 0;
      
      for (const btn of buttons) {
        const text = btn.textContent.toLowerCase();
        if (text.includes('view') || 
            text.includes('more') || 
            text.includes('comment') ||
            text.includes('repl') ||
            text.includes('voir') ||
            text.includes('afficher')) {
          try {
            btn.click();
            count++;
            if (count >= 5) break;
          } catch (e) {}
        }
      }
      return count;
    });
    
    console.log(`      → Clicked ${clicked} buttons`);
    if (clicked > 0) await delay(2000);

    // Extract comments using REAL Instagram structure
    const extraction = await page.evaluate(() => {
      const result = {
        comments: [],
        debug: {
          ulsFound: 0,
          lisFound: 0,
          commentsExtracted: 0
        }
      };

      // Find comment containers: ul._a9ym
      const commentUls = document.querySelectorAll('ul._a9ym');
      result.debug.ulsFound = commentUls.length;

      commentUls.forEach(ul => {
        // Find individual comments: li._a9zj
        const commentLis = ul.querySelectorAll('li._a9zj, li._a9zl');
        result.debug.lisFound += commentLis.length;

        commentLis.forEach(li => {
          try {
            // Extract username from profile link
            const profileLink = li.querySelector('a[href^="/"][href*="/"]');
            if (!profileLink) return;
            
            const href = profileLink.getAttribute('href') || '';
            
            // Skip non-profile links (posts, reels, etc.)
            if (href.includes('/p/') || 
                href.includes('/reel/') || 
                href.includes('/explore/') ||
                href.includes('/tags/') ||
                href === '/') {
              return;
            }
            
            const username = profileLink.textContent.trim();
            if (!username || username.length < 2 || username.length > 30) return;

            // Extract comment text: span._ap3a (and variations)
            const textSpan = li.querySelector('span._ap3a, span[dir="auto"]._aaco, span._aacu');
            if (!textSpan) return;
            
            let commentText = textSpan.textContent.trim();
            
            // Skip if text is empty or too short
            if (!commentText || commentText.length < 1) return;
            
            // Clean up: remove username if it appears at start
            if (commentText.startsWith(username)) {
              commentText = commentText.substring(username.length).trim();
            }
            
            // Skip UI text
            const uiWords = ['verified', 'j\'aime', 'répondre', 'reply', 'like', 'more options', 'options'];
            if (uiWords.includes(commentText.toLowerCase())) return;
            
            // If still empty after cleanup, skip
            if (commentText.length < 1) return;

            // Extract timestamp
            const timeElement = li.querySelector('time._a9ze, time[datetime]');
            const commentDate = timeElement ? timeElement.getAttribute('datetime') : '';

            // Build full profile URL
            const profileUrl = href.startsWith('http') ? href : `https://www.instagram.com${href}`;

            result.comments.push({
              username: username,
              profile_url: profileUrl,
              comment_text: commentText.substring(0, 500),
              comment_date: commentDate,
              followers_estimate: ''
            });
            
            result.debug.commentsExtracted++;

          } catch (error) {
            // Skip malformed comments
            console.error('Error extracting comment:', error.message);
          }
        });
      });

      return result;
    });

    console.log(`      → Found ${extraction.debug.ulsFound} comment containers`);
    console.log(`      → Found ${extraction.debug.lisFound} comment items`);
    console.log(`      → Extracted ${extraction.debug.commentsExtracted} valid comments`);

    // Deduplicate by username + comment text
    const seen = new Set();
    for (const comment of extraction.comments) {
      const key = `${comment.username}:${comment.comment_text.substring(0, 50)}`;
      
      if (!seen.has(key) && comments.length < maxComments) {
        comments.push({
          post_url: postUrl,
          username: comment.username,
          profile_url: comment.profile_url,
          comment_text: comment.comment_text,
          comment_date: comment.comment_date,
          followers_estimate: comment.followers_estimate
        });
        seen.add(key);
      }
    }

    // Debug output
    if (comments.length > 0) {
      console.log(`      ✅ Extracted ${comments.length} unique comments`);
      console.log(`      → Sample: "@${comments[0].username}: ${comments[0].comment_text.substring(0, 60)}..."`);
    } else {
      console.log(`      ⚠️  No comments extracted with V5`);
      console.log(`      💡 Debug info:`);
      console.log(`         - UL containers: ${extraction.debug.ulsFound}`);
      console.log(`         - LI items: ${extraction.debug.lisFound}`);
      console.log(`      💡 Possible reasons:`);
      console.log(`         - No comments on this post`);
      console.log(`         - Comments not loaded (try more scrolling)`);
      console.log(`         - Instagram changed class names (update selectors)`);
    }

    // Save context
    postContext.comments_count = comments.length.toString();
    await saveContextJSON(postUrl, postContext);

  } catch (error) {
    console.error(`   Error in V5 scraper: ${error.message}`);
  }

  return comments;
}

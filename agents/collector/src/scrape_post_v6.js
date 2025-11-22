/**
 * Post Scraper Module V6 - Structure-based (No class names)
 * 
 * Uses DOM structure patterns instead of obfuscated class names:
 * - Looks for <ul> containing <li> with profile links
 * - Identifies username + text patterns
 * - Does NOT rely on Instagram's changing class names
 */

import { delay, detectChallenge, saveContextJSON } from './utils.js';
import { CONFIG } from './config.js';

/**
 * Scrape comments using structure-based approach (class-agnostic)
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
    await delay(4000);
    
    // Aggressive scrolling to load comments
    console.log(`      → Scrolling to load comments...`);
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => {
        window.scrollBy({ top: 400, behavior: 'smooth' });
      });
      await delay(1000);
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
            if (count >= 8) break;
          } catch (e) {}
        }
      }
      return count;
    });
    
    console.log(`      → Clicked ${clicked} buttons`);
    if (clicked > 0) await delay(3000);

    // Extract comments using STRUCTURE-BASED approach (no class names)
    const extraction = await page.evaluate(() => {
      const result = {
        comments: [],
        debug: {
          allUls: 0,
          allLis: 0,
          profileLinksFound: 0,
          commentCandidates: 0,
          validComments: 0
        }
      };

      // Strategy: Find ALL <ul> elements, then look for <li> with profile links
      const allUls = document.querySelectorAll('ul');
      result.debug.allUls = allUls.length;

      allUls.forEach(ul => {
        const lis = ul.querySelectorAll('li');
        result.debug.allLis += lis.length;

        lis.forEach(li => {
          try {
            // Look for profile link: <a href="/username">
            const links = li.querySelectorAll('a[href^="/"]');
            let profileLink = null;
            let username = null;

            for (const link of links) {
              const href = link.getAttribute('href') || '';
              const text = link.textContent.trim();
              
              // Profile pattern: /username (not /p/, /reel/, etc.)
              if (href.match(/^\/[a-zA-Z0-9._]+\/?$/) && 
                  text.length >= 2 && 
                  text.length <= 30 &&
                  !text.includes(' ')) {
                
                profileLink = link;
                username = text;
                result.debug.profileLinksFound++;
                break;
              }
            }

            if (!profileLink || !username) return;

            // Now find the comment text
            // Strategy: Look for <span dir="auto"> or any span with substantial text
            const spans = li.querySelectorAll('span[dir="auto"], span');
            let commentText = null;

            for (const span of spans) {
              const text = span.textContent.trim();
              
              // Skip if it's just the username
              if (text === username) continue;
              
              // Skip UI text
              const uiWords = ['verified', 'j\'aime', 'répondre', 'reply', 'like', 
                              'more options', 'options', 'suivre', 'follow', 'abonné'];
              if (uiWords.includes(text.toLowerCase())) continue;
              
              // Skip time patterns
              if (/^\d+\s*(h|d|w|m|s|min|hour|day|week|month|année)/.test(text.toLowerCase())) continue;
              
              // Skip numbers only
              if (/^\d+$/.test(text)) continue;
              
              // Skip "X J'aime" pattern
              if (/^\d+\s*(j'aime|like|réponse|reply)/i.test(text)) continue;
              
              // If text is substantial and different from username
              if (text.length >= 2 && 
                  text.length <= 500 && 
                  !text.includes('{') && 
                  !text.includes('require') &&
                  !text.includes('__d(')) {
                
                // Remove username if it appears at the start
                let cleanText = text;
                if (cleanText.startsWith(username)) {
                  cleanText = cleanText.substring(username.length).trim();
                }
                
                if (cleanText.length >= 1) {
                  commentText = cleanText;
                  result.debug.commentCandidates++;
                  break;
                }
              }
            }

            if (!commentText) {
              // Fallback: get all text from li, remove username and UI elements
              let fullText = li.textContent.trim();
              
              // Remove username
              fullText = fullText.replace(username, '');
              
              // Remove common UI patterns
              fullText = fullText.replace(/\d+\s*h/g, '');
              fullText = fullText.replace(/\d+\s*j'aime/gi, '');
              fullText = fullText.replace(/répondre/gi, '');
              fullText = fullText.replace(/reply/gi, '');
              fullText = fullText.replace(/like/gi, '');
              fullText = fullText.replace(/verified/gi, '');
              
              fullText = fullText.trim();
              
              if (fullText.length >= 2 && fullText.length <= 500) {
                commentText = fullText;
              }
            }

            if (!commentText || commentText.length < 1) return;

            // Extract timestamp
            const timeElement = li.querySelector('time[datetime]');
            const commentDate = timeElement ? timeElement.getAttribute('datetime') : '';

            // Build full profile URL
            const profileUrl = `https://www.instagram.com${profileLink.getAttribute('href')}`;

            result.comments.push({
              username: username,
              profile_url: profileUrl,
              comment_text: commentText.substring(0, 500),
              comment_date: commentDate,
              followers_estimate: ''
            });
            
            result.debug.validComments++;

          } catch (error) {
            // Skip malformed comments
          }
        });
      });

      return result;
    });

    console.log(`      → Found ${extraction.debug.allUls} UL elements total`);
    console.log(`      → Found ${extraction.debug.allLis} LI elements total`);
    console.log(`      → Found ${extraction.debug.profileLinksFound} profile links`);
    console.log(`      → Found ${extraction.debug.commentCandidates} comment candidates`);
    console.log(`      → Extracted ${extraction.debug.validComments} valid comments`);

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
      console.log(`      ⚠️  No comments extracted with V6`);
      console.log(`      💡 Debug info:`);
      console.log(`         - Total ULs: ${extraction.debug.allUls}`);
      console.log(`         - Total LIs: ${extraction.debug.allLis}`);
      console.log(`         - Profile links: ${extraction.debug.profileLinksFound}`);
      console.log(`      💡 Possible reasons:`);
      console.log(`         - No comments on this post`);
      console.log(`         - Comments in Shadow DOM (not accessible)`);
      console.log(`         - Need to inspect page structure manually`);
    }

    // Save context
    postContext.comments_count = comments.length.toString();
    await saveContextJSON(postUrl, postContext);

  } catch (error) {
    console.error(`   Error in V6 scraper: ${error.message}`);
  }

  return comments;
}

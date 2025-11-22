/**
 * Post Scraper Module V7 - Fixed structure: UL > DIV > LI
 * 
 * Instagram structure discovered:
 * <ul> → <div role="button"> → <li> → comment content
 * 
 * Previous versions failed because they looked for <ul> → <li> directly
 */

import { delay, detectChallenge, saveContextJSON } from './utils.js';
import { CONFIG } from './config.js';

/**
 * Scrape comments using correct UL > DIV > LI structure
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
    for (let i = 0; i < 12; i++) {
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
            if (count >= 10) break;
          } catch (e) {}
        }
      }
      return count;
    });
    
    console.log(`      → Clicked ${clicked} buttons`);
    if (clicked > 0) await delay(3000);

    // Extract comments using CORRECT structure: UL > DIV > LI
    const extraction = await page.evaluate(() => {
      const result = {
        comments: [],
        debug: {
          allUls: 0,
          divsInUls: 0,
          lisInDivs: 0,
          profileLinksFound: 0,
          textSpansFound: 0,
          validComments: 0
        }
      };

      // Find ALL <ul> elements
      const allUls = document.querySelectorAll('ul');
      result.debug.allUls = allUls.length;

      allUls.forEach(ul => {
        // Look for DIVs inside UL (Instagram wraps LI in DIV)
        const divsInUl = ul.querySelectorAll(':scope > div');
        result.debug.divsInUls += divsInUl.length;

        divsInUl.forEach(div => {
          // Look for LI inside DIV
          const lisInDiv = div.querySelectorAll('li');
          result.debug.lisInDivs += lisInDiv.length;

          lisInDiv.forEach(li => {
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

              // Find comment text in SPAN tags
              const spans = li.querySelectorAll('span[dir="auto"], span');
              let commentText = null;

              for (const span of spans) {
                result.debug.textSpansFound++;
                const text = span.textContent.trim();
                
                // Skip if it's just the username
                if (text === username) continue;
                
                // Skip UI text
                const uiWords = ['verified', 'j\'aime', 'répondre', 'reply', 'like', 
                                'more options', 'options', 'suivre', 'follow', 'abonné',
                                'see translation', 'voir la traduction'];
                if (uiWords.some(word => text.toLowerCase() === word)) continue;
                
                // Skip time patterns (19 h, 2 d, etc.)
                if (/^\d+\s*(h|d|w|m|s|min|hour|day|week|month|année|j|sem)$/i.test(text)) continue;
                
                // Skip numbers only
                if (/^\d+$/.test(text)) continue;
                
                // Skip "X J'aime" / "X likes" pattern
                if (/^\d+\s*(j'aime|like|réponse|reply|vu|view)/i.test(text)) continue;
                
                // Skip code/JSON
                if (text.includes('{') || text.includes('require') || text.includes('__d(')) continue;
                
                // If text is substantial
                if (text.length >= 1 && text.length <= 500) {
                  // Remove username if it appears at the start
                  let cleanText = text;
                  if (cleanText.startsWith(username)) {
                    cleanText = cleanText.substring(username.length).trim();
                  }
                  
                  if (cleanText.length >= 1) {
                    commentText = cleanText;
                    break; // Found it!
                  }
                }
              }

              // Fallback: extract text from entire LI if no span found
              if (!commentText) {
                let fullText = li.textContent.trim();
                
                // Remove username
                fullText = fullText.replace(username, '');
                
                // Remove common UI patterns
                fullText = fullText.replace(/\d+\s*h/g, '');
                fullText = fullText.replace(/\d+\s*j'aime/gi, '');
                fullText = fullText.replace(/\d+\s*like/gi, '');
                fullText = fullText.replace(/répondre/gi, '');
                fullText = fullText.replace(/reply/gi, '');
                fullText = fullText.replace(/verified/gi, '');
                fullText = fullText.replace(/more options/gi, '');
                
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
      });

      return result;
    });

    console.log(`      → Found ${extraction.debug.allUls} UL elements`);
    console.log(`      → Found ${extraction.debug.divsInUls} DIVs in ULs`);
    console.log(`      → Found ${extraction.debug.lisInDivs} LIs in DIVs`);
    console.log(`      → Found ${extraction.debug.profileLinksFound} profile links`);
    console.log(`      → Found ${extraction.debug.textSpansFound} text spans`);
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
      console.log(`      ⚠️  No comments extracted with V7`);
      console.log(`      💡 Debug info:`);
      console.log(`         - ULs: ${extraction.debug.allUls}`);
      console.log(`         - DIVs in ULs: ${extraction.debug.divsInUls}`);
      console.log(`         - LIs in DIVs: ${extraction.debug.lisInDivs}`);
      console.log(`         - Profile links: ${extraction.debug.profileLinksFound}`);
      console.log(`         - Text spans: ${extraction.debug.textSpansFound}`);
      console.log(`      💡 Next step: manually inspect page structure`);
    }

    // Save context
    postContext.comments_count = comments.length.toString();
    await saveContextJSON(postUrl, postContext);

  } catch (error) {
    console.error(`   Error in V7 scraper: ${error.message}`);
  }

  return comments;
}

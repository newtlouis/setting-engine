/**
 * Post Scraper Module V8 - DIV-ONLY Structure (Nov 2025)
 * 
 * Instagram NO LONGER uses UL/LI for comments!
 * New structure: nested DIVs with:
 * - <a href="/username"> for profile
 * - <span dir="auto"> for comment text
 * - <time datetime="..."> for timestamp
 */

import { delay, detectChallenge, saveContextJSON } from './utils.js';
import { CONFIG } from './config.js';

/**
 * Sort comments by "Most Recent" / "Les plus récents"
 * This ensures we get the freshest leads first
 * 
 * @param {Page} page - Playwright page object
 * @returns {Promise<boolean>} True if sort was changed successfully
 */
async function sortCommentsByRecent(page) {
  try {
    console.log(`      → Looking for sort dropdown...`);
    
    // Try using Playwright's locator API for more reliable clicking
    // Look for the dropdown trigger containing sort text
    
    // Method 1: Try clicking on text "Les plus récents" or "Pour vous" (the current sort selection)
    const sortTexts = ['Les plus récents', 'Pour vous', 'Most recent', 'For you'];
    let dropdownOpened = false;
    
    for (const sortText of sortTexts) {
      try {
        // Find a clickable element containing this text
        const locator = page.locator(`[role="button"]:has-text("${sortText}")`).first();
        const isVisible = await locator.isVisible({ timeout: 2000 }).catch(() => false);
        
        if (isVisible) {
          console.log(`      → Found sort button with text: "${sortText}"`);
          await locator.click({ timeout: 3000 });
          dropdownOpened = true;
          await delay(1500);
          break;
        }
      } catch (e) {
        // Try next text
        continue;
      }
    }
    
    // Method 2: If no text found, try finding by chevron icon
    if (!dropdownOpened) {
      try {
        const chevronButton = page.locator('[aria-haspopup="menu"]:has(svg)').first();
        const isVisible = await chevronButton.isVisible({ timeout: 2000 }).catch(() => false);
        
        if (isVisible) {
          const buttonText = await chevronButton.textContent();
          if (buttonText && (buttonText.includes('récent') || buttonText.includes('vous') || 
                            buttonText.includes('recent') || buttonText.includes('you'))) {
            console.log(`      → Found sort button via aria-haspopup`);
            await chevronButton.click({ timeout: 3000 });
            dropdownOpened = true;
            await delay(1500);
          }
        }
      } catch (e) {
        // Continue
      }
    }
    
    if (!dropdownOpened) {
      console.log(`      → Sort dropdown not found on this post`);
      return false;
    }
    
    // Now click on "Les plus récents" in the dropdown menu
    console.log(`      → Dropdown opened, looking for "Most recent" option...`);
    
    // Wait a bit more for menu to fully render
    await delay(1000);
    
    // Try to click "Les plus récents" / "Most recent" option
    const recentTexts = ['Les plus récents', 'Most recent'];
    let optionClicked = false;
    
    for (const recentText of recentTexts) {
      try {
        // Look for the menu item - it should be a role="button" that appeared after clicking
        const menuItem = page.locator(`[role="button"]:has-text("${recentText}")`);
        const count = await menuItem.count();
        
        // There might be multiple matches - the dropdown trigger and the menu option
        // Click the second one (index 1) if it exists, otherwise the first
        if (count > 1) {
          await menuItem.nth(1).click({ timeout: 3000 });
          optionClicked = true;
          console.log(`      ✅ Clicked "${recentText}" (menu option)`);
          break;
        } else if (count === 1) {
          // Check if this is already showing as selected (might not need to click)
          const element = menuItem.first();
          const hasCheckmark = await element.locator('svg polyline, svg path').count() > 0;
          if (!hasCheckmark) {
            await element.click({ timeout: 3000 });
            optionClicked = true;
            console.log(`      ✅ Clicked "${recentText}"`);
            break;
          } else {
            console.log(`      → "${recentText}" already selected`);
            optionClicked = true;
            break;
          }
        }
      } catch (e) {
        continue;
      }
    }
    
    if (!optionClicked) {
      // Try clicking by evaluating in page context as fallback
      const clicked = await page.evaluate(() => {
        const allButtons = document.querySelectorAll('[role="button"]');
        for (const btn of allButtons) {
          const text = btn.textContent.trim();
          if (text === 'Les plus récents' || text === 'Most recent') {
            btn.click();
            return true;
          }
        }
        return false;
      });
      
      if (clicked) {
        console.log(`      ✅ Clicked "Most recent" via evaluate`);
        optionClicked = true;
      }
    }
    
    if (optionClicked) {
      await delay(2000); // Wait for comments to reload
      return true;
    }
    
    // Close dropdown by pressing Escape or clicking elsewhere
    await page.keyboard.press('Escape').catch(() => {});
    console.log(`      → Could not select "Most recent" option`);
    return false;

  } catch (error) {
    console.log(`      ⚠️  Error sorting comments: ${error.message}`);
    return false;
  }
}

/**
 * Scrape comments using DIV-only structure (no UL/LI)
 * 
 * @param {Page} page - Playwright page object
 * @param {string} postUrl - URL of the post
 * @param {number} maxComments - Maximum comments to extract
 * @param {string[]} excludeUsernames - Additional usernames to exclude (optional)
 */
export async function scrapePostComments(page, postUrl, maxComments, excludeUsernames = []) {
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
    
    // STEP 1: Sort comments by "Most Recent" / "Les plus récents"
    console.log(`      → Sorting comments by most recent...`);
    const sortChanged = await sortCommentsByRecent(page);
    if (sortChanged) {
      console.log(`      ✅ Comments sorted by most recent`);
      await delay(2000); // Wait for comments to reload
    } else {
      console.log(`      ⚠️  Could not change sort order (may already be sorted or not available)`);
    }
    
    // Aggressive, targeted scrolling to load comments
    // User Update: Don't scroll window (triggers suggested posts), scroll the comment sidebar/container
    console.log(`      → Scrolling comment list...`);
    for (let i = 0; i < 15; i++) {
        const scrolled = await page.evaluate(() => {
            // Find the most likely comment container
            // It should be a scrollable DIV or UL, not body/html
            // On desktop post view, it's usually the right-hand column inside the modal/page
            const candidates = Array.from(document.querySelectorAll('div, ul'));
            let bestScroller = null;
            let maxScrollHeight = 0;

            for (const el of candidates) {
                // Must be vertical scrollable
                if (el.scrollHeight > el.clientHeight) {
                    const style = window.getComputedStyle(el);
                    if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                        // Heuristic: The comment container usually has many children
                        // and appears in the DOM structure (not a tiny dropdown)
                        if (el.scrollHeight > maxScrollHeight) {
                            maxScrollHeight = el.scrollHeight;
                            bestScroller = el;
                        }
                    }
                }
            }

            if (bestScroller) {
                bestScroller.scrollBy({ top: 500, behavior: 'smooth' });
                return true;
            }
            return false;
        });

        if (!scrolled) {
            // Fallback for mobile view or weird layouts where window IS the scroller
            await page.evaluate(() => window.scrollBy({ top: 500, behavior: 'smooth' }));
        }
        
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
            if (count >= 12) break;
          } catch (e) {}
        }
      }
      return count;
    });
    
    console.log(`      → Clicked ${clicked} buttons`);
    if (clicked > 0) await delay(3000);

    // STEP 0: Detect post author from page BEFORE extracting comments
    const postAuthor = await page.evaluate(() => {
      // Strategy: The author is the username that appears MOST FREQUENTLY
      // in the first 10 profile links (excluding @mentions in caption)
      
      const allLinks = document.querySelectorAll('a[href^="/"]');
      const usernameCount = {};
      let linksChecked = 0;
      
      // Count frequency of each username in first 15 links
      for (const link of allLinks) {
        if (linksChecked >= 15) break;
        
        const href = link.getAttribute('href') || '';
        
        // Skip location links
        if (href.includes('/explore/locations/')) {
          continue;
        }
        
        const match = href.match(/^\/([a-zA-Z0-9._]+)\/?$/);
        
        if (match && match[1] !== 'p' && match[1] !== 'reel' && match[1] !== 'explore') {
          const username = match[1];
          usernameCount[username] = (usernameCount[username] || 0) + 1;
          linksChecked++;
        }
      }
      
      // Find the username with highest frequency
      let maxCount = 0;
      let authorUsername = null;
      
      for (const [username, count] of Object.entries(usernameCount)) {
        if (count > maxCount) {
          maxCount = count;
          authorUsername = username;
        }
      }
      
      // Debug: show frequency
      console.log('Username frequency in first 15 links:', usernameCount);
      console.log('Detected author:', authorUsername, 'with', maxCount, 'occurrences');
      
      return authorUsername;
    });
    
    console.log(`      → Pre-detected post author: @${postAuthor || 'unknown'}`);

    // Extract comments using DIV-based structure analysis
    const extraction = await page.evaluate(({ currentPostUrl, additionalExclusions, detectedAuthor }) => {
      const result = {
        comments: [],
        debug: {
          totalDivs: 0,
          profileLinksFound: 0,
          commentCandidatesFound: 0,
          validComments: 0,
          skippedAsAuthorOrUI: 0,
          skippedAsPostAuthor: 0,
          postAuthor: detectedAuthor
        }
      };

      // Use the pre-detected author
      const postAuthor = detectedAuthor;
      let authorDetected = !!postAuthor;

      // Strategy: Find all DIVs that contain:
      // 1. A profile link <a href="/username">
      // 2. A text span (comment)
      // 3. Optionally a timestamp <time>
      
      const allDivs = document.querySelectorAll('div');
      result.debug.totalDivs = allDivs.length;
      
      // Track first 2 comments to skip them (author + "For You" UI)
      let commentCount = 0;

      allDivs.forEach(div => {
        try {
          // Look for profile link in this div
          const profileLinks = div.querySelectorAll('a[href^="/"]');
          let username = null;
          let profileHref = null;

          for (const link of profileLinks) {
            const href = link.getAttribute('href') || '';
            
            // Skip location links
            if (href.includes('/explore/locations/')) {
              continue;
            }
            
            // Profile pattern: /username (not /p/, /reel/, /c/, etc.)
            if (href.match(/^\/[a-zA-Z0-9._]+\/?$/) && !href.includes('/p/') && !href.includes('/reel/')) {
              
              // STRATEGY 1: Look for username in SIBLING spans (after the link)
              // This catches cases where @tagged is in the link, but author is in span
              const parentDiv = link.parentElement;
              if (parentDiv) {
                const siblingSpans = parentDiv.querySelectorAll('span._ap3a, span[dir="auto"]');
                for (const span of siblingSpans) {
                  const spanText = span.textContent.trim();
                  const cleanText = spanText.replace(/^@+/, '');
                  
                  // If this looks like a username (not the link text)
                  if (cleanText.length >= 2 && 
                      cleanText.length <= 30 && 
                      !cleanText.includes(' ') &&
                      !cleanText.match(/^\d+$/) &&
                      cleanText !== link.textContent.trim()) {
                    
                    username = cleanText;
                    // Use this username's profile URL (construct it)
                    profileHref = `/${cleanText}`;
                    result.debug.profileLinksFound++;
                    result.debug.usernameFromSpan = true;
                    break;
                  }
                }
              }
              
              // STRATEGY 2: If no sibling span, use the link itself
              if (!username) {
                const linkText = link.textContent.trim();
                const span = link.querySelector('span._ap3a, span[dir="auto"]');
                const spanText = span ? span.textContent.trim() : '';
                
                const candidateUsername = spanText || linkText;
                const cleanUsername = candidateUsername.replace(/^@+/, '');
                
                if (cleanUsername.length >= 2 && 
                    cleanUsername.length <= 30 && 
                    !cleanUsername.includes(' ') &&
                    !cleanUsername.match(/^\d+$/)) {
                  
                  username = cleanUsername;
                  profileHref = href;
                  result.debug.profileLinksFound++;
                }
              }
              
              if (username) break;
            }
          }

          if (!username) return;

          // Now look for comment text in SIBLING or CHILD spans
          // The comment text is usually in a span[dir="auto"] AFTER the username
          const spans = div.querySelectorAll('span[dir="auto"]');
          let commentText = null;

          for (const span of spans) {
            let text = span.textContent.trim();
            
            // Skip if it's the username itself
            if (text === username) continue;
            
            // Skip UI text (expanded list)
            const uiWords = ['verified', 'vérifié', 'j\'aime', 'répondre', 'reply', 'like', 
                            'more options', 'options', 'suivre', 'follow', 'abonné',
                            'see translation', 'voir la traduction', 'masquer', 'hide',
                            'afficher', 'show', 'view replies', 'voir les réponses',
                            'masquer toutes les réponses', 'hide all replies',
                            'modifié', 'modified', 'edited', 'for you', 'pour vous',
                            'following', 'abonnements'];
            if (uiWords.some(word => text.toLowerCase().includes(word))) continue;
            
            // Skip "X J'aime" / "X likes" / "X sem" / "X h" patterns
            if (/^\d+\s*(j'aime|like|réponse|reply|h|d|w|m|s|min|sem|hour|day|week)$/i.test(text)) continue;
            
            // Skip pure numbers
            if (/^\d+$/.test(text)) continue;
            
            // Skip code/JSON
            if (text.includes('{') || text.includes('require') || text.includes('__d(')) continue;
            
            // Skip if text looks like a caption (contains hashtags and is very long)
            if (text.includes('#') && text.length > 100) continue;
            
            // Remove @mentions from the beginning of the text
            text = text.replace(/^@[a-zA-Z0-9._]+\s*/, '').trim();
            
            // Skip if the text is JUST a username (tagging someone)
            if (text.match(/^[a-zA-Z0-9._]+$/)) {
              continue; // It's just a tag, not a real comment
            }
            
            // Skip if it looks like a location/place name (usually 2-3 capitalized words)
            // Examples: "MACFit Buyaka", "Gold's Gym", "Fitness First"
            if (text.match(/^[A-Z][a-zA-Z]+(\s+[A-Z][a-zA-Z]+){1,2}$/) && text.length < 30) {
              continue; // Likely a location tag
            }
            
            // If still has content after cleanup
            if (text.length >= 1 && text.length <= 200) {
              commentText = text;
              result.debug.commentCandidatesFound++;
              break;
            }
          }

          if (!commentText) return;

          // SKIP ALL COMMENTS from post author OR excluded users
          // We don't want any content from these users in our leads
          const shouldExclude = (postAuthor && username === postAuthor) || 
                                (additionalExclusions && additionalExclusions.includes(username));
          
          if (shouldExclude) {
            result.debug.skippedAsPostAuthor++;
            return;
          }

          // SKIP FIRST 5 COMMENTS (caption, UI elements, tags, etc.)
          // Instagram can have multiple UI elements and tags before real comments
          commentCount++;
          if (commentCount <= 5) {
            result.debug.skippedAsAuthorOrUI++;
            return;
          }

          // Extract timestamp (might be in same div or parent)
          const timeElement = div.querySelector('time[datetime]');
          const commentDate = timeElement ? timeElement.getAttribute('datetime') : '';

          // SKIP comments without timestamp (usually replies/responses from post author)
          // Real user comments ALWAYS have a timestamp
          if (!commentDate || commentDate === '') {
            result.debug.skippedNoTimestamp = (result.debug.skippedNoTimestamp || 0) + 1;
            return;
          }

          // Build full profile URL
          const profileUrl = `https://www.instagram.com${profileHref}`;

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

      return result;
    }, { currentPostUrl: postUrl, additionalExclusions: excludeUsernames, detectedAuthor: postAuthor });

    console.log(`      → Scanned ${extraction.debug.totalDivs} DIV elements`);
    console.log(`      → Using post author: @${extraction.debug.postAuthor || 'unknown'} (from header)`);
    if (excludeUsernames.length > 0) {
      console.log(`      → Additional exclusions: ${excludeUsernames.map(u => '@' + u).join(', ')}`);
    }
    console.log(`      → Found ${extraction.debug.profileLinksFound} profile links`);
    console.log(`      → Skipped ${extraction.debug.skippedAsPostAuthor} excluded user comments`);
    console.log(`      → Skipped ${extraction.debug.skippedAsAuthorOrUI} (first 5: UI elements)`);
    console.log(`      → Skipped ${extraction.debug.skippedNoTimestamp || 0} without timestamp (replies)`);
    console.log(`      → Found ${extraction.debug.commentCandidatesFound} comment candidates`);
    console.log(`      → Extracted ${extraction.debug.validComments} raw comments`);

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
      console.log(`      ✅ SUCCESS! Extracted ${comments.length} unique comments`);
      console.log(`      → Sample: "@${comments[0].username}: ${comments[0].comment_text.substring(0, 60)}..."`);
    } else {
      console.log(`      ⚠️  No comments extracted with V8`);
      console.log(`      💡 Debug info:`);
      console.log(`         - Post author: @${extraction.debug.postAuthor || 'unknown'}`);
      console.log(`         - DIVs scanned: ${extraction.debug.totalDivs}`);
      console.log(`         - Profile links: ${extraction.debug.profileLinksFound}`);
      console.log(`         - Skipped (author): ${extraction.debug.skippedAsPostAuthor}`);
      console.log(`         - Candidates: ${extraction.debug.commentCandidatesFound}`);
      console.log(`      💡 Possible reasons:`);
      console.log(`         - No comments on this post`);
      console.log(`         - Bot detection blocking content`);
      console.log(`         - Need manual verification`);
    }

    // Save context
    postContext.comments_count = comments.length.toString();
    await saveContextJSON(postUrl, postContext);

  } catch (error) {
    console.error(`   Error in V8 scraper: ${error.message}`);
  }

  return comments;
}

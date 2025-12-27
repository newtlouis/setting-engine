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
    
    // STRATEGY: Find the sort button using the robust `aria-haspopup="menu"` attribute
    // User provided HTML confirms: <div aria-expanded="false" aria-haspopup="menu" role="button" ...>
    // This is much safer than generic text matching which might hit "Suggested for you" headers.

    let dropdownTrigger = null;
    
    // 1. Selector based on aria-haspopup (Standard Instagram Sort Button)
    // We look for this specific role AND containing one of our keywords or the chevron
    const triggerTexts = ['Pour vous', 'For you', 'Most relevant', 'Pertinence', 'Plus récents', 'Most recent'];
    
    // Try to find the button specifically
    const candidateButtons = page.locator('div[aria-haspopup="menu"][role="button"], button[aria-haspopup="menu"]');
    const count = await candidateButtons.count();
    
    console.log(`      → Found ${count} buttons with popup menu`);

    for (let i = 0; i < count; i++) {
        const btn = candidateButtons.nth(i);
        const text = await btn.textContent();
        // Check if it contains relevant text OR has the chevron icon
        const hasChevron = await btn.locator('svg[aria-label*="chevron"], svg[aria-label*="Chevron"]').count() > 0;
        
        // Check for text match
        const matchesText = triggerTexts.some(t => text.includes(t));
        
        if (matchesText || hasChevron) {
            dropdownTrigger = btn;
            console.log(`      → Identified sort trigger (Has text: ${matchesText}, Has chevron: ${hasChevron})`);
            break;
        }
    }

    // 2. Fallback: If no aria-haspopup found (structure change?), strictly look for text in a button
    if (!dropdownTrigger) {
         console.log(`      → aria-haspopup strategy failed, trying strict text match...`);
         for (const text of triggerTexts) {
            const el = page.locator(`:is(button, div[role="button"]):has-text("${text}")`).first();
            if (await el.count() > 0) {
                dropdownTrigger = el;
                break;
            }
         }
    }

    if (!dropdownTrigger) {
        console.log(`      ⚠️  Sort trigger not found.`);
    } else {
        // Ensure it's in view - User suspected scrolling issue
        try {
            await dropdownTrigger.scrollIntoViewIfNeeded();
        } catch (e) {
            // If scrollIntoViewIfNeeded not supported or fails, try generic evaluate
            await dropdownTrigger.evaluate(el => el.scrollIntoView({ block: 'center' }));
        }
        
        await delay(500);
        
        // Check visibility handling
        if (await dropdownTrigger.isVisible()) {
             await dropdownTrigger.click();
             await delay(1500); // Wait for menu to appear
        } else {
             console.log(`      ⚠️  Trigger found but not visible even after scroll.`);
             // Force click via evaluate as last resort
             await dropdownTrigger.evaluate(el => el.click());
             await delay(1500);
        }
    }

    // NOW FIND "Most recent" / "Les plus récents" in the menu
    // The menu is usually a separate layer at the end of DOM
    const recentOptions = ['Les plus récents', 'Most recent', 'Newest'];
    let optionClicked = false;

    for (const opt of recentOptions) {
        // Look for the specific menu item
        const menuOption = page.locator(`div[role="button"], div[role="menuitem"], span`).filter({ hasText: opt }).last();
        
        if (await menuOption.isVisible().catch(() => false)) {
            console.log(`      → Found option "${opt}", clicking...`);
            await menuOption.click();
            optionClicked = true;
            break;
        }
    }

    if (!optionClicked) {
        console.log(`      → "Most recent" option not visible, trying fallback (evaluate click)...`);
        optionClicked = await page.evaluate(() => {
            const all = document.querySelectorAll('span, div');
            for (const el of all) {
                if (el.textContent === 'Les plus récents' || el.textContent === 'Most recent') {
                    el.click();
                    return true;
                }
            }
            return false;
        });
    }

    if (optionClicked) {
        console.log(`      ✅ Clicked "Most recent"`);
        await delay(2000); // Verify reload
        return true;
    }

    console.log(`      ⚠️  Could not select "Most recent" (maybe already active?)`);
    // Close menu if open by clicking body
    await page.mouse.click(10, 10).catch(() => {});
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
      // Select buttons that might be "Load more"
      // Exclude buttons near the top (header) to avoid options menu
      const buttons = Array.from(document.querySelectorAll('div[role="button"], button'));
      let count = 0;
      
      for (const btn of buttons) {
        const text = btn.textContent.toLowerCase().trim();
        const label = btn.getAttribute('aria-label') || '';
        
        // SKIP: Options menu, Share, Save, etc.
        if (text === '' && !label) continue; // Skip empty buttons (likely icons without label)
        if (label.includes('option') || label.includes('more') || label.includes('plus')) {
            // "More options" usually has this label. 
            // BUT "View more comments" might also have "more".
            // We need to distinguish.
            
            // The options menu usually has an SVG child
            if (btn.querySelector('svg')) {
                // Determine if it's the 3-dots menu
                // usually distinct from text-based "View more comments"
                const svgTitle = btn.querySelector('title')?.textContent || '';
                if (svgTitle.includes('option') || svgTitle.includes('more')) continue;
                
                // If it's just an icon button with "More options" label, skip
                if (label.toLowerCase().includes('option')) continue;
            }
        }

        // TEXT MATCHING: Be more specific
        // Must contain "view" or "voir" or "afficher" AND "comment" or "repl" or "répon"
        // OR be exactly "View more" / "Voir plus" in the context of comments
        const isLoadMore = (
            (text.includes('view') || text.includes('voir') || text.includes('afficher')) &&
            (text.includes('comment') || text.includes('repl') || text.includes('répon'))
        ) || (
            // Sometimes just "View more" (replies)
           (text === 'view more' || text === 'voir plus') 
        ) || (
            // Plus symbol often used for replies
            text.includes('+') && (text.includes('repl') || text.includes('répon'))
        );

        // EXTRA SAFEGUARDS
        if (text.includes('option')) continue;
        if (text.includes('share')) continue;
        if (text.includes('save')) continue;
        if (text.includes('report')) continue;
        if (text.includes('signaler')) continue;
        if (text.includes('partager')) continue;

        if (isLoadMore) {
          try {
            // Scroll into view to avoid clicks being intercepted
            btn.scrollIntoView({ block: 'center', inline: 'center' });
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

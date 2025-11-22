/**
 * Post Scraper Module V3 - Ultra Generic Approach
 * 
 * Last resort: extract all text and links, then use heuristics
 */

import { delay, detectChallenge, saveContextJSON } from './utils.js';
import { CONFIG } from './config.js';

/**
 * Scrape comments using ultra-generic brute force approach
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
    // Wait and scroll multiple times to load all comments
    await page.waitForSelector('article', { timeout: 10000 }).catch(() => null);
    
    console.log(`      → Scrolling to load comments...`);
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        window.scrollBy({ top: 400, behavior: 'smooth' });
      });
      await delay(1500);
    }

    // Click "View more comments" buttons if they exist
    console.log(`      → Looking for 'Load more' buttons...`);
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
      let clickCount = 0;
      
      for (const btn of buttons) {
        const text = btn.textContent.toLowerCase();
        if (text.includes('view') || text.includes('more') || text.includes('comment')) {
          try {
            btn.click();
            clickCount++;
            if (clickCount >= 3) break; // Limit clicks
          } catch (e) {}
        }
      }
      
      return clickCount;
    });
    
    if (clicked > 0) {
      console.log(`      → Clicked ${clicked} buttons, waiting for load...`);
      await delay(2000);
    }

    // Brute force extraction: get ALL text and ALL links
    const rawData = await page.evaluate(() => {
      const data = {
        allLinks: [],
        allTextBlocks: []
      };

      // Get ALL links
      document.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href') || '';
        const text = a.textContent.trim();
        
        if (href && text) {
          data.allLinks.push({
            href: href,
            text: text,
            isProfile: href.startsWith('/') && 
                      !href.includes('/p/') && 
                      !href.includes('/reel/') &&
                      !href.includes('/explore/') &&
                      !href.includes('/tags/') &&
                      href.length < 50
          });
        }
      });

      // Get ALL text blocks from entire page
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null
      );

      let node;
      while (node = walker.nextNode()) {
        const text = node.textContent.trim();
        if (text.length > 5 && text.length < 500) {
          // Get parent info
          let parent = node.parentElement;
          let depth = 0;
          const parents = [];
          
          while (parent && depth < 5) {
            parents.push(parent.tagName.toLowerCase());
            parent = parent.parentElement;
            depth++;
          }
          
          data.allTextBlocks.push({
            text: text,
            parents: parents,
            hasArticleParent: parents.includes('article')
          });
        }
      }

      return data;
    });

    console.log(`      → Found ${rawData.allLinks.length} total links (${rawData.allLinks.filter(l => l.isProfile).length} profiles)`);
    console.log(`      → Found ${rawData.allTextBlocks.length} text blocks (${rawData.allTextBlocks.filter(t => t.hasArticleParent).length} in article)`);

    // Filter for profile links
    const profileLinks = rawData.allLinks.filter(l => l.isProfile);

    // Filter text blocks likely to be comments (in article, substantial, not UI text)
    const uiKeywords = ['like', 'reply', 'view', 'load', 'more', 'ago', 'follow', 'share', 'save', 'hour', 'day', 'week', 'month'];
    const commentTexts = rawData.allTextBlocks.filter(t => {
      if (!t.hasArticleParent) return false;
      if (t.text.length < 10) return false;
      
      const lower = t.text.toLowerCase();
      // Not just a UI keyword
      if (uiKeywords.some(kw => lower === kw)) return false;
      // Not just numbers/times
      if (/^\d+[smhd]$/.test(lower)) return false;
      
      return true;
    });

    console.log(`      → Filtered to ${commentTexts.length} potential comment texts`);

    // Try to pair usernames with comment texts
    // Strategy: look for username followed by text in the commentTexts
    const seen = new Set();
    
    for (const link of profileLinks) {
      const username = link.text;
      if (!username || username.length < 2) continue;

      // Find text blocks that might be associated with this username
      for (const textBlock of commentTexts) {
        const text = textBlock.text;
        
        // Skip if this text mentions the username (might be the username itself)
        if (text === username) continue;
        
        // Skip if we've seen similar text
        const textKey = text.substring(0, 50);
        if (seen.has(textKey)) continue;
        
        // This is a potential comment
        const commentText = text;
        
        // Verify it's not just the caption or other metadata
        if (commentText.length > 10 && 
            !commentText.toLowerCase().includes('sponsored') &&
            !commentText.toLowerCase().includes('ad')) {
          
          comments.push({
            post_url: postUrl,
            username: username,
            profile_url: link.href.startsWith('http') ? link.href : `https://www.instagram.com${link.href}`,
            comment_text: commentText.substring(0, 500),
            comment_date: '',
            followers_estimate: ''
          });
          
          seen.add(textKey);
          
          if (comments.length >= maxComments) break;
        }
      }
      
      if (comments.length >= maxComments) break;
    }

    // Deduplicate by username + first 30 chars
    const unique = [];
    const keys = new Set();
    
    for (const comment of comments) {
      const key = `${comment.username}:${comment.comment_text.substring(0, 30)}`;
      if (!keys.has(key)) {
        unique.push(comment);
        keys.add(key);
      }
    }

    console.log(`      → Extracted ${unique.length} unique comments after dedup`);

    // Debug output
    if (unique.length > 0) {
      console.log(`      → Sample: "${unique[0].comment_text.substring(0, 60)}..." by @${unique[0].username}`);
    } else {
      console.log(`      ⚠️  No comments could be extracted with V3 brute force`);
      console.log(`      💡 Try manually inspecting the page in DevTools`);
    }

    comments.length = 0;
    comments.push(...unique);

    // Save context
    postContext.comments_count = comments.length.toString();
    await saveContextJSON(postUrl, postContext);

  } catch (error) {
    console.error(`   Error in V3 scraper: ${error.message}`);
  }

  return comments;
}

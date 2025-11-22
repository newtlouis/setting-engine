/**
 * Post Scraper Module V4 - No Article Dependency
 * 
 * Completely ignore article tag, work with entire page
 */

import { delay, detectChallenge, saveContextJSON } from './utils.js';
import { CONFIG } from './config.js';

/**
 * Scrape comments without depending on article tag
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
    console.log(`      → Waiting for page to fully load...`);
    await delay(3000);
    
    // Scroll aggressively to trigger lazy loading
    console.log(`      → Scrolling down to load all content...`);
    for (let i = 0; i < 5; i++) {
      await page.evaluate((scrollNum) => {
        window.scrollBy({ top: 500, behavior: 'smooth' });
        console.log(`Scroll ${scrollNum}: scrollY = ${window.scrollY}`);
      }, i + 1);
      await delay(1500);
    }

    // Click any button that might load more comments
    const clickedButtons = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, div[role="button"], span[role="button"]'));
      let clicked = 0;
      
      for (const btn of buttons) {
        const text = btn.textContent.toLowerCase();
        // Look for various "load more" patterns
        if (text.includes('view') || 
            text.includes('more') || 
            text.includes('comment') ||
            text.includes('voir') ||
            text.includes('afficher')) {
          try {
            console.log('Clicking button:', text.substring(0, 50));
            btn.click();
            clicked++;
            if (clicked >= 5) break;
          } catch (e) {
            console.log('Failed to click:', e.message);
          }
        }
      }
      
      return clicked;
    });
    
    console.log(`      → Clicked ${clickedButtons} potential load-more buttons`);
    
    if (clickedButtons > 0) {
      await delay(3000);
    }

    // Extract everything - NO article dependency
    const extraction = await page.evaluate(() => {
      const result = {
        profiles: [],
        texts: [],
        structure: {}
      };

      // Find ALL profile links anywhere on page
      const allLinks = document.querySelectorAll('a[href]');
      allLinks.forEach(a => {
        const href = a.getAttribute('href') || '';
        const text = a.textContent.trim();
        
        // Profile link pattern: starts with /, username-like, not special paths
        if (href.startsWith('/') && 
            !href.includes('/p/') && 
            !href.includes('/reel/') &&
            !href.includes('/explore/') &&
            !href.includes('/tags/') &&
            !href.includes('/direct/') &&
            !href.includes('/accounts/') &&
            href.length > 2 && 
            href.length < 50 &&
            text.length > 0 &&
            text.length < 30) {
          
          result.profiles.push({
            username: text,
            href: href,
            fullUrl: href.startsWith('http') ? href : `https://www.instagram.com${href}`
          });
        }
      });

      // Get ALL meaningful text from the page using TreeWalker
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: function(node) {
            const text = node.textContent.trim();
            // Only text nodes with substantial content
            if (text.length < 8 || text.length > 1000) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      let textNode;
      while (textNode = walker.nextNode()) {
        const text = textNode.textContent.trim();
        const parent = textNode.parentElement;
        
        if (parent) {
          // Get some context about where this text is
          const parentTag = parent.tagName.toLowerCase();
          const hasLinkSibling = !!parent.querySelector('a');
          const grandparent = parent.parentElement?.tagName.toLowerCase();
          
          result.texts.push({
            text: text,
            parentTag: parentTag,
            grandparent: grandparent,
            hasLinkSibling: hasLinkSibling
          });
        }
      }

      // Find main content area (usually the largest div container)
      const mainDivs = Array.from(document.querySelectorAll('div')).filter(div => {
        return div.offsetHeight > 500 && div.offsetWidth > 300;
      });
      
      result.structure.mainContainers = mainDivs.length;
      result.structure.totalDivs = document.querySelectorAll('div').length;
      result.structure.hasArticle = !!document.querySelector('article');

      return result;
    });

    console.log(`      → Found ${extraction.profiles.length} profile links`);
    console.log(`      → Found ${extraction.texts.length} text nodes`);
    console.log(`      → Structure: ${extraction.structure.totalDivs} divs, ${extraction.structure.mainContainers} main containers, article=${extraction.structure.hasArticle}`);

    // Show sample profiles
    if (extraction.profiles.length > 0) {
      console.log(`      → Sample profiles: ${extraction.profiles.slice(0, 3).map(p => '@' + p.username).join(', ')}`);
    }

    // Filter texts that look like comments
    const uiKeywords = [
      'like', 'likes', 'reply', 'replies', 'view', 'load', 'more', 'ago', 
      'follow', 'following', 'share', 'save', 'saved', 'hour', 'hours',
      'day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years',
      'sponsored', 'ad', 'promote', 'shop', 'buy', 'learn more'
    ];

    const potentialComments = extraction.texts.filter(t => {
      const lower = t.text.toLowerCase();
      
      // Must be substantial
      if (t.text.length < 10) return false;
      
      // Not just a UI keyword
      if (uiKeywords.includes(lower)) return false;
      
      // Not just a time (1h, 2d, etc)
      if (/^\d+\s*[smhdjyw]$/.test(lower)) return false;
      
      // Not just numbers
      if (/^\d+$/.test(t.text)) return false;
      
      // Prefer text that has link siblings (username nearby)
      return true;
    });

    console.log(`      → Filtered to ${potentialComments.length} potential comments`);

    // Show some samples
    if (potentialComments.length > 0) {
      console.log(`      → Sample texts:`);
      potentialComments.slice(0, 3).forEach((t, i) => {
        console.log(`         ${i + 1}. "${t.text.substring(0, 60)}..."`);
      });
    }

    // Create username -> comment mapping
    // Strategy: for each unique username, pair with nearby unique text
    const usedTexts = new Set();
    const uniqueUsernames = [...new Set(extraction.profiles.map(p => p.username))];
    
    console.log(`      → Pairing ${uniqueUsernames.length} unique usernames with comments...`);

    for (let i = 0; i < Math.min(uniqueUsernames.length, potentialComments.length) && comments.length < maxComments; i++) {
      const profile = extraction.profiles[i];
      const commentText = potentialComments[i];
      
      if (!profile || !commentText) continue;
      
      // Make sure we haven't used this text
      const textKey = commentText.text.substring(0, 50);
      if (usedTexts.has(textKey)) continue;
      
      // Make sure text isn't the username itself
      if (commentText.text === profile.username) continue;
      
      comments.push({
        post_url: postUrl,
        username: profile.username,
        profile_url: profile.fullUrl,
        comment_text: commentText.text.substring(0, 500),
        comment_date: '',
        followers_estimate: ''
      });
      
      usedTexts.add(textKey);
    }

    console.log(`      → Created ${comments.length} comment pairs`);

    // Debug output
    if (comments.length > 0) {
      console.log(`      ✅ Sample: "${comments[0].comment_text.substring(0, 60)}..." by @${comments[0].username}`);
    } else {
      console.log(`      ⚠️  V4 extraction failed`);
      console.log(`      💡 Possible reasons:`);
      console.log(`         - Comments not loaded (need more scrolling/clicking)`);
      console.log(`         - Instagram using Shadow DOM`);
      console.log(`         - Comments loaded via API only`);
      console.log(`         - Bot detection preventing comment display`);
    }

    // Save context
    postContext.comments_count = comments.length.toString();
    await saveContextJSON(postUrl, postContext);

  } catch (error) {
    console.error(`   Error in V4 scraper: ${error.message}`);
  }

  return comments;
}

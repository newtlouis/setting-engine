/**
 * Post Scraper Module V2 - More Generic Approach
 * 
 * Uses pattern matching instead of fixed selectors to find comments
 */

import { delay, detectChallenge, saveContextJSON } from './utils.js';
import { CONFIG } from './config.js';

/**
 * Scrape comments using generic pattern matching
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
    // Wait for article
    await page.waitForSelector('article', { timeout: 10000 }).catch(() => null);
    await delay(2000);
    
    // Scroll down to load comments
    await page.evaluate(() => {
      window.scrollBy({ top: 800, behavior: 'smooth' });
    });
    await delay(2000);

    // Extract using generic approach - find username + text pairs
    const extractedComments = await page.evaluate(() => {
      const results = [];
      const article = document.querySelector('article');
      if (!article) return results;

      // Find all links that look like profile links
      const profileLinks = Array.from(article.querySelectorAll('a[href]'))
        .filter(a => {
          const href = a.getAttribute('href');
          return href && 
                 href.startsWith('/') && 
                 !href.includes('/p/') && 
                 !href.includes('/reel/') &&
                 !href.includes('/explore/') &&
                 href.length < 50;
        });

      console.log(`Found ${profileLinks.length} potential profile links`);

      // For each profile link, look for nearby text that could be a comment
      profileLinks.forEach(link => {
        const username = link.textContent.trim();
        if (!username || username.length < 2) return;

        // Look at parent and siblings for comment text
        let commentElement = link.parentElement;
        while (commentElement && commentElement !== article) {
          const text = Array.from(commentElement.childNodes)
            .filter(node => node.nodeType === Node.TEXT_NODE || 
                          (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'SPAN'))
            .map(node => node.textContent)
            .join(' ')
            .trim();

          // If we found substantial text that's not just the username
          if (text.length > username.length + 5 && text.includes(username)) {
            const commentText = text.replace(username, '').trim();
            
            // Check if this looks like a real comment (not UI text)
            if (commentText.length > 3 && 
                !commentText.match(/^(like|reply|view|load|more|less|ago|\d+[smhd])$/i)) {
              
              results.push({
                username: username,
                profileUrl: link.href.startsWith('http') ? link.href : `https://www.instagram.com${link.href}`,
                commentText: commentText.substring(0, 500), // Limit length
                element: commentElement.tagName
              });
              
              break; // Found comment for this username
            }
          }
          
          commentElement = commentElement.parentElement;
        }
      });

      return results;
    });

    console.log(`      → Extracted ${extractedComments.length} potential comments using generic method`);

    // Filter and format comments
    const seen = new Set();
    for (const item of extractedComments) {
      const key = `${item.username}:${item.commentText.substring(0, 50)}`;
      
      if (!seen.has(key) && 
          item.commentText.length > 5 &&
          item.username !== 'unknown') {
        
        comments.push({
          post_url: postUrl,
          username: item.username,
          profile_url: item.profileUrl,
          comment_text: item.commentText,
          comment_date: '', // Not easily extractable with generic approach
          followers_estimate: ''
        });
        
        seen.add(key);
        
        if (comments.length >= maxComments) break;
      }
    }

    // Debug output
    if (comments.length > 0) {
      console.log(`      → Sample: "${comments[0].comment_text.substring(0, 60)}..." by @${comments[0].username}`);
    } else {
      console.log(`      ⚠️  No valid comments found with generic extraction`);
    }

    // Save context
    postContext.comments_count = comments.length.toString();
    await saveContextJSON(postUrl, postContext);

  } catch (error) {
    console.error(`   Error extracting post metadata: ${error.message}`);
  }

  return comments;
}

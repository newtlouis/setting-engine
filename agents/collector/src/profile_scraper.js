/**
 * Profile Scraper Module
 * 
 * Extracts profile data (followers, bio, verification status) for lead qualification.
 * This data is crucial for filtering bots and identifying high-value prospects.
 * 
 * Integrated with SQLite database for persistent storage.
 */

import { delay, detectChallenge } from './utils.js';
import { getDatabase, updateLeadProfile, getLeadByUsername } from './database.js';

/**
 * Scrape profile data for a single user
 * 
 * @param {Page} page - Playwright page object
 * @param {string} username - Instagram username
 * @param {boolean} saveToDb - Whether to save to database (default: true)
 * @returns {Promise<Object>} Profile data object
 */
export async function scrapeProfileData(page, username, saveToDb = true) {
  const profileData = {
    username,
    followers_count: null,
    following_count: null,
    posts_count: null,
    is_verified: false,
    is_business: false,
    is_private: false,
    bio: '',
    external_url: '',
    full_name: '',
    scrape_error: null
  };

  try {
    const profileUrl = `https://www.instagram.com/${username}/`;
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(2000 + Math.random() * 1500);

    // Check for challenge
    if (await detectChallenge(page)) {
      profileData.scrape_error = 'challenge_detected';
      return profileData;
    }

    // Check if profile exists
    const notFound = await page.$('text=/sorry, this page/i').catch(() => null);
    if (notFound) {
      profileData.scrape_error = 'profile_not_found';
      return profileData;
    }

    // Extract profile data using page evaluation
    const extractedData = await page.evaluate(() => {
      const data = {
        followers: null,
        following: null,
        posts: null,
        isVerified: false,
        isBusiness: false,
        isPrivate: false,
        bio: '',
        externalUrl: '',
        fullName: ''
      };

      // Method 1: Try meta tags (most reliable)
      const metaDescription = document.querySelector('meta[name="description"]');
      if (metaDescription) {
        const content = metaDescription.getAttribute('content') || '';
        
        // Parse "X Followers, X Following, X Posts"
        const followersMatch = content.match(/([\d,.]+[KMB]?)\s*Followers/i);
        const followingMatch = content.match(/([\d,.]+[KMB]?)\s*Following/i);
        const postsMatch = content.match(/([\d,.]+[KMB]?)\s*Posts/i);
        
        if (followersMatch) data.followers = followersMatch[1];
        if (followingMatch) data.following = followingMatch[1];
        if (postsMatch) data.posts = postsMatch[1];
      }

      // Method 2: Try header section stats
      const headerSection = document.querySelector('header section');
      if (headerSection) {
        const statElements = headerSection.querySelectorAll('ul li');
        statElements.forEach(li => {
          const text = li.textContent.toLowerCase();
          const numMatch = text.match(/([\d,.]+[KMB]?)/);
          if (numMatch) {
            if (text.includes('follower')) data.followers = data.followers || numMatch[1];
            else if (text.includes('following')) data.following = data.following || numMatch[1];
            else if (text.includes('post')) data.posts = data.posts || numMatch[1];
          }
        });
      }

      // Check verification badge
      const verifiedBadge = document.querySelector('svg[aria-label="Verified"]') ||
                           document.querySelector('[title="Verified"]') ||
                           document.querySelector('span[title="Verified"]');
      data.isVerified = !!verifiedBadge;

      // Check for business/creator indicators
      const categoryLabel = document.querySelector('div[class*="category"]');
      // Look for contact/email/call buttons by checking all buttons and links
      const allButtons = document.querySelectorAll('button, a[role="link"]');
      let hasContactButton = false;
      allButtons.forEach(btn => {
        const text = btn.textContent.toLowerCase();
        if (text.includes('contact') || text.includes('email') || text.includes('call')) {
          hasContactButton = true;
        }
      });
      data.isBusiness = !!(categoryLabel || hasContactButton);

      // Check if private
      const pageText = document.body.innerText.toLowerCase();
      data.isPrivate = pageText.includes('this account is private');

      // Extract bio - Instagram 2024 structure
      // Strategy 1: Find the bio section in the header area
      const header = document.querySelector('header');
      if (header) {
        // The bio is usually in a span with dir="auto" that's NOT part of stats
        // and NOT the username/fullname
        const allSpans = header.querySelectorAll('span[dir="auto"]');
        const potentialBios = [];
        
        allSpans.forEach(span => {
          const text = span.textContent.trim();
          // Skip stats (followers, following, posts)
          if (/^\d[\d,.]*[KMB]?$/i.test(text)) return;
          if (/^(followers?|following|posts?)$/i.test(text)) return;
          // Skip very short text (likely UI elements)
          if (text.length < 5) return;
          // Skip if it looks like a category label only
          if (text.length < 20 && /^(coach|trainer|fitness|artist|entrepreneur)$/i.test(text)) {
            // Keep category labels as they can be useful
            potentialBios.push(text);
            return;
          }
          // Skip if it's just the username with @
          if (/^@[\w.]+$/.test(text)) return;
          // This could be the bio
          potentialBios.push(text);
        });
        
        // Take the longest text as the bio (usually the actual bio is the longest)
        if (potentialBios.length > 0) {
          const longestText = potentialBios.reduce((a, b) => a.length >= b.length ? a : b);
          if (longestText.length >= 10) {
            data.bio = longestText.substring(0, 300);
          }
        }
      }
      
      // Strategy 2: Try the specific section class (may change)
      if (!data.bio) {
        const bioSection = document.querySelector('section.xqui205');
        if (bioSection) {
          const bioSpans = bioSection.querySelectorAll('span[dir="auto"]');
          const bioTexts = [];
          bioSpans.forEach(span => {
            const text = span.textContent.trim();
            if (text && !text.includes('@') && text.length > 0) {
              bioTexts.push(text);
            }
          });
          if (bioTexts.length > 0) {
            data.bio = bioTexts.join(' ').substring(0, 300);
          }
        }
      }
      
      // Fallback: try meta description for bio
      if (!data.bio) {
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
          const content = metaDesc.getAttribute('content') || '';
          // Meta format: "X Followers, X Following, X Posts - Bio text here"
          // or "X Followers, X Following, X Posts - See Instagram photos and videos from Name (@username)"
          const dashIndex = content.indexOf(' - ');
          if (dashIndex > 0) {
            let bioText = content.substring(dashIndex + 3).trim();
            
            // Filter out Instagram's default text (no actual bio)
            const defaultPatterns = [
              /^See Instagram photos and videos from/i,
              /^See photos and videos from/i,
              /^Instagram photos and videos/i,
              /^Photos and videos from/i
            ];
            
            const isDefaultText = defaultPatterns.some(pattern => pattern.test(bioText));
            if (!isDefaultText && bioText.length > 0) {
              // Clean up: remove trailing "(@username)" pattern that Instagram sometimes adds
              bioText = bioText.replace(/\s*\(@[\w.]+\)\s*$/, '').trim();
              // Remove any "on Instagram" suffix
              bioText = bioText.replace(/\s+on Instagram\s*$/i, '').trim();
              data.bio = bioText.substring(0, 300);
            }
          }
        }
      }
      
      // Fallback 2: older selectors
      if (!data.bio) {
        const bioSelectors = [
          'header section div > span[dir="auto"]',
          'header section h1 + div span',
          'section > div > span > span'
        ];
        for (const selector of bioSelectors) {
          const bioEl = document.querySelector(selector);
          if (bioEl && bioEl.textContent.length > 3) {
            data.bio = bioEl.textContent.trim().substring(0, 300);
            break;
          }
        }
      }

      // Extract full name - improved selectors
      const nameSelectors = [
        'header section span[class*="notranslate"]',
        'header h2',
        'header section > div > span'
      ];
      for (const selector of nameSelectors) {
        const nameEl = document.querySelector(selector);
        if (nameEl && nameEl.textContent.trim().length > 0) {
          const text = nameEl.textContent.trim();
          // Skip if it looks like a bio (too long) or username
          if (text.length < 50 && !text.includes('@')) {
            data.fullName = text;
            break;
          }
        }
      }

      // Extract external URL
      const externalLink = document.querySelector('header a[rel="me nofollow noopener"]') ||
                          document.querySelector('header a[target="_blank"]');
      if (externalLink) {
        data.externalUrl = externalLink.getAttribute('href') || '';
      }

      return data;
    });

    // Simplified extraction (columns removed)
    // The initial profileData object is already defined at the start of scrapeProfileData
    // We will update it with minimal fields from extractedData
    profileData.is_private = extractedData.isPrivate;
    profileData.profile_scraped_at = new Date().toISOString();

    // Clear other fields that are no longer being extracted
    profileData.followers_count = null;
    profileData.following_count = null;
    profileData.posts_count = null;
    profileData.is_verified = false;
    profileData.is_business = false;
    profileData.bio = '';
    profileData.external_url = '';
    profileData.full_name = '';

    // Save to database if requested
    if (saveToDb && !profileData.scrape_error) {
      try {
        await getDatabase();
        const existingLead = getLeadByUsername(username);
        if (existingLead) {
          updateLeadProfile(username, profileData);
        }
      } catch (dbError) {
        // Don't fail if DB save fails
        console.error(`   ⚠️  DB save error for ${username}: ${dbError.message}`);
      }
    }

  } catch (error) {
    profileData.scrape_error = error.message;
  }

  return profileData;
}

/**
 * Parse follower count string to number
 * Handles formats like "1,234", "12.5K", "1.2M", "1B"
 * 
 * @param {string} countStr - Follower count string
 * @returns {number|null} Parsed count or null
 */
function parseFollowerCount(countStr) {
  if (!countStr) return null;
  
  // Remove commas
  let cleanStr = countStr.replace(/,/g, '').trim();
  
  // Handle K, M, B suffixes
  const multipliers = {
    'K': 1000,
    'M': 1000000,
    'B': 1000000000
  };
  
  const suffix = cleanStr.slice(-1).toUpperCase();
  if (multipliers[suffix]) {
    const num = parseFloat(cleanStr.slice(0, -1));
    return Math.round(num * multipliers[suffix]);
  }
  
  return parseInt(cleanStr, 10) || null;
}

/**
 * Batch scrape profiles for a list of usernames
 * Includes rate limiting to avoid detection
 * 
 * @param {Page} page - Playwright page object
 * @param {string[]} usernames - Array of usernames to scrape
 * @param {Object} options - Options
 * @param {Function} options.onProgress - Callback for progress updates
 * @param {boolean} options.skipExisting - Skip if already scraped (default: true)
 * @param {number} options.maxAge - Max age in hours before re-scraping (default: 168 = 7 days)
 * @returns {Promise<Map>} Map of username -> profile data
 */
export async function batchScrapeProfiles(page, usernames, options = {}) {
  const {
    onProgress = null,
    skipExisting = true,
    maxAge = 168 // 7 days in hours
  } = options;
  
  const results = new Map();
  const uniqueUsernames = [...new Set(usernames)];
  
  // Filter out already-scraped profiles if skipExisting is true
  let toScrape = uniqueUsernames;
  if (skipExisting) {
    try {
      await getDatabase();
      toScrape = uniqueUsernames.filter(username => {
        const lead = getLeadByUsername(username);
        if (!lead || !lead.profile_scraped_at) return true;
        
        // Check if profile data is stale
        const scrapedAt = new Date(lead.profile_scraped_at);
        const hoursSinceScrape = (Date.now() - scrapedAt.getTime()) / (1000 * 60 * 60);
        return hoursSinceScrape > maxAge;
      });
      
      const skipped = uniqueUsernames.length - toScrape.length;
      if (skipped > 0) {
        console.log(`   ⏭️  Skipping ${skipped} profiles already scraped within ${maxAge}h`);
      }
    } catch (e) {
      // If DB not available, scrape all
    }
  }
  
  if (toScrape.length === 0) {
    console.log(`   ✅ All profiles already up-to-date`);
    return results;
  }
  
  console.log(`   📊 Scraping profile data for ${toScrape.length} users...`);
  
  for (let i = 0; i < toScrape.length; i++) {
    const username = toScrape[i];
    
    if (onProgress) {
      onProgress(i + 1, toScrape.length, username);
    } else {
      console.log(`      [${i + 1}/${toScrape.length}] @${username}`);
    }
    
    const profileData = await scrapeProfileData(page, username, true);
    results.set(username, profileData);
    
    // Log result
    if (profileData.scrape_error) {
      console.log(`         ⚠️  Error: ${profileData.scrape_error}`);
    } else if (profileData.followers_count !== null) {
      console.log(`         ✓ ${profileData.followers_count.toLocaleString()} followers`);
    }
    
    // Rate limiting: longer delay between profile scrapes
    if (i < toScrape.length - 1) {
      await delay(2000 + Math.random() * 3000);
    }
    
    // Check for challenge every 10 profiles
    if ((i + 1) % 10 === 0) {
      if (await detectChallenge(page)) {
        console.log(`   ⚠️  Challenge detected after ${i + 1} profiles. Stopping.`);
        break;
      }
    }
  }
  
  return results;
}

/**
 * Enrich comments with profile data
 * 
 * @param {Array} comments - Array of comment objects
 * @param {Map} profileDataMap - Map of username -> profile data
 * @returns {Array} Enriched comments
 */
export function enrichCommentsWithProfiles(comments, profileDataMap) {
  return comments.map(comment => {
    const profileData = profileDataMap.get(comment.username);
    
    if (profileData) {
      return {
        ...comment,
        followers_count: profileData.followers_count,
        is_verified: profileData.is_verified,
        is_business: profileData.is_business,
        is_private: profileData.is_private,
        full_name: profileData.full_name || comment.full_name,
        bio: profileData.bio
      };
    }
    
    return comment;
  });
}

/**
 * Quick bot detection based on profile metrics
 * 
 * @param {Object} profileData - Profile data object
 * @returns {Object} { isLikelyBot: boolean, reasons: string[] }
 */
export function detectBotProfile(profileData) {
  const reasons = [];
  
  // Very low or zero followers
  if (profileData.followers_count !== null && profileData.followers_count < 10) {
    reasons.push('very_low_followers');
  }
  
  // Following way more than followers (follow-for-follow behavior)
  if (profileData.followers_count && profileData.following_count) {
    const ratio = profileData.following_count / profileData.followers_count;
    if (ratio > 10 && profileData.followers_count < 100) {
      reasons.push('suspicious_follow_ratio');
    }
  }
  
  // No posts but active commenting
  if (profileData.posts_count === 0) {
    reasons.push('no_posts');
  }
  
  // Private with very low followers
  if (profileData.is_private && profileData.followers_count !== null && profileData.followers_count < 50) {
    reasons.push('private_low_followers');
  }
  
  return {
    isLikelyBot: reasons.length >= 2,
    reasons
  };
}

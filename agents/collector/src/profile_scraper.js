/**
 * Profile Scraper Module
 * 
 * Extracts profile data (followers, bio, verification status) for lead qualification.
 * This data is crucial for filtering bots and identifying high-value prospects.
 */

import { delay, detectChallenge } from './utils.js';

/**
 * Scrape profile data for a single user
 * 
 * @param {Page} page - Playwright page object
 * @param {string} username - Instagram username
 * @returns {Promise<Object>} Profile data object
 */
export async function scrapeProfileData(page, username) {
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
      const contactButton = document.querySelector('text=/contact|email|call/i');
      data.isBusiness = !!(categoryLabel || contactButton);

      // Check if private
      const privateIndicator = document.querySelector('text=/this account is private/i');
      data.isPrivate = !!privateIndicator;

      // Extract bio
      const bioSection = document.querySelector('header section div > span');
      if (bioSection) {
        data.bio = bioSection.textContent.trim().substring(0, 300);
      }

      // Extract full name
      const nameElement = document.querySelector('header section span[class*="notranslate"]') ||
                         document.querySelector('header h2');
      if (nameElement) {
        data.fullName = nameElement.textContent.trim();
      }

      // Extract external URL
      const externalLink = document.querySelector('header a[rel="me nofollow noopener"]') ||
                          document.querySelector('header a[target="_blank"]');
      if (externalLink) {
        data.externalUrl = externalLink.getAttribute('href') || '';
      }

      return data;
    });

    // Parse follower count to number
    profileData.followers_count = parseFollowerCount(extractedData.followers);
    profileData.following_count = parseFollowerCount(extractedData.following);
    profileData.posts_count = parseFollowerCount(extractedData.posts);
    profileData.is_verified = extractedData.isVerified;
    profileData.is_business = extractedData.isBusiness;
    profileData.is_private = extractedData.isPrivate;
    profileData.bio = extractedData.bio;
    profileData.external_url = extractedData.externalUrl;
    profileData.full_name = extractedData.fullName;

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
 * @param {Function} onProgress - Callback for progress updates
 * @returns {Promise<Map>} Map of username -> profile data
 */
export async function batchScrapeProfiles(page, usernames, onProgress = null) {
  const results = new Map();
  const uniqueUsernames = [...new Set(usernames)];
  
  console.log(`   📊 Scraping profile data for ${uniqueUsernames.length} users...`);
  
  for (let i = 0; i < uniqueUsernames.length; i++) {
    const username = uniqueUsernames[i];
    
    if (onProgress) {
      onProgress(i + 1, uniqueUsernames.length, username);
    }
    
    const profileData = await scrapeProfileData(page, username);
    results.set(username, profileData);
    
    // Rate limiting: longer delay between profile scrapes
    if (i < uniqueUsernames.length - 1) {
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

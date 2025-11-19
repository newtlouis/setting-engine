/**
 * Configuration Constants
 */

export const CONFIG = {
  // Delays (in milliseconds)
  MIN_DELAY: 3000,
  MAX_DELAY: 7000,
  SLOW_MO: 100,

  // User Agent (updated periodically to match real browsers)
  USER_AGENT: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

  // Default limits
  DEFAULT_MAX_POSTS: 50,
  DEFAULT_MAX_COMMENTS: 100,

  // Instagram selectors (centralized for easy updates)
  // FIX NOTE: Update these selectors if Instagram changes their DOM structure
  SELECTORS: {
    POST_LINK: 'article a[href*="/p/"], article a[href*="/reel/"]',
    CAPTION: 'article h1',
    LIKES: 'section a[href$="/liked_by/"] span, section span:has-text("likes")',
    LOAD_MORE_COMMENTS: 'button:has-text("View more comments"), button:has-text("more comments")',
    COMMENT_ITEM: 'article ul li[role="menuitem"]',
    COMMENT_USERNAME: 'a[role="link"]',
    COMMENT_TEXT: 'span',
    COMMENT_DATE: 'time'
  }
};

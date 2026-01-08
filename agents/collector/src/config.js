/**
 * Configuration Constants
 */

import path from 'path';
import dotenv from 'dotenv';
import { getCredentialsForProfile } from '../../../shared/credentials.js';
import { USER_AGENT } from '../../../shared/stealth.js';
import { getBrowserDataDir } from '../../../shared/paths.js';
dotenv.config();

const profile = process.env.IG_PROFILE;
const credentials = getCredentialsForProfile(profile);

export const CONFIG = {
  // Delays (in milliseconds)
  MIN_DELAY: 4000,
  MAX_DELAY: 8000,
  SLOW_MO: 150,
  
  // Timeouts (in milliseconds)
  PAGE_LOAD_TIMEOUT: 60000,
  SELECTOR_TIMEOUT: 15000,

  // User Agent (from stealth module - updated periodically)
  USER_AGENT,

  // Default limits
  DEFAULT_MAX_POSTS: 50,
  DEFAULT_MAX_COMMENTS: 100,

  // Instagram credentials (optional - for auto-login)
  INSTAGRAM_USERNAME: credentials.username,
  INSTAGRAM_PASSWORD: credentials.password,
  
  // Persistent browser data for session storage
  USER_DATA_DIR: getBrowserDataDir(profile),

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

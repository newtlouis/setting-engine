/**
 * Outreach Agent Configuration
 */

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const CONFIG = {
  // Database path (shared with collector)
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', '..', 'collector', 'permanent-data', 'leads.db'),
  
  // Rate limiting - CRITICAL for avoiding detection
  MIN_DELAY_BETWEEN_DMS: parseInt(process.env.MIN_DELAY_BETWEEN_DMS, 10) || 60000,  // 1 minute minimum
  MAX_DELAY_BETWEEN_DMS: parseInt(process.env.MAX_DELAY_BETWEEN_DMS, 10) || 180000, // 3 minutes maximum
  MAX_DMS_PER_SESSION: parseInt(process.env.MAX_DMS_PER_SESSION, 10) || 10,          // Max DMs per session
  MAX_DMS_PER_DAY: parseInt(process.env.MAX_DMS_PER_DAY, 10) || 20,                  // Max DMs per day
  
  // Session management
  SESSION_COOLDOWN_HOURS: parseInt(process.env.SESSION_COOLDOWN_HOURS, 10) || 4,    // Hours between sessions
  
  // Browser settings
  HEADLESS: process.env.HEADLESS === 'true',  // Default: false (visible browser)
  SLOW_MO: parseInt(process.env.SLOW_MO, 10) || 50,  // Slow down actions by 50ms
  
  // Timeouts
  PAGE_TIMEOUT: parseInt(process.env.PAGE_TIMEOUT, 10) || 30000,
  DM_SEND_TIMEOUT: parseInt(process.env.DM_SEND_TIMEOUT, 10) || 15000,
  
  // Selectors - may need updating if Instagram changes UI
  SELECTORS: {
    // Profile page
    MESSAGE_BUTTON: 'div[role="button"]:has-text("Message")',
    MESSAGE_BUTTON_ALT: 'button:has-text("Message")',
    
    // DM dialog/inbox
    MESSAGE_INPUT: 'div[role="textbox"][aria-label*="Message"]',
    MESSAGE_INPUT_ALT: 'textarea[placeholder*="Message"]',
    SEND_BUTTON: 'button[type="submit"]',
    SEND_BUTTON_ALT: 'div[role="button"]:has-text("Send")',
    
    // Detection indicators
    CHALLENGE_INDICATOR: 'form[id*="challenge"]'
    // Note: Rate limit detection is now done with specific selectors in dm_sender.js
  }
};

// Lead selection criteria for outreach
export const OUTREACH_CRITERIA = {
  // Minimum requirements
  MIN_ENGAGEMENT_SCORE: parseInt(process.env.MIN_ENGAGEMENT_SCORE, 10) || 0,  // Default 0 to include all
  MIN_FOLLOWERS: parseInt(process.env.MIN_FOLLOWERS, 10) || 0,                 // Default 0 to include all
  MAX_FOLLOWERS: parseInt(process.env.MAX_FOLLOWERS, 10) || 1000000,           // Default 1M
  
  // Exclude
  EXCLUDE_PRIVATE: process.env.EXCLUDE_PRIVATE !== 'false',   // Default: exclude private accounts
  EXCLUDE_BUSINESS: process.env.EXCLUDE_BUSINESS === 'true',  // Default: include business accounts
  EXCLUDE_VERIFIED: process.env.EXCLUDE_VERIFIED === 'true',  // Default: include verified
  
  // Priorities
  PRIORITIZE_WARMTH: ['hot', 'warm', 'cold'],  // Order of priority
  PRIORITIZE_ENGAGEMENT: ['HIGH', 'MEDIUM', 'LOW']
};

export default CONFIG;

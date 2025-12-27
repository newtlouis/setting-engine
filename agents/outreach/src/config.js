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
  // CRM config removed

  
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
    // Profile page - "Contacter" button (FR) or "Message" button (EN)
    // This button opens the DM popup directly from the profile
    CONTACT_BUTTON: [
      'main header div[role="button"]:has-text("Contacter")',  // French (scoped to profile header)
      'main header div[role="button"]:has-text("Message")',    // English
      'main header button:has-text("Contacter")',
      'main header button:has-text("Message")',
       // Fallback for some layouts (mobile/responsive) where header might be different but still in main
      'main div[role="button"]:has-text("Contacter")',
      'main div[role="button"]:has-text("Message")',
      'main button:has-text("Contacter")',
      'main button:has-text("Message")'
    ],
    
    // DM popup - contenteditable message input
    MESSAGE_INPUT: [
      'div[contenteditable="true"][role="textbox"]',
      'div[aria-label*="message" i][contenteditable="true"]',
      'div[aria-label*="Message" i][contenteditable="true"]',
      'div[aria-placeholder*="message" i][contenteditable="true"]',
      'div[data-lexical-editor="true"]'
    ],
    
    // Send button (after typing, usually just Enter works)
    SEND_BUTTON: [
      'button[type="submit"]',
      'div[role="button"]:has-text("Send")',
      'div[role="button"]:has-text("Envoyer")'  // French
    ],
    
    // Detection indicators
    CHALLENGE_INDICATOR: 'form[id*="challenge"]'
    // Note: Rate limit detection is now done with specific selectors in dm_sender.js
  },
  
  // OpenAI Configuration for Lead Qualification
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  QUALIFICATION_ENABLED: process.env.QUALIFICATION_ENABLED !== 'false', // Default: enabled
  QUALIFICATION_PROMPT: `Analyse cette bio Instagram. 
Si la personne est un professionnel de l'accompagnement, un coach, un thérapeute, un formateur, ou travaille dans le développement personnel, réponds uniquement "NON".
Sinon, réponds uniquement "OUI".

Bio: {bio}

Réponse (OUI ou NON):`,
};

// Default outreach criteria
export const OUTREACH_CRITERIA = {
  // Minimum requirements
  MIN_ENGAGEMENT_SCORE: parseInt(process.env.MIN_ENGAGEMENT_SCORE, 10) || 0,  // Default 0 to include all
  // Removed followers/private criteria
  
  // Exclude
  EXCLUDE_BUSINESS: process.env.EXCLUDE_BUSINESS === 'true',  // Default: include business accounts
  EXCLUDE_VERIFIED: process.env.EXCLUDE_VERIFIED === 'true',  // Default: include verified
  
  // Priorities
  PRIORITIZE_WARMTH: ['hot', 'warm', 'cold'],  // Order of priority
  PRIORITIZE_ENGAGEMENT: ['HIGH', 'MEDIUM', 'LOW']
};

export default CONFIG;

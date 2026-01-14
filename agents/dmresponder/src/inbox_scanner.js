/**
 * @file Inbox Scanner for DM Responder
 * 
 * Scans the Instagram inbox directly to find unread conversations.
 * Uses an incremental scan-and-scroll approach to capture all conversations,
 * including those that might be scrolled out of view.
 */

import { 
  initBrowser, 
  scrapeConversationMessages,
  typeInOpenTab,
  registerOpenTab,
  waitForUserToFinish,
  closeBrowser,
  getOpenMessageTabs
} from './scraper.js';
import { generateResponse } from './engine.js';
import {
  initDB,
  getLeadWithContext,
  getConversationHistory,
  addMessage,
  setDmThreadStatus
} from './db_integration.js';
import { loadProfileConfig } from '../../../shared/utils/configLoader.js';

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  INBOX_URL: 'https://www.instagram.com/direct/inbox/',
  SCROLL_COUNT: 10,
  DELAYS: {
    AFTER_NAVIGATION: 3500,
    AFTER_CLICK: 2500,
    AFTER_SCROLL: 1200,
    BETWEEN_CONVERSATIONS: 1500
  }
};

// ============================================
// UTILITIES
// ============================================
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Navigate to the Instagram inbox
 */
async function navigateToInbox(page) {
  console.log(`   Navigating to inbox...`);
  await page.goto(CONFIG.INBOX_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await delay(CONFIG.DELAYS.AFTER_NAVIGATION);
  
  // Wait for conversation list to load
  try {
    await page.waitForSelector('div[role="listbox"], div[role="list"]', { timeout: 10000 });
    console.log(`   ✅ Inbox loaded`);
    return true;
  } catch (e) {
    console.log(`   ⚠️ Could not detect conversation list, continuing anyway...`);
    return true;
  }
}

/**
 * Perform a single scroll action in the sidebar
 */
async function scrollSidebarOnce(page) {
  return await page.evaluate(() => {
    // Find scrollable container
    const containers = document.querySelectorAll('div[style*="overflow"]');
    for (const container of containers) {
      const style = window.getComputedStyle(container);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        if (container.querySelector('img[alt*="profile" i]')) {
          container.scrollTop += 500;
          return true;
        }
      }
    }
    
    // Fallback
    const firstConv = document.querySelector('div[role="button"] img[alt*="profile" i]');
    if (firstConv) {
      let parent = firstConv.parentElement;
      while (parent) {
        const style = window.getComputedStyle(parent);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          parent.scrollTop += 500;
          return true;
        }
        parent = parent.parentElement;
      }
    }
    return false;
  });
}

/**
 * Get currently visible conversation items
 */
async function getVisibleConversations(page) {
  return await page.evaluate(() => {
    const conversations = [];
    const seenNames = new Set();
    
    const buttons = document.querySelectorAll('div[role="button"]');
    
    buttons.forEach((button) => {
      const hasProfileImage = button.querySelector('img[alt*="profile" i], img[alt*="picture" i]');
      const nameSpan = button.querySelector('span[title]');
      
      if (!hasProfileImage || !nameSpan) return;
      
      const name = nameSpan.getAttribute('title') || nameSpan.textContent || '';
      if (!name || seenNames.has(name)) return;
      seenNames.add(name);
      
      let isUnread = false;
      const allSpans = button.querySelectorAll('span');
      for (const span of allSpans) {
        const text = span.textContent || '';
        if (text === 'Unread' || text.includes('Unread')) {
          isUnread = true;
          break;
        }
      }
      
      const dotIndicator = button.querySelector('span[data-visualcompletion="ignore"] + div, .x6s0dn4.x1iwo8zk');
      if (dotIndicator) {
        isUnread = true;
      }
      
      const dirSpans = button.querySelectorAll('span[dir="auto"]');
      let preview = '';
      if (dirSpans.length >= 2) {
        preview = dirSpans[1]?.textContent?.trim() || '';
      }
      
      conversations.push({
        name,
        isUnread,
        preview: preview.substring(0, 60)
      });
    });
    
    return conversations;
  });
}

/**
 * Click on a conversation by its NAME
 */
async function clickConversationByName(page, targetName) {
  const clicked = await page.evaluate((name) => {
    const buttons = document.querySelectorAll('div[role="button"]');
    
    for (const button of buttons) {
      const nameSpan = button.querySelector('span[title]');
      if (nameSpan) {
        const buttonName = nameSpan.getAttribute('title') || nameSpan.textContent || '';
        if (buttonName === name) {
          button.click();
          button.scrollIntoView({ block: 'center', behavior: 'instant' }); // Ensure it's in view
          return true;
        }
      }
    }
    return false;
  }, targetName);
  
  if (clicked) {
    await delay(CONFIG.DELAYS.AFTER_CLICK);
  }
  
  return clicked;
}

/**
 * Extract username from conversation header
 */
async function extractUsernameFromConversation(page) {
  await delay(800);
  
  const username = await page.evaluate(() => {
    const mainArea = document.querySelector('div[role="main"]');
    if (mainArea) {
      const links = mainArea.querySelectorAll('a[href^="/"]');
      for (const link of links) {
        const href = link.getAttribute('href');
        if (href && href.match(/^\/[a-zA-Z0-9._]+\/?$/) && !href.includes('direct') && !href.includes('explore')) {
          return href.replace(/\//g, '');
        }
      }
    }
    
    const profileLink = document.querySelector('a[aria-label*="profil" i], a[aria-label*="profile page" i]');
    if (profileLink) {
      const href = profileLink.getAttribute('href');
      if (href) {
        const match = href.match(/\/([a-zA-Z0-9._]+)\/?$/);
        if (match) return match[1];
      }
    }
    
    const headerTitle = document.querySelector('div[role="main"] header h1, div[role="main"] h1');
    if (headerTitle) {
      return headerTitle.textContent?.trim();
    }
    
    return null;
  });
  
  return username;
}

/**
 * Find new messages
 */
function findNewMessages(scrapedMessages, dbHistory) {
  if (!scrapedMessages || scrapedMessages.length === 0) return [];
  if (!dbHistory || dbHistory.length === 0) return scrapedMessages;
  
  const existingTexts = new Set(dbHistory.map(m => m.text?.trim().toLowerCase()));
  
  return scrapedMessages.filter(msg => {
    const normalizedText = msg.text?.trim().toLowerCase();
    return !existingTexts.has(normalizedText);
  });
}

// ============================================
// MAIN INBOX SCANNER
// ============================================

export async function runInboxScanner(options = {}) {
  await initDB();
  
  const profile = options.profile || process.env.IG_PROFILE;
  if (!profile) {
    throw new Error('Profile name is required. Use --profile <name>.');
  }
  
  console.log(`\n========================================`);
  console.log(`   DM RESPONDER - INBOX SCANNER MODE`);
  console.log(`========================================`);
  console.log(`   Profile: ${profile}`);
  console.log(`   Strategy: Incremental Scan & Scroll`);
  
  let browser = null;
  let workingPage = null;
  let processedCount = 0;
  let skippedCount = 0;
  
  try {
    const browserResult = await initBrowser({ 
      profile,
      headless: false
    });
    browser = browserResult.browser;
    workingPage = browserResult.page;
    
    const profileConfig = await loadProfileConfig(profile);
    if (profileConfig?.niche) {
      console.log(`   🧠 Using niche strategy: ${profileConfig.niche}`);
    }
    
    await navigateToInbox(workingPage);
    
    // --- INCREMENTAL COLLECTION PHASE ---
    console.log(`\n   🔍 PHASE 1: Collecting unread conversations...`);
    
    const allConversations = new Map(); // Use Map to deduplicate by name
    
    // Scan initially then loop scroll
    for (let i = 0; i <= CONFIG.SCROLL_COUNT; i++) {
      const visible = await getVisibleConversations(workingPage);
      
      let newFound = 0;
      visible.forEach(c => {
        if (!allConversations.has(c.name)) {
          allConversations.set(c.name, c);
          newFound++;
        }
      });
      
      console.log(`      Scan ${i}: Found ${visible.length} visible, ${newFound} new.`);
      
      if (i < CONFIG.SCROLL_COUNT) {
        await scrollSidebarOnce(workingPage);
        await delay(CONFIG.DELAYS.AFTER_SCROLL);
      }
    }
    
    const unreadConversations = Array.from(allConversations.values()).filter(c => c.isUnread);
    
    console.log(`\n   ✅ Collection Complete.`);
    console.log(`   Total Found: ${allConversations.size}`);
    console.log(`   📬 Unread: ${unreadConversations.length}`);
    
    if (unreadConversations.length === 0) {
      console.log(`   No unread conversations found. Exiting.`);
      await closeBrowser();
      return;
    }

    console.log(`\n   --- Unread List ---`);
    unreadConversations.forEach((c, i) => {
      console.log(`   ${i + 1}. ${c.name} - "${c.preview.substring(0, 30)}..."`);
    });
    
    // --- PROCESSING PHASE ---
    console.log(`\n   🛠️ PHASE 2: Processing unread conversations...`);
    
    for (const conv of unreadConversations) {
      console.log(`\n   Processing: ${conv.name}`);
      
      // Click by NAME
      const clicked = await clickConversationByName(workingPage, conv.name);
      if (!clicked) {
        console.log(`   ⚠️ Could not open conversation (maybe scrolled too far). Trying to find it...`);
        // Retry logic: try to scroll up/down to find it? 
        // For now, simpler to just skip or log error.
        skippedCount++;
        continue;
      }
      
      const username = await extractUsernameFromConversation(workingPage);
      if (!username) {
        console.log(`   ⚠️ Could not extract username, skipping`);
        skippedCount++;
        continue;
      }
      console.log(`   👤 Username: @${username}`);
      
      const leadContext = await getLeadWithContext(username);
      if (!leadContext) {
        console.log(`   ⏭️ Not in our lead database, skipping`);
        skippedCount++;
        continue;
      }
      
      const validStatuses = ['conversation', 'outreach', 'contacted'];
      if (!validStatuses.includes(leadContext.status)) {
        console.log(`   ⏭️ Status '${leadContext.status}' not in target list, skipping`);
        skippedCount++;
        continue;
      }
      
      console.log(`   📖 Scraping conversation...`);
      const scrapedMessages = await scrapeConversationMessages(workingPage);
      
      const existingHistory = await getConversationHistory(username);
      const newMessages = findNewMessages(scrapedMessages, existingHistory);
      
      let updatedHistory = [...existingHistory];
      if (newMessages.length > 0) {
        console.log(`   💾 Saving ${newMessages.length} new message(s) to DB`);
        for (const msg of newMessages) {
          await addMessage(username, msg.role, msg.text);
          updatedHistory.push(msg);
        }
      }
      
      const lastMsg = updatedHistory.length > 0 ? updatedHistory[updatedHistory.length - 1] : null;
      if (!lastMsg || lastMsg.role !== 'user') {
        console.log(`   ⏳ Waiting for user reply (last msg was ${lastMsg?.role || 'none'})`);
        continue;
      }
      
      console.log(`   🤖 Generating response...`);
      const response = await generateResponse({
        conversationHistory: updatedHistory,
        leadContext,
        profileConfig
      });
      
      const message = response.next_message || response.message;
      if (!message) {
        console.log(`   ⚠️ No message generated`);
        continue;
      }
      
      console.log(`   💬 Suggested: "${message.substring(0, 50)}..."`);
      
      let finalMessage = message;
      if (finalMessage.includes('[ALERT_BOOKING]')) {
        console.log(`   🚨 BOOKING ALERT DETECTED!`);
        finalMessage = finalMessage.replace('[ALERT_BOOKING]', '').trim();
        await setDmThreadStatus(username, 'scheduling', { booking_status: 'pending' });
      }
      
      const typeResult = await typeInOpenTab(workingPage, finalMessage);
      if (!typeResult.success) {
        console.log(`   ❌ Failed to type: ${typeResult.error}`);
        continue;
      }
      
      await addMessage(username, 'assistant', finalMessage, response.message_type || 'generated');
      await setDmThreadStatus(username, 'conversation', { last_checked_at: new Date().toISOString() });
      
      console.log(`   ✅ Message typed!`);
      processedCount++;
      registerOpenTab(username, workingPage, finalMessage);
      
      await delay(CONFIG.DELAYS.BETWEEN_CONVERSATIONS);
    }
    
    if (getOpenMessageTabs().length > 0) {
      await waitForUserToFinish();
    }
    
  } catch (error) {
    console.error(`\n❌ Fatal error: ${error.message}`);
    if (process.env.DEBUG === 'true') {
      console.error(error.stack);
    }
  } finally {
    await closeBrowser();
  }
  
  console.log(`\n========================================`);
  console.log(`   INBOX SCAN COMPLETE`);
  console.log(`   Processed: ${processedCount} | Skipped: ${skippedCount}`);
  console.log(`========================================\n`);
}

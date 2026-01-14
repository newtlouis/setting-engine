/**
 * @file Inbox Scanner for DM Responder
 * 
 * Scans the Instagram inbox directly to find and process unread conversations.
 * Uses a "Process-as-you-Scroll" approach:
 * 1. Scan visible unread conversations
 * 2. Process them immediately (Click -> Respond) before they scroll out of view
 * 3. Scroll down
 * 4. Repeat
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
  MAX_SCROLLS: 15,
  DELAYS: {
    AFTER_NAVIGATION: 3500,
    AFTER_CLICK: 2500,
    AFTER_SCROLL: 1500,
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
      
      // Check for "Unread" text
      const allSpans = button.querySelectorAll('span');
      for (const span of allSpans) {
        const text = span.textContent || '';
        if (text === 'Unread' || text.includes('Unread')) {
          isUnread = true;
          break;
        }
      }
      
      // Check for blue dot
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
          button.scrollIntoView({ block: 'center', behavior: 'instant' }); 
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
  console.log(`   Strategy: Process-as-you-Scroll`);
  
  let browser = null;
  let workingPage = null;
  let processedCount = 0;
  let skippedCount = 0;
  
  // Keep track of processed conversation names to avoid infinite duplicates
  const processedNames = new Set();
  
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
    
    // --- MAIN LOOP: SCAN -> PROCESS -> SCROLL ---
    
    for (let scrollIdx = 0; scrollIdx <= CONFIG.MAX_SCROLLS; scrollIdx++) {
      console.log(`\n   📜 Round ${scrollIdx + 1}: Scanning visible conversations...`);
      
      const visible = await getVisibleConversations(workingPage);
      console.log(`      Found ${visible.length} visible items.`);
      
      // Filter for actionable items: Unread AND Not Processed
      const actionable = visible.filter(c => c.isUnread && !processedNames.has(c.name));
      
      if (actionable.length > 0) {
        console.log(`      Found ${actionable.length} NEW unread conversation(s). Processing immediately...`);
        
        for (const conv of actionable) {
          console.log(`\n   --- Processing: ${conv.name} ---`);
          processedNames.add(conv.name); // Mark as processed
          
          // 1. Click (it is visible now)
          const clicked = await clickConversationByName(workingPage, conv.name);
          if (!clicked) {
            console.log(`   ⚠️ Could not click conversation. Skipping.`);
            skippedCount++;
            continue;
          }
          
          // 2. Extract Username
          const username = await extractUsernameFromConversation(workingPage);
          if (!username) {
            console.log(`   ⚠️ Could not extract username.`);
            skippedCount++;
            continue;
          }
          console.log(`   👤 Username: @${username}`);
          
          // 3. Database Check
          const leadContext = await getLeadWithContext(username);
          if (!leadContext) {
            console.log(`   ⏭️ Not in DB, skipping.`);
            skippedCount++;
            continue;
          }
          
          const validStatuses = ['conversation', 'outreach', 'contacted'];
          if (!validStatuses.includes(leadContext.status)) {
            console.log(`   ⏭️ Status '${leadContext.status}' invalid, skipping.`);
            skippedCount++;
            continue;
          }
          
          // 4. Scrape & Process
          console.log(`   📖 Scraping...`);
          const scrapedMessages = await scrapeConversationMessages(workingPage);
          
          const existingHistory = await getConversationHistory(username);
          const newMessages = findNewMessages(scrapedMessages, existingHistory);
          
          let updatedHistory = [...existingHistory];
          if (newMessages.length > 0) {
            console.log(`   💾 Saving ${newMessages.length} new message(s)`);
            for (const msg of newMessages) {
              await addMessage(username, msg.role, msg.text);
              updatedHistory.push(msg);
            }
          }
          
          // 5. Check if response needed
          const lastMsg = updatedHistory.length > 0 ? updatedHistory[updatedHistory.length - 1] : null;
          if (!lastMsg || lastMsg.role !== 'user') {
            console.log(`   ⏳ Last message was not from user.`);
            continue;
          }
          
          // 6. Generate Response
          console.log(`   🤖 Generating response...`);
          const response = await generateResponse({
            conversationHistory: updatedHistory,
            leadContext,
            profileConfig
          });
          
          const message = response.next_message || response.message;
          if (!message) {
            console.log(`   ⚠️ No message generated.`);
            continue;
          }
          
          console.log(`   💬 Suggested: "${message.substring(0, 50)}..."`);
          
          // 7. Booking Alert
          let finalMessage = message;
          if (finalMessage.includes('[ALERT_BOOKING]')) {
            console.log(`   🚨 BOOKING ALERT!`);
            finalMessage = finalMessage.replace('[ALERT_BOOKING]', '').trim();
            await setDmThreadStatus(username, 'scheduling', { booking_status: 'pending' });
          }
          
          // 8. Type Message
          const typeResult = await typeInOpenTab(workingPage, finalMessage);
          if (typeResult.success) {
             await addMessage(username, 'assistant', finalMessage, response.message_type || 'generated');
            await setDmThreadStatus(username, 'conversation', { last_checked_at: new Date().toISOString() });
            console.log(`   ✅ Message typed!`);
            processedCount++;
            
            // Register tab for final manual review
            registerOpenTab(username, workingPage, finalMessage);
          } else {
            console.log(`   ❌ Failed to type.`);
          }
          
          // Small delay before next item
          await delay(CONFIG.DELAYS.BETWEEN_CONVERSATIONS);
        }
        
      } else {
        console.log(`      No new unread items in this view.`);
      }
      
      // Scroll for next round
      if (scrollIdx < CONFIG.MAX_SCROLLS) {
        await scrollSidebarOnce(workingPage);
        await delay(CONFIG.DELAYS.AFTER_SCROLL);
      }
    }
    
    // --- FINISH ---
    
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
  console.log(`   Unique names processed: ${processedNames.size}`);
  console.log(`   Actionable processed: ${processedCount}`);
  console.log(`========================================\n`);
}

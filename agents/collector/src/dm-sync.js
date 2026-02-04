/**
 * DM Sync Module
 *
 * Synchronizes actual Instagram DM conversations with the database.
 * This enables the feedback loop by capturing:
 * 1. Real messages sent (vs AI suggestions)
 * 2. User modifications to AI-generated messages
 * 3. Successful conversation patterns from converted leads
 */

import { getDb } from './db/core.js';
import { getConversation, addConversationMessage } from './db/conversations.js';
import { delay } from '../../../shared/browser/interactions.js';

// Selectors for Instagram DM interface (updated for 2024/2025 Instagram)
const SELECTORS = {
  // Inbox - multiple possible selectors
  inboxContainer: 'div[aria-label="Inbox"], div[role="list"], section > div > div > div',
  conversationItem: 'div[role="button"], a[href*="/direct/t/"]',

  // Search in DM
  searchInput: 'input[placeholder*="Search"], input[placeholder*="Rechercher"], input[name="queryBox"]',

  // Conversation thread
  messageContainer: 'div[role="row"], div[class*="x9f619"]',
  messageText: 'div[dir="auto"], span[dir="auto"]',

  // General
  anyLink: 'a[href*="/direct/"]'
};

/**
 * Get leads that should be synced (high-value conversations)
 * @param {number} accountId
 * @returns {Array} Leads to sync
 */
export function getLeadsToSync(accountId) {
  const db = getDb();

  return db.prepare(`
    SELECT l.*,
           (SELECT COUNT(*) FROM conversations WHERE lead_id = l.id) as db_message_count
    FROM leads l
    WHERE l.account_id = ?
      AND l.is_ignored = 0
      AND (
        l.funnel_step >= 5
        OR l.booking_status IS NOT NULL
      )
    ORDER BY
      CASE WHEN l.booking_status = 'completed' THEN 1
           WHEN l.booking_status = 'pending' THEN 2
           ELSE 3 END,
      l.funnel_step DESC,
      l.updated_at DESC
    LIMIT 50
  `).all(accountId);
}

/**
 * Navigate to Instagram DM inbox
 * @param {Page} page - Playwright page
 */
async function navigateToInbox(page) {
  console.log('📬 Navigating to DM inbox...');

  await page.goto('https://www.instagram.com/direct/inbox/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  await delay(4000, 5000);

  // Wait for any DM-related element to appear
  const loaded = await Promise.race([
    page.waitForSelector('a[href*="/direct/t/"]', { timeout: 15000 }).then(() => 'conversations'),
    page.waitForSelector('div[role="list"]', { timeout: 15000 }).then(() => 'list'),
    page.waitForSelector('input[placeholder*="earch"]', { timeout: 15000 }).then(() => 'search'),
    page.waitForSelector('svg[aria-label*="Direct"]', { timeout: 15000 }).then(() => 'icon'),
    delay(15000).then(() => false)
  ]);

  if (!loaded) {
    console.log('⚠️ Inbox elements not detected, taking screenshot...');
    await page.screenshot({ path: '/tmp/dm-sync-inbox-debug.png' });
    console.log('   Screenshot saved to /tmp/dm-sync-inbox-debug.png');
  } else {
    console.log(`   ✅ Inbox loaded (detected: ${loaded})`);
  }
}

/**
 * Search for a specific user in DM inbox
 * @param {Page} page
 * @param {string} username
 * @returns {boolean} True if conversation found and opened
 */
async function openConversation(page, username) {
  console.log(`   🔍 Searching for @${username}...`);

  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`   🔄 Retry attempt ${attempt}/${maxRetries}...`);
        await delay(1000, 2000);
      }

      // Method 1: Use page.fill() directly with selector (more stable than getting element handle)
      const searchSelectors = [
        'input[placeholder*="Rechercher"]',
        'input[placeholder*="Search"]',
        'input[name="queryBox"]'
      ];

      let searchWorked = false;
      for (const selector of searchSelectors) {
        try {
          // Wait for the input to be visible and stable
          await page.waitForSelector(selector, { state: 'visible', timeout: 5000 });
          await delay(500, 800);

          // Click to focus, then use page.fill which is more robust
          await page.click(selector);
          await delay(300, 500);

          // Clear and type using page methods (not element handle)
          await page.fill(selector, '');
          await delay(200, 300);
          await page.type(selector, username, { delay: 80 });

          console.log(`   📝 Typed "${username}" in search (${selector})`);
          searchWorked = true;
          break;
        } catch (e) {
          // Try next selector
          continue;
        }
      }

      if (!searchWorked) {
        console.log(`   ⚠️ Could not find/use search input`);
        continue; // Retry
      }

      await delay(2000, 2500);

      // Look for search result with username
      const resultSelectors = [
        `div[role="button"]:has-text("${username}")`,
        `a:has-text("${username}")`,
        `span:has-text("${username}")`
      ];

      for (const selector of resultSelectors) {
        try {
          const result = await page.$(selector);
          if (result) {
            // Verify it's visible
            const isVisible = await result.isVisible();
            if (!isVisible) continue;

            console.log(`   ✅ Found result with: ${selector}`);
            await result.click();
            await delay(2500, 3500);

            // Verify we're in a conversation
            const url = page.url();
            if (url.includes('/direct/t/')) {
              console.log(`   ✅ Conversation opened: ${url}`);
              return true;
            }
          }
        } catch (e) {
          continue;
        }
      }

      // Method 2: Scroll through visible conversations
      console.log(`   🔄 Trying to find in conversation list...`);

      // First clear the search to show all conversations
      try {
        const searchInput = await page.$('input[placeholder*="Rechercher"], input[placeholder*="Search"]');
        if (searchInput) {
          await searchInput.fill('');
          await delay(1000, 1500);
        }
      } catch (e) {}

      const conversations = await page.$$('a[href*="/direct/t/"]');
      console.log(`   📋 Found ${conversations.length} conversation links`);

      for (const conv of conversations.slice(0, 30)) {
        try {
          const text = await conv.textContent();
          if (text && text.toLowerCase().includes(username.toLowerCase())) {
            console.log(`   ✅ Found @${username} in conversation list`);
            await conv.click();
            await delay(2500, 3500);

            const url = page.url();
            if (url.includes('/direct/t/')) {
              console.log(`   ✅ Conversation opened: ${url}`);
              return true;
            }
          }
        } catch (e) {
          continue;
        }
      }

    } catch (error) {
      console.log(`   ⚠️ Attempt ${attempt} error: ${error.message}`);
      if (attempt === maxRetries) {
        console.error(`   ❌ Failed after ${maxRetries} attempts`);
        await page.screenshot({ path: `/tmp/dm-sync-error-${username}.png` });
      }
    }
  }

  console.log(`   ❌ Conversation with @${username} not found`);
  return false;
}

/**
 * Extract messages from the currently open conversation
 * @param {Page} page
 * @returns {Array<{role: string, text: string, timestamp?: string}>}
 */
async function extractMessages(page) {
  console.log('   📝 Extracting messages...');

  const messages = [];

  try {
    // Scroll to load all messages (scroll up to get older messages)
    await page.evaluate(() => {
      const container = document.querySelector('div[role="grid"]') ||
                       document.querySelector('main');
      if (container) {
        container.scrollTop = 0;
      }
    });
    await delay(1000, 1500);

    // Get all message rows
    // Instagram DM structure: messages are in divs with role="row" or similar
    const messageElements = await page.$$('div[role="row"], div[class*="message"]');

    for (const el of messageElements) {
      try {
        // Get the message text
        const textEl = await el.$('div[dir="auto"], span[dir="auto"]');
        if (!textEl) continue;

        const text = await textEl.textContent();
        if (!text || text.trim().length === 0) continue;

        // Determine if this is our message or theirs
        // Instagram typically aligns own messages to the right
        const style = await el.evaluate(node => {
          // Check computed styles or class names
          const computedStyle = window.getComputedStyle(node);
          const classes = node.className || '';
          const parentClasses = node.parentElement?.className || '';

          return {
            justifyContent: computedStyle.justifyContent,
            alignSelf: computedStyle.alignSelf,
            classes: classes + ' ' + parentClasses
          };
        });

        // Heuristic: own messages usually have 'flex-end' or similar
        const isOwnMessage =
          style.justifyContent?.includes('end') ||
          style.alignSelf?.includes('end') ||
          style.classes?.includes('_acqt') || // Instagram-specific class for sent messages
          style.classes?.includes('outgoing');

        messages.push({
          role: isOwnMessage ? 'assistant' : 'user',
          text: text.trim()
        });

      } catch (e) {
        // Skip problematic elements
        continue;
      }
    }

  } catch (error) {
    console.error(`   ❌ Error extracting messages: ${error.message}`);
  }

  console.log(`   📊 Found ${messages.length} messages`);
  return messages;
}

/**
 * Alternative extraction method using a more robust approach
 * @param {Page} page
 * @param {boolean} debug - If true, log detailed info about each message
 * @returns {Array<{role: string, text: string}>}
 */
async function extractMessagesRobust(page, debug = false) {
  console.log('   📝 Extracting messages (robust method)...');

  // First, scroll to load all messages
  await page.evaluate(() => {
    const scrollable = document.querySelector('div[role="grid"]') ||
                       document.querySelector('section > div > div > div > div > div');
    if (scrollable) {
      scrollable.scrollTop = 0; // Scroll to top to load older messages
    }
  });
  await delay(1000, 1500);

  const messages = await page.evaluate((debugMode) => {
    const result = [];
    const debugInfo = [];

    // Get the main conversation container
    const mainSection = document.querySelector('section main') || document.querySelector('main');
    if (!mainSection) {
      debugInfo.push('No main section found');
      return { messages: result, debug: debugInfo };
    }

    // Find all message groups - Instagram groups messages by sender
    // Each group typically has a consistent alignment
    const allDivs = mainSection.querySelectorAll('div[dir="auto"]');

    allDivs.forEach((el, idx) => {
      const text = el.textContent?.trim();
      if (!text || text.length < 2) return;

      // Skip UI elements
      if (el.closest('button')) return;
      if (el.closest('nav')) return;
      if (el.closest('header')) return;
      if (el.closest('form')) return; // Skip input area
      if (el.closest('textarea')) return;

      // Skip if it looks like a timestamp or date
      if (text.match(/^\d{1,2}:\d{2}$/) || text.match(/^(lun|mar|mer|jeu|ven|sam|dim)/i)) return;
      if (text.match(/^(aujourd|hier|il y a)/i)) return;

      // Find the message container (bubble)
      let container = el;
      for (let i = 0; i < 10; i++) {
        container = container.parentElement;
        if (!container) break;

        // Look for row-like containers
        if (container.getAttribute('role') === 'row') break;
        if (container.className?.includes('x1n2onr6')) break;
      }

      if (!container) return;

      // Get positioning info
      const rect = el.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      // Find the conversation area bounds
      const conversationArea = mainSection.querySelector('div[role="grid"]') || mainSection;
      const areaRect = conversationArea.getBoundingClientRect();

      // Calculate relative position
      const relativeLeft = rect.left - areaRect.left;
      const areaWidth = areaRect.width;
      const positionRatio = relativeLeft / areaWidth;

      // Heuristics for detecting "our" messages (sent by account owner):
      // Position ratio is the most reliable: > 0.45 means right side (our messages)
      const isRightAligned = positionRatio > 0.45;

      // Determine role based on position
      const role = isRightAligned ? 'assistant' : 'user';

      if (debugMode) {
        debugInfo.push({
          text: text.substring(0, 40),
          positionRatio: positionRatio.toFixed(2),
          isRightAligned,
          role
        });
      }

      result.push({
        role,
        text,
        _debug: {
          positionRatio
        }
      });
    });

    return { messages: result, debug: debugInfo };
  }, debug);

  if (debug && messages.debug?.length > 0) {
    console.log('   🔍 Debug info:');
    messages.debug.slice(0, 10).forEach(d => {
      const icon = d.role === 'assistant' ? '📤' : '📥';
      console.log(`      ${icon} [${d.role.padEnd(9)}] pos=${d.positionRatio} "${d.text}..."`);
    });
  }

  // Deduplicate
  const seen = new Set();
  const unique = messages.messages.filter(m => {
    const key = m.text.substring(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`   📊 Found ${unique.length} messages`);
  return unique;
}

/**
 * Compare scraped messages with database and detect corrections
 * @param {number} leadId
 * @param {Array} scrapedMessages
 * @returns {Object} Comparison results
 */
export function compareMessages(leadId, scrapedMessages) {
  const db = getDb();
  const dbMessages = getConversation(leadId);

  const result = {
    newMessages: [],
    corrections: [],
    matches: 0
  };

  // Get AI suggestions from conversations table
  const dbAssistantMessages = dbMessages
    .filter(m => m.role === 'assistant')
    .map(m => m.message_text);

  // Get actually sent messages from scraped data
  const scrapedAssistantMessages = scrapedMessages
    .filter(m => m.role === 'assistant')
    .map(m => m.text);

  // Compare each scraped message
  for (const scraped of scrapedAssistantMessages) {
    // Check if this exact message exists in DB
    const exactMatch = dbAssistantMessages.find(db =>
      normalizeMessage(db) === normalizeMessage(scraped)
    );

    if (exactMatch) {
      result.matches++;
      continue;
    }

    // Check for similar messages (potential correction)
    const similarMatch = dbAssistantMessages.find(db =>
      calculateSimilarity(db, scraped) > 0.5
    );

    if (similarMatch) {
      // This is likely a corrected message
      result.corrections.push({
        ai_suggested: similarMatch,
        actually_sent: scraped,
        similarity: calculateSimilarity(similarMatch, scraped)
      });
    } else {
      // New message not in DB (might be manually typed)
      result.newMessages.push({
        role: 'assistant',
        text: scraped
      });
    }
  }

  // Also capture any new user messages
  const dbUserMessages = dbMessages
    .filter(m => m.role === 'user')
    .map(m => m.message_text);

  const scrapedUserMessages = scrapedMessages
    .filter(m => m.role === 'user')
    .map(m => m.text);

  for (const scraped of scrapedUserMessages) {
    const exists = dbUserMessages.some(db =>
      normalizeMessage(db) === normalizeMessage(scraped)
    );

    if (!exists) {
      result.newMessages.push({
        role: 'user',
        text: scraped
      });
    }
  }

  return result;
}

/**
 * Normalize a message for comparison
 */
function normalizeMessage(text) {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
}

/**
 * Calculate similarity between two strings (simple word overlap)
 */
function calculateSimilarity(str1, str2) {
  const words1 = new Set(normalizeMessage(str1).split(' '));
  const words2 = new Set(normalizeMessage(str2).split(' '));

  const intersection = [...words1].filter(w => words2.has(w));
  const union = new Set([...words1, ...words2]);

  return intersection.length / union.size;
}

/**
 * Save corrections to database
 * @param {number} leadId
 * @param {Array} corrections
 */
export function saveCorrections(leadId, corrections) {
  const db = getDb();

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO message_corrections
    (lead_id, ai_suggested, actually_sent, was_modified, modification_type)
    VALUES (?, ?, ?, 1, ?)
  `);

  for (const correction of corrections) {
    const modificationType = correction.similarity > 0.7 ? 'edited' : 'rewritten';
    stmt.run(leadId, correction.ai_suggested, correction.actually_sent, modificationType);
  }
}

/**
 * Save new messages to database
 * @param {number} leadId
 * @param {Array} newMessages
 */
export function saveNewMessages(leadId, newMessages) {
  for (const msg of newMessages) {
    addConversationMessage(leadId, msg.role, msg.text, 'synced');
  }
}

/**
 * Update lead's last sync timestamp
 * @param {number} leadId
 */
export function updateSyncTimestamp(leadId) {
  const db = getDb();
  db.prepare(`
    UPDATE leads SET last_dm_sync_at = datetime('now') WHERE id = ?
  `).run(leadId);
}

/**
 * Main sync function - synchronize DMs for high-value leads
 * @param {BrowserSession} session - Browser session
 * @param {number} accountId - Account to sync
 * @param {Object} options - Sync options
 */
export async function syncDMs(session, accountId, options = {}) {
  const { maxLeads = 20, skipRecent = true } = options;

  console.log('\n' + '='.repeat(50));
  console.log('🔄 DM SYNC - Synchronizing conversations');
  console.log('='.repeat(50));

  const page = session.getWorkingPage();

  // Get leads to sync
  let leads = getLeadsToSync(accountId);

  // Optionally skip recently synced
  if (skipRecent) {
    const db = getDb();
    leads = leads.filter(l => {
      if (!l.last_dm_sync_at) return true;
      const lastSync = new Date(l.last_dm_sync_at);
      const hoursSince = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60);
      return hoursSince > 24; // Only sync if not synced in last 24h
    });
  }

  leads = leads.slice(0, maxLeads);

  console.log(`\n📋 Found ${leads.length} leads to sync:`);
  leads.forEach(l => {
    console.log(`   - @${l.username} (Step ${l.funnel_step}, Booking: ${l.booking_status || 'none'})`);
  });

  if (leads.length === 0) {
    console.log('\n✅ No leads need syncing');
    return { synced: 0, corrections: 0, newMessages: 0 };
  }

  // Navigate to inbox
  await navigateToInbox(page);

  const stats = {
    synced: 0,
    corrections: 0,
    newMessages: 0,
    errors: 0
  };

  // Process each lead
  for (const lead of leads) {
    console.log(`\n--- Syncing @${lead.username} ---`);

    try {
      // Open the conversation
      const found = await openConversation(page, lead.username);

      if (!found) {
        console.log(`   ⏭️ Skipping - conversation not found`);
        stats.errors++;
        continue;
      }

      // Extract messages with debug enabled
      let messages = await extractMessagesRobust(page, true);

      if (messages.length === 0) {
        // Try alternative method
        messages = await extractMessages(page);
      }

      if (messages.length === 0) {
        console.log(`   ⚠️ No messages extracted`);
        stats.errors++;
        continue;
      }

      // Compare with database
      const comparison = compareMessages(lead.id, messages);

      console.log(`   📊 Results: ${comparison.matches} matches, ${comparison.corrections.length} corrections, ${comparison.newMessages.length} new`);

      // Save corrections
      if (comparison.corrections.length > 0) {
        saveCorrections(lead.id, comparison.corrections);
        stats.corrections += comparison.corrections.length;

        console.log('   📝 Corrections detected:');
        comparison.corrections.forEach(c => {
          console.log(`      AI: "${c.ai_suggested.substring(0, 40)}..."`);
          console.log(`      Sent: "${c.actually_sent.substring(0, 40)}..."`);
        });
      }

      // Save new messages
      if (comparison.newMessages.length > 0) {
        saveNewMessages(lead.id, comparison.newMessages);
        stats.newMessages += comparison.newMessages.length;
      }

      // Update sync timestamp
      updateSyncTimestamp(lead.id);
      stats.synced++;

      // Delay between conversations
      await delay(2000, 4000);

      // Go back to inbox for next conversation
      await navigateToInbox(page);

    } catch (error) {
      console.error(`   ❌ Error syncing @${lead.username}: ${error.message}`);
      stats.errors++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 SYNC COMPLETE');
  console.log('='.repeat(50));
  console.log(`   ✅ Synced: ${stats.synced} conversations`);
  console.log(`   📝 Corrections found: ${stats.corrections}`);
  console.log(`   💬 New messages: ${stats.newMessages}`);
  console.log(`   ❌ Errors: ${stats.errors}`);

  return stats;
}

/**
 * Get correction statistics for analysis
 * @param {number} accountId
 * @returns {Object} Correction stats
 */
export function getCorrectionStats(accountId) {
  const db = getDb();

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_corrections,
      SUM(CASE WHEN modification_type = 'edited' THEN 1 ELSE 0 END) as edited,
      SUM(CASE WHEN modification_type = 'rewritten' THEN 1 ELSE 0 END) as rewritten
    FROM message_corrections mc
    JOIN leads l ON mc.lead_id = l.id
    WHERE l.account_id = ?
  `).get(accountId);

  const recentCorrections = db.prepare(`
    SELECT mc.*, l.username
    FROM message_corrections mc
    JOIN leads l ON mc.lead_id = l.id
    WHERE l.account_id = ?
    ORDER BY mc.synced_at DESC
    LIMIT 20
  `).all(accountId);

  return {
    ...stats,
    recentCorrections
  };
}

export default {
  syncDMs,
  getLeadsToSync,
  compareMessages,
  getCorrectionStats
};

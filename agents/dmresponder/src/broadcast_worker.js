/**
 * Broadcast Worker
 *
 * Sends a campaign message to followers in batches.
 * Tracks which followers have already received each campaign to avoid duplicates.
 */

import { getDb } from '../../../agents/collector/src/db/core.js';
import { initBrowser, closeBrowser, goToProfileAndOpenDM, createNewTab } from './scraper.js';
import { initDB, getOrCreateAccount } from './db_integration.js';
import { getContainer } from '../../../shared/container.js';
import { typeFast, delay as browserDelay } from '../../../shared/browser/index.js';
import { MESSAGE_INPUT } from '../../../shared/config/selectors.js';

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Find the message input in a DM tab
 */
async function findMessageInput(page) {
  for (const selector of MESSAGE_INPUT) {
    const input = await page.$(selector).catch(() => null);
    if (input) {
      const isVisible = await input.isVisible().catch(() => false);
      if (isVisible) return input;
    }
  }
  return null;
}

/**
 * Paste message lines and send with Enter (no letter-by-letter typing)
 * Splits message by newlines, pastes each line, presses Enter to send.
 */
/**
 * Split message into chunks at paragraph boundaries (\n\n) to stay under Instagram's DM char limit
 */
function splitMessage(message, maxLen = 900) {
  if (message.length <= maxLen) return [message];

  const chunks = [];
  const paragraphs = message.split('\n\n');
  let current = '';

  for (const para of paragraphs) {
    const candidate = current ? current + '\n\n' + para : para;
    if (candidate.length > maxLen && current) {
      chunks.push(current);
      current = para;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function pasteAndSend(tab, message) {
  // Wait a moment for conversation to settle, then check if input is ready
  await delay(2000);

  const input = await findMessageInput(tab);
  if (!input) {
    console.log(`   ⏳ Waiting for message input...`);
    await delay(5000);
    const retryInput = await findMessageInput(tab);
    if (!retryInput) {
      return { success: false, error: 'message_input_not_found' };
    }
    await retryInput.click();
    await delay(500);
  } else {
    await input.click();
    await delay(500);
  }

  // Split long messages into chunks to avoid Instagram's character limit
  const chunks = splitMessage(message);

  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) {
      // Re-focus input for next chunk
      const nextInput = await findMessageInput(tab);
      if (nextInput) {
        await nextInput.click();
        await delay(500);
      }
    }
    await typeFast(tab, chunks[i]);
    await delay(300);
    await tab.keyboard.press('Enter');
    if (i < chunks.length - 1) {
      await delay(1500); // wait between messages
    }
  }

  return { success: true };
}

/**
 * Run the broadcast pipeline
 * @param {Object} options
 * @param {string} options.profile - Account profile name
 * @param {number} options.campaignId - Campaign ID to send
 * @param {number} options.batch - Number of DMs to send in this batch
 */
export async function runBroadcast({ profile, campaignId, batch = 20 }) {
  // Init DB
  await initDB();
  const container = await getContainer();
  const db = getDb();

  const account = await getOrCreateAccount(profile);
  const accountId = account.id;

  // Load campaign
  const campaign = db.prepare('SELECT * FROM broadcast_campaigns WHERE id = ? AND account_id = ?').get(campaignId, accountId);
  if (!campaign) {
    throw new Error(`Campaign #${campaignId} not found for profile "${profile}"`);
  }
  if (campaign.status !== 'active') {
    throw new Error(`Campaign #${campaignId} is "${campaign.status}", not active`);
  }

  console.log(`\n📢 BROADCAST`);
  console.log(`================================`);
  console.log(`   Profile: ${profile}`);
  console.log(`   Campaign #${campaignId}`);
  console.log(`   Message: "${campaign.message_text.substring(0, 60)}..."`);
  console.log(`   Batch size: ${batch}`);
  console.log('');

  // Init browser
  console.log('🌐 Initializing browser...');
  const { page } = await initBrowser({ profile, purpose: 'broadcast', headless: false });

  try {
    const totalFollowers = db.prepare('SELECT COUNT(*) as c FROM account_followers WHERE account_id = ?').get(accountId).c;
    const contactable = db.prepare('SELECT COUNT(*) as c FROM account_followers WHERE account_id = ? AND contactable != 0').get(accountId).c;
    const notContactable = db.prepare('SELECT COUNT(*) as c FROM account_followers WHERE account_id = ? AND contactable = 0').get(accountId).c;
    const alreadySent = db.prepare("SELECT COUNT(*) as c FROM broadcast_sends WHERE campaign_id = ? AND status = 'sent'").get(campaignId).c;
    const remainingTotal = db.prepare(`
      SELECT COUNT(*) as c FROM account_followers af
      WHERE af.account_id = ? AND (af.contactable IS NULL OR af.contactable != 0)
        AND af.username NOT IN (
          SELECT bs.follower_username FROM broadcast_sends bs WHERE bs.campaign_id = ? AND bs.status = 'sent'
        )
    `).get(accountId, campaignId).c;

    console.log(`📊 Followers: ${totalFollowers} total, ${notContactable} not contactable, ${alreadySent} already sent, ${remainingTotal} remaining`);
    console.log(`🎯 Target: ${batch} successful sends\n`);

    if (remainingTotal === 0) {
      console.log('✅ All followers have been successfully contacted for this campaign.');
      db.prepare("UPDATE broadcast_campaigns SET status = 'completed' WHERE id = ?").run(campaignId);
      console.log('🏁 Campaign marked as completed.');
      return;
    }

    // Send messages — keep going until we reach `batch` successful sends or run out of followers
    let sentCount = 0;
    let failedCount = 0;
    let offset = 0;
    const CHUNK_SIZE = 50; // fetch followers in chunks

    while (sentCount < batch) {
      // Fetch next chunk of untouched followers
      const followers = db.prepare(`
        SELECT af.username
        FROM account_followers af
        WHERE af.account_id = ?
          AND (af.contactable IS NULL OR af.contactable != 0)
          AND af.username NOT IN (
            SELECT bs.follower_username FROM broadcast_sends bs WHERE bs.campaign_id = ? AND bs.status = 'sent'
          )
        ORDER BY af.id
        LIMIT ?
      `).all(accountId, campaignId, CHUNK_SIZE);

      if (followers.length === 0) {
        console.log('\n⚠️ No more followers to try.');
        break;
      }

      for (const follower of followers) {
        if (sentCount >= batch) break;

        console.log(`\n--- Sent ${sentCount}/${batch} | @${follower.username} ---`);

        try {
          // Reuse the same page — just navigate to the next profile
          const profileUrl = `https://www.instagram.com/${follower.username}/`;
          const openResult = await goToProfileAndOpenDM(page, profileUrl);

          if (!openResult.success) {
            console.log(`   ⏭️ Skipped (no DM button): ${openResult.error}`);
            // Mark follower as not contactable so we skip them in future batches
            db.prepare("UPDATE account_followers SET contactable = 0 WHERE account_id = ? AND username = ?").run(accountId, follower.username);
            failedCount++;
            continue;
          }

          // Paste each line and press Enter to send immediately
          const sendResult = await pasteAndSend(page, campaign.message_text);
          if (sendResult.success) {
            db.prepare("INSERT OR REPLACE INTO broadcast_sends (campaign_id, follower_username, status, sent_at) VALUES (?, ?, 'sent', datetime('now'))").run(campaignId, follower.username);
            db.prepare("UPDATE account_followers SET contactable = 1 WHERE account_id = ? AND username = ?").run(accountId, follower.username);
            sentCount++;
            console.log(`   ✅ Message sent to @${follower.username} (${sentCount}/${batch})`);
          } else {
            console.log(`   ⏭️ Failed to send: ${sendResult.error}`);
            db.prepare("INSERT OR REPLACE INTO broadcast_sends (campaign_id, follower_username, status, error) VALUES (?, ?, 'skipped', ?)").run(campaignId, follower.username, sendResult.error);
            failedCount++;
          }

        } catch (err) {
          console.log(`   ❌ Error: ${err.message}`);
          db.prepare("INSERT OR REPLACE INTO broadcast_sends (campaign_id, follower_username, status, error) VALUES (?, ?, 'skipped', ?)").run(campaignId, follower.username, err.message);
          failedCount++;
        }
      }
    }

    const newAlreadySent = db.prepare("SELECT COUNT(*) as c FROM broadcast_sends WHERE campaign_id = ? AND status = 'sent'").get(campaignId).c;

    console.log(`\n================================`);
    console.log(`📊 BATCH RESULTS`);
    console.log(`   ✅ Sent: ${sentCount}`);
    console.log(`   ⏭️ Skipped: ${failedCount}`);
    console.log(`   Total sent for campaign: ${newAlreadySent}`);
    console.log(`   Remaining followers: ${totalFollowers - newAlreadySent - failedCount}`);
    console.log('');

    console.log('✅ Batch complete.\n');

  } finally {
    await closeBrowser();
  }
}

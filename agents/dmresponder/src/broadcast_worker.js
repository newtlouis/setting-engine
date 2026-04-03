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
async function pasteAndSend(tab, message) {
  // Wait a moment for conversation to settle, then check if input is ready
  await delay(2000);

  const input = await findMessageInput(tab);
  if (!input) {
    // Input not found — conversation might still be loading, wait longer
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

  // Paste the entire message and send with Enter
  await typeFast(tab, message);
  await delay(300);
  await tab.keyboard.press('Enter');

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
    const alreadySent = db.prepare('SELECT COUNT(*) as c FROM broadcast_sends WHERE campaign_id = ?').get(campaignId).c;
    const remainingTotal = db.prepare(`
      SELECT COUNT(*) as c FROM account_followers af
      WHERE af.account_id = ? AND af.username NOT IN (
        SELECT bs.follower_username FROM broadcast_sends bs WHERE bs.campaign_id = ?
      )
    `).get(accountId, campaignId).c;

    console.log(`📊 Followers: ${totalFollowers} total, ${alreadySent} already sent, ${remainingTotal} remaining`);
    console.log(`🎯 Target: ${batch} successful sends\n`);

    if (remainingTotal === 0) {
      console.log('✅ No more followers to contact for this campaign.');
      if (alreadySent >= totalFollowers) {
        db.prepare("UPDATE broadcast_campaigns SET status = 'completed' WHERE id = ?").run(campaignId);
        console.log('🏁 Campaign marked as completed.');
      }
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
          AND af.username NOT IN (
            SELECT bs.follower_username FROM broadcast_sends bs WHERE bs.campaign_id = ?
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
            db.prepare("INSERT OR REPLACE INTO broadcast_sends (campaign_id, follower_username, status, error) VALUES (?, ?, 'skipped', ?)").run(campaignId, follower.username, openResult.error);
            failedCount++;
            continue;
          }

          // Paste each line and press Enter to send immediately
          const sendResult = await pasteAndSend(page, campaign.message_text);
          if (sendResult.success) {
            db.prepare("INSERT OR REPLACE INTO broadcast_sends (campaign_id, follower_username, status, sent_at) VALUES (?, ?, 'sent', datetime('now'))").run(campaignId, follower.username);
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

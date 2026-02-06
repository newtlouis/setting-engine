#!/usr/bin/env node
/**
 * Send Queued Messages Script
 * 
 * Pulls N leads from the outreach_queue and sends their prepared messages.
 * 
 * Usage:
 *   npm run send-queued -- --limit 5 --profile melanie
 *   node scripts/send_queued.js --limit 5 --profile melanie
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { getContainer } from '../shared/container.js';
import {
  initBrowser,
  closeBrowser,
  sendDM,
  uploadFileInDM,
  goToProfileAndOpenDM,
  createNewTab,
  typeInOpenTab,
  registerOpenTab,
  waitForUserToFinish,
  goToDirectDM
} from '../agents/dmresponder/src/scraper.js';
import { fullUpsertLead, addMessage } from '../agents/dmresponder/src/db_integration.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    limit: 5,
    profile: 'melanie',
    manual: false
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      result.limit = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--profile' && args[i + 1]) {
      result.profile = args[i + 1];
      i++;
    } else if (args[i] === '--manual' || args[i] === '-m') {
      result.manual = true;
    }
  }

  return result;
}

async function main() {
  const { limit, profile, manual } = parseArgs();

  console.log('========================================');
  console.log('   SEND QUEUED MESSAGES');
  console.log('========================================');
  console.log(`   Limit: ${limit} messages`);
  console.log(`   Profile: ${profile}`);
  console.log(`   Mode: ${manual ? 'MANUAL REVIEW (Type but don\'t send)' : 'AUTOMATIC SEND'}`);
  console.log('========================================\n');

  // Initialize container
  const container = await getContainer();
  const outreachQueue = container.repositories.outreachQueue;

  const stats = await outreachQueue.getStats();
  console.log(`📊 Queue status: ${stats.pending} pending leads`);

  if (stats.pending === 0) {
    console.log('✅ Queue is empty. Nothing to send.');
    return;
  }

  // Get leads to process
  const leadsToSend = await outreachQueue.getPending(limit);
  console.log(`📩 Fetched ${leadsToSend.length} leads to process\n`);

  if (leadsToSend.length === 0) {
    console.log('✅ No pending leads found.');
    return;
  }

  // Initialize browser
  console.log('🌐 Initializing browser...');
  const browserResult = await initBrowser({
    profile,
    headless: false
  });
  const page = browserResult.page;

  const account = await container.repositories.account.getOrCreate(profile);
  let sentCount = 0;
  let failedCount = 0;

  try {
    for (const lead of leadsToSend) {
      console.log(`\n--- Processing: @${lead.username} ---`);
      console.log(`   Source: ${lead.source}`);
      console.log(`   Message: "${lead.preparedMessage.substring(0, 50)}..."`);

      try {
        // Determine page to use (Current or New Tab for manual)
        const currentPage = manual ? await createNewTab() : page;
        
        // Navigate to profile and open DM
        const profileUrl = lead.profileUrl || `https://www.instagram.com/${lead.username}/`;
        
        // Use Direct DM URL if available for speed
        let openResult;
        if (lead.dmUrl && lead.dmUrl.includes('/t/')) {
            openResult = await goToDirectDM(currentPage, lead.dmUrl);
        } else {
            openResult = await goToProfileAndOpenDM(currentPage, profileUrl);
        }
        
        if (!openResult.success) {
            const error = openResult.error || 'unknown';

            // Distinguish permanent failures from retryable errors
            const permanentErrors = ['no_contact_button', 'no_contact_button_private_account', 'public_no_contact_button', 'profile_not_found', 'account_suspended'];
            const isPermanent = permanentErrors.some(e => error.includes(e));

            if (isPermanent) {
                console.log(`   ❌ Permanent failure: ${error}`);
                await outreachQueue.markFailed(lead.username, error);
                await fullUpsertLead(lead.username, account.id, {
                  status: 'failed',
                  notes: `Outreach failed: ${error}`
                });
                failedCount++;
            } else {
                // Retryable error (network, timing, click_did_not_open_dm, etc.)
                // Keep in queue as pending for next batch
                console.log(`   ⏳ Retryable error: ${error} — will retry next batch`);
                await outreachQueue.incrementRetry(lead.username, error);
            }

            if (manual && currentPage !== page) await currentPage.close().catch(() => {});
            continue;
        }

        // Send or Type DM
        let dmResult;
        if (manual) {
            dmResult = await typeInOpenTab(currentPage, lead.preparedMessage);
            // Register tab for manual review
            registerOpenTab(lead.username, currentPage, lead.preparedMessage);
        } else {
            dmResult = await sendDM(currentPage, lead.username, lead.preparedMessage);
        }

        if (dmResult.success) {
          console.log(manual ? `   ✅ Message typed for review!` : `   ✅ Message sent successfully!`);

          // Handle resource upload if present (even in manual mode it's helpful to pre-upload)
          if (lead.resourceFile) {
            console.log(`   📎 Uploading resource: ${lead.resourceFile}`);
            const uploadResult = await uploadFileInDM(currentPage, lead.resourceFile);
            if (!uploadResult.success) {
              console.log(`   ⚠️ Resource upload failed: ${uploadResult.error}`);
            }
          }

          // Mark as sent in queue
          await outreachQueue.markSent(lead.username);

          // Update lead status in main leads table
          await fullUpsertLead(lead.username, account.id, {
            status: 'contacted',
            dm_url: dmResult.dmUrl || lead.dmUrl,
            funnel_step: 1
          });

          // Record in conversation history
          await addMessage(lead.username, 'assistant', lead.preparedMessage, lead.source, account.id);

          sentCount++;
        } else {
          console.log(`   ❌ Failed to send: ${dmResult.error}`);
          await outreachQueue.markFailed(lead.username, dmResult.error);
          
          // Sync failure to main leads table
          await fullUpsertLead(lead.username, account.id, {
            status: 'failed',
            notes: `Outreach failed: ${dmResult.error}`
          });

          failedCount++;
        }

        // Delay between sends
        await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));

      } catch (err) {
        console.error(`   ❌ Error processing @${lead.username}: ${err.message}`);
        await outreachQueue.markFailed(lead.username, err.message);
        failedCount++;
      }
    }

  } finally {
    if (manual) {
        console.log(`\n👉 ${sentCount} tabs are open for your review.`);
        await waitForUserToFinish();
    }
    await closeBrowser().catch(() => {});
  }

  const finalStats = await outreachQueue.getStats();
  console.log('\n========================================');
  console.log('   SEND COMPLETE');
  console.log('========================================');
  console.log(`   Sent: ${sentCount}`);
  console.log(`   Failed: ${failedCount}`);
  console.log(`   Remaining in queue: ${finalStats.pending}`);
  console.log('========================================\n');
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});

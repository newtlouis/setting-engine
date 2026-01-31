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
import { 
  getDatabase, 
  getQueuedLeads, 
  markQueuedLeadSent, 
  markQueuedLeadFailed,
  getQueueCount 
} from '../agents/collector/src/database.js';
import { 
  initBrowser, 
  closeBrowser, 
  sendDM,
  uploadFileInDM,
  goToProfileAndOpenDM
} from '../agents/dmresponder/src/scraper.js';
import { fullUpsertLead, addMessage } from '../agents/dmresponder/src/db_integration.js';
import { getOrCreateAccount } from '../agents/collector/src/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    limit: 5,
    profile: 'melanie'
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      result.limit = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--profile' && args[i + 1]) {
      result.profile = args[i + 1];
      i++;
    }
  }

  return result;
}

async function main() {
  const { limit, profile } = parseArgs();

  console.log('========================================');
  console.log('   SEND QUEUED MESSAGES');
  console.log('========================================');
  console.log(`   Limit: ${limit} messages`);
  console.log(`   Profile: ${profile}`);
  console.log('========================================\n');

  // Initialize DB
  const dbPath = path.join(__dirname, '..', 'agents', 'collector', 'permanent-data', 'leads.db');
  await getDatabase(dbPath);

  const pendingCount = getQueueCount();
  console.log(`📊 Queue status: ${pendingCount} pending leads`);

  if (pendingCount === 0) {
    console.log('✅ Queue is empty. Nothing to send.');
    return;
  }

  // Get leads to process
  const leadsToSend = getQueuedLeads(limit);
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

  const account = getOrCreateAccount(profile);
  let sentCount = 0;
  let failedCount = 0;

  try {
    for (const lead of leadsToSend) {
      console.log(`\n--- Processing: @${lead.username} ---`);
      console.log(`   Source: ${lead.source}`);
      console.log(`   Message: "${lead.prepared_message.substring(0, 50)}..."`);

      try {
        // Navigate to profile and open DM
        const profileUrl = lead.profile_url || `https://www.instagram.com/${lead.username}/`;
        const openResult = await goToProfileAndOpenDM(page, profileUrl);
        
        if (!openResult.success) {
            console.log(`   ❌ Failed to open DM: ${openResult.error}`);
            markQueuedLeadFailed(lead.username, openResult.error);
            failedCount++;
            continue;
        }

        // Send DM
        const dmResult = await sendDM(page, lead.username, lead.prepared_message);

        if (dmResult.success) {
          console.log(`   ✅ Message sent successfully!`);

          // Handle resource upload if present
          if (lead.resource_file) {
            console.log(`   📎 Uploading resource: ${lead.resource_file}`);
            const uploadResult = await uploadFileInDM(page, lead.resource_file);
            if (!uploadResult.success) {
              console.log(`   ⚠️ Resource upload failed: ${uploadResult.error}`);
            }
          }

          // Mark as sent in queue
          markQueuedLeadSent(lead.username);

          // Update lead status in main leads table
          await fullUpsertLead(lead.username, account.id, {
            status: 'contacted',
            dm_url: dmResult.dmUrl || lead.dm_url,
            conversation_step: 1
          });

          // Record in conversation history
          await addMessage(lead.username, 'assistant', lead.prepared_message, lead.source, account.id);

          sentCount++;
        } else {
          console.log(`   ❌ Failed to send: ${dmResult.error}`);
          markQueuedLeadFailed(lead.username, dmResult.error);
          failedCount++;
        }

        // Delay between sends
        await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));

      } catch (err) {
        console.error(`   ❌ Error processing @${lead.username}: ${err.message}`);
        markQueuedLeadFailed(lead.username, err.message);
        failedCount++;
      }
    }

  } finally {
    await closeBrowser().catch(() => {});
  }

  console.log('\n========================================');
  console.log('   SEND COMPLETE');
  console.log('========================================');
  console.log(`   Sent: ${sentCount}`);
  console.log(`   Failed: ${failedCount}`);
  console.log(`   Remaining in queue: ${getQueueCount()}`);
  console.log('========================================\n');
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});

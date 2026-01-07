#!/usr/bin/env node

/**
 * Outreach Agent CLI
 * 
 * Send personalized first DMs to qualified leads.
 * 
 * SAFETY: Default mode is PREVIEW (no actual sending).
 */

import { Command } from 'commander';
import { 
  previewOutreach, 
  runOutreach, 
  getOutreachStats,
  getOutreachCandidates 
} from '../src/index.js';

const program = new Command();

program
  .name('outreach')
  .description('Instagram DM outreach agent - send personalized first messages')
  .version('1.0.0');

program
  .option('-m, --mode <mode>', 'Operation mode: preview, send, status', 'preview')
  .option('-l, --limit <number>', 'Number of leads to process', parseInt, 10)
  .option('-s, --status <status>', 'Target lead status (new, failed, qualified, contacted)', 'new')
  .option('-n, --niche <niche>', 'Your niche/industry for templates', 'fitness')
  .option('-t, --topic <topic>', 'Topic to reference in messages', 'their goals')
  .option('--live', 'Actually send messages (dangerous!)', false)
  .option('--browser-data <path>', 'Path to browser data directory', './browser-data')
  .option('--profile <name>', 'Browser profile name (auto-sets browser-data path)')
  .option('--min-engagement <score>', 'Minimum engagement score (uses .env default)', parseInt)
  .option('--simple', 'Send a simple greeting: "Hey [FirstName]!"', false)
  .parse();

const opts = program.opts();

async function main() {
  console.log('\n========================================');
  console.log('   INSTAGRAM OUTREACH AGENT');
  console.log('========================================\n');
  
  try {
    // Resolve Account ID if profile is provided
    let accountId = null;
    if (opts.profile) {
        process.env.IG_PROFILE = opts.profile; // Set env for consistency
        const { getOrCreateAccount, initDatabase } = await import('../../collector/src/database.js');
        await initDatabase();
        const account = getOrCreateAccount(opts.profile);
        accountId = account.id;
        console.log(`👤 Profile: ${opts.profile} (Account ID: ${accountId})`);
    } else {
        console.error('❌ Error: Profile name is required. Use --profile <name>');
        console.error('   Example: npm run send -- --profile hercule --mode preview');
        process.exit(1);
    }

    switch (opts.mode) {
      case 'preview':
        await handlePreview(accountId);
        break;
        
      case 'send':
        await handleSend(accountId);
        break;
        
      case 'status':
        await handleStatus(accountId);
        break;
        
      case 'list':
        await handleList(accountId);
        break;
        
      default:
        console.error(`Unknown mode: ${opts.mode}`);
        console.log('Available modes: preview, send, status, list');
        process.exit(1);
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('\nERROR:', error.message);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

async function handlePreview(accountId) {
  console.log('MODE: Preview (no messages will be sent)\n');
  
  await previewOutreach({
    limit: opts.limit,
    niche: opts.niche,
    topic: opts.topic,
    minEngagementScore: opts.minEngagement,
    targetStatus: opts.status,
    isSimple: opts.simple,
    accountId: accountId
  });
  
  console.log('\nTo send these messages, run:');
  console.log(`   node bin/run.js --mode send --limit ${opts.limit} --live\n`);
}

async function handleSend(accountId) {
  const dryRun = !opts.live;
  
  if (dryRun) {
    console.log('MODE: Send (DRY RUN - messages will be typed but not sent)\n');
    console.log('To actually send messages, add --live flag\n');
  } else {
    console.log('MODE: LIVE SEND\n');
    process.stdout.write('\x07'); // Beep!
  }

  const results = await runOutreach({
    limit: opts.limit,
    niche: opts.niche,
    topic: opts.topic,
    dryRun,
    userDataDir: opts.browserData,
    minEngagementScore: opts.minEngagement,
    targetStatus: opts.status,
    isSimple: opts.simple,
    profile: opts.profile
  });
  
  console.log('\n--- Results ---');
  console.log(`Attempted: ${results.attempted || 0}`);
  console.log(`Successful: ${results.successful || 0}`);
  console.log(`Failed: ${results.failed || 0}`);
  
  if (results.blocked) {
    console.log(`\nWARNING: Stopped due to: ${results.blockReason}`);
    console.log('Wait a few hours before trying again.');
  }
}

async function handleStatus(accountId) {
  console.log('MODE: Status\n');
  
  const stats = await getOutreachStats(accountId);
  
  console.log('=== Lead Pipeline ===');
  console.log(`Total leads:           ${stats.total_leads}`);
  console.log(`New (not contacted):   ${stats.new_leads}`);
  console.log(`Contacted:             ${stats.contacted_leads}`);
  console.log(`Replied:               ${stats.replied_leads}`);
  
  console.log('\n=== Messages ===');
  console.log(`Messages sent:         ${stats.messages_sent}`);
  console.log(`Messages received:     ${stats.messages_received}`);
  
  console.log('\n=== Eligible for Outreach ===');
  console.log(`Min engagement score:  ${stats.min_engagement_threshold}`);
  console.log(`Ready to contact:      ${stats.eligible_for_outreach}`);
  
  if (stats.by_engagement && stats.by_engagement.length > 0) {
    console.log('\nBy engagement level:');
    stats.by_engagement.forEach(row => {
      console.log(`   ${row.level}: ${row.count}`);
    });
  }
  
  if (stats.eligible_for_outreach > 0) {
    console.log('\nRun preview to see top candidates:');
    console.log('   node bin/run.js --mode preview --limit 5');
  }
}

async function handleList(accountId) {
  console.log('MODE: List candidates\n');
  
  const leads = await getOutreachCandidates({
    limit: opts.limit,
    minEngagementScore: opts.minEngagement,
    targetStatus: opts.status,
    accountId: accountId
  });
  
  if (leads.length === 0) {
    console.log('No eligible leads found.');
    return;
  }
  
  console.log(`Found ${leads.length} eligible leads:\n`);
  
  leads.forEach((lead, i) => {
    console.log(`${i + 1}. @${lead.username}`);
    console.log(`   Followers: ${lead.followers_count || 'unknown'}`);
    console.log(`   Engagement: ${lead.warmth} (score: ${lead.engagement_score})`);
    console.log(`   Comments: ${lead.total_comments || 0}`);
    console.log(`   Bio: ${lead.bio ? lead.bio.substring(0, 80) + '...' : 'N/A'}`);
    console.log('');
  });
}

main();

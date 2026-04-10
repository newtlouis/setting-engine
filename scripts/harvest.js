#!/usr/bin/env node
/**
 * Harvest Script - Lead Queue Orchestrator
 * 
 * Runs at 6am via cron. Finds N leads (default 30) across different sources
 * in priority order: Followers → Engagement → Prospector
 * 
 * Usage:
 *   npm run harvest -- --target 30 --profile melanie
 *   node scripts/harvest.js --target 30 --profile melanie
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import { getContainer } from '../shared/container.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    target: 60,
    profile: 'melanie',
    prospectMode: 'comments',
    variant: 'A'
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' && args[i + 1]) {
      result.target = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--profile' && args[i + 1]) {
      result.profile = args[i + 1];
      i++;
    } else if (args[i] === '--prospect-mode' && args[i + 1]) {
      result.prospectMode = args[i + 1];
      i++;
    } else if (args[i] === '--variant' && args[i + 1]) {
      result.variant = args[i + 1];
      i++;
    }
  }

  return result;
}

/**
 * Run a child process and wait for completion
 */
function runScript(command, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n🚀 Running: ${command} ${args.join(' ')}`);
    
    const proc = spawn(command, args, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..')
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  const { target, profile, prospectMode, variant } = parseArgs();

  console.log('========================================');
  console.log('   LEAD HARVESTER - Queue Builder');
  console.log('========================================');
  console.log(`   Target: ${target} leads`);
  console.log(`   Profile: ${profile}`);
  console.log(`   Variant: ${variant}`);
  console.log(`   Priority: Followers → Engagement → Prospector`);
  console.log('========================================\n');

  // Initialize container for queue access
  const container = await getContainer();

  // Resolve account_id for this profile
  const db = container.getDb();
  const accountRow = db?.prepare('SELECT id FROM accounts WHERE name = ?').get(profile);
  const accountId = accountRow?.id || null;
  console.log(`🔑 Account: ${profile} (id: ${accountId})`);

  // Helper to get pending queue count (filtered by profile)
  const getQueueCount = async () => {
    const stats = await container.repositories.outreachQueue.getStats(accountId);
    return stats.pending;
  };

  let added = 0;
  const initialCount = await getQueueCount();
  console.log(`📊 Current queue: ${initialCount} pending leads`);
  console.log(`🎯 Will add ${target} NEW leads\n`);

  // Phase 1: Followers (no limit — queue all contactable new followers)
  console.log('--- PHASE 1: NEW FOLLOWERS ---');
  let countBefore = await getQueueCount();
  try {
    await runScript('npm', ['run', 'followers', '--', '--profile', profile, '--prepare-only', '--track-week']);
  } catch (err) {
    console.error(`⚠️ Followers phase error: ${err.message}`);
  }
  let countAfter = await getQueueCount();
  let phaseAdded = Math.max(0, countAfter - countBefore);
  added += phaseAdded;
  console.log(`\n📊 Followers added: +${phaseAdded} leads (Total added: ${added})`);

  // Phase 2: Engagement (no limit — queue all contactable engaged leads)
  console.log('\n--- PHASE 2: ENGAGEMENT ---');
  countBefore = await getQueueCount();
  try {
    await runScript('npm', ['run', 'engagement', '--', '--profile', profile, '--prepare-only']);
  } catch (err) {
    console.error(`⚠️ Engagement phase error: ${err.message}`);
  }
  countAfter = await getQueueCount();
  phaseAdded = Math.max(0, countAfter - countBefore);
  added += phaseAdded;
  console.log(`\n📊 Engagement added: +${phaseAdded} leads (Total added: ${added})`);

  // Phase 3: Prospector (only if target not yet reached)
  if (added >= target) {
    console.log(`\n✅ Target already reached (${added}/${target}) — skipping Prospector.`);
    return finish(added, countAfter);
  }

  const remaining = target - added;
  console.log(`\n--- PHASE 3: PROSPECTOR (need ${remaining} more to reach ${target}) ---`);
  countBefore = await getQueueCount();
  try {
    await runScript('npm', ['run', 'prospect', '--', '--profile', profile, '--total', String(remaining), '--mode', prospectMode, '--variant', variant]);
  } catch (err) {
    console.error(`⚠️ Prospector phase error: ${err.message}`);
  }
  countAfter = await getQueueCount();
  phaseAdded = Math.max(0, countAfter - countBefore);
  added += phaseAdded;
  console.log(`\n📊 Prospector added: +${phaseAdded} leads (Total added: ${added})`);

  return finish(added, countAfter);
}

function finish(added, totalQueued) {
  console.log('\n========================================');
  console.log('   HARVEST COMPLETE');
  console.log('========================================');
  console.log(`   New leads added: ${added}`);
  console.log(`   Total queue: ${totalQueued}`);
  console.log(`   Ready for: npm run send-queued`);
  console.log('========================================\n');
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});

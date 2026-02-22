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
    profile: 'melanie'
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' && args[i + 1]) {
      result.target = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--profile' && args[i + 1]) {
      result.profile = args[i + 1];
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
  const { target, profile } = parseArgs();

  console.log('========================================');
  console.log('   LEAD HARVESTER - Queue Builder');
  console.log('========================================');
  console.log(`   Target: ${target} leads`);
  console.log(`   Profile: ${profile}`);
  console.log(`   Priority: Followers → Engagement → Prospector`);
  console.log('========================================\n');

  // Initialize container for queue access
  const container = await getContainer();

  // Helper to get pending queue count
  const getQueueCount = async () => {
    const stats = await container.repositories.outreachQueue.getStats();
    return stats.pending;
  };

  let initialCount = await getQueueCount();
  let currentCount = initialCount;
  console.log(`📊 Current queue: ${currentCount} pending leads`);

  // Phase 1: Followers
  console.log('\n--- PHASE 1: NEW FOLLOWERS ---');
  try {
    const remaining = target - currentCount;
    await runScript('npm', ['run', 'followers', '--', '--profile', profile, '--prepare-only', '--track-week', '--target-message-count', String(remaining)]);
  } catch (err) {
    console.error(`⚠️ Followers phase error: ${err.message}`);
  }

  currentCount = await getQueueCount();
  let newLeads = currentCount - initialCount;
  console.log(`\n📊 Followers added: ${newLeads} leads (Total queue: ${currentCount})`);

  if (currentCount >= target) {
    console.log(`\n✅ Target reached after Followers phase!`);
    return finish(currentCount);
  }

  // Phase 2: Engagement
  console.log('\n--- PHASE 2: ENGAGEMENT ---');
  try {
    const remaining = target - currentCount;
    await runScript('npm', ['run', 'engagement', '--', '--profile', profile, '--prepare-only', '--target-message-count', String(remaining)]);
  } catch (err) {
    console.error(`⚠️ Engagement phase error: ${err.message}`);
  }

  currentCount = await getQueueCount();
  console.log(`\n📊 After Engagement: ${currentCount} total pending leads`);

  if (currentCount >= target) {
    console.log(`\n✅ Target reached after Engagement phase!`);
    return finish(currentCount);
  }

  // Phase 3: Prospector
  const remaining = target - currentCount;
  console.log(`\n--- PHASE 3: PROSPECTOR (need ${remaining} more) ---`);
  try {
    await runScript('npm', ['run', 'prospect', '--', '--profile', profile, '--prepare-only', '--total', String(remaining)]);
  } catch (err) {
    console.error(`⚠️ Prospector phase error: ${err.message}`);
  }

  currentCount = await getQueueCount();
  console.log(`\n📊 After Prospector: ${currentCount} total pending leads`);

  return finish(currentCount);
}

function finish(totalQueued) {
  console.log('\n========================================');
  console.log('   HARVEST COMPLETE');
  console.log('========================================');
  console.log(`   Total leads queued: ${totalQueued}`);
  console.log(`   Ready for: npm run send-queued`);
  console.log('========================================\n');
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Hourly Cycle Orchestrator
 *
 * Runs send-queued then respond:inbox 3 times at 20min intervals.
 * Skips respond:inbox if a previous browser session is still open.
 *
 * Usage:
 *   node scripts/hourly-cycle.js --profile katessence
 *   node scripts/hourly-cycle.js --profile katessence --limit 5
 */

import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync, statSync, unlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { profile: null, limit: 5, skipSend: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile' && args[i + 1]) {
      result.profile = args[i + 1];
      i++;
    } else if (args[i] === '--limit' && args[i + 1]) {
      result.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--skip-send') {
      result.skipSend = true;
    }
  }
  return result;
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isBrowserAlive(profile) {
  // Check if the actual Chrome browser process is running for this profile
  try {
    const browserDir = `browser-data-${profile}-responder`;
    const result = execSync(`pgrep -f "user-data-dir=.*${browserDir}" 2>/dev/null || true`, { encoding: 'utf8' }).trim();
    return result.length > 0;
  } catch {
    return false;
  }
}

function isBrowserSessionOpen(profile) {
  const lockFile = path.join(PROJECT_ROOT, 'browser-data', `browser-data-${profile}-responder`, '.session.pid');
  if (!existsSync(lockFile)) return false;
  try {
    const pid = parseInt(readFileSync(lockFile, 'utf8'), 10);
    if (!pid || !isProcessRunning(pid)) {
      // Stale lock — clean up
      try { unlinkSync(lockFile); } catch {}
      return false;
    }

    // If the Node process is alive but Chrome browser is gone, kill the orphan
    if (!isBrowserAlive(profile)) {
      console.log(`   ⚠️ Orphan detected: PID ${pid} alive but browser closed — killing`);
      try { process.kill(pid, 'SIGTERM'); } catch {}
      const start = Date.now();
      while (Date.now() - start < 3000 && isProcessRunning(pid)) { /* wait */ }
      if (isProcessRunning(pid)) {
        try { process.kill(pid, 'SIGKILL'); } catch {}
      }
      try { unlinkSync(lockFile); } catch {}
      return false;
    }

    // Browser is alive → NEVER kill. Just skip this run.
    const lockStat = statSync(lockFile);
    const lockAgeMinutes = (Date.now() - lockStat.mtimeMs) / 60000;
    console.log(`   🟢 Session active (PID ${pid}, ${Math.round(lockAgeMinutes)}min) — browser alive, skipping`);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runSendQueued(profile, limit) {
  console.log(`\n📤 [${timestamp()}] send-queued --limit ${limit} --profile ${profile}`);
  try {
    execSync(`/opt/homebrew/bin/npm run send-queued -- --limit ${limit} --profile ${profile}`, {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      timeout: 10 * 60 * 1000 // 10 min max
    });
    console.log(`✅ [${timestamp()}] send-queued complete`);
  } catch (err) {
    console.error(`❌ [${timestamp()}] send-queued failed: ${err.message}`);
  }
}

function spawnRespondInbox(profile) {
  if (isBrowserSessionOpen(profile)) {
    console.log(`⏭️  [${timestamp()}] Skipping respond:inbox — previous browser session still open`);
    return false;
  }

  console.log(`📥 [${timestamp()}] respond:inbox --profile ${profile}`);
  const child = spawn('/opt/homebrew/bin/npm', ['run', 'respond:inbox', '--', '--profile', profile], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    detached: false
  });

  child.on('error', err => console.error(`❌ respond:inbox error: ${err.message}`));
  child.on('exit', code => console.log(`📥 [${timestamp()}] respond:inbox exited (code ${code})`));

  return true;
}

function timestamp() {
  return new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
}

async function main() {
  const { profile, limit, skipSend } = parseArgs();
  if (!profile) {
    console.error('Usage: node scripts/hourly-cycle.js --profile <name> [--limit N] [--skip-send]');
    process.exit(1);
  }

  console.log(`🔄 [${timestamp()}] Hourly cycle — profile: ${profile}, limit: ${limit}${skipSend ? ' (send paused)' : ''}`);

  // Step 1: send queued messages (synchronous) — skipped when --skip-send is set
  if (skipSend) {
    console.log(`⏸️  [${timestamp()}] send-queued skipped (--skip-send)`);
  } else {
    runSendQueued(profile, limit);
  }

  // Step 2: respond:inbox — run 1/3
  const run1 = spawnRespondInbox(profile);

  // Wait 20 minutes
  if (run1) {
    console.log(`⏳ [${timestamp()}] Waiting 20 minutes...`);
    await sleep(20 * 60 * 1000);
  }

  // Step 3: respond:inbox — run 2/3
  const run2 = spawnRespondInbox(profile);

  // Wait 20 minutes
  if (run2) {
    console.log(`⏳ [${timestamp()}] Waiting 20 minutes...`);
    await sleep(20 * 60 * 1000);
  }

  // Step 4: respond:inbox — run 3/3
  spawnRespondInbox(profile);

  console.log(`🏁 [${timestamp()}] Hourly cycle complete`);
}

main().catch(err => {
  console.error('❌ Hourly cycle error:', err.message);
  process.exit(1);
});

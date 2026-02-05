#!/usr/bin/env node

/**
 * Funnel Step Analyzer CLI
 *
 * Analyzes conversations step-by-step against funnel scripts
 * to detect adaptations and suggest RAG entries.
 *
 * Usage:
 *   node bin/analyze-funnel-steps.js --profile melanie --username romain.benn
 *   node bin/analyze-funnel-steps.js --profile melanie --username romain.benn --save
 *   node bin/analyze-funnel-steps.js --profile melanie --username romain.benn,elina_guez
 */

import { Command } from 'commander';
import { initDatabase, getDb } from '../src/db/core.js';
import { runStepAnalysis } from '../src/funnel-step-analyzer.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

program
  .name('analyze-funnel-steps')
  .description('Analyze conversations step-by-step against funnel scripts')
  .option('-p, --profile <name>', 'Account profile name', 'melanie')
  .option('-u, --username <usernames>', 'One or more usernames (comma-separated)')
  .option('-s, --save', 'Save suggested RAG entries to Knowledge Base (inactive)', false)
  .parse(process.argv);

const options = program.opts();

async function main() {
  console.log('\n🔬 Funnel Step Analyzer');
  console.log('='.repeat(40));

  if (!options.username) {
    console.error('❌ --username est requis. Ex: --username romain.benn,elina_guez');
    process.exit(1);
  }

  // Initialize database
  const dbPath = path.join(__dirname, '..', 'permanent-data', 'leads.db');
  await initDatabase(dbPath);
  const db = getDb();

  // Get account ID
  const account = db.prepare('SELECT id FROM accounts WHERE name = ?').get(options.profile);
  if (!account) {
    console.error(`❌ Account "${options.profile}" not found`);
    process.exit(1);
  }
  const accountId = account.id;
  console.log(`📱 Account: ${options.profile} (ID: ${accountId})`);

  // Parse usernames
  const usernames = options.username.split(',').map(u => u.trim()).filter(Boolean);
  console.log(`👤 Usernames: ${usernames.join(', ')}`);
  console.log(`💾 Save RAG entries: ${options.save ? 'Yes' : 'No'}`);

  // Run analysis
  const results = await runStepAnalysis(accountId, usernames, { save: options.save });

  if (!results.success) {
    console.error('\n❌ Analyse echouee:', results.error);
    process.exit(1);
  }

  console.log('\n✅ Analyse terminee!\n');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

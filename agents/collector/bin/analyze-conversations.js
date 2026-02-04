#!/usr/bin/env node

/**
 * Conversation Analyzer CLI
 *
 * Analyzes converted conversations to extract winning patterns
 * and optionally saves insights to the Knowledge Base.
 *
 * Usage:
 *   node bin/analyze-conversations.js --profile melanie
 *   node bin/analyze-conversations.js --profile melanie --max 3
 *   node bin/analyze-conversations.js --profile melanie --auto-save
 */

import { Command } from 'commander';
import { initDatabase, getDb } from '../src/db/core.js';
import {
  getConvertedConversations,
  runFullAnalysis,
  generateReport,
  saveToKnowledgeBase
} from '../src/conversation-analyzer.js';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

program
  .name('analyze-conversations')
  .description('Analyze converted conversations to extract winning patterns')
  .option('-p, --profile <name>', 'Account profile name', 'melanie')
  .option('-m, --max <number>', 'Maximum conversations to analyze', '5')
  .option('-l, --list', 'Just list converted conversations without analyzing')
  .option('--auto-save', 'Automatically save suggestions to Knowledge Base')
  .option('--min-messages <number>', 'Minimum messages required', '5')
  .parse(process.argv);

const options = program.opts();

function askQuestion(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.toLowerCase());
    });
  });
}

async function main() {
  console.log('\n🔍 Conversation Analyzer');
  console.log('='.repeat(40));

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

  // List mode
  if (options.list) {
    const conversations = getConvertedConversations(accountId);

    console.log(`\n📋 Conversations converties: ${conversations.length}\n`);

    if (conversations.length === 0) {
      console.log('   Aucune conversation convertie trouvée');
      process.exit(0);
    }

    conversations.forEach((conv, i) => {
      const syncStatus = conv.lead.last_dm_sync_at
        ? `Sync: ${new Date(conv.lead.last_dm_sync_at).toLocaleDateString()}`
        : 'Jamais syncé';
      const truncInfo = conv.truncated
        ? ` (tronqué: ${conv.messageCount}/${conv.totalMessageCount})`
        : '';
      console.log(`   ${i + 1}. @${conv.lead.username}`);
      console.log(`      Messages: ${conv.messageCount}${truncInfo} | Step: ${conv.lead.funnel_step} | ${syncStatus}`);
    });

    process.exit(0);
  }

  // Full analysis
  console.log(`\n🚀 Lancement de l'analyse...`);
  console.log(`   Max conversations: ${options.max}`);
  console.log(`   Min messages: ${options.minMessages}`);
  console.log(`   Auto-save: ${options.autoSave ? 'Oui' : 'Non'}\n`);

  const results = await runFullAnalysis(accountId, {
    maxConversations: parseInt(options.max),
    minMessages: parseInt(options.minMessages),
    autoSave: false // We'll handle save manually for confirmation
  });

  if (results.success === false) {
    console.error('\n❌ Analyse échouée:', results.error);
    process.exit(1);
  }

  // Ask to save if not auto-save and there are suggestions
  const suggestions = results.aggregated?.suggested_knowledge_entries || [];

  if (suggestions.length > 0 && !options.autoSave) {
    console.log(`\n📚 ${suggestions.length} suggestions pour la Knowledge Base détectées.`);

    const answer = await askQuestion('\nVoulez-vous les sauvegarder ? (o/n): ');

    if (answer === 'o' || answer === 'oui' || answer === 'y' || answer === 'yes') {
      console.log('\n💾 Sauvegarde dans la Knowledge Base...');
      const saveResults = await saveToKnowledgeBase(accountId, suggestions);
      console.log(`   ✅ Sauvegardées: ${saveResults.saved}`);
      console.log(`   ⏭️ Ignorées (doublons): ${saveResults.skipped}`);
      console.log(`   ❌ Erreurs: ${saveResults.errors}`);
    } else {
      console.log('\n⏭️ Sauvegarde annulée');
    }
  } else if (options.autoSave && suggestions.length > 0) {
    console.log('\n💾 Sauvegarde automatique dans la Knowledge Base...');
    const saveResults = await saveToKnowledgeBase(accountId, suggestions);
    console.log(`   ✅ Sauvegardées: ${saveResults.saved}`);
    console.log(`   ⏭️ Ignorées (doublons): ${saveResults.skipped}`);
    console.log(`   ❌ Erreurs: ${saveResults.errors}`);
  }

  console.log('\n✅ Analyse terminée!\n');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

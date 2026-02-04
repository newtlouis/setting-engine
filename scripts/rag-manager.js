#!/usr/bin/env node

/**
 * RAG Manager CLI
 *
 * Manage the RAG knowledge base:
 * - Seed initial knowledge entries
 * - Generate/update embeddings
 * - View stats
 * - Add custom entries
 *
 * Usage:
 *   node scripts/rag-manager.js seed <account_id>
 *   node scripts/rag-manager.js embeddings <account_id>
 *   node scripts/rag-manager.js stats <account_id>
 *   node scripts/rag-manager.js add <account_id> <category> <content>
 */

import { getContainer } from '../shared/container.js';
import { getEmbedding, getEmbeddings } from '../shared/utils/embeddings.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from dmresponder (has OPENAI_API_KEY)
dotenv.config({ path: path.join(__dirname, '../agents/dmresponder/.env') });

// Default knowledge entries for initial seeding
const DEFAULT_KNOWLEDGE = [
  // Objections
  {
    category: 'objection',
    triggerKeywords: ['pas le temps', 'occupée', 'busy', 'débordée', 'chargée'],
    situation: 'Le prospect dit ne pas avoir le temps pour un appel',
    content: `Approche efficace : Ne pas insister, proposer de la flexibilité.
Exemple : "Ok :) L'appel dure 30 min max et on peut le caler quand ca t'arrange, meme tot le matin ou en soiree. Tu preferes plutot en semaine ou le week-end ?"`
  },
  {
    category: 'objection',
    triggerKeywords: ['combien', 'prix', 'tarif', 'coût', 'payant', 'gratuit'],
    situation: 'Le prospect demande le prix ou si c\'est payant',
    content: `IMPORTANT : Ne JAMAIS donner de prix a ce stade. L'objectif est l'appel decouverte.
Exemple : "L'appel decouverte est 100% gratuit ! C'est vraiment juste un moment pour faire le point sur ta situation et voir si je peux t'aider. Aucun engagement, promis."`
  },
  {
    category: 'objection',
    triggerKeywords: ['réfléchir', 'je vais voir', 'je te dis', 'peut-être', 'on verra'],
    situation: 'Le prospect hésite et veut réfléchir',
    content: `Ne pas forcer. Valider son besoin de reflexion tout en gardant le momentum.
Exemple : "Bien sur, prends le temps qu'il te faut ! Je peux juste te demander ce qui te fait hesiter ? C'est le timing, ou autre chose ?"`
  },
  {
    category: 'objection',
    triggerKeywords: ['pas intéressée', 'non merci', 'pas pour moi', 'pas besoin'],
    situation: 'Refus clair du prospect',
    content: `UTILISER [NOT_INTERESTED]. Cloturer poliment sans insister.
Exemple : "Pas de souci du tout, je comprends ! Merci pour ta reponse. Si jamais ca te parle un jour, n'hesite pas. Belle continuation a toi !"`
  },
  {
    category: 'objection',
    triggerKeywords: ['arnaque', 'scam', 'méfiant', 'confiance', 'c\'est quoi le piège'],
    situation: 'Le prospect exprime de la méfiance',
    content: `Rassurer avec transparence. Ne pas etre defensif.
Exemple : "Je comprends ta prudence, c'est normal ! Je suis [Prenom], coach en [domaine]. Tu peux voir mon profil, mes temoignages... L'appel est gratuit et sans engagement, c'est vraiment juste pour discuter."`
  },

  // FAQ
  {
    category: 'faq',
    triggerKeywords: ['c\'est quoi', 'tu fais quoi', 'comment ça marche', 'en quoi ça consiste'],
    situation: 'Le prospect demande ce que tu fais / comment ça marche',
    content: `Repondre simplement et recentrer sur le prospect.
Exemple : "En fait, j'accompagne les [cible] qui [probleme] a [resultat]. Concretement, on fait un premier appel gratuit pour voir ta situation, et si je peux t'aider, je t'explique comment. C'est quoi qui t'a fait reagir a mon message ?"`
  },
  {
    category: 'faq',
    triggerKeywords: ['ça dure combien', 'combien de temps', 'c\'est long'],
    situation: 'Le prospect demande la durée',
    content: `Exemple : "L'appel decouverte dure environ 30 minutes. Juste le temps de comprendre ta situation et voir si je peux t'apporter des pistes concretes."`
  },

  // Techniques
  {
    category: 'technique',
    triggerKeywords: ['oui', 'ok', 'pourquoi pas', 'ça m\'intéresse', 'd\'accord'],
    situation: 'Signal positif détecté - le prospect montre de l\'intérêt',
    content: `IMPORTANT : Ne pas sur-vendre ! Quand le prospect montre de l'interet, enchainer rapidement vers la proposition concrete (creneaux). Trop parler = risque de le perdre.`
  },
  {
    category: 'technique',
    triggerKeywords: ['...', 'hm', 'ah', 'ok...', 'je vois'],
    situation: 'Réponse courte/vague du prospect',
    content: `Le prospect est peut-etre timide ou pas convaincu. Poser une question ouverte pour l'engager davantage.
Exemple : "Je sens que tu hesites peut-etre... Tu veux m'en dire plus sur ce qui te bloque ?"`
  },

  // Success stories (templates)
  {
    category: 'success_story',
    triggerKeywords: ['ça marche vraiment', 'résultats', 'témoignage', 'preuve'],
    situation: 'Le prospect demande des preuves ou résultats',
    content: `Utiliser un temoignage court et relatable.
Exemple : "Recemment, [Prenom] etait exactement dans la meme situation que toi. En [X semaines], elle a [resultat concret]. Je peux te montrer son temoignage si tu veux !"`
  }
];

async function seedKnowledge(accountId) {
  console.log(`\n🌱 Seeding knowledge base for account ${accountId}...\n`);

  const container = await getContainer();
  const knowledgeRepo = container.repositories.knowledge;

  // Check existing entries
  const existing = await knowledgeRepo.getByAccount(accountId);
  if (existing.length > 0) {
    console.log(`⚠️  Account already has ${existing.length} knowledge entries.`);
    console.log('   Use "embeddings" command to update embeddings only.\n');
    return;
  }

  let created = 0;
  for (const entry of DEFAULT_KNOWLEDGE) {
    try {
      await knowledgeRepo.save({
        accountId,
        ...entry
      });
      console.log(`   ✓ Added [${entry.category}]: ${entry.situation.slice(0, 50)}...`);
      created++;
    } catch (e) {
      console.error(`   ✗ Failed: ${e.message}`);
    }
  }

  console.log(`\n✅ Created ${created} knowledge entries.`);
  console.log('   Run "embeddings" command to generate embeddings.\n');
}

async function generateEmbeddings(accountId) {
  console.log(`\n🧠 Generating embeddings for account ${accountId}...\n`);

  const container = await getContainer();
  const knowledgeRepo = container.repositories.knowledge;

  const entries = await knowledgeRepo.getByAccount(accountId);
  const withoutEmbedding = entries.filter(e => !e.embedding);

  if (withoutEmbedding.length === 0) {
    console.log('✅ All entries already have embeddings.\n');
    return;
  }

  console.log(`   Found ${withoutEmbedding.length} entries without embeddings.\n`);

  // Batch process for efficiency
  const batchSize = 10;
  let processed = 0;

  for (let i = 0; i < withoutEmbedding.length; i += batchSize) {
    const batch = withoutEmbedding.slice(i, i + batchSize);
    const texts = batch.map(e => `${e.situation} ${e.content}`);

    try {
      const embeddings = await getEmbeddings(texts);

      for (let j = 0; j < batch.length; j++) {
        await knowledgeRepo.updateEmbedding(batch[j].id, embeddings[j]);
        processed++;
        console.log(`   ✓ [${processed}/${withoutEmbedding.length}] ${batch[j].category}: ${batch[j].situation.slice(0, 40)}...`);
      }
    } catch (e) {
      console.error(`   ✗ Batch failed: ${e.message}`);
    }
  }

  console.log(`\n✅ Generated ${processed} embeddings.\n`);
}

async function showStats(accountId) {
  console.log(`\n📊 RAG Stats for account ${accountId}\n`);

  const container = await getContainer();
  const knowledgeRepo = container.repositories.knowledge;

  const stats = await knowledgeRepo.getStats(accountId);

  console.log('Knowledge Base:');
  console.log(`   Total entries:      ${stats.knowledgeBase.total_entries || 0}`);
  console.log(`   With embeddings:    ${stats.knowledgeBase.with_embeddings || 0}`);
  console.log(`   Total usage:        ${stats.knowledgeBase.total_usage || 0}`);
  console.log(`   Avg success rate:   ${stats.knowledgeBase.avg_success_rate ? (stats.knowledgeBase.avg_success_rate * 100).toFixed(1) + '%' : 'N/A'}`);
  console.log(`   Categories:         ${stats.knowledgeBase.categories || 0}`);

  console.log('\nConversation Embeddings:');
  console.log(`   Total:              ${stats.conversations.total_conversations || 0}`);
  console.log(`   Converted:          ${stats.conversations.converted || 0}`);
  console.log(`   Lost:               ${stats.conversations.lost || 0}`);
  console.log(`   Avg funnel step:    ${stats.conversations.avg_funnel_step ? stats.conversations.avg_funnel_step.toFixed(1) : 'N/A'}`);

  // Show entries by category
  const entries = await knowledgeRepo.getByAccount(accountId);
  const byCategory = entries.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + 1;
    return acc;
  }, {});

  console.log('\nEntries by category:');
  for (const [cat, count] of Object.entries(byCategory)) {
    console.log(`   ${cat}: ${count}`);
  }

  console.log('');
}

async function addEntry(accountId, category, content, situation = null, keywords = null) {
  console.log(`\n➕ Adding knowledge entry...\n`);

  const container = await getContainer();
  const knowledgeRepo = container.repositories.knowledge;

  // Generate embedding
  const textForEmbedding = `${situation || ''} ${content}`;
  const embedding = await getEmbedding(textForEmbedding);

  const entry = await knowledgeRepo.save({
    accountId,
    category,
    content,
    situation,
    triggerKeywords: keywords ? keywords.split(',').map(k => k.trim()) : [],
    embedding
  });

  console.log(`✅ Added entry #${entry.id}`);
  console.log(`   Category: ${category}`);
  console.log(`   Content: ${content.slice(0, 100)}...`);
  console.log(`   Embedding: generated\n`);
}

async function listEntries(accountId) {
  console.log(`\n📋 Knowledge entries for account ${accountId}\n`);

  const container = await getContainer();
  const knowledgeRepo = container.repositories.knowledge;

  const entries = await knowledgeRepo.getByAccount(accountId);

  if (entries.length === 0) {
    console.log('   No entries found. Run "seed" command first.\n');
    return;
  }

  for (const entry of entries) {
    const hasEmbed = entry.embedding ? '✓' : '✗';
    console.log(`[${entry.id}] [${entry.category}] ${hasEmbed} embed`);
    console.log(`    Situation: ${entry.situation || 'N/A'}`);
    console.log(`    Keywords: ${entry.triggerKeywords?.join(', ') || 'none'}`);
    console.log(`    Usage: ${entry.usage_count} | Success: ${entry.success_rate ? (entry.success_rate * 100).toFixed(0) + '%' : 'N/A'}`);
    console.log(`    Content: ${entry.content.slice(0, 80)}...`);
    console.log('');
  }
}

async function testRetrieval(accountId, message) {
  console.log(`\n🔍 Testing RAG retrieval for: "${message}"\n`);

  const container = await getContainer();
  const ragRetriever = container.services.ragRetriever;

  const results = await ragRetriever.retrieve({
    prospectMessage: message,
    leadContext: { funnel_step: 3 },
    accountId
  });

  console.log('Results:');
  console.log(`   Knowledge entries: ${results.relevantKnowledge.length}`);
  console.log(`   Similar conversations: ${results.similarConversations.length}`);
  console.log(`   Keyword matches: ${results.keywordMatches.length}`);

  if (results.relevantKnowledge.length > 0) {
    console.log('\nTop knowledge matches:');
    for (const kb of results.relevantKnowledge.slice(0, 3)) {
      console.log(`   [${(kb.score * 100).toFixed(0)}%] [${kb.category}] ${kb.situation}`);
    }
  }

  console.log('\nFormatted for prompt:');
  console.log('---');
  console.log(ragRetriever.formatForPrompt(results) || '(no relevant results)');
  console.log('---\n');
}

// Main
const [,, command, ...args] = process.argv;

if (!command) {
  console.log(`
RAG Manager - Knowledge Base CLI

Commands:
  seed <account_id>              Seed default knowledge entries
  embeddings <account_id>        Generate embeddings for entries without them
  stats <account_id>             Show RAG statistics
  list <account_id>              List all knowledge entries
  add <account_id> <category> "<content>" ["<situation>"] ["<keywords>"]
                                 Add a custom entry
  test <account_id> "<message>"  Test RAG retrieval with a message

Categories: objection, faq, product, success_story, technique

Examples:
  node scripts/rag-manager.js seed 1
  node scripts/rag-manager.js embeddings 1
  node scripts/rag-manager.js add 1 objection "Reponse..." "Quand le prospect dit X"
  node scripts/rag-manager.js test 1 "j'ai pas le temps"
`);
  process.exit(0);
}

(async () => {
  try {
    switch (command) {
      case 'seed':
        await seedKnowledge(parseInt(args[0]));
        break;
      case 'embeddings':
        await generateEmbeddings(parseInt(args[0]));
        break;
      case 'stats':
        await showStats(parseInt(args[0]));
        break;
      case 'list':
        await listEntries(parseInt(args[0]));
        break;
      case 'add':
        await addEntry(parseInt(args[0]), args[1], args[2], args[3], args[4]);
        break;
      case 'test':
        await testRetrieval(parseInt(args[0]), args[1]);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }

  process.exit(0);
})();

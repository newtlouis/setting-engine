/**
 * Conversation Analyzer
 *
 * Analyzes converted conversations to extract winning patterns
 * and suggest Knowledge Base enrichments for the RAG system.
 */

import { getDb } from './db/core.js';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from dmresponder
dotenv.config({ path: path.join(__dirname, '../../dmresponder/.env') });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Get converted conversations with full message history
 * @param {number} accountId
 * @returns {Array} Conversations with messages
 */
export function getConvertedConversations(accountId) {
  const db = getDb();

  const leads = db.prepare(`
    SELECT l.*
    FROM leads l
    WHERE l.account_id = ?
      AND l.booking_status = 'completed'
      AND l.is_ignored = 0
    ORDER BY l.updated_at DESC
  `).all(accountId);

  return leads.map(lead => {
    const messages = db.prepare(`
      SELECT role, message_text, message_type, sent_at
      FROM conversations
      WHERE lead_id = ?
      ORDER BY sent_at ASC
    `).all(lead.id);

    return {
      lead,
      messages,
      messageCount: messages.length
    };
  });
}

/**
 * Format conversation for LLM analysis
 * @param {Object} conversation
 * @returns {string}
 */
function formatConversationForAnalysis(conversation) {
  const { lead, messages } = conversation;

  let formatted = `## Conversation avec @${lead.username}\n`;
  formatted += `Funnel Step atteint: ${lead.funnel_step}\n`;
  formatted += `Résultat: CONVERTI (booking complété)\n\n`;
  formatted += `### Messages:\n\n`;

  for (const msg of messages) {
    const role = msg.role === 'assistant' ? '🟢 COACH' : '🔵 PROSPECT';
    formatted += `${role}: ${msg.message_text}\n\n`;
  }

  return formatted;
}

/**
 * Analyze a single conversation with LLM
 * @param {Object} conversation
 * @returns {Promise<Object>} Analysis results
 */
async function analyzeConversation(conversation) {
  const formatted = formatConversationForAnalysis(conversation);

  const prompt = `Tu es un expert en analyse de conversations de vente/coaching.

Analyse cette conversation qui a mené à une CONVERSION (le prospect a booké un appel).

${formatted}

---

Extrais les éléments suivants au format JSON:

{
  "winning_phrases": [
    {
      "phrase": "La phrase exacte qui a bien marché",
      "context": "Dans quel contexte elle a été utilisée",
      "why_effective": "Pourquoi elle a été efficace"
    }
  ],
  "objection_handling": [
    {
      "objection": "L'objection du prospect",
      "response": "La réponse qui a fonctionné",
      "technique": "La technique utilisée (empathie, reformulation, etc.)"
    }
  ],
  "turning_points": [
    {
      "moment": "Description du moment clé",
      "what_changed": "Ce qui a fait basculer le prospect"
    }
  ],
  "tone_style": {
    "overall_tone": "Le ton général (chaleureux, professionnel, etc.)",
    "key_characteristics": ["caractéristique 1", "caractéristique 2"]
  },
  "suggested_knowledge_entries": [
    {
      "category": "technique|objection|success_story",
      "situation": "Quand utiliser cette connaissance",
      "content": "Le contenu à ajouter à la Knowledge Base",
      "trigger_keywords": ["mot-clé 1", "mot-clé 2"]
    }
  ]
}

Réponds UNIQUEMENT avec le JSON, sans commentaires.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 2000
    });

    const content = response.choices[0].message.content;

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return {
        success: true,
        username: conversation.lead.username,
        analysis: JSON.parse(jsonMatch[0])
      };
    }

    return {
      success: false,
      username: conversation.lead.username,
      error: 'Could not parse JSON from response'
    };

  } catch (error) {
    return {
      success: false,
      username: conversation.lead.username,
      error: error.message
    };
  }
}

/**
 * Analyze multiple conversations and aggregate insights
 * @param {number} accountId
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function analyzeConvertedConversations(accountId, options = {}) {
  const { maxConversations = 5, minMessages = 5 } = options;

  console.log('\n' + '='.repeat(50));
  console.log('🔍 ANALYSE DES CONVERSATIONS CONVERTIES');
  console.log('='.repeat(50));

  // Get converted conversations
  let conversations = getConvertedConversations(accountId);

  // Filter by minimum message count
  conversations = conversations.filter(c => c.messageCount >= minMessages);

  console.log(`\n📊 ${conversations.length} conversations converties trouvées`);

  if (conversations.length === 0) {
    return { success: false, error: 'No converted conversations found' };
  }

  // Limit to maxConversations
  conversations = conversations.slice(0, maxConversations);

  console.log(`📝 Analyse de ${conversations.length} conversations...\n`);

  const results = {
    analyzed: 0,
    errors: 0,
    analyses: [],
    aggregated: {
      winning_phrases: [],
      objection_handling: [],
      turning_points: [],
      suggested_knowledge_entries: []
    }
  };

  // Analyze each conversation
  for (const conv of conversations) {
    console.log(`   Analyse de @${conv.lead.username} (${conv.messageCount} messages)...`);

    const analysis = await analyzeConversation(conv);

    if (analysis.success) {
      results.analyzed++;
      results.analyses.push(analysis);

      // Aggregate results
      if (analysis.analysis.winning_phrases) {
        results.aggregated.winning_phrases.push(...analysis.analysis.winning_phrases);
      }
      if (analysis.analysis.objection_handling) {
        results.aggregated.objection_handling.push(...analysis.analysis.objection_handling);
      }
      if (analysis.analysis.turning_points) {
        results.aggregated.turning_points.push(...analysis.analysis.turning_points);
      }
      if (analysis.analysis.suggested_knowledge_entries) {
        results.aggregated.suggested_knowledge_entries.push(...analysis.analysis.suggested_knowledge_entries);
      }

      console.log(`   ✅ Analyse terminée`);
    } else {
      results.errors++;
      console.log(`   ❌ Erreur: ${analysis.error}`);
    }
  }

  return results;
}

/**
 * Generate a summary report from analysis results
 * @param {Object} results
 * @returns {string}
 */
export function generateReport(results) {
  let report = '\n' + '='.repeat(60) + '\n';
  report += '📊 RAPPORT D\'ANALYSE DES CONVERSATIONS CONVERTIES\n';
  report += '='.repeat(60) + '\n\n';

  report += `Conversations analysées: ${results.analyzed}\n`;
  report += `Erreurs: ${results.errors}\n\n`;

  // Winning phrases
  if (results.aggregated.winning_phrases.length > 0) {
    report += '─'.repeat(40) + '\n';
    report += '🏆 PHRASES GAGNANTES\n';
    report += '─'.repeat(40) + '\n\n';

    results.aggregated.winning_phrases.forEach((wp, i) => {
      report += `${i + 1}. "${wp.phrase}"\n`;
      report += `   Contexte: ${wp.context}\n`;
      report += `   Efficacité: ${wp.why_effective}\n\n`;
    });
  }

  // Objection handling
  if (results.aggregated.objection_handling.length > 0) {
    report += '─'.repeat(40) + '\n';
    report += '🛡️ GESTION DES OBJECTIONS\n';
    report += '─'.repeat(40) + '\n\n';

    results.aggregated.objection_handling.forEach((oh, i) => {
      report += `${i + 1}. Objection: "${oh.objection}"\n`;
      report += `   Réponse: "${oh.response}"\n`;
      report += `   Technique: ${oh.technique}\n\n`;
    });
  }

  // Turning points
  if (results.aggregated.turning_points.length > 0) {
    report += '─'.repeat(40) + '\n';
    report += '🔄 POINTS DE BASCULE\n';
    report += '─'.repeat(40) + '\n\n';

    results.aggregated.turning_points.forEach((tp, i) => {
      report += `${i + 1}. ${tp.moment}\n`;
      report += `   → ${tp.what_changed}\n\n`;
    });
  }

  // Suggested KB entries
  if (results.aggregated.suggested_knowledge_entries.length > 0) {
    report += '─'.repeat(40) + '\n';
    report += '📚 SUGGESTIONS POUR LA KNOWLEDGE BASE\n';
    report += '─'.repeat(40) + '\n\n';

    results.aggregated.suggested_knowledge_entries.forEach((entry, i) => {
      report += `${i + 1}. [${entry.category.toUpperCase()}]\n`;
      report += `   Situation: ${entry.situation}\n`;
      report += `   Contenu: ${entry.content}\n`;
      report += `   Mots-clés: ${entry.trigger_keywords?.join(', ') || 'N/A'}\n\n`;
    });
  }

  return report;
}

/**
 * Save suggested entries to Knowledge Base
 * @param {number} accountId
 * @param {Array} entries
 * @returns {Object} Save results
 */
export async function saveToKnowledgeBase(accountId, entries) {
  const db = getDb();

  const results = {
    saved: 0,
    skipped: 0,
    errors: 0
  };

  for (const entry of entries) {
    try {
      // Check if similar entry already exists
      const existing = db.prepare(`
        SELECT id FROM knowledge_base
        WHERE account_id = ?
          AND category = ?
          AND content LIKE ?
      `).get(accountId, entry.category, `%${entry.content.substring(0, 50)}%`);

      if (existing) {
        results.skipped++;
        continue;
      }

      // Insert new entry
      db.prepare(`
        INSERT INTO knowledge_base (account_id, category, situation, content, trigger_keywords)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        accountId,
        entry.category,
        entry.situation,
        entry.content,
        JSON.stringify(entry.trigger_keywords || [])
      );

      results.saved++;

    } catch (error) {
      console.error(`Error saving entry: ${error.message}`);
      results.errors++;
    }
  }

  return results;
}

/**
 * Full analysis pipeline
 * @param {number} accountId
 * @param {Object} options
 */
export async function runFullAnalysis(accountId, options = {}) {
  const { autoSave = false, maxConversations = 5 } = options;

  // Run analysis
  const results = await analyzeConvertedConversations(accountId, { maxConversations });

  if (!results.success === false) {
    console.error('Analysis failed:', results.error);
    return results;
  }

  // Generate report
  const report = generateReport(results);
  console.log(report);

  // Optionally save to KB
  if (autoSave && results.aggregated.suggested_knowledge_entries.length > 0) {
    console.log('\n💾 Sauvegarde automatique dans la Knowledge Base...');
    const saveResults = await saveToKnowledgeBase(
      accountId,
      results.aggregated.suggested_knowledge_entries
    );
    console.log(`   ✅ Sauvegardées: ${saveResults.saved}`);
    console.log(`   ⏭️ Ignorées (doublons): ${saveResults.skipped}`);
    console.log(`   ❌ Erreurs: ${saveResults.errors}`);
  }

  return results;
}

export default {
  getConvertedConversations,
  analyzeConvertedConversations,
  generateReport,
  saveToKnowledgeBase,
  runFullAnalysis
};

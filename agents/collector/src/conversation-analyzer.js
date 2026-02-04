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
 * Detect if a message is a booking confirmation (end of conversion funnel)
 * @param {string} text - Message text
 * @param {string} role - Message role (assistant/user)
 * @returns {boolean}
 */
function isBookingConfirmation(text, role) {
  if (!text) return false;
  const lower = text.toLowerCase();

  // Booking confirmation patterns (usually from assistant)
  if (role === 'assistant') {
    // WhatsApp/phone confirmation
    if (lower.includes('whatsapp') && (lower.includes('écrit') || lower.includes('envoyé'))) return true;

    // Calendar/meeting confirmation
    if ((lower.includes('rendez-vous') || lower.includes('appel')) &&
        (lower.includes('confirmé') || lower.includes('réservé') || lower.includes('noté'))) return true;

    // Asking for phone/email for booking (this is the final step before booking)
    if (lower.includes('numéro') && (lower.includes('téléphone') || lower.includes('whatsapp'))) return true;
    if (lower.includes('email') && lower.includes('confirmer')) return true;
  }

  // User provides phone number (strong indicator of booking)
  if (role === 'user') {
    // Phone number pattern (at least 8 digits)
    if (text.match(/[\d\s\+\-\.]{8,}/)) {
      // Verify it looks like a phone number, not just random numbers
      const digits = text.replace(/\D/g, '');
      if (digits.length >= 8 && digits.length <= 15) return true;
    }
  }

  return false;
}

/**
 * Filter messages to keep only the conversion funnel (before booking confirmation)
 * @param {Array} messages - All messages
 * @returns {Array} Messages up to and including booking confirmation
 */
function filterToConversionFunnel(messages) {
  let bookingIndex = -1;

  // Find the first booking confirmation message
  for (let i = 0; i < messages.length; i++) {
    if (isBookingConfirmation(messages[i].message_text, messages[i].role)) {
      // Include a few messages after to capture the immediate confirmation
      bookingIndex = Math.min(i + 2, messages.length - 1);
      break;
    }
  }

  if (bookingIndex === -1) {
    // No booking found, return all messages
    return messages;
  }

  return messages.slice(0, bookingIndex + 1);
}

/**
 * Get converted conversations with full message history
 * @param {number} accountId
 * @param {Object} options
 * @returns {Array} Conversations with messages
 */
export function getConvertedConversations(accountId, options = {}) {
  const { includePostBooking = false } = options;
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
    let messages = db.prepare(`
      SELECT role, message_text, message_type, sent_at
      FROM conversations
      WHERE lead_id = ?
      ORDER BY sent_at ASC
    `).all(lead.id);

    const totalMessages = messages.length;

    // Filter to conversion funnel only (before booking)
    if (!includePostBooking) {
      messages = filterToConversionFunnel(messages);
    }

    return {
      lead,
      messages,
      messageCount: messages.length,
      totalMessageCount: totalMessages,
      truncated: messages.length < totalMessages
    };
  });
}

/**
 * Format conversation for LLM analysis
 * @param {Object} conversation
 * @returns {string}
 */
function formatConversationForAnalysis(conversation) {
  const { lead, messages, truncated, totalMessageCount } = conversation;

  let formatted = `## Conversation avec @${lead.username}\n`;
  formatted += `Funnel Step atteint: ${lead.funnel_step}\n`;
  formatted += `Résultat: CONVERTI (booking complété)\n`;
  if (truncated) {
    formatted += `Note: Conversation tronquée au moment du booking (${messages.length}/${totalMessageCount} messages)\n`;
  }
  formatted += `\n### Messages:\n\n`;

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
 * Check if a suggestion already exists in the Knowledge Base
 * @param {number} accountId
 * @param {Object} suggestion
 * @returns {Object} { exists: boolean, reason: string, matchedEntry: Object }
 */
function checkIfSuggestionExists(accountId, suggestion) {
  const db = getDb();

  // Get existing KB entries for this category
  const existingEntries = db.prepare(`
    SELECT id, category, situation, content, trigger_keywords
    FROM knowledge_base
    WHERE account_id = ? AND category = ?
  `).all(accountId, suggestion.category);

  if (existingEntries.length === 0) {
    return { exists: false };
  }

  const suggestionKeywords = new Set(
    (suggestion.trigger_keywords || []).map(k => k.toLowerCase())
  );

  for (const entry of existingEntries) {
    // Parse existing keywords
    let entryKeywords = [];
    try {
      entryKeywords = JSON.parse(entry.trigger_keywords || '[]');
    } catch (e) {
      entryKeywords = [];
    }
    const entryKeywordsSet = new Set(entryKeywords.map(k => k.toLowerCase()));

    // Check keyword overlap (if > 50% overlap, consider duplicate)
    const intersection = [...suggestionKeywords].filter(k => entryKeywordsSet.has(k));
    const keywordOverlap = suggestionKeywords.size > 0
      ? intersection.length / suggestionKeywords.size
      : 0;

    if (keywordOverlap >= 0.5) {
      return {
        exists: true,
        reason: `Keywords similaires (${intersection.join(', ')})`,
        matchedEntry: entry
      };
    }

    // Check content similarity (simple word overlap)
    const suggestionWords = new Set(
      suggestion.content.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 3)
    );
    const entryWords = new Set(
      entry.content.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 3)
    );

    const wordIntersection = [...suggestionWords].filter(w => entryWords.has(w));
    const contentOverlap = suggestionWords.size > 0
      ? wordIntersection.length / suggestionWords.size
      : 0;

    if (contentOverlap >= 0.4) {
      return {
        exists: true,
        reason: `Contenu similaire à l'entrée "${entry.situation?.substring(0, 30)}..."`,
        matchedEntry: entry
      };
    }
  }

  return { exists: false };
}

/**
 * Filter suggestions to remove duplicates that already exist in KB
 * @param {number} accountId
 * @param {Array} suggestions
 * @returns {Object} { newSuggestions: Array, duplicates: Array }
 */
export function filterDuplicateSuggestions(accountId, suggestions) {
  const newSuggestions = [];
  const duplicates = [];

  for (const suggestion of suggestions) {
    const check = checkIfSuggestionExists(accountId, suggestion);
    if (check.exists) {
      duplicates.push({ suggestion, reason: check.reason });
    } else {
      newSuggestions.push(suggestion);
    }
  }

  return { newSuggestions, duplicates };
}

/**
 * Generate a summary report from analysis results
 * @param {Object} results
 * @param {number} accountId - Optional, for duplicate checking
 * @returns {string}
 */
export function generateReport(results, accountId = null) {
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

  // Suggested KB entries - filter duplicates if accountId provided
  if (results.aggregated.suggested_knowledge_entries.length > 0) {
    report += '─'.repeat(40) + '\n';
    report += '📚 SUGGESTIONS POUR LA KNOWLEDGE BASE\n';
    report += '─'.repeat(40) + '\n\n';

    let newSuggestions = results.aggregated.suggested_knowledge_entries;
    let duplicates = [];

    // Filter duplicates if accountId is provided
    if (accountId) {
      const filtered = filterDuplicateSuggestions(accountId, results.aggregated.suggested_knowledge_entries);
      newSuggestions = filtered.newSuggestions;
      duplicates = filtered.duplicates;

      // Update results with filtered suggestions
      results.aggregated.suggested_knowledge_entries = newSuggestions;
    }

    if (newSuggestions.length > 0) {
      report += `✨ NOUVELLES suggestions (${newSuggestions.length}):\n\n`;
      newSuggestions.forEach((entry, i) => {
        report += `${i + 1}. [${entry.category.toUpperCase()}]\n`;
        report += `   Situation: ${entry.situation}\n`;
        report += `   Contenu: ${entry.content}\n`;
        report += `   Mots-clés: ${entry.trigger_keywords?.join(', ') || 'N/A'}\n\n`;
      });
    } else {
      report += `Aucune nouvelle suggestion (toutes déjà en KB)\n\n`;
    }

    if (duplicates.length > 0) {
      report += `⏭️ Ignorées car déjà en KB (${duplicates.length}):\n`;
      duplicates.forEach((d, i) => {
        report += `   - [${d.suggestion.category}] ${d.suggestion.situation?.substring(0, 40)}...\n`;
        report += `     Raison: ${d.reason}\n`;
      });
      report += '\n';
    }
  }

  return report;
}

/**
 * Save suggested entries to Knowledge Base (as inactive by default)
 * @param {number} accountId
 * @param {Array} entries
 * @param {Object} options
 * @returns {Object} Save results
 */
export async function saveToKnowledgeBase(accountId, entries, options = {}) {
  const { active = false } = options; // New entries are inactive by default
  const db = getDb();

  const results = {
    saved: 0,
    skipped: 0,
    errors: 0
  };

  for (const entry of entries) {
    try {
      // Check if similar entry already exists (active or inactive)
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

      // Insert new entry (inactive by default, pending review)
      db.prepare(`
        INSERT INTO knowledge_base (account_id, category, situation, content, trigger_keywords, is_active)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        accountId,
        entry.category,
        entry.situation,
        entry.content,
        JSON.stringify(entry.trigger_keywords || []),
        active ? 1 : 0
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
  const { maxConversations = 5 } = options;

  // Run analysis
  const results = await analyzeConvertedConversations(accountId, { maxConversations });

  if (!results.success === false) {
    console.error('Analysis failed:', results.error);
    return results;
  }

  // Generate report (with duplicate filtering)
  const report = generateReport(results, accountId);
  console.log(report);

  // Auto-save new suggestions as INACTIVE (pending review in dashboard)
  if (results.aggregated.suggested_knowledge_entries.length > 0) {
    console.log('\n💾 Sauvegarde des suggestions (en attente de validation)...');
    const saveResults = await saveToKnowledgeBase(
      accountId,
      results.aggregated.suggested_knowledge_entries,
      { active: false } // Inactive by default
    );
    console.log(`   ✅ Sauvegardées (inactives): ${saveResults.saved}`);
    console.log(`   ⏭️ Ignorées (doublons): ${saveResults.skipped}`);
    if (saveResults.errors > 0) {
      console.log(`   ❌ Erreurs: ${saveResults.errors}`);
    }
    if (saveResults.saved > 0) {
      console.log(`\n   👉 Activez-les dans le dashboard: npm run ui`);
    }
  }

  return results;
}

export default {
  getConvertedConversations,
  analyzeConvertedConversations,
  generateReport,
  filterDuplicateSuggestions,
  saveToKnowledgeBase,
  runFullAnalysis
};

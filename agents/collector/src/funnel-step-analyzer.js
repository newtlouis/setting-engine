/**
 * Funnel Step Analyzer
 *
 * Analyzes conversations step-by-step against funnel scripts to detect
 * adaptations and suggest RAG entries for reusable patterns.
 */

import { getDb } from './db/core.js';
import { filterDuplicateSuggestions, saveToKnowledgeBase } from './conversation-analyzer.js';
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
 * Get conversation messages for a specific username
 * @param {Object} db - Database instance
 * @param {string} username - Instagram username
 * @param {number} accountId - Account ID
 * @returns {Object|null} { lead, messages }
 */
export function getConversationForUser(db, username, accountId) {
  const lead = db.prepare(`
    SELECT * FROM leads
    WHERE username = ? AND account_id = ?
  `).get(username, accountId);

  if (!lead) return null;

  const messages = db.prepare(`
    SELECT role, message_text, sent_at
    FROM conversations
    WHERE lead_id = ?
    ORDER BY sent_at ASC
  `).all(lead.id);

  return { lead, messages };
}

/**
 * Get all funnel scripts for an account
 * @param {Object} db - Database instance
 * @param {number} accountId - Account ID
 * @returns {Array} Funnel stages with conversation_script
 */
export function getFunnelScripts(db, accountId) {
  return db.prepare(`
    SELECT stage_order, stage_name, stage_label, conversation_script
    FROM funnel_stages
    WHERE account_id = ? AND is_active = 1
    ORDER BY stage_order ASC
  `).all(accountId);
}

/**
 * Analyze step adaptations using LLM
 * @param {Array} messages - Conversation messages
 * @param {Array} funnelScripts - Funnel stage scripts
 * @param {string} username - Lead username
 * @returns {Promise<Object>} Analysis result
 */
export async function analyzeStepAdaptations(messages, funnelScripts, username) {
  // Format funnel scripts
  let scriptsBlock = '';
  for (const stage of funnelScripts) {
    scriptsBlock += `\n### ${stage.stage_label} - ${stage.stage_name} (order: ${stage.stage_order})\n`;
    scriptsBlock += stage.conversation_script || '(pas de script defini)';
    scriptsBlock += '\n';
  }

  // Format conversation messages
  let conversationBlock = '';
  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'COACH' : 'PROSPECT';
    // Detect step tag
    const stepMatch = msg.message_text?.match(/\[STEP_(\d+)/i);
    const stepTag = stepMatch ? ` [STEP_${stepMatch[1]}]` : '';
    conversationBlock += `${role}${stepTag}: ${msg.message_text}\n\n`;
  }

  // Count assistant messages for the prompt
  const assistantCount = messages.filter(m => m.role === 'assistant').length;

  const prompt = `Tu es un expert en analyse de conversations de vente/coaching.

Voici les SCRIPTS DU FUNNEL (le comportement attendu par etape) :
${scriptsBlock}

---

Voici la CONVERSATION REELLE avec @${username} :
${conversationBlock}

---

INSTRUCTIONS IMPORTANTES :
- Il y a ${assistantCount} messages ASSISTANT dans cette conversation.
- Tu DOIS analyser CHAQUE message ASSISTANT, un par un, dans l'ordre chronologique.
- Ne saute AUCUN message. Je veux exactement ${assistantCount} entrees dans "steps_analysis".
- Pour chaque message ASSISTANT, compare precisement avec le script de l'etape correspondante.
- Si le coach a adapte/personnalise sa reponse par rapport au script standard (reformulation, reponse a une question imprevue, ajout contextuel), c'est une adaptation.

Pour chaque message ASSISTANT, analyse :
1. Quelle etape du funnel a ete utilisee (base-toi sur le tag [STEP_X] s'il est present, sinon deduis)
2. Comment le message a ete adapte par rapport au script standard (compare mot a mot avec le script)
3. Pourquoi (quel message du prospect a declenche cette adaptation)
4. Si cette adaptation est un pattern reutilisable (utile comme entree RAG)

Reponds UNIQUEMENT avec du JSON valide, sans commentaires, au format :
{
  "steps_analysis": [
    {
      "step_number": 2,
      "user_message_summary": "Resume du message prospect AVANT ce message assistant",
      "assistant_message_summary": "Resume du message assistant",
      "standard_behavior": "Ce que le script prevoyait pour cette etape",
      "adaptation": "Ce qui a ete change/adapte par rapport au script",
      "adaptation_trigger": "Ce qui a declenche l'adaptation (message prospect, contexte...)",
      "is_useful_pattern": true,
      "suggested_rag_entry": {
        "category": "technique",
        "situation": "Quand...",
        "content": "Faire...",
        "trigger_keywords": ["mot1", "mot2"],
        "applicable_steps": [2]
      }
    }
  ],
  "summary": "Resume global de la conversation"
}

Note : "suggested_rag_entry" doit etre null si is_useful_pattern est false.
RAPPEL : Je veux ${assistantCount} entrees dans steps_analysis, une par message assistant.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 8000
  });

  const content = response.choices[0].message.content;
  const jsonMatch = content.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error('Could not parse JSON from LLM response');
  }

  return JSON.parse(jsonMatch[0]);
}

/**
 * Format analysis report for console output
 * @param {Object} analysis - LLM analysis result
 * @param {string} username - Lead username
 * @returns {string} Formatted report
 */
export function formatReport(analysis, username) {
  let report = '\n' + '='.repeat(60) + '\n';
  report += `📊 ANALYSE STEP-BY-STEP : @${username}\n`;
  report += '='.repeat(60) + '\n\n';

  if (analysis.summary) {
    report += `📝 Resume : ${analysis.summary}\n\n`;
  }

  if (!analysis.steps_analysis || analysis.steps_analysis.length === 0) {
    report += '   Aucune analyse disponible.\n';
    return report;
  }

  for (const step of analysis.steps_analysis) {
    report += '─'.repeat(40) + '\n';
    report += `🔹 STEP ${step.step_number}\n`;
    report += '─'.repeat(40) + '\n';
    report += `   Prospect : ${step.user_message_summary}\n`;
    report += `   Assistant : ${step.assistant_message_summary}\n`;
    report += `   Script prevu : ${step.standard_behavior}\n`;
    report += `   Adaptation : ${step.adaptation}\n`;
    report += `   Declencheur : ${step.adaptation_trigger}\n`;

    if (step.is_useful_pattern && step.suggested_rag_entry) {
      report += `   ✅ Pattern reutilisable !\n`;
      report += `      Categorie : ${step.suggested_rag_entry.category}\n`;
      report += `      Situation : ${step.suggested_rag_entry.situation}\n`;
      report += `      Contenu : ${step.suggested_rag_entry.content}\n`;
      report += `      Keywords : ${step.suggested_rag_entry.trigger_keywords?.join(', ') || 'N/A'}\n`;
      report += `      Steps : ${step.suggested_rag_entry.applicable_steps?.join(', ') || 'N/A'}\n`;
    } else {
      report += `   ⬜ Pas de pattern reutilisable\n`;
    }
    report += '\n';
  }

  return report;
}

/**
 * Run the full step analysis pipeline
 * @param {number} accountId - Account ID
 * @param {Array<string>} usernames - List of usernames to analyze
 * @param {Object} options - { save: boolean }
 * @returns {Promise<Object>} Pipeline results
 */
export async function runStepAnalysis(accountId, usernames, options = {}) {
  const { save = false } = options;
  const db = getDb();

  // Load funnel scripts
  const funnelScripts = getFunnelScripts(db, accountId);
  if (funnelScripts.length === 0) {
    console.error('❌ Aucun funnel stage configure pour ce compte');
    return { success: false, error: 'No funnel stages configured' };
  }

  console.log(`📋 ${funnelScripts.length} etapes de funnel chargees`);

  const results = {
    analyzed: 0,
    errors: 0,
    analyses: [],
    allSuggestedEntries: []
  };

  for (const username of usernames) {
    console.log(`\n🔍 Analyse de @${username}...`);

    // Load conversation
    const data = getConversationForUser(db, username, accountId);
    if (!data) {
      console.log(`   ❌ Lead @${username} non trouve`);
      results.errors++;
      continue;
    }

    if (data.messages.length === 0) {
      console.log(`   ⚠️  Aucun message pour @${username}`);
      results.errors++;
      continue;
    }

    console.log(`   📨 ${data.messages.length} messages charges`);

    try {
      // Analyze
      const analysis = await analyzeStepAdaptations(data.messages, funnelScripts, username);

      // Display report
      const report = formatReport(analysis, username);
      console.log(report);

      results.analyzed++;
      results.analyses.push({ username, analysis });

      // Collect suggested RAG entries
      const suggestedEntries = (analysis.steps_analysis || [])
        .filter(s => s.is_useful_pattern && s.suggested_rag_entry)
        .map(s => s.suggested_rag_entry);

      results.allSuggestedEntries.push(...suggestedEntries);

    } catch (err) {
      console.log(`   ❌ Erreur: ${err.message}`);
      results.errors++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 BILAN');
  console.log('='.repeat(60));
  console.log(`   Analyses reussies : ${results.analyzed}`);
  console.log(`   Erreurs : ${results.errors}`);
  console.log(`   Patterns detectes : ${results.allSuggestedEntries.length}`);

  // Save RAG entries if requested
  if (save && results.allSuggestedEntries.length > 0) {
    console.log('\n💾 Sauvegarde des entrees RAG...');

    // Filter duplicates
    const { newSuggestions, duplicates } = filterDuplicateSuggestions(accountId, results.allSuggestedEntries);

    if (duplicates.length > 0) {
      console.log(`   ⏭️  ${duplicates.length} doublon(s) ignore(s)`);
    }

    if (newSuggestions.length > 0) {
      // Add applicable_steps to each entry before saving
      const entriesToSave = newSuggestions.map(entry => ({
        ...entry,
        applicable_steps: JSON.stringify(entry.applicable_steps || [])
      }));

      const saveResults = await saveToKnowledgeBase(accountId, entriesToSave, { active: false });
      console.log(`   ✅ Sauvegardees (inactives) : ${saveResults.saved}`);
      console.log(`   ⏭️  Ignorees (doublons exacts) : ${saveResults.skipped}`);
      if (saveResults.errors > 0) {
        console.log(`   ❌ Erreurs : ${saveResults.errors}`);
      }
      if (saveResults.saved > 0) {
        console.log(`\n   👉 Activez-les dans le dashboard : npm run ui`);
      }
    } else {
      console.log('   Aucune nouvelle entree a sauvegarder.');
    }
  } else if (!save && results.allSuggestedEntries.length > 0) {
    console.log(`\n💡 Utilisez --save pour sauvegarder les ${results.allSuggestedEntries.length} entree(s) RAG suggeree(s)`);
  }

  return { success: true, ...results };
}

export default {
  getConversationForUser,
  getFunnelScripts,
  analyzeStepAdaptations,
  formatReport,
  runStepAnalysis
};

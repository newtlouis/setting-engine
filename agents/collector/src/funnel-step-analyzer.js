/**
 * Funnel Step Analyzer
 *
 * Analyzes conversations step-by-step against funnel scripts to detect
 * adaptations and suggest RAG entries for reusable patterns.
 */

import { getDb } from './db/core.js';
import { saveToKnowledgeBase } from './conversation-analyzer.js';
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
 * Format a RAG entry content from principle + example
 */
function formatRagContent(principle, exampleProspect, exampleResponse) {
  return `${principle}\nExemples :\n- "${exampleProspect}" → "${exampleResponse}"`;
}

/**
 * Try to merge a new example into an existing KB entry.
 * Returns { merged: true, entryId } if merged, { merged: false } if new.
 */
function mergeOrCreateEntry(accountId, suggestion) {
  const db = getDb();

  const existingEntries = db.prepare(`
    SELECT id, situation, content, trigger_keywords
    FROM knowledge_base
    WHERE account_id = ? AND category = ?
  `).all(accountId, suggestion.category);

  const suggestionKeywords = new Set(
    (suggestion.trigger_keywords || []).map(k => k.toLowerCase())
  );

  for (const entry of existingEntries) {
    let entryKeywords = [];
    try { entryKeywords = JSON.parse(entry.trigger_keywords || '[]'); } catch (e) { /* ignore */ }
    const entryKeywordsSet = new Set(entryKeywords.map(k => k.toLowerCase()));

    const intersection = [...suggestionKeywords].filter(k => entryKeywordsSet.has(k));
    const keywordOverlap = suggestionKeywords.size > 0
      ? intersection.length / suggestionKeywords.size
      : 0;

    // Check content word similarity
    const suggestionWords = new Set(
      suggestion.response_principle.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 3)
    );
    const entryWords = new Set(
      entry.content.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 3)
    );
    const wordIntersection = [...suggestionWords].filter(w => entryWords.has(w));
    const contentOverlap = suggestionWords.size > 0
      ? wordIntersection.length / suggestionWords.size
      : 0;

    if (keywordOverlap >= 0.5 || contentOverlap >= 0.4) {
      // Check if this exact example already exists
      if (entry.content.includes(suggestion.example_prospect)) {
        return { merged: false, skipped: true, reason: `Exemple deja present dans "${entry.situation?.substring(0, 30)}..."` };
      }

      // Merge: append new example to existing content
      const newExample = `\n- "${suggestion.example_prospect}" → "${suggestion.example_response}"`;
      const updatedContent = entry.content + newExample;

      // Merge keywords
      const mergedKeywords = [...new Set([...entryKeywords.map(k => k.toLowerCase()), ...suggestionKeywords])];

      db.prepare(`
        UPDATE knowledge_base
        SET content = ?, trigger_keywords = ?
        WHERE id = ?
      `).run(updatedContent, JSON.stringify(mergedKeywords), entry.id);

      return { merged: true, entryId: entry.id, entryName: entry.situation?.substring(0, 40) };
    }
  }

  return { merged: false, skipped: false };
}

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
- Pour chaque message ASSISTANT, compare PRECISEMENT MOT A MOT avec le script de l'etape correspondante.

TYPES D'ADAPTATIONS A DETECTER (sois tres attentif) :
1. **Parties du script RETIREES** : Le coach a volontairement supprime une partie du script parce que le contexte la rend inutile. Exemple : si le prospect a deja dit son probleme (ex: "je me suis separe"), le coach retire la question "C'est plus en amour, en amitie, au travail ?" car la reponse est deja connue.
2. **Reponses a des questions imprevues** : Le prospect pose une question qui n'est pas dans le script (ex: "tu veux me coacher ?"), et le coach repond avant de continuer le script.
3. **Ajouts contextuels** : Le coach ajoute un element qui n'est pas dans le script (ex: "Sait-on jamais ?" pour relancer).
4. **Reformulations** : Le coach reformule le script en fonction du ton/contexte du prospect.
5. **Decoupage ou fusion de messages** : Le coach envoie le script en plusieurs messages, ou fusionne des etapes.

CHACUNE de ces adaptations est un pattern reutilisable (is_useful_pattern = true) car elle montre comment adapter le script au contexte.

Pour chaque message ASSISTANT, analyse :
1. Quelle etape du funnel a ete utilisee (base-toi sur le tag [STEP_X] s'il est present, sinon deduis)
2. Cite le passage exact du script prevu, puis cite le message reellement envoye, et identifie les differences
3. Pourquoi cette adaptation (quel message du prospect ou quel contexte l'a declenchee)
4. Si c'est un pattern reutilisable

Reponds UNIQUEMENT avec du JSON valide, sans commentaires, au format :
{
  "steps_analysis": [
    {
      "step_number": 2,
      "user_message_summary": "Resume du message prospect AVANT ce message assistant",
      "assistant_message_summary": "Resume du message assistant",
      "script_expected": "Citation exacte du passage du script qui aurait du etre envoye",
      "message_sent": "Citation exacte du message reellement envoye",
      "adaptation_type": "removed_part|unexpected_response|contextual_addition|reformulation|split_merge|none",
      "adaptation": "Description de ce qui a ete change et pourquoi",
      "adaptation_trigger": "Ce qui a declenche l'adaptation (message prospect, contexte accumule...)",
      "is_useful_pattern": true,
      "suggested_rag_entry": {
        "category": "technique",
        "situation": "Description generale de la situation (ex: 'Quand le prospect pose une question imprevue sur le coaching')",
        "response_principle": "Le principe de reponse SANS exemple (ex: 'Reponds avec humour et legerete avant de revenir au script')",
        "example_prospect": "Le message exact du prospect qui a declenche l'adaptation (ex: 'Tu viens me coacher ?')",
        "example_response": "Le message exact reellement envoye par le coach (ex: 'Sait-on jamais ? 😄')",
        "trigger_keywords": ["mot1", "mot2"],
        "applicable_steps": [2]
      }
    }
  ],
  "summary": "Resume global avec nombre d'adaptations detectees"
}

Note : "suggested_rag_entry" doit etre null si is_useful_pattern est false.

IMPORTANT pour les suggested_rag_entry :
- "situation" doit etre GENERALE (pas d'exemple specifique dedans). Ex: "Quand le prospect pose une question imprevue sur le coaching"
- "response_principle" est le PRINCIPE de reponse, sans citer de message. Ex: "Reponds avec humour et legerete avant de revenir au script"
- "example_prospect" est le message EXACT du prospect. Ex: "Tu viens me coacher ?"
- "example_response" est le message EXACT envoye par le coach. Ex: "Sait-on jamais ? 😄"
- L'objectif est de pouvoir accumuler plusieurs exemples pour la meme situation au fil des analyses.

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
    const typeLabel = {
      removed_part: '🔻 Partie retiree',
      unexpected_response: '💬 Reponse imprevue',
      contextual_addition: '➕ Ajout contextuel',
      reformulation: '🔄 Reformulation',
      split_merge: '✂️ Decoupage/fusion',
      none: '✅ Conforme au script'
    };

    report += '─'.repeat(40) + '\n';
    report += `🔹 STEP ${step.step_number}`;
    if (step.adaptation_type && step.adaptation_type !== 'none') {
      report += ` — ${typeLabel[step.adaptation_type] || step.adaptation_type}`;
    }
    report += '\n';
    report += '─'.repeat(40) + '\n';
    report += `   Prospect : ${step.user_message_summary}\n`;
    if (step.script_expected) {
      report += `   📜 Script prevu : "${step.script_expected}"\n`;
    }
    if (step.message_sent) {
      report += `   📤 Envoye :       "${step.message_sent}"\n`;
    }
    report += `   Adaptation : ${step.adaptation}\n`;
    report += `   Declencheur : ${step.adaptation_trigger}\n`;

    if (step.is_useful_pattern && step.suggested_rag_entry) {
      const rag = step.suggested_rag_entry;
      report += `   ✅ Pattern reutilisable !\n`;
      report += `      Situation : ${rag.situation}\n`;
      report += `      Principe : ${rag.response_principle}\n`;
      report += `      Exemple : "${rag.example_prospect}" → "${rag.example_response}"\n`;
      report += `      Keywords : ${rag.trigger_keywords?.join(', ') || 'N/A'}\n`;
      report += `      Steps : ${rag.applicable_steps?.join(', ') || 'N/A'}\n`;
    } else {
      report += `   ⬜ Conforme au script\n`;
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

    let merged = 0, created = 0, skipped = 0, errors = 0;

    for (const entry of results.allSuggestedEntries) {
      try {
        // Try to merge into existing entry
        const result = mergeOrCreateEntry(accountId, entry);

        if (result.merged) {
          console.log(`   🔀 Exemple ajoute a : "${result.entryName}..."`);
          merged++;
        } else if (result.skipped) {
          skipped++;
        } else {
          // New entry — format content from principle + example
          const content = formatRagContent(entry.response_principle, entry.example_prospect, entry.example_response);
          const toSave = {
            category: entry.category,
            situation: entry.situation,
            content,
            trigger_keywords: entry.trigger_keywords,
            applicable_steps: JSON.stringify(entry.applicable_steps || [])
          };
          const saveResult = await saveToKnowledgeBase(accountId, [toSave], { active: false });
          created += saveResult.saved;
          skipped += saveResult.skipped;
        }
      } catch (err) {
        console.error(`   ❌ Erreur: ${err.message}`);
        errors++;
      }
    }

    if (merged > 0) console.log(`   🔀 Exemples ajoutes a des entrees existantes : ${merged}`);
    if (created > 0) console.log(`   ✅ Nouvelles entrees (inactives) : ${created}`);
    if (skipped > 0) console.log(`   ⏭️  Ignores (deja presents) : ${skipped}`);
    if (errors > 0) console.log(`   ❌ Erreurs : ${errors}`);
    if (created > 0) console.log(`\n   👉 Activez-les dans le dashboard : npm run ui`);
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

/**
 * @file LLM-powered conversation engine for the DM Responder agent.
 */

import axios from 'axios';
import dotenv from 'dotenv';
import { SYSTEM_PROMPT } from './prompts.js';
import { validateConversation } from './utils.js';
import { composeSystemPrompt } from '../../../shared/domain/services/PromptComposer.js';

// Load environment variables from .env file
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// Cache for prompt data to avoid repeated DB queries
const promptCache = new Map();

// Retry wrapper for OpenAI API calls (handles rate limits)
const MAX_RETRIES = 3;
async function openaiPost(url, data, config) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await axios.post(url, data, config);
    } catch (err) {
      const status = err.response?.status;
      const errorData = err.response?.data?.error;
      const isRateLimit = status === 429 || errorData?.code === 'rate_limit_exceeded';
      if (isRateLimit && attempt < MAX_RETRIES) {
        const retryAfter = parseFloat(errorData?.message?.match(/try again in ([\d.]+)s/)?.[1]) || 15;
        const waitMs = Math.ceil((retryAfter + 2) * 1000);
        console.log(`[Engine] ⏳ Rate limit hit (attempt ${attempt}/${MAX_RETRIES}), waiting ${waitMs / 1000}s...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }
}

// ============================================
// FOREIGN LANGUAGE DETECTION
// ============================================

// Words that French speakers commonly use — should NOT trigger foreign language detection
const UNIVERSAL_WORDS = new Set([
  'hello', 'hi', 'hey', 'ok', 'okay', 'yes', 'no', 'yeah', 'yep', 'nope',
  'sure', 'thanks', 'thank', 'please', 'sorry', 'cool', 'nice', 'good', 'great',
  'lol', 'haha', 'hahaha', 'wow', 'omg', 'love', 'like', 'bye', 'ciao', 'stop',
  'of', 'course', 'the', 'a', 'it', 'is', 'my', 'me', 'you', 'and', 'or', 'but',
  'what', 'why', 'how', 'who', 'where', 'when', 'up', 'so', 'too', 'all', 'just',
  'not', 'top', 'go', 'come', 'on', 'off', 'in', 'out', 'at', 'to', 'for', 'with',
]);

// Common French words that indicate the message is in French
const FRENCH_WORDS = new Set([
  'je', 'tu', 'il', 'elle', 'nous', 'vous', 'ils', 'elles', 'on',
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'au', 'aux',
  'est', 'suis', 'sont', 'ai', 'as', 'ont', 'avons', 'avez', 'été',
  'et', 'ou', 'mais', 'donc', 'car', 'que', 'qui', 'quoi', 'dont',
  'ne', 'pas', 'plus', 'jamais', 'rien',
  'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses',
  'ce', 'cette', 'ces', 'ça', 'cela', 'ceci',
  'dans', 'sur', 'sous', 'avec', 'pour', 'par', 'entre', 'chez',
  'très', 'bien', 'aussi', 'encore', 'toujours', 'trop', 'peu',
  'oui', 'non', 'merci', 'bonjour', 'bonsoir', 'salut', 'coucou',
  'moi', 'toi', 'lui', 'eux', 'nous', 'leur', 'leurs',
  'puis', 'après', 'avant', 'pendant', 'depuis', 'vers',
  'tout', 'toute', 'tous', 'toutes', 'même', 'autre', 'autres',
  'peut', 'peux', 'veux', 'veut', 'fais', 'fait', 'va', 'vais',
  'comme', 'quand', 'si', 'parce', 'alors', 'donc',
]);

/**
 * Detect if a message is a substantial non-French sentence.
 * Returns true only for 4+ word messages with no French indicators.
 * Short/universal words (hello, yes, ok, what's up...) are ignored.
 */
function isForeignLanguageMessage(message) {
  if (!message) return false;

  const words = message.trim().split(/\s+/);
  if (words.length < 4) return false;

  const hasFrenchAccents = /[éèêëàâçùûôîïœæ]/i.test(message);
  if (hasFrenchAccents) return false;

  const cleanWords = words.map(w => w.toLowerCase().replace(/[^a-zàâçéèêëîïôùûü']/g, ''));
  const substantiveWords = cleanWords.filter(w => w.length > 1 && !UNIVERSAL_WORDS.has(w));

  // Not enough non-universal words to judge
  if (substantiveWords.length < 3) return false;

  const frenchCount = substantiveWords.filter(w => FRENCH_WORDS.has(w)).length;
  const frenchRatio = frenchCount / substantiveWords.length;

  // Less than 10% French words → likely foreign language
  return frenchRatio < 0.1;
}

/**
 * Generates a response for a conversation using an LLM.
 *
 * @param {Object} params
 * @param {Array} params.conversationHistory - Array of {role, text} objects
 * @returns {Promise<Object>} Response object with next_message, stage, reasoning, etc.
 */
export async function generateResponse({ conversationHistory, leadContext = null, profileConfig = null }) {
  // Validate input
  validateConversation(conversationHistory);

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set in the environment variables.');
  }

  try {
    // The user's last message is the prompt for the LLM
    const llmResponse = await getLlmResponse(conversationHistory, leadContext, profileConfig);

    // Structure the response to match the expected output format
    return {
      next_message: llmResponse.message,
      message_type: "empathy_and_discovery",
      reasoning: "Generated by LLM.",
      step_used: llmResponse.step_used || null,
      booking_intent: llmResponse.booking_intent || null,
      alternative_approaches: [
        "Ask a more direct question about their challenges.",
        "Share a relatable, brief anecdote.",
        "Offer a small piece of actionable advice to build trust."
      ],
      next_steps: [
        "Wait for their response.",
        "Analyze the response for pain points and goals.",
        "Continue building trust before suggesting any next steps."
      ]
    };
  } catch (error) {
    console.error("Error generating LLM response:", error.response ? error.response.data : error.message);
    throw new Error('Failed to get a response from the LLM.');
  }
}

/**
 * Generates a specific revival message when the last interaction was not a question.
 */
export async function generateRevivalMessage(conversationHistory, leadContext) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required');

  const systemPrompt = `
    You are an Instagram outreach expert. 
    Your goal is to re-engage a prospect who has stopped replying.
    
    CONTEXT:
    The last message you sent was NOT a question (e.g., "Ok no problem", "Understood").
    You must now send a friendly follow-up question to restart the conversation.
    
    INSTRUCTIONS:
    1. Analyze the conversation history, especially the prospect's last message (excuse, objection, busy, etc.).
    2. Generate a SHORT, casual, and empathetic question.
    3. Example: If they said "I'm busy", ask "Hey, how are you? Did you find some time for yourself?"
    4. Example: If they said "I'll watch later", ask "Coucou! Did you get a chance to watch the video?"
    5. Be subtle. Do not sound desperate.
    6. Language: MATCH THE LANGUAGE OF THE CONVERSATION (French or English).
  `;

  return getLlmResponse(conversationHistory, leadContext, { 
      dm_responder: { system_prompt: systemPrompt } 
  });
}

/**
 * Get the system prompt from database for an account
 * @param {number} accountId - The account ID
 * @param {number} funnelStep - Current funnel step to focus the prompt
 * @returns {Promise<string|null>} The composed system prompt or null if not configured
 */
async function getPromptFromDatabase(accountId, funnelStep = 0, variant = 'A') {
  if (!accountId) return null;

  // Check cache first (keyed by account + step + variant)
  const cacheKey = `prompt_${accountId}_step${funnelStep}_v${variant}`;
  if (promptCache.has(cacheKey)) {
    const cached = promptCache.get(cacheKey);
    // Cache for 5 minutes
    if (Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return cached.prompt;
    }
  }

  try {
    const { getContainer } = await import('../../../shared/container.js');
    const container = await getContainer();
    const funnelRepo = container.repositories.funnel;

    const { persona, stages } = await funnelRepo.getPromptData(accountId);

    // Check if we have conversation scripts in the database
    const hasScripts = stages.some(s => s.conversationScript);

    if (!hasScripts && !persona) {
      // No database config, will fall back to config file
      return null;
    }

    const prompt = composeSystemPrompt({ persona, stages, currentStep: funnelStep, variant });

    // Cache the result
    promptCache.set(cacheKey, { prompt, timestamp: Date.now() });

    return prompt;
  } catch (error) {
    console.error('[Engine] Failed to get prompt from database:', error.message);
    return null;
  }
}

/**
 * Clear the prompt cache (useful after updates)
 */
export function clearPromptCache(accountId = null) {
  if (accountId) {
    promptCache.delete(`prompt_${accountId}`);
  } else {
    promptCache.clear();
  }
}

/**
 * Calls the OpenAI API to get a contextual response.
 * @param {Array} conversationHistory - The history of the conversation.
 * @returns {Promise<string>} The text of the next message.
 */
async function getLlmResponse(conversationHistory, leadContext, profileConfig = null) {
  const headers = {
    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  };

  // Inject current date/time so the LLM can interpret relative dates correctly
  // (e.g. "demain" in yesterday's message = "aujourd'hui")
  const now = new Date();
  const currentDateTime = now.toLocaleString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris'
  });

  // Build a context description if available
  let contextDescription = `\n\nDATE ET HEURE ACTUELLES : ${currentDateTime}\n⚠️ Les horodatages entre crochets [HH:MM JJ/MM] indiquent QUAND chaque message a été envoyé. Utilise-les pour interpréter les dates relatives ("demain", "ce soir", "lundi") par rapport au moment où le message a été écrit, PAS par rapport à maintenant.\n`;
  if (leadContext) {
    contextDescription += `\nCONTEXTE DU PROSPECT (Utilise ces infos pour personnaliser l'échange) :\n`;
    if (leadContext.username) contextDescription += `- Username: @${leadContext.username}\n`;
    if (leadContext.fullName) contextDescription += `- Nom: ${leadContext.fullName}\n`;
    if (leadContext.biography) contextDescription += `- Bio: ${leadContext.biography}\n`;
    if (leadContext.pain_points) contextDescription += `- Problèmes identifiés: ${leadContext.pain_points}\n`;
    if (leadContext.goals) contextDescription += `- Objectifs: ${leadContext.goals}\n`;
    if (leadContext.funnel_step) contextDescription += `- Étape actuelle du funnel (1-9): ${leadContext.funnel_step}\n`;
    if (leadContext.notes) contextDescription += `- Notes: ${leadContext.notes}\n`;
  }

  // Check if last message is a non-text media (voice note, image, sticker)
  const lastConvMsg = conversationHistory?.length > 0 ? conversationHistory[conversationHistory.length - 1] : null;
  if (lastConvMsg && lastConvMsg.text && lastConvMsg.text.includes('[Message non-texte')) {
    contextDescription += `\n⚠️ Le prospect a répondu avec un message vocal/image/sticker qu'on ne peut pas lire. Considère que c'est une réponse positive et continue normalement avec la prochaine étape du script. Ne mentionne PAS que tu n'as pas pu lire le message.\n`;
  }

  // Determine System Prompt (priority: database > profileConfig > default)
  let systemPrompt = SYSTEM_PROMPT;

  // Try to get prompt from database first (if accountId is available)
  const accountId = leadContext?.account_id || profileConfig?.account_id || null;
  const funnelStep = leadContext?.funnel_step || 0;
  const variant = leadContext?.variant || 'A';
  if (accountId) {
    const dbPrompt = await getPromptFromDatabase(accountId, funnelStep, variant);
    if (dbPrompt) {
      systemPrompt = dbPrompt;
    }
  }

  // Fall back to config file if no database prompt
  if (systemPrompt === SYSTEM_PROMPT && profileConfig?.dm_responder?.system_prompt) {
    systemPrompt = profileConfig.dm_responder.system_prompt;
  }

  // === RAG ENRICHMENT ===
  // Retrieve relevant knowledge and similar conversations (accountId already defined above)
  if (accountId) {
    try {
      const { getContainer } = await import('../../../shared/container.js');
      const container = await getContainer();
      const ragRetriever = container.services.ragRetriever;

      // Get all consecutive user messages at the end (prospects often send multiple messages)
      const lastProspectMessages = [];
      for (let i = conversationHistory.length - 1; i >= 0; i--) {
        if (conversationHistory[i].role === 'user') {
          lastProspectMessages.unshift(conversationHistory[i].text);
        } else {
          break;
        }
      }
      const lastProspectMessage = lastProspectMessages.join(' ') || '';

      console.log(`[Engine] RAG lookup for: "${lastProspectMessage}" (step: ${leadContext?.funnel_step})`);
      if (lastProspectMessage) {
        const ragResults = await ragRetriever.retrieve({
          prospectMessage: lastProspectMessage,
          leadContext,
          accountId
        });

        console.log(`[Engine] RAG results: ${ragResults.relevantKnowledge.length} semantic, ${ragResults.keywordMatches.length} keyword`);
        if (ragResults.keywordMatches.length > 0) {
          ragResults.keywordMatches.forEach(km => console.log(`[Engine] RAG keyword match: #${km.id} via "${km.matchedKeyword}"`));
        }

        if (ragRetriever.hasRelevantResults(ragResults)) {
          const ragContext = ragRetriever.formatForPrompt(ragResults);
          contextDescription += `\n\n${ragContext}`;
          console.log(`[Engine] RAG injected ${ragResults.relevantKnowledge.length} entries into prompt`);
        } else {
          console.log(`[Engine] RAG: no relevant results found`);
        }
      }
    } catch (e) {
      console.error('[Engine] RAG retrieval failed (continuing without):', e.message);
      // Continue without RAG - graceful degradation
    }
  }

  // Inject booking availability when needed (call proposed or prospect proposes a meeting)
  const currentStep = leadContext?.funnel_step || 0;
  const lastAssistantMsg = conversationHistory.filter(m => m.role === 'assistant').pop()?.text?.toLowerCase() || '';
  const lastUserMsg = conversationHistory.filter(m => m.role === 'user').pop()?.text?.toLowerCase() || '';
  const callProposedByUs = lastAssistantMsg.includes('30 min') || lastAssistantMsg.includes('appel') || lastAssistantMsg.includes('se call') || lastAssistantMsg.includes('on prenne') || lastAssistantMsg.includes('créneau') || lastAssistantMsg.includes('creneau') || lastAssistantMsg.includes('on se cale');
  const callProposedByProspect = lastUserMsg.includes('visio') || lastUserMsg.includes('appel') || lastUserMsg.includes('rdv') || lastUserMsg.includes('rendez-vous') || lastUserMsg.includes('créneau') || lastUserMsg.includes('creneau') || lastUserMsg.includes('disponibilité') || lastUserMsg.includes('disponibilite') || lastUserMsg.includes('s\'appeler') || lastUserMsg.includes('on se call') || lastUserMsg.includes('09h') || lastUserMsg.includes('10h') || lastUserMsg.includes('11h') || lastUserMsg.includes('14h') || lastUserMsg.includes('15h') || lastUserMsg.includes('16h') || lastUserMsg.includes('17h') || lastUserMsg.includes('18h');
  const needsSlots = currentStep >= 4 || callProposedByUs || callProposedByProspect;
  console.log(`[Engine] Booking check: step=${currentStep}, callProposedByUs=${callProposedByUs}, callProposedByProspect=${callProposedByProspect}, needsSlots=${needsSlots}`);
  if (needsSlots) {
      try {
          const { resolveBookingAdapter } = await import('../../../shared/infrastructure/booking/BookingAdapterFactory.js');
          const { getDb } = await import('../../../agents/collector/src/db/core.js');

          // Resolve the right adapter based on account's booking_mode
          let profileName = profileConfig?.profile_name || 'default';
          let adapter;
          if (accountId) {
              const resolved = resolveBookingAdapter(getDb, accountId);
              adapter = resolved.adapter;
              profileName = resolved.profileName;
          } else {
              const { createCalendlyAdapter } = await import('../../../shared/infrastructure/booking/CalendlyAdapter.js');
              adapter = createCalendlyAdapter();
          }

          const availability = await adapter.fetchAvailability(profileName);

          const formatSlot = (s) => {
              const d = new Date(s.start_time);
              const readable = d.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
              return `${readable} [ISO:${s.start_time}]`;
          };

          const hasThisWeek = availability.thisWeek?.primary?.length > 0;
          const hasNextWeek = availability.nextWeek?.primary?.length > 0;

          if (hasThisWeek || hasNextWeek) {
              contextDescription += `\n\nDISPONIBILITÉS RÉELLES :\n`;

              if (hasThisWeek) {
                  contextDescription += `\nCETTE SEMAINE :\n`;
                  contextDescription += `- PROPOSITION PRIMAIRE : ${availability.thisWeek.primary.map(formatSlot).join(', ')}\n`;
                  if (availability.thisWeek.backup.length > 0) {
                      contextDescription += `- PROPOSITION DE SECOURS : ${availability.thisWeek.backup.map(formatSlot).join(', ')}\n`;
                  }
                  if (availability.thisWeek.all?.length > 0) {
                      contextDescription += `- TOUS LES CRÉNEAUX DISPONIBLES : ${availability.thisWeek.all.map(formatSlot).join(', ')}\n`;
                  }
              }

              if (hasNextWeek) {
                  contextDescription += `\nSEMAINE PROCHAINE :\n`;
                  contextDescription += `- PROPOSITION PRIMAIRE : ${availability.nextWeek.primary.map(formatSlot).join(', ')}\n`;
                  if (availability.nextWeek.backup.length > 0) {
                      contextDescription += `- PROPOSITION DE SECOURS : ${availability.nextWeek.backup.map(formatSlot).join(', ')}\n`;
                  }
                  if (availability.nextWeek.all?.length > 0) {
                      contextDescription += `- TOUS LES CRÉNEAUX DISPONIBLES : ${availability.nextWeek.all.map(formatSlot).join(', ')}\n`;
                  }
              }

              contextDescription += `\nINSTRUCTIONS :\n`;
              // Check if prospect has expressed a clear business objective in conversation history
              const allUserMsgs = conversationHistory.filter(m => m.role === 'user').map(m => m.text?.toLowerCase() || '').join(' ');
              const objectiveKeywords = ['client', 'clients', 'scaler', 'structurer', 'automatiser', 'déléguer', 'ca ', 'chiffre', 'revenus', 'visibilité', 'positionnement', 'offre', 'vendre', 'vente', 'développer', 'croissance', 'système', 'prospect', 'business', 'activité', 'lancement', 'connaître', 'audience', 'communauté', 'charge mentale', 'objectif', 'challenge', 'bloquer', 'blocage', 'problème'];
              const hasExpressedObjective = objectiveKeywords.some(kw => allUserMsgs.includes(kw));
              if (callProposedByProspect && !hasExpressedObjective && currentStep < 5) {
                  contextDescription += `- ⚠️ RÈGLE PRIORITAIRE : Le prospect propose un appel MAIS n'a pas encore exprimé d'objectif business clair dans la conversation. Tu ne dois PAS accepter l'appel tout de suite. Réponds avec enthousiasme ("Avec plaisir !") puis enchaîne IMMÉDIATEMENT avec une question sur son objectif : "Avant qu'on se cale ça, dis-moi, c'est quoi ton plus gros challenge dans ton activité en ce moment ?" Une fois l'objectif identifié, tu pourras proposer les créneaux.\n`;
              }
              contextDescription += `- ⚠️ TOUS les créneaux ci-dessus sont en HEURE DE PARIS (Europe/Paris). Ne précise PAS "heure de Paris" dans ton message SAUF si le prospect a mentionné être dans un autre pays/fuseau (Canada, Belgique, etc.). Dans ce cas seulement, ajoute "(heure de Paris)".\n`;
              contextDescription += `- ⚠️ RÈGLE CRITIQUE : Si le prospect PROPOSE un créneau (jour + heure), tu DOIS vérifier qu'il figure dans "TOUS LES CRÉNEAUX DISPONIBLES" ci-dessus. S'il Y FIGURE, confirme-le immédiatement. S'il N'Y EST PAS, ne confirme JAMAIS. Réponds : "Malheureusement je ne suis pas dispo à ce moment-là ! Je peux te proposer [CRENEAU_1] ou [CRENEAU_2], ça te conviendrait ?" en proposant 2 créneaux de la liste sur 2 jours différents.\n`;
              contextDescription += `- Propose d'abord les créneaux CETTE SEMAINE.\n`;
              contextDescription += `- Si le prospect dit ne pas pouvoir cette semaine ou demande la semaine prochaine → propose les créneaux SEMAINE PROCHAINE.\n`;
              // Inject STEP_6 and STEP_7 scripts so the LLM knows EXACTLY what to say after booking validation
              if (accountId) {
                  try {
                      const step6 = getDb().prepare("SELECT conversation_script FROM funnel_stages WHERE account_id = ? AND stage_name = 'step6'").get(accountId);
                      const step7 = getDb().prepare("SELECT conversation_script FROM funnel_stages WHERE account_id = ? AND stage_name = 'step7'").get(accountId);
                      if (step6?.conversation_script) {
                          contextDescription += `- ⚠️ RÈGLE CRITIQUE APRÈS VALIDATION D'UN CRÉNEAU : Utilise EXACTEMENT ce script (STEP_6) :\n${step6.conversation_script}\n`;
                      }
                      if (step7?.conversation_script) {
                          contextDescription += `- APRÈS RÉCEPTION DES COORDONNÉES, utilise ce script (STEP_7) :\n${step7.conversation_script}\n`;
                      }
                  } catch (e) {
                      console.error('[Engine] Failed to inject STEP_6/7 scripts:', e.message);
                  }
              }
              contextDescription += `- Si le lead a validé un créneau DE LA LISTE -> utilise EXACTEMENT le script STEP_6 ci-dessus. Ne demande PAS d'email/téléphone de ta propre initiative — envoie le message type tel quel.\n`;
              contextDescription += `- Si le lead a donné ses coordonnées -> utilise le script STEP_7 ci-dessus.\n`;
          } else {
              contextDescription += `\n\n⚠️ AUCUN CRÉNEAU DISPONIBLE. N'invente PAS de créneaux. Demande simplement au prospect quand il serait disponible dans la semaine et dis-lui que tu reviendras vers lui avec des créneaux précis.\n`;
          }
      } catch (e) {
          console.error("[Engine] Failed to fetch booking availability:", e.message);
          contextDescription += `\n\n⚠️ AUCUN CRÉNEAU DISPONIBLE. N'invente PAS de créneaux. Demande simplement au prospect quand il serait disponible dans la semaine et dis-lui que tu reviendras vers lui avec des créneaux précis.\n`;
      }
  }

  // Inject video resources if available (for STEP_5 video CTA alternative)
  if (currentStep >= 4 && currentStep <= 5 && accountId) {
      try {
          const { getVideoResources } = await import('./db_integration.js');
          const { matchVideo } = await import('../../../shared/domain/services/VideoMatcher.js');
          const videoEntries = await getVideoResources(accountId);
          if (videoEntries.length > 0) {
              const bestVideo = matchVideo(videoEntries, {
                  conversationHistory,
                  leadContext,
                  applicableContext: 'funnel_alternative'
              });
              if (bestVideo) {
                  contextDescription += `\n\nVIDEOS RESSOURCES DISPONIBLES :\n`;
                  contextDescription += `Video recommandée : "${bestVideo.content}" → ${bestVideo.video_url}\n`;
                  contextDescription += `Utilise cette video comme CTA alternatif si le prospect hésite à prendre un appel (hésitation molle). Reste au STEP_5 après.\n`;
              }
          }
      } catch (e) {
          console.error('[Engine] Video resource injection failed (continuing without):', e.message);
      }
  }

  // Force JSON output instruction
  systemPrompt += `
  
  IMPORTANT: Ton output DOIT être un JSON valide, sans markdown, au format suivant :
  {
      "message": "Le texte du message à envoyer",
      "step_used": "6",
      "booking_intent": {
          "slot": "2026-02-05T14:00:00Z",
          "email": "lead@mail.com",
          "phone": "06..."
      }
  }
  "step_used" correspond au numéro de l'étape du script que tu viens d'utiliser (1, 2, 3, 4, 5, 6, 7, 8 ou 9).
  "booking_intent" ne doit être rempli QUE si tu as TOUTES les informations (créneau choisi, email, téléphone) pour valider le RDV. Sinon, mets null.
  ⚠️ Pour le champ "slot" : copie EXACTEMENT la valeur ISO entre crochets [ISO:...] du créneau choisi. N'essaie JAMAIS de construire l'ISO toi-même.
  `;


  // The messages payload starts with the system prompt + context
  const messages = [
    { role: 'system', content: systemPrompt + contextDescription },
    ...conversationHistory.map(msg => {
      // Prefix each message with its timestamp so the LLM can track time gaps
      let content = msg.text;
      if (msg.timestamp) {
        const d = new Date(msg.timestamp);
        const ts = d.toLocaleString('fr-FR', {
          hour: '2-digit', minute: '2-digit',
          day: '2-digit', month: '2-digit',
          timeZone: 'Europe/Paris'
        });
        content = `[${ts}] ${msg.text}`;
      }
      return { role: msg.role, content };
    }),
  ];

  const data = {
    model: 'gpt-4o', // Or 'gpt-3.5-turbo' for faster, cheaper responses
    messages: messages,
    temperature: 0.3, // Low for consistent tag usage, enough for natural tone
    max_tokens: 1024,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    response_format: { type: "json_object" } // Enforce JSON mode
  };

  // === FOREIGN LANGUAGE PRE-CHECK ===
  // If the prospect wrote a real sentence in a non-French language, close politely in their language
  const lastUserMsgText = conversationHistory.filter(m => m.role === 'user').pop()?.text || '';
  if (isForeignLanguageMessage(lastUserMsgText)) {
    console.log('[Engine] Foreign language detected, generating closing message');
    const closingResp = await openaiPost(OPENAI_API_URL, {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Generate a very short, polite closing message in the SAME language as the user message. Say that unfortunately you only communicate in French and wish them well. 1-2 sentences max. Return ONLY the message text, no JSON.' },
        { role: 'user', content: lastUserMsgText }
      ],
      max_tokens: 100,
      temperature: 0.3
    }, { headers });
    const closingMsg = closingResp.data.choices?.[0]?.message?.content?.trim();
    if (closingMsg) {
      return { message: `[NOT_INTERESTED] ${closingMsg}`, step_used: '9', booking_intent: null };
    }
  }

  const response = await openaiPost(OPENAI_API_URL, data, { headers });

  if (response.data.choices && response.data.choices.length > 0) {
    const rawContent = response.data.choices[0].message.content.trim();
    try {
        const json = JSON.parse(rawContent);
        let message = json.message;

        // Safety net: detect closing/abandon messages
        const closingPatterns = [
          'si jamais tu changes d\'avis',
          'si tu changes d\'avis',
          'n\'hésite pas à revenir',
          'n\'hésite pas à me contacter',
          'si ça te parle un jour',
          'si un jour tu',
          'si jamais tu',
          'si jamais t\'',
          'prends soin de toi',
          'belle journée',
          'bonne journée',
          'passe une belle',
          'bonne continuation',
          'belle continuation',
          'au plaisir',
          'te souhaite le meilleur',
          'je te souhaite',
          'bonne route',
          'bonne chance',
        ];
        const lowerMsg = message.toLowerCase();
        const closingMatchCount = closingPatterns.filter(p => lowerMsg.includes(p)).length;
        const looksLikeClosing = closingMatchCount >= 1;
        const hasQuestion = message.includes('?');

        // Check if user EXPLICITLY refused (hard refusal only)
        const lastUserMsg = conversationHistory.filter(m => m.role === 'user').pop()?.text?.toLowerCase() || '';
        const hardRefusalPatterns = ['non merci', 'pas intéress', 'ça m\'intéresse pas', 'arrête', 'laisse-moi', 'stop', 'ne m\'écris plus', 'je veux pas'];
        const userHardRefused = hardRefusalPatterns.some(p => lastUserMsg.includes(p));

        if (looksLikeClosing && !userHardRefused) {
          // LLM tried to abandon but user did NOT explicitly refuse → BLOCK and force continuation
          console.log(`[Engine] 🚫 BLOCKED abandon message: "${message.substring(0, 80)}..."`);
          console.log('[Engine] User did NOT explicitly refuse. Forcing continuation...');

          // Strip the closing message and add [NOT_INTERESTED] tag with forced retry instruction
          const retryMessages = [
            ...messages,
            { role: 'assistant', content: JSON.stringify({ message, step_used: json.step_used, booking_intent: null }) },
            { role: 'user', content: '⚠️ ERREUR: Tu viens d\'abandonner la conversation alors que le prospect n\'a PAS dit non. Tu ne dois JAMAIS abandonner. Le prospect est encore engagé. Génère un nouveau message qui CONTINUE la conversation : pose une question, propose l\'appel gratuit, ou rebondis sur ce qu\'il a dit. Ne dis JAMAIS "bonne continuation" ou "je te souhaite le meilleur". JSON uniquement.' }
          ];

          const retryResp = await openaiPost(OPENAI_API_URL, { ...data, messages: retryMessages }, { headers });
          if (retryResp.data.choices?.[0]) {
            try {
              const retryJson = JSON.parse(retryResp.data.choices[0].message.content.trim());
              console.log(`[Engine] ✅ Retry succeeded: "${retryJson.message?.substring(0, 80)}..."`);
              return { message: retryJson.message, step_used: retryJson.step_used, booking_intent: retryJson.booking_intent || null };
            } catch {
              console.log('[Engine] Retry JSON parse failed, using retry raw content');
              return { message: retryResp.data.choices[0].message.content.trim(), step_used: json.step_used };
            }
          }
        }

        // If user explicitly refused AND LLM is closing, tag as NOT_INTERESTED
        if (message && !message.includes('[NOT_INTERESTED]') && looksLikeClosing && userHardRefused) {
          message = '[NOT_INTERESTED] ' + message;
          console.log('[Engine] Safety net: added [NOT_INTERESTED] tag (user explicitly refused)');
        }

        return { message, step_used: json.step_used, booking_intent: json.booking_intent || null };
    } catch (e) {
        // Fallback if model fails JSON (rare with JSON mode)
        console.warn("LLM didn't output valid JSON, falling back to raw text.");
        return { message: rawContent, step_used: null };
    }
  } else {
    throw new Error('No response choices returned from the API.');
  }
}

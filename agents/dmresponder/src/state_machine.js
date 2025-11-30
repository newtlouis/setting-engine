/**
 * Machine à États de Conversation
 * 
 * Analyse l'historique de la conversation pour déterminer l'étape et l'intention actuelles.
 */

/**
 * Analyse la conversation pour déterminer l'étape actuelle
 * 
 * @param {Array} conversationHistory - Tableau d'objets de message
 * @param {Object} leadContext - Données du prospect (optionnel)
 * @returns {string} Étape actuelle de la conversation
 */
export function analyzeConversationStage(conversationHistory, leadContext) {
  const messageCount = conversationHistory.length;
  const latestMessage = conversationHistory[messageCount - 1];

  // Vérifier les signaux d'étape explicites
  if (isSchedulingStage(conversationHistory)) {
    return 'planification';
  }

  if (isCTAStage(conversationHistory)) {
    return 'appel_a_l_action';
  }

  if (isObjectionStage(latestMessage.text)) {
    return 'gestion_objection';
  }

  if (isQualificationStage(conversationHistory)) {
    return 'qualification';
  }

  if (isValueStage(conversationHistory)) {
    return 'demonstration_valeur';
  }

  // Étapes initiales : empathie et rapport
  if (messageCount <= 2) {
    return 'rapport_initial';
  }

  if (messageCount <= 4) {
    return 'creation_empathie';
  }

  // Par défaut : qualification
  return 'qualification';
}

/**
 * Détecte l'intention de l'utilisateur dans un message
 */
export function detectIntent(messageText) {
  const text = messageText.toLowerCase();

  // Objections
  if (/too expensive|can't afford|don't have money|price|cost|trop cher|pas les moyens|prix|coût/i.test(text)) {
    return { type: 'objection', objection: 'prix' };
  }

  if (/don't have time|too busy|no time|pas le temps|trop occupé/i.test(text)) {
    return { type: 'objection', objection: 'temps' };
  }

  if (/doesn't work|tried before|scam|skeptical|doubt|ça ne marche pas|déjà essayé|arnaque|sceptique|doute/i.test(text)) {
    return { type: 'objection', objection: 'scepticisme' };
  }

  // Questions
  if (/how|what|when|where|why|can you|\?|comment|quoi|quand|où|pourquoi|pouvez-vous/i.test(text)) {
    return { type: 'pose_question' };
  }

  // Signaux positifs
  if (/interested|yes|sounds good|tell me more|when can we|book|schedule|intéressé|oui|ça me va|dites m'en plus|quand peut-on|réserver|planifier/i.test(text)) {
    return { type: 'signal_positif' };
  }

  // Expression de douleur
  if (/struggling|help|lost|frustrated|stuck|don't know|need|problem|j'ai du mal|aide|perdu|frustré|bloqué|je ne sais pas|besoin|problème/i.test(text)) {
    return { type: 'expression_douleur' };
  }

  // Neutre
  return { type: 'neutre' };
}

/**
 * Extrait les points de douleur mentionnés dans le message
 */
export function extractPainPoints(messageText) {
  const painPoints = [];

  const painPatterns = [
    // EN
    { pattern: /struggl(e|ing) with ([^.,!?]+)/i, group: 2 },
    { pattern: /can't (seem to )?([^.,!?]+)/i, group: 2 },
    { pattern: /problem with ([^.,!?]+)/i, group: 1 },
    { pattern: /frustrated (with|about) ([^.,!?]+)/i, group: 2 },
    { pattern: /don't know how to ([^.,!?]+)/i, group: 1 },
    { pattern: /need help (with )?([^.,!?]+)/i, group: 2 },
    { pattern: /stuck (with|on) ([^.,!?]+)/i, group: 2 },
    // FR
    { pattern: /j'ai du mal avec ([^.,!?]+)/i, group: 1 },
    { pattern: /je n'arrive pas à ([^.,!?]+)/i, group: 1 },
    { pattern: /mon problème est ([^.,!?]+)/i, group: 1 },
    { pattern: /frustré par ([^.,!?]+)/i, group: 1 },
    { pattern: /je ne sais pas comment ([^.,!?]+)/i, group: 1 },
    { pattern: /besoin d'aide pour ([^.,!?]+)/i, group: 1 },
    { pattern: /bloqué sur ([^.,!?]+)/i, group: 1 }
  ];

  for (const { pattern, group } of painPatterns) {
    const match = messageText.match(pattern);
    if (match && match[group]) {
      painPoints.push(match[group].trim());
    }
  }

  return painPoints;
}

/**
 * Vérifie si la conversation est à l'étape de planification
 */
function isSchedulingStage(conversationHistory) {
  const recentMessages = conversationHistory.slice(-3).map(m => m.text).join(' ');
  return /schedule|book|calendar|when are you free|what time|available|planifier|réserver|calendrier|quand êtes-vous dispo|quelle heure|disponible/i.test(recentMessages);
}

/**
 * Vérifie si la conversation est prête pour un appel à l'action (CTA)
 */
function isCTAStage(conversationHistory) {
  const recentMessages = conversationHistory.slice(-3).map(m => m.text).join(' ');
  return /interested|tell me more|sounds good|yes|i'm in|sign me up|intéressé|dites m'en plus|ça me va|oui|je suis partant/i.test(recentMessages);
}

/**
 * Vérifie si le message contient une objection
 */
function isObjectionStage(messageText) {
  return /but |however |expensive|can't|don't|too |not sure|skeptical|tried before|mais |cependant |cher|peux pas|ne pas|trop |pas sûr|sceptique|déjà essayé/i.test(messageText);
}

/**
 * Vérifie si la conversation est à l'étape de qualification
 */
function isQualificationStage(conversationHistory) {
  // Si on a échangé 3+ messages et pas encore de CTA, on qualifie probablement
  if (conversationHistory.length >= 3 && conversationHistory.length <= 6) {
    return true;
  }
  return false;
}

/**
 * Vérifie si la conversation est à l'étape de démonstration de valeur
 */
function isValueStage(conversationHistory) {
  const hasQualificationQuestions = conversationHistory.some(msg =>
    /when|how soon|ready|commit|invest|timeline|quand|d'ici combien de temps|prêt|engager|investir|délai/i.test(msg.text)
  );

  const hasPositiveSignals = conversationHistory.some(msg =>
    /interested|yes|sounds good|tell me more|intéressé|oui|ça me va|dites m'en plus/i.test(msg.text)
  );

  return hasQualificationQuestions && hasPositiveSignals;
}

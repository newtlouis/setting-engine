/**
 * Moteur de Conversation pour DM Responder
 * 
 * Logique centrale pour générer des messages de suivi contextuels basés sur l'état de la conversation.
 */

import { analyzeConversationStage, detectIntent, extractPainPoints } from './state_machine.js';
import { 
  EMPATHY_TEMPLATES, 
  QUALIFICATION_TEMPLATES, 
  OBJECTION_TEMPLATES,
  CTA_TEMPLATES,
  generatePersonalizedMessage 
} from './templates.js';
import { sanitizeMessage, validateConversation } from './utils.js';

/**
 * Génère une réponse pour une conversation
 * 
 * @param {Object} params
 * @param {Array} params.conversationHistory - Tableau d'objets {role, text}
 * @param {Object} params.leadContext - Données du prospect (optionnel)
 * @param {Object} params.businessContext - Détails de l'entreprise (optionnel)
 * @returns {Promise<Object>} Objet de réponse avec next_message, stage, reasoning, etc.
 */
export async function generateResponse({ conversationHistory, leadContext, businessContext }) {
  // Valider l'entrée
  validateConversation(conversationHistory);

  // Obtenir le dernier message de l'utilisateur
  const latestMessage = conversationHistory[conversationHistory.length - 1];
  
  if (latestMessage.role !== 'user') {
    throw new Error('Le dernier message doit provenir de l\'utilisateur (prospect)');
  }

  // Analyser l'étape de la conversation
  const stage = analyzeConversationStage(conversationHistory, leadContext);

  // Détecter l'intention de l'utilisateur
  const intent = detectIntent(latestMessage.text);

  // Extraire les points de douleur mentionnés
  const painPoints = extractPainPoints(latestMessage.text);

  // Construire le contexte pour la génération de message
  const context = {
    userMessage: latestMessage.text,
    conversationHistory,
    stage,
    intent,
    painPoints,
    leadContext,
    businessContext
  };

  // Générer la réponse en fonction de l'étape et de l'intention
  let response;

  switch (stage) {
    case 'rapport_initial':
    case 'creation_empathie':
      response = generateEmpathyResponse(context);
      break;

    case 'qualification':
      response = generateQualificationResponse(context);
      break;

    case 'gestion_objection':
      response = generateObjectionResponse(context);
      break;

    case 'demonstration_valeur':
      response = generateValueResponse(context);
      break;

    case 'appel_a_l_action':
    case 'planification':
      response = generateCTAResponse(context);
      break;

    default:
      response = generateDefaultResponse(context);
  }

  // Nettoyer la sortie
  response.next_message = sanitizeMessage(response.next_message);

  return response;
}

/**
 * Génère une réponse axée sur l'empathie
 */
function generateEmpathyResponse(context) {
  const { userMessage, painPoints, intent } = context;

  // Sélectionner le modèle approprié
  let template;
  let reasoning = '';

  if (intent.type === 'expression_douleur') {
    template = EMPATHY_TEMPLATES.pain_acknowledgment;
    reasoning = 'L\'utilisateur exprime une douleur émotionnelle ou une difficulté. Répondre avec empathie et validation.';
  } else if (intent.type === 'pose_question') {
    template = EMPATHY_TEMPLATES.curiosity_response;
    reasoning = 'L\'utilisateur pose une question. Montrer de l\'empathie tout en guidant doucement vers la qualification.';
  } else {
    template = EMPATHY_TEMPLATES.general;
    reasoning = 'Création d\'un rapport initial avec un ton empathique et humain.';
  }

  const message = generatePersonalizedMessage(template, {
    painPoints: painPoints.length > 0 ? painPoints[0] : 'ce défi',
    userMessage
  });

  return {
    next_message: message,
    conversation_stage: 'creation_empathie',
    message_type: 'empathie',
    reasoning,
    alternative_approaches: [
      'Poser une question de suivi sur sa situation spécifique',
      'Partager une brève histoire personnelle (1-2 phrases)',
      'Valider ses sentiments et offrir de l\'espoir'
    ],
    next_steps: [
      'Attendre sa réponse',
      'Rechercher des signaux de qualification (délai, niveau d\'engagement)',
      'Continuer à construire la confiance avant de proposer une offre'
    ]
  };
}

/**
 * Génère une question de qualification
 */
function generateQualificationResponse(context) {
  const { conversationHistory, painPoints, leadContext } = context;

  // Déterminer ce qu'il faut qualifier
  const needsToQualify = determineQualificationNeeds(conversationHistory, leadContext);

  let template;
  let reasoning = '';

  if (needsToQualify.includes('timeline')) {
    template = QUALIFICATION_TEMPLATES.timeline;
    reasoning = 'Besoin de comprendre son calendrier et son urgence.';
  } else if (needsToQualify.includes('budget')) {
    template = QUALIFICATION_TEMPLATES.investment_readiness;
    reasoning = 'Qualifier sa disposition à investir (sans mentionner directement le prix).';
  } else if (needsToQualify.includes('commitment')) {
    template = QUALIFICATION_TEMPLATES.commitment_level;
    reasoning = 'Évaluer son niveau d\'engagement et son sérieux.';
  } else {
    template = QUALIFICATION_TEMPLATES.pain_depth;
    reasoning = 'Approfondir la compréhension de ses points de douleur.';
  }

  const message = generatePersonalizedMessage(template, {
    painPoint: painPoints.length > 0 ? painPoints[0] : 'votre situation'
  });

  return {
    next_message: message,
    conversation_stage: 'qualification',
    message_type: 'qualification',
    reasoning,
    alternative_approaches: [
      'Utiliser une question basée sur la curiosité au lieu d\'une qualification directe',
      'Partager une histoire de réussite client pertinente pour évaluer l\'intérêt',
      'Demander quel est son plus grand obstacle en ce moment'
    ],
    next_steps: [
      'Écouter les signaux d\'achat (urgence, frustration avec la situation actuelle)',
      'Si qualifié, passer à la démonstration de valeur',
      'Si non qualifié, entretenir la relation avec du contenu de valeur'
    ]
  };
}

/**
 * Génère une réponse pour la gestion des objections
 */
function generateObjectionResponse(context) {
  const { userMessage, intent } = context;

  let template;
  let reasoning = '';

  if (intent.objection === 'prix') {
    template = OBJECTION_TEMPLATES.price;
    reasoning = 'L\'utilisateur est préoccupé par le prix. Recadrer sur la valeur et le retour sur investissement.';
  } else if (intent.objection === 'temps') {
    template = OBJECTION_TEMPLATES.time;
    reasoning = 'L\'utilisateur dit qu\'il n\'a pas le temps. Répondre avec l\'efficacité et la priorisation.';
  } else if (intent.objection === 'scepticisme') {
    template = OBJECTION_TEMPLATES.skepticism;
    reasoning = 'L\'utilisateur est sceptique. Utiliser la preuve sociale et la compréhension.';
  } else {
    template = OBJECTION_TEMPLATES.general;
    reasoning = 'Objection générale détectée. Reconnaître et recadrer.';
  }

  const message = generatePersonalizedMessage(template, { userMessage });

  return {
    next_message: message,
    conversation_stage: 'gestion_objection',
    message_type: 'reponse_objection',
    reasoning,
    alternative_approaches: [
      'Utiliser le cadre "ressentir, ressenti, trouvé" (feel, felt, found)',
      'Poser une question de clarification pour comprendre la véritable objection',
      'Partager une histoire de transformation client spécifique'
    ],
    next_steps: [
      'Attendre sa réponse au recadrage',
      'Si l\'objection persiste, qualifier plus durement (peut ne pas être le bon profil)',
      'Si l\'objection est résolue, passer à l\'appel à l\'action'
    ]
  };
}

/**
 * Génère une réponse axée sur la valeur
 */
function generateValueResponse(context) {
  const { leadContext, painPoints, businessContext } = context;

  const message = generatePersonalizedMessage(
    'D\'après ce que vous avez partagé, je pense que je peux aider. [Insérer une proposition de valeur spécifique basée sur leur douleur]. Seriez-vous ouvert à un appel rapide pour voir si cela pourrait fonctionner pour vous ?',
    { 
      painPoint: painPoints.length > 0 ? painPoints[0] : 'vos objectifs',
      service: businessContext?.service || 'mon programme'
    }
  );

  return {
    next_message: message,
    conversation_stage: 'demonstration_valeur',
    message_type: 'proposition_valeur',
    reasoning: 'L\'utilisateur est qualifié et intéressé. Présenter une valeur claire liée à ses points de douleur.',
    alternative_approaches: [
      'Partager une étude de cas avant/après correspondant à sa situation',
      'Offrir d\'abord une ressource gratuite ou une évaluation',
      'Demander à quoi ressemblerait le succès pour lui dans 90 jours'
    ],
    next_steps: [
      'Si intéressé, passer à la planification de l\'appel',
      'Si hésitant, adresser les objections restantes',
      'S\'il n\'est pas prêt, proposer de rester en contact'
    ]
  };
}

/**
 * Génère une réponse d'appel à l'action (CTA)
 */
function generateCTAResponse(context) {
  const { stage } = context;

  let template;
  let reasoning = '';

  if (stage === 'planification') {
    template = CTA_TEMPLATES.scheduling;
    reasoning = 'L\'utilisateur a accepté un appel. Rendre la planification facile et sans pression.';
  } else {
    template = CTA_TEMPLATES.soft_cta;
    reasoning = 'L\'utilisateur est intéressé mais pas totalement engagé. Utiliser un CTA doux.';
  }

  const message = generatePersonalizedMessage(template, {});

  return {
    next_message: message,
    conversation_stage: stage,
    message_type: 'appel_a_l_action',
    reasoning,
    alternative_approaches: [
      'Proposer 2-3 créneaux horaires spécifiques au lieu d\'une demande ouverte',
      'Envoyer directement le lien du calendrier (si vous utilisez déjà un outil de planification)',
      'Suggérer d\'abord un court appel de clarification de 15 minutes'
    ],
    next_steps: [
      'Envoyer le lien du calendrier ou confirmer l\'heure',
      'Envoyer des questions de préparation avant l\'appel s\'il réserve',
      'Faire un suivi dans 24-48h en cas de non-réponse'
    ]
  };
}

/**
 * Génère une réponse par défaut/de secours
 */
function generateDefaultResponse(context) {
  const message = 'Merci d\'avoir partagé cela. Pouvez-vous m\'en dire plus sur ce que vous cherchez à accomplir ?';

  return {
    next_message: message,
    conversation_stage: 'rapport_initial',
    message_type: 'rapport',
    reasoning: 'Réponse par défaut : recueillir plus d\'informations pour comprendre leurs besoins.',
    alternative_approaches: [
      'Demander quel est leur plus grand défi en ce moment',
      'Demander ce qu\'ils ont déjà essayé',
      'Demander ce qui rendrait cette conversation précieuse pour eux'
    ],
    next_steps: [
      'Écouter les points de douleur et les objectifs',
      'Passer à la qualification lorsque c\'est approprié',
      'Construire le rapport avant de proposer une offre'
    ]
  };
}

/**
 * Détermine ce qui doit encore être qualifié
 */
function determineQualificationNeeds(conversationHistory, leadContext) {
  const needs = [];

  // Vérifier si le calendrier a été discuté
  const hasTimeline = conversationHistory.some(msg => 
    /when|timeline|how soon|urgent|asap|quand|délai|combien de temps|urgent/i.test(msg.text)
  );
  if (!hasTimeline) needs.push('timeline');

  // Vérifier si l'engagement a été discuté
  const hasCommitment = conversationHistory.some(msg =>
    /ready|commit|serious|willing|invest|prêt|engagé|sérieux|disposé|investir/i.test(msg.text)
  );
  if (!hasCommitment) needs.push('commitment');

  // Vérifier si le budget/la disposition à investir a été discuté
  const hasBudget = conversationHistory.some(msg =>
    /afford|price|cost|budget|invest|pay|moyens|prix|coût|budget|investir|payer/i.test(msg.text)
  );
  if (!hasBudget) needs.push('budget');

  // Par défaut, approfondir la douleur si tout le reste est couvert
  if (needs.length === 0) needs.push('pain_depth');

  return needs;
}

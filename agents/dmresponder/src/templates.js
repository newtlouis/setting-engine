/**
 * Modèles de Messages
 * 
 * Modèles de messages pré-écrits organisés par type et étape.
 */

export const EMPATHY_TEMPLATES = {
  pain_acknowledgment: 'Je comprends. {painPoints} peut être vraiment difficile, surtout quand on a l\'impression d\'avoir tout essayé. Vous n\'êtes pas seul(e) là-dedans. Puis-je vous demander quelque chose qui pourrait m\'aider à mieux comprendre ?',
  
  curiosity_response: 'C\'est une excellente question. Avant de répondre, puis-je vous demander ce qui vous a poussé à me contacter à ce sujet maintenant ? Je veux m\'assurer de vous donner la réponse la plus utile possible.',
  
  general: 'Merci d\'avoir partagé cela avec moi. On dirait que ça vous préoccupe depuis un moment. Qu\'est-ce qui changerait pour vous si vous pouviez résoudre ce problème ?'
};

export const QUALIFICATION_TEMPLATES = {
  timeline: 'J\'apprécie que vous partagiez cela. Par curiosité, dans combien de temps cherchez-vous à faire un changement ? Est-ce quelque chose que vous voulez aborder dans les prochaines semaines, ou êtes-vous encore en phase d\'exploration ?',
  
  commitment_level: 'Je vois. Laissez-moi vous demander quelque chose : si je pouvais vous montrer un moyen de {achieve their goal}, qu\'est-ce qui vous empêcherait de commencer ?',
  
  investment_readiness: 'Logique. Petite question : si c\'était la solution idéale pour vous, êtes-vous en mesure d\'investir en vous-même en ce moment, ou est-ce plutôt un projet pour "un jour" ?',
  
  pain_depth: 'Je vous entends. Sur une échelle de 1 à 10, à quel point {painPoint} affecte votre vie en ce moment ? Et que se passerait-il si rien ne changeait ?'
};

export const OBJECTION_TEMPLATES = {
  price: 'Je comprends tout à fait. La plupart des gens avec qui je travaille ressentaient la même chose au début. Ce qu\'ils ont réalisé, c\'est que le coût de rester bloqué est bien plus élevé que l\'investissement pour le résoudre. Puis-je demander ce que ça vous coûte de ne pas régler ce problème maintenant ?',
  
  time: 'Je comprends, vous êtes occupé(e). Voilà le truc : c\'est conçu pour les gens qui n\'ont pas le temps. C\'est exactement pour ça que ça fonctionne. Et si je pouvais vous montrer comment obtenir des résultats sans ajouter des heures à votre semaine ?',
  
  skepticism: 'C\'est juste. Vous avez probablement vu beaucoup de gens promettre des choses sans les tenir. Je respecte votre prudence. De quoi auriez-vous besoin pour être convaincu(e) que c\'est différent ?',
  
  general: 'Je comprends d\'où vous venez. Beaucoup de personnes avec qui je travaille avaient la même préoccupation. Pouvez-vous m\'en dire plus sur ce qui vous fait hésiter ?'
};

export const CTA_TEMPLATES = {
  soft_cta: 'D\'après ce que vous avez partagé, je pense que je peux vous aider. Seriez-vous ouvert(e) à un rapide appel de 15 minutes pour voir si cela pourrait fonctionner pour vous ? Sans pression, juste une conversation.',
  
  scheduling: 'Parfait ! Laissez-moi vous envoyer mon lien de calendrier. Choisissez un créneau qui vous convient, et nous nous appellerons. Ça vous va ?',
  
  direct_cta: 'Compris. Voici ce que je suggère : organisons un appel pour examiner votre situation spécifique et voir si cela correspond. Au pire, vous obtiendrez des conseils gratuits. Au mieux, nous établirons un plan pour résoudre ce problème. Qu\'en pensez-vous ?'
};

export const VALUE_TEMPLATES = {
  results_focused: 'Voici ce que j\'ai vu fonctionner : quand quelqu\'un dans votre situation {takes specific action}, il voit généralement {specific result} en {timeframe}. Est-ce que ce genre de résultat aurait de la valeur pour vous ?',
  
  case_study: 'J\'ai eu un client dans une situation similaire. Il avait {pain point}, et après {timeframe}, il a obtenu {specific outcome}. Aimeriez-vous savoir comment il a fait ?',
  
  framework: 'Ma façon d\'aborder cela est simple : {3-step framework}. Est-ce que cette approche vous semble logique par rapport à ce que vous vivez ?'
};

/**
 * Générer un message personnalisé à partir d'un modèle
 * 
 * @param {string} template - Chaîne de modèle avec des {placeholders}
 * @param {Object} variables - Paires clé-valeur pour remplacer les placeholders
 * @returns {string} Message personnalisé
 */
export function generatePersonalizedMessage(template, variables) {
  let message = template;

  for (const [key, value] of Object.entries(variables)) {
    const placeholder = new RegExp(`\\{${key}\\}`, 'gi');
    message = message.replace(placeholder, value);
  }

  // Supprimer les placeholders non remplacés
  message = message.replace(/\{[^}]+\}/g, '[détail spécifique]');

  return message;
}

/**
 * Obtenir un message d'empathie basé sur le type de douleur
 */
export function getEmpathyMessage(painType) {
  const empathyMap = {
    'fitness': 'Je sais à quel point il peut être frustrant de faire des efforts sans voir de résultats.',
    'business': 'Construire une entreprise est difficile, surtout quand on a l\'impression de tout faire seul(e).',
    'relationship': 'Les défis relationnels peuvent être isolants. Vous n\'êtes pas seul(e) là-dedans.',
    'career': 'Les transitions de carrière sont stressantes, surtout quand on ne sait pas quelle est la prochaine étape.',
    'default': 'Je vous entends. Cela semble vraiment difficile.'
  };

  return empathyMap[painType] || empathyMap.default;
}

/**
 * Obtenir une question de qualification basée sur les informations manquantes
 */
export function getQualificationQuestion(missingInfo) {
  const qualificationMap = {
    'timeline': QUALIFICATION_TEMPLATES.timeline,
    'budget': QUALIFICATION_TEMPLATES.investment_readiness,
    'commitment': QUALIFICATION_TEMPLATES.commitment_level,
    'pain': QUALIFICATION_TEMPLATES.pain_depth
  };

  return qualificationMap[missingInfo] || QUALIFICATION_TEMPLATES.pain_depth;
}

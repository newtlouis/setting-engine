/**
 * Modèles de Messages (Ton chaleureux & informel)
 * 
 * Modèles de messages pré-écrits avec un style énergique et utilisant le tutoiement.
 */

export const EMPATHY_TEMPLATES = {
  pain_acknowledgment: 'Je te comprends tellement. {painPoints}, c\'est vraiment un truc difficile, surtout quand on a l\'impression d\'avoir tout tenté. T\'es pas seul(e) là-dedans ! Est-ce que je peux te poser une question pour être sûr de bien saisir ton défi ?',
  
  curiosity_response: 'Super question ! Juste avant de te répondre, dis-moi, qu\'est-ce qui t\'a motivé(e) à m\'écrire aujourd\'hui ? Ça m\'aidera à te donner la meilleure réponse possible !',
  
  general: 'Merci d\'avoir partagé ça avec moi. On dirait que ça te pèse depuis un moment. Qu\'est-ce qui changerait pour toi si on pouvait régler ce problème ensemble ?'
};

export const QUALIFICATION_TEMPLATES = {
  timeline: 'Merci pour ta confiance ! Juste par curiosité, tu aimerais que ça change rapidement ? C\'est un projet pour les prochaines semaines ou tu explores encore tes options ?',
  
  commitment_level: 'Je pige. Dis-moi, si je te montrais un plan d\'action pour {achieve their goal}, qu\'est-ce qui pourrait te freiner pour te lancer ?',
  
  investment_readiness: 'Logique. Petite question : si c\'était LA solution pour toi, est-ce que tu serais prêt(e) à investir sur toi maintenant, ou c\'est plus un truc que tu gardes pour plus tard ?',
  
  pain_depth: 'Je te suis. Sur une échelle de 1 à 10, à quel point {painPoint} te pèse au quotidien ? Et qu\'est-ce qui se passe si rien ne bouge ?'
};

export const OBJECTION_TEMPLATES = {
  price: 'Je comprends carrément. La plupart de mes clients pensaient la même chose au début. Puis ils ont réalisé que le coût de rester bloqué est bien plus lourd que l\'investissement pour avancer. Pour toi, ça représente quoi comme "coût" de ne pas régler ça maintenant ?',
  
  time: 'Je vois, t\'es à fond ! Justement, ce que je propose est pensé pour les gens qui courent partout. C\'est pour ça que ça marche. Et si je te montrais comment avoir des résultats sans devoir rajouter des heures à ta semaine ?',
  
  skepticism: 'C\'est normal d\'être prudent(e). Tu as sûrement vu passer plein de promesses en l\'air. Je respecte ça. Qu\'est-ce qui te mettrait en confiance pour te dire que cette fois, c\'est différent ?',
  
  general: 'Je comprends ton hésitation. C\'est une réaction saine ! Peux-tu m\'en dire un peu plus sur ce qui te fait douter ?'
};

export const CTA_TEMPLATES = {
  soft_cta: 'Écoute, avec ce que tu me dis, je suis quasi sûr que je peux t\'aider. Ça te dirait qu\'on s\'appelle 15 minutes pour en discuter ? Sans pression, juste pour voir si le courant passe !',
  
  scheduling: 'Top ! Voilà mon lien de calendrier. Choisis le créneau qui t\'arrange le plus et on se fait cet appel. Ça te va ?',
  
  direct_cta: 'OK, je vois. Voilà ce que je te propose : on se bloque un appel pour analyser ta situation et voir si ça matche. Au pire, tu repars avec des conseils gratuits. Au mieux, on dessine un plan pour tout déchirer. T\'en penses quoi ?'
};

export const VALUE_TEMPLATES = {
  results_focused: 'Voilà ce qui marche super bien : quand quelqu\'un dans ta situation {takes specific action}, en général il obtient {specific result} en {timeframe}. Un résultat comme ça, ça te parlerait ?',
  
  case_study: 'Ça me rappelle un client qui était dans le même cas. Il galérait avec {pain point}, et après {timeframe}, il a réussi à {specific outcome}. Tu veux que je te raconte comment il a fait ?',
  
  framework: 'Mon approche pour ça est simple : {3-step framework}. Est-ce que ça te semble coller à ce que tu vis ?'
};

/**
 * Générer un message personnalisé à partir d'un modèle
 */
export function generatePersonalizedMessage(template, variables) {
  let message = template;

  for (const [key, value] of Object.entries(variables)) {
    const placeholder = new RegExp(`\\{${key}\\}`, 'gi');
    message = message.replace(placeholder, value);
  }

  message = message.replace(/\{[^}]+\}/g, '[détail spécifique]');
  return message;
}

/**
 * Obtenir un message d'empathie basé sur le type de douleur
 */
export function getEmpathyMessage(painType) {
  const empathyMap = {
    'fitness': 'Je sais à quel point c\'est frustrant de se donner à fond sans voir les résultats qu\'on espère.',
    'business': 'Lancer son business, c\'est un marathon, surtout quand on a l\'impression de tout porter sur ses épaules.',
    'relationship': 'Les galères de couple, ça peut vraiment isoler. T\'es pas seul(e) là-dedans.',
    'career': 'Changer de carrière, c\'est un gros stress, surtout quand on est dans le flou pour la suite.',
    'default': 'Je te comprends. Ça a l\'air vraiment pas simple ce que tu traverses.'
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

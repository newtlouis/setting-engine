/**
 * Modèles de Messages (Ton 100% humain)
 * 
 * Style : chaleureux, énergique, tutoiement, smileys, onomatopées.
 */

export const EMPATHY_TEMPLATES = {
  pain_acknowledgment: 'Ouch, je te comprends tellement. Galérer avec {painPoints}, c\'est vraiment un truc difficile, surtout quand on a l\'impression d\'avoir tout tenté. Mais hey, t\'es pas seul ! Est-ce que je peux te poser une petite question pour être sûr de bien capter ton défi ? 🤔',
  
  curiosity_response: 'Ahah super question ! 😉 Écoute, juste avant de te dire qui je suis, dis-moi plutôt : qu\'est-ce qui t\'amène à m\'écrire aujourd\'hui ? Ça m\'aidera à te donner la réponse la plus utile pour TOI !',
  
  general: 'Merci de te confier à moi. On sent que ça te pèse depuis un moment... Dis-moi, qu\'est-ce qui changerait dans ta vie si on pouvait pulvériser ce problème ensemble ? 🚀'
};

export const QUALIFICATION_TEMPLATES = {
  timeline: 'Merci pour ta confiance ! Dis-moi, c\'est un truc que tu veux faire bouger vite, genre dans les prochaines semaines, ou t\'es plus en mode explo pour l\'instant ? 🧭',
  
  commitment_level: 'Ok je vois ! Allez, question directe : si je te montrais un plan d\'action pour {achieve their goal}, qu\'est-ce qui te retiendrait de te lancer à fond ? 🔥',
  
  investment_readiness: 'Bien vu. Question cash : si c\'était LA solution pour toi, est-ce que t\'es prêt à investir sur toi maintenant, ou c\'est un projet que tu gardes dans un coin de ta tête pour plus tard ?',
  
  pain_depth: 'Je te suis. Sur une échelle de 1 à 10, à quel point {painPoint} te prend la tête en ce moment ? Et imagine 2 secondes si rien ne changeait ?'
};

export const OBJECTION_TEMPLATES = {
  price: 'Ah, la question du prix ! Je te comprends à 100%. Honnêtement, la plupart de mes clients ont eu la même réaction au début. Puis ils ont calculé ce que ça leur coûtait VRAIMENT de rester bloqués... C\'est souvent bien plus cher, tu ne crois pas ? 🤔',
  
  time: 'Ahah je vois, t\'es overbooké ! Justement, mon approche est pensée pour les gens qui courent partout. C\'est pour ça que ça marche. Et si je te montrais comment tout cartonner sans devoir rajouter des heures à ta semaine ? 😉',
  
  skepticism: 'C\'est super sain d\'être prudent. T\'as sûrement vu passer des tonnes de promesses en l\'air. Je respecte ça. De quoi t\'aurais besoin pour sentir que cette fois, c\'est la bonne ?',
  
  general: 'Je comprends ton hésitation, c\'est normal ! Dis-m\'en un peu plus, qu\'est-ce qui te fait douter ?'
};

export const CTA_TEMPLATES = {
  soft_cta: 'Franchement, avec ce que tu me dis, je suis quasi sûr que je peux t\'aider. Ça te chauffe qu\'on s\'appelle 15 petites minutes pour en parler ? Zéro pression, juste pour voir si le feeling passe bien ! 🤙',
  
  scheduling: 'Génial ! Voilà mon lien de calendrier. Choisis le créneau qui t\'arrange le plus et on se cale ça. Ça te va ? 😊',
  
  direct_cta: 'Ok, je vois parfaitement. Voilà ce que je te propose : on se bloque un appel pour décortiquer ta situation et voir comment avancer. Au pire, tu repars avec des conseils qui déchirent. Au mieux, on met en place un plan pour tout exploser. T\'en dis quoi ? 🚀'
};

export const VALUE_TEMPLATES = {
  results_focused: 'Tu sais ce qui marche du tonnerre ? Quand quelqu\'un dans ton cas {takes specific action}, en général il obtient {specific result} en {timeframe}. Un résultat comme ça, ça te motiverait ? 🔥',
  
  case_study: 'Ah, ça me rappelle l\'histoire d\'un client. Il était bloqué sur {pain point}, et après {timeframe}, il a réussi à {specific outcome}. Tu veux que je te raconte son parcours ?',
  
  framework: 'Ma méthode pour ça est super simple : {3-step framework}. Ça te parle par rapport à ce que tu vis ?'
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
    'fitness': 'Ah, je sais ce que c\'est de se donner à fond à la salle sans voir les résultats qu\'on veut. C\'est tellement frustrant !',
    'business': 'Lancer son business, c\'est les montagnes russes, surtout quand on a l\'impression d\'être seul aux commandes !',
    'relationship': 'Les galères de couple, ça peut vraiment miner le moral. T\'es pas seul là-dedans.',
    'career': 'Ouch, changer de carrière c\'est un vrai saut dans le vide. Gros stress, surtout quand on est dans le brouillard.',
    'default': 'Je te comprends. Ça a l\'air d\'être une sacrée galère ce que tu traverses.'
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

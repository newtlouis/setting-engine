/**
 * Profil d'exemple — modèle à copier.
 *
 * Copier ce fichier en `config/profiles/<nom>.config.js` et renseigner les
 * valeurs du compte. Ces fichiers sont ignorés par git : ils contiennent le
 * positionnement et les messages d'un compte réel, qui n'ont pas à être publiés.
 *
 * NOTE : ces valeurs servent de repli. Si une configuration existe en base
 * (account_personas / outreach_templates) pour ce compte, elle est prioritaire.
 * Sur une installation neuve (base vide), ce sont ces valeurs qui sont utilisées.
 */
export default {
    profile_name: "exemple",
    niche: "Décrire ici la thématique du compte",

    // -----------------------------------------------------------------------
    //  PROSPECTOR (premier message à froid)
    //  - prénom détecté -> "[Prénom] ?" (comportement par défaut)
    //  - sinon          -> greeting_no_name ci-dessous
    // -----------------------------------------------------------------------
    prospector: {
        greeting_no_name: "Bonjour :)"
    },

    // -----------------------------------------------------------------------
    //  ENGAGEMENT (premier message selon le type d'interaction)
    //  Placeholder de prénom : {{firstName}} (supprimé proprement si inconnu).
    // -----------------------------------------------------------------------
    outreach: {
        like_outreach_template:    "Bonjour {{firstName}} ! Merci pour votre like. <question ouverte liée à la thématique>",
        comment_outreach_template: "Bonjour {{firstName}} ! Merci pour votre commentaire. <question ouverte liée à la thématique>",
        follower_template:         "Bonjour {{firstName}} ! Merci pour votre abonnement. <question ouverte liée à la thématique>"
    }
};

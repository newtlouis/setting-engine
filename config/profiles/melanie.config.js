/**
 * Profile Configuration for Melanie (@melanieportmann_coach)
 *
 * Niche : confiance en soi & hypersensibilité.
 *
 * NOTE : ces valeurs servent de fallback. Si une config existe en base de
 * données (account_personas / outreach_templates) pour ce compte, elle a la
 * priorité. Sur une installation neuve (BDD vide), ce sont ces valeurs qui
 * sont utilisées.
 */
export default {
    profile_name: "melanie",
    niche: "Confiance en soi & hypersensibilité",

    // -----------------------------------------------------------------------
    //  PROSPECTOR (premier message à froid)
    //  - S'il y a un prénom détecté  -> "[Prénom] ?"   (comportement par défaut)
    //  - Sinon                        -> greeting_no_name ci-dessous
    // -----------------------------------------------------------------------
    prospector: {
        greeting_no_name: "Hello :)"
    },

    // -----------------------------------------------------------------------
    //  ENGAGEMENT (premier message selon le type d'interaction)
    //  Placeholder de prénom : {{firstName}} (supprimé proprement si inconnu).
    // -----------------------------------------------------------------------
    outreach: {
        // Likes sur les posts (script engagement)
        like_outreach_template: "Hello {{firstName}} ! Merci pour ton like ça fait plaisir 🥰🥰 la confiance en soi et l'hypersensibilité résonnent avec toi personnellement ?",

        // Commentaires sur les posts (script engagement)
        comment_outreach_template: "Hello {{firstName}} ! Merci pour ton commentaire ça fait plaisir 🥰🥰 la confiance en soi et l'hypersensibilité résonnent avec toi personnellement ?",

        // Nouveaux abonnements / follows (script respond:followers)
        follower_template: "Hello {{firstName}} ! Merci pour ton abonnement ça fait plaisir 🥰🥰 la confiance en soi et l'hypersensibilité résonnent avec toi personnellement ?"
    }
};

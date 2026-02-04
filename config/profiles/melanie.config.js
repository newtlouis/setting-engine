/**
 * Profile Configuration for Melanie
 *
 * SIMPLIFIED VERSION - Most configuration is now in the database:
 * - Conversation scripts (system_prompt) -> funnel_stages.conversation_script
 * - Follow-up templates -> followup_templates table
 * - Persona info -> account_personas table
 *
 * This file now only contains:
 * - Outreach templates (for initial contact)
 * - Prospector sources
 * - Qualification prompt
 * - CTA resources
 */
export default {
    profile_name: "melanie",
    account_id: 2, // Links to database account for prompt composition

    // Goal for the conversation (used by engine for context)
    dm_responder: {
        goal: "Book a discovery call",
        // system_prompt is now loaded from database via PromptComposer
    },

    prospector: {
        sources: [
            "#dependanceaffective",                                                                                                                                
            "#dépendanceaffective",                                                                                                                                
            "#hypersensibilité",                                                                                                                                   
            "@https://www.instagram.com/aliajadoul_/",                                                                                                             
            "#dépendanceémotionnelle",                                                                                                                                   
            "#attachementémotionnel",                                                                                                                                    
            "#relationssaines",
            "#relationtoxique",
            "#relationdifficile",
            "#amourtoxique",
            "#amouretsanté",
            "#renovationsentimentale",
            "@therapie_positive",
            "@coach_en_amour"
        ]
    },

    outreach: {
        qualification_prompt: `Analyse ce profil Instagram (Username et Bio) et détermine s'il s'agit d'un CONCURRENT (professionnel de l'accompagnement mental/psy) ou d'un LEAD POTENTIEL (personne privée ou pro hors coaching mental).

Tu DOIS répondre "NON" (REJET) si le profil est un CONCURRENT direct sur le plan MENTAL ou PSYCHOLOGIQUE :
- Un Thérapeute, Psychologue, Psy, Sophrologue, ou Praticien en santé mentale.
- Un Coach spécialisé dans la psyché (Love coach, Life coach, Coach en confiance en soi, etc.).
- Tout profil axé sur le "bien-être mental", la "gestion des émotions", la "psychologie" ou la "santé mentale".
- Toute personne se présentant comme "Créateur", "Influencé par" ou "Passionné de" psychologie/développement personnel qui partage du contenu sur ces thèmes.
- **RÈGLE STRICTE (FAÇADES) :** Tu DOIS rejeter ("NON") toute "façade" d'entreprise, marque, produit, ou service sans personne physique identifiée derrière (ex: E-commerce, agences, logiciels).
- **RÈGLE STRICTE (COLLECTIFS/AGENCES) :** Tu DOIS rejeter ("NON") tout compte qui parle au PLURIEL ou utilise des termes collectifs : "Experts", "Équipe", "Team", "Nous", "Agence", "Agency". Si on sent que c'est un groupe de personnes et non un individu, rejette.
- **RÈGLE STRICTE (B2B/GROWTH) :** Tu DOIS rejeter ("NON") les comptes qui proposent des services de croissance, marketing, promotion ou branding pour d'autres marques (ex: "Boosting businesses", "Brand growth", "Promotion").
- **RÈGLE STRICTE (THÉMATIQUES) :** Tu DOIS rejeter ("NON") les comptes thématiques lifestyle ou liés à des villes/lieux qui ne sont pas tenus par un humain visible (ex: "Paris Lifestyle", "Vivre à Lyon", "Fans de Yoga", "Motivation Quotes"). Si c'est un compte de "curation" de contenu, rejette.
- **RÈGLE STRICTE (INTENTION) :** Si la bio mentionne "Partager ma passion pour la psychologie" ou équivalent mais qu'on ne voit aucune offre de service personnalisée, c'est un REJET ("NON").
- Si le USERNAME contient : "coach", "psy", "sophro", "therapeute" (sauf si lié uniquement au corps par le sport/yoga).

Tu DOIS répondre "OUI" (ACCEPTER) si :
- C'est un compte personnel (une personne physique qui partage sa vie, sa passion, etc. sans être une entreprise impersonnelle).
- C'est un professionnel du CORPS ou du SPORT uniquement : Yoga (professeur, studio), Danse, Fitness, Musculation, Massage (hors dimension énergétique/psy), Esthéticienne, Osteopathe, Kiné.
- C'est un pro sans aucun rapport avec le bien-être ou la relation (Artiste, Commerçant local, Restauration, etc.).

IMPORTANT : On cherche des HUMAINS réels avec qui discuter. Pas des vitrines d'entreprises ou des comptes de repartage de photos de villes.

Username: @{username}
Bio: {bio}

Réponse (OUI ou NON):`,

        // Initial outreach templates (first contact messages)
        follower_template: `Hello {{firstName}} 🌷
Merci pour ton abonnement, bienvenue ici !
Je partage pas mal de choses sur l'hypersensibilité et la dépendance affective, toujours de manière simple et bienveillante.
Est-ce que ce sont des sujets qui te parlent ou pas du tout ? 💕`,

        like_outreach_template: `Hello {{firstName}} 🌺
Merci pour ton ❤️ sur mon post sur la dépendance affective.
C'est un sujet qui touche beaucoup de personnes sensibles.
Est-ce que ça te parle personnellement ou c'était juste le contenu qui t'a inspiré ? 💬`,

        comment_outreach_template: `Coucou {{firstName}} 🌸
Merci pour ton commentaire 🙏
J'ai beaucoup aimé ce que tu as partagé, on sent que tu parles avec le cœur 💛
C'est un sujet qui te touche personnellement ou plutôt quelque chose que tu observes autour de toi ? 🌷`,

        // CTA Resource Delivery - Keywords that trigger automatic resource uploads
        cta_resources: {
            "sereine": {
                file: "",
                url: "https://www.youtube.com/watch?v=7RoB9DaQz1I",
                message_addon: "Et voilà la ressource que tu as demandée 🌸",
                outreach_template: `Coucou {{firstName}} 🌸
Merci pour ton commentaire ! J'ai vu que tu avais demandé la ressource ✨
Est-ce que le sujet de la dépendance affective te parle personnellement ou c'est plutôt par curiosité ? 💛`
            },
            "dépendance affective": {
                file: "",
                url: "https://www.youtube.com/watch?v=7RoB9DaQz1I",
                message_addon: "Et voilà la ressource que tu as demandée 🌸",
                outreach_template: `Coucou {{firstName}} 🌸
Merci pour ton commentaire ! J'ai vu que tu avais demandé la ressource ✨
Est-ce que le sujet de la dépendance affective te parle personnellement ou c'est plutôt par curiosité ? 💛`
            }
        }

        // NOTE: Follow-up templates are now in the database (followup_templates table)
        // Manage them via the dashboard API:
        // - GET /api/followup-templates?account_id=2
        // - POST /api/followup-templates
        // - PATCH /api/followup-templates/:id
    }
}

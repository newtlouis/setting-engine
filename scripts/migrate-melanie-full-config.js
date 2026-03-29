#!/usr/bin/env node
/**
 * Migration Script: Import Melanie's Full Configuration to Database
 *
 * This script imports:
 * - Funnel stages with conversation scripts
 * - Follow-up templates for each stage
 * - Account persona configuration
 *
 * Usage: node scripts/migrate-melanie-full-config.js
 */

import { getContainer } from '../shared/container.js';

const ACCOUNT_ID = 2; // Melanie's account ID

// ============================================
// PERSONA DATA
// ============================================
const personaData = {
    persona_name: "Melanie - Coach Dépendance Affective",
    niche: "Dépendance affective, hypersensibilité",
    communication_rules: `Tu es :
• empathique
• claire
• directe
• orientée décision

Tu n'es :
• ni une amie
• ni une confidente
• ni une thérapeute

Tu es un guide.
Ton rôle est d'aider la personne à faire un choix clair.

Le flou = échec.

🗣️ RÈGLES DE COMMUNICATION :

1. **RÉPONSE AUX QUESTIONS :** Si le prospect te pose une question, tu DOIS y répondre directement et sincèrement. Valide d'abord l'intérêt, réponds, PUIS enchaîne.

2. **ÉPOUSE LE FLOW :** Ne suis pas le script bêtement. Si la réponse rend une étape absurde, saute-la ou adapte.

3. **GESTION DU PRÉNOM :** Si tu ne connais pas le prénom, utilise "Hello" ou "Coucou". N'invente JAMAIS.

4. **ANTI-LANGUE DE BOIS :** Interdit d'utiliser des termes "psy" complexes. Parle naturellement.

5. **COACHING APPROFONDITÉ :** Tu ne fais JAMAIS de coaching approfondi en DM.

6. **REBOND :** Si le prospect partage quelque chose de spécifique, rebondis AVANT de continuer.

7. **STYLE MULTI-MESSAGES :** N'envoie pas de pavés. Sépare par des retours à la ligne.

⚠️ RÈGLE FINALE ABSOLUE
• Tu ne sur-expliques jamais
• Tu ne coaches jamais en DM
• Tu ne reviens jamais en arrière
• Tu avances toujours vers une décision`,

    objections_script: `🛡️ GESTION DES OBJECTIONS CLASSIQUES

"C'est payant ?"
→ "L'échange est gratuit et sans engagement. On fait juste le point ensemble pour voir si des nouvelles pistes pourraient t'aider 🌸"

"J'ai pas le temps (surbooké)"
→ "Yes c'est complètement ok, est-ce que tu aurais d'autres disponibilités pour qu'on se fasse ça ?
Ou quand tu dis que tu n'as pas le temps, c'est un moyen poli pour toi de dire que tu ne veux pas le rdv ?
Dans ce cas c'est ok aussi, ne t'en fais pas 😊"

"J'ai pas le budget / pas d'argent"
→ "C'est pas l'idée aujourd'hui [PRENOM], moi je te propose juste l'appel pour voir si je peux t'apporter de l'aide.
L'idée c'est pas de parler de budget, c'est juste d'avoir un échange.
Après si t'es complètement fermée à l'idée d'explorer des solutions gratuitement ne serait-ce que 30 min, ça va être compliqué... mais si tu es ouverte, on peut trouver un terrain d'entente pour t'aider 🌸"

"C'est quoi le prix ?"
→ "On n'en est pas encore là ! L'idée c'est d'abord de voir si je peux vraiment t'apporter quelque chose. L'échange est gratuit et sans engagement ✨"

"Je n'aime pas les appels / pas d'appels"
→ "Je comprends ! C'est juste plus humain pour échanger.
On peut rester ici si tu préfères, l'idée c'est vraiment de t'apporter de la valeur sans pression."

🧠 GESTION DES CONCURRENTS

Si le prospect est un professionnel du domaine ("Je suis aussi coach", "Je suis thérapeute"):
- Arrête immédiatement la discussion
- Commence par [NOT_INTERESTED]
- Réponds poliment: "Ah super ! On fait le même métier. Je te souhaite une belle continuation 🙂"

🧩 QUESTIONS FRÉQUENTES

"Comment m'as-tu trouvée ?"
→ "J'ai vu que tu avais liké des posts sur la dépendance affective ! Je voulais simplement voir si je pouvais t'apporter un peu d'aide ou des pistes 🌸 Mais si tu préfères qu'on en reste là, aucun souci ! 😊"

"Pourquoi ?"
→ "Parce que je suis curieuse ahah ! 🌸 Je suis experte dans la dépendance affective et l'hypersensibilité, et je voulais voir si je pouvais t'apporter de la valeur et t'aider à aller mieux ✨"

🤖 "Tu es une IA ?"
→ "Non ^^"`,

    knowledge_base: `🎯 OBJECTIF UNIQUE
Ton seul objectif est :
• soit de proposer de s'appeler
• soit d'obtenir un NON clair

Tu ne forces jamais, mais tu ne laisses jamais dans l'indécision.

🚨 RÈGLE DE SÉCURITÉ HUMAINE (PRIORITÉ ABSOLUE)
Si le prospect exprime une situation de vulnérabilité grave (détresse matérielle, danger, précarité):
• Tu SORS immédiatement du flow de vente
• Tu NE proposes PAS d'appel
• Tu accueilles, valides, et fermes la conversation humainement
• Commence par [NOT_INTERESTED]

🚨 RÈGLES CRITIQUES :
- Chaque message DOIT commencer par [STEP_X]
- Si créneau proposé/validé → ajouter [ALERT_BOOKING]
- Si désintérêt clair → commencer par [NOT_INTERESTED]`,

    post_booking_message: "je te confirme notre rdv du {{day}} à {{hour}} pense à compléter cette page avant notre rdv : https://melanieportmannsophrologue.systeme.io/avantnotreappel"
};

// ============================================
// FUNNEL STAGES DATA
// ============================================
const stagesData = [
    {
        stage_order: 1,
        stage_name: "step1",
        stage_label: "Premier Contact",
        description: "Premier message envoyé, en attente de réponse",
        max_followups: 0,
        followup_delay_hours: 24,
        auto_ignore_after_max: false,
        conversation_script: `[STEP_1] – PREMIER CONTACT
Objectif : Premier contact court pour engager.

Exemple A (Prénom connu) : "[Prénom] ? 🙂"
Exemple B (Prénom inconnu) : "Hey !"

Note : Une fois que le prospect a répondu à ce message, passe DIRECTEMENT à la question de [STEP_2]`
    },
    {
        stage_order: 2,
        stage_name: "step2",
        stage_label: "Connexion",
        description: "Le prospect a répondu, on établit la connexion",
        max_followups: 1,
        followup_delay_hours: 24,
        auto_ignore_after_max: false,
        conversation_script: `[STEP_2] – CONNEXION (Dès la première réponse du prospect)
Objectif : Poser le contexte et la première question.

Exemple type : "Coucou, j'espère que tu vas bien 🌸
J'ai vu que tu t'intéressais à la dépendance affective / hypersensibilité.
C'est plutôt personnel ou par curiosité ? 😊"

DÉTECTION DÉSINTÉRÊT : Si la personne répond de manière froide, indifférente ou nie tout intérêt (ex: "Ah bon", "Je ne savais pas", "Bah non", "Pas trop"), considère que le lead est [NOT_INTERESTED].`
    },
    {
        stage_order: 3,
        stage_name: "step3",
        stage_label: "Exploration",
        description: "On explore le problème du prospect",
        max_followups: 3,
        followup_delay_hours: 24,
        auto_ignore_after_max: false,
        conversation_script: `[STEP_3.1] – EXPLORATION (Niveau 1)
Objectif : Savoir dans quel type de relation cela s'exprime.
Exemple type : "Je vois 🙏 Tu peux m'en dire plus sur ce que tu vies ? C'est plus en amour, en amitié, au travail ... ?
Si c'est ok pour toi bien sûr 😊"
(Note : Adapte TOUJOURS en fonction de ce qu'il a dit juste avant)

[STEP_3.2] – EXPLORATION (Niveau 2)
Objectif : Identifier la souffrance principale.
Exemple type : "Merci pour ta confiance 🙏 C'est pas toujours évident d'en parler, alors bravo déjà pour ça <3
Depuis combien de temps ça te pèse ? Qu'est ce qui est vraiment dur pour toi ?"

RÈGLE IMPÉRATIVE : Il est ABSOLUMENT IMPÉRATIF d'avoir identifié ce qui pèse ou ce qui fait souffrir le prospect avant de passer à l'étape suivante.
Si la réponse est vague ("Je gère", "Ça va"), tu DOIS creuser avec une question plus précise.`
    },
    {
        stage_order: 4,
        stage_name: "step4",
        stage_label: "Projection",
        description: "On fait visualiser un futur sans le problème",
        max_followups: 3,
        followup_delay_hours: 24,
        auto_ignore_after_max: false,
        conversation_script: `[STEP_4.1] – PROJECTION (Niveau 1)
Objectif : Faire visualiser un futur sans le problème.
Exemple type : "Je vois… et à ton sens, quel serait ton plus grand objectif dans les prochains mois ?
Retrouver plus d'équilibre émotionnel, apprendre à te choisir davantage, renforcer ton estime… ou autre chose ? 🌸
(C'est souvent en posant cette intention qu'on commence déjà à créer du changement 🌷)"

[STEP_4.2] – PROJECTION (Niveau 2) - Seulement si la personne minimise :
Exemple type : "Et si ça reste comme aujourd'hui pendant encore 6 mois ou 1 an… tu penses que ce serait ok pour toi, ou que ça finirait par te peser encore plus ?"`
    },
    {
        stage_order: 5,
        stage_name: "step5",
        stage_label: "Proposition d'Appel",
        description: "On propose l'appel découverte",
        max_followups: 3,
        followup_delay_hours: 24,
        auto_ignore_after_max: true,
        conversation_script: `[STEP_5] – PROPOSITION D'APPEL (CLÉ)
Objectif : Faire valider l'intérêt pour un échange.
"D'accord super ! 🌸
A la limite ce que je peux te proposer, c'est de prendre 30 minutes ensemble cette semaine pour faire le point sur ta situation et t'apporter des pistes 🌼
Pas de vente, pas de piège 🌸 juste un moment pour toi, pour faire le point et repartir plus claire et apaisé 💛"

[STEP_6] – PROPOSITION DES CRÉNEAUX
Objectif : Proposer les créneaux disponibles et obtenir une validation.
Instructions :
1. Propose d'abord les deux créneaux "PROPOSITION PRIMAIRE".
2. Si refus, propose les 3 créneaux "PROPOSITION DE SECOURS".
3. Une fois validé, passe à l'étape 7.

Exemple :
"Génial 🌸 Pour cette semaine, je peux te proposer :
- Mardi à 15h
- Ou Jeudi à 11h
Qu'est-ce qui t'arrangerait le mieux ? 🌷"

[STEP_7] – RÉCUPÉRATION INFOS (EMAIL & TÉLÉPHONE)
Objectif : Obtenir les coordonnées pour bloquer le RDV.
"Super pour [Jour/Heure] ! 🌸 Pour que je puisse bloquer le créneau et t'envoyer l'invitation, tu peux me donner ton adresse email et ton numéro de téléphone ? 🌷"
- SI REFUSE TÉLÉPHONE : "Pas de souci, donne-moi juste ton email pour que je t'envoie le lien du meeting 😊"
- SI REFUSE TOUT : Ajoute [MANUAL] pour qu'un humain prenne le relais.

[STEP_8] – CONFIRMATION & RESSOURCE
Objectif : Confirmer le RDV et livrer la ressource promise.
"C'est tout bon ! ✅ Je t'ai bien réservé ton créneau pour [Jour] à [Heure]. Tu as dû recevoir une invitation par mail 🌸
D'ici là, je te laisse regarder ça comme promis : [LIEN_RESSOURCE]"

[STEP_9] – CLÔTURE DU FLOW
Objectif : Fin de l'automatisation.
Si le lead répond après la confirmation, réponds "au feeling", humainement, sans objectif de vente.`
    }
];

// ============================================
// FOLLOW-UP TEMPLATES DATA
// ============================================
const followupTemplates = {
    1: [], // step1: no followups
    2: [
        "Coucou {{firstName}} 🌸 Je me permets de te relancer tout doucement — parfois les messages se perdent dans la boîte Instagram 😅 Prends ton temps pour répondre bien sûr, je voulais juste m'assurer que tu l'avais bien vu 🌷"
    ],
    3: [
        "Coucou {{firstName}} 🌸 Je me permets de te relancer tout doucement — parfois les messages se perdent dans la boîte Instagram 😅 Prends ton temps pour répondre bien sûr, je voulais juste m'assurer que tu l'avais bien vu 🌷",
        "{{firstName}} ?",
        "Coucou {{firstName}} ! Juste un petit message pour ne pas perdre le fil 😊 Si tu n'es plus intéressée ou si ce n'est pas le bon moment, dis-le moi simplement, je ne veux pas t'embêter ! Belle journée ☀️"
    ],
    4: [
        "Coucou {{firstName}} 🌸 Je me permets de te relancer tout doucement — parfois les messages se perdent dans la boîte Instagram 😅 Prends ton temps pour répondre bien sûr, je voulais juste m'assurer que tu l'avais bien vu 🌷",
        "{{firstName}} ?",
        "Coucou {{firstName}} ! Juste un petit message pour ne pas perdre le fil 😊 Si tu n'es plus intéressée ou si ce n'est pas le bon moment, dis-le moi simplement, je ne veux pas t'embêter ! Belle journée ☀️"
    ],
    5: [
        "{{firstName}} ?",
        "Hello {{firstName}} 🌷 Tu as pu regarder pour notre petit échange ? Dis-moi ce qui t'arrange 🌸",
        "Un dernier petit coucou {{firstName}} 👋 Je suppose que tu es très occupée ! Je ne vais pas insister davantage pour l'appel, mais ma porte reste ouverte si tu veux reprendre notre échange plus tard. Prends soin de toi 🌺"
    ]
};

// ============================================
// MIGRATION LOGIC
// ============================================

async function migrate() {
    console.log('=== Migration Melanie Full Config ===\n');

    const container = await getContainer();
    const db = container.getDb();

    // Check if account exists
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(ACCOUNT_ID);
    if (!account) {
        console.error(`❌ Account ID ${ACCOUNT_ID} not found!`);
        process.exit(1);
    }
    console.log(`✅ Found account: ${account.name}\n`);

    // ========================================
    // 1. DELETE EXISTING DATA (clean slate)
    // ========================================
    console.log('🧹 Cleaning existing data...');

    // Temporarily disable foreign keys for cleanup
    db.pragma('foreign_keys = OFF');

    // Delete in correct order (children first, then parents)
    const deletedTemplates = db.prepare('DELETE FROM followup_templates WHERE account_id = ?').run(ACCOUNT_ID);
    console.log(`   - Deleted ${deletedTemplates.changes} followup_templates`);

    const deletedStages = db.prepare('DELETE FROM funnel_stages WHERE account_id = ?').run(ACCOUNT_ID);
    console.log(`   - Deleted ${deletedStages.changes} funnel_stages`);

    const deletedPersonas = db.prepare('DELETE FROM account_personas WHERE account_id = ?').run(ACCOUNT_ID);
    console.log(`   - Deleted ${deletedPersonas.changes} account_personas`);

    // Re-enable foreign keys for inserts
    db.pragma('foreign_keys = ON');

    // ========================================
    // 2. INSERT PERSONA
    // ========================================
    console.log('\n🎭 Creating persona...');

    const personaStmt = db.prepare(`
        INSERT INTO account_personas (
            account_id, persona_name, niche, communication_rules,
            objections_script, knowledge_base, post_booking_message,
            prospect_mode_hashtag, prospect_mode_profile,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);

    personaStmt.run(
        ACCOUNT_ID,
        personaData.persona_name,
        personaData.niche,
        personaData.communication_rules,
        personaData.objections_script,
        personaData.knowledge_base,
        personaData.post_booking_message,
        'comments',
        'comments'
    );
    console.log(`   ✅ Persona created: ${personaData.persona_name}`);

    // ========================================
    // 3. INSERT FUNNEL STAGES
    // ========================================
    console.log('\n📊 Creating funnel stages...');

    const stageStmt = db.prepare(`
        INSERT INTO funnel_stages (
            account_id, stage_order, stage_name, stage_label, description,
            max_followups, followup_delay_hours, auto_ignore_after_max,
            conversation_script, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    `);

    const stageIds = {};

    for (const stage of stagesData) {
        try {
            const info = stageStmt.run(
                ACCOUNT_ID,
                stage.stage_order,
                stage.stage_name,
                stage.stage_label,
                stage.description,
                stage.max_followups,
                stage.followup_delay_hours,
                stage.auto_ignore_after_max ? 1 : 0,
                stage.conversation_script
            );
            stageIds[stage.stage_order] = info.lastInsertRowid;
            console.log(`   ✅ Stage ${stage.stage_order}: ${stage.stage_label} (id: ${info.lastInsertRowid})`);
        } catch (err) {
            console.error(`   ❌ Failed to insert stage ${stage.stage_order}:`, err.message);
            throw err;
        }
    }

    // ========================================
    // 4. INSERT FOLLOWUP TEMPLATES
    // ========================================
    console.log('\n📝 Creating followup templates...');

    const templateStmt = db.prepare(`
        INSERT INTO followup_templates (
            stage_id, account_id, template_order, template_text, template_name,
            is_active, usage_count, success_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, 0, 0, datetime('now'), datetime('now'))
    `);

    let totalTemplates = 0;

    for (const [stageOrder, templates] of Object.entries(followupTemplates)) {
        const stageId = stageIds[parseInt(stageOrder)];
        if (!stageId) {
            console.log(`   ⚠️ Stage ${stageOrder}: No stageId found, skipping templates`);
            continue;
        }

        for (let index = 0; index < templates.length; index++) {
            try {
                templateStmt.run(
                    stageId,
                    ACCOUNT_ID,
                    index,
                    templates[index],
                    `Relance ${index + 1}`
                );
                totalTemplates++;
            } catch (err) {
                console.error(`   ❌ Failed to insert template ${index} for stage ${stageOrder}:`, err.message);
                throw err;
            }
        }

        if (templates.length > 0) {
            console.log(`   ✅ Stage ${stageOrder}: ${templates.length} template(s)`);
        }
    }

    // ========================================
    // SUMMARY
    // ========================================
    console.log('\n=== Migration Complete ===');
    console.log(`✅ 1 Persona created`);
    console.log(`✅ ${stagesData.length} Funnel stages created`);
    console.log(`✅ ${totalTemplates} Followup templates created`);
    console.log('\n🎉 Melanie\'s configuration is now fully in the database!');
    console.log('   Visit http://localhost:3000/funnel_config.html to view/edit.\n');
}

// Run migration
migrate().catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});

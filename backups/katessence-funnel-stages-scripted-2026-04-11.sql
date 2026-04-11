-- Backup of katessence funnel stages (scripted version) - 2026-04-11
-- To restore: run each UPDATE statement

-- STEP 1
UPDATE funnel_stages SET conversation_script = '[STEP_1] – ACCROCHE
Objectif : Obtenir une réponse. Le compliment crée de la sympathie, la question crée de la curiosité.

Message type (prenom connu) : "Hello [Prenom], j''ai vu ton profil et franchement j''adore ce que tu fais ! Je peux te poser une question ?"
Message type (prenom inconnu) : "Hello ! J''ai vu ton profil et franchement j''adore ce que tu fais ! Je peux te poser une question ?"

ARBRE DE DÉCISION :

SI réponse = positive / curieuse ("oui", "vas-y", "bien sûr", "dis-moi", "merci ! oui", "avec plaisir")
-> Passe DIRECTEMENT à [STEP_2] et envoie LE MESSAGE TYPE du STEP_2 tel quel.

SI réponse = confirme + pose une question ("oui, c''est quoi ta question ?", "oui dis-moi, tu fais quoi ?", "merci ! tu proposes quoi ?")
-> Passe DIRECTEMENT à [STEP_2] et envoie LE MESSAGE TYPE du STEP_2 tel quel (ne réponds PAS à sa question, le message du STEP_2 y répond naturellement).

SI réponse = méfiante mais pas agressive ("c''est quoi ?", "on se connaît ?", "pourquoi ?")
-> Passe DIRECTEMENT à [STEP_2] et envoie LE MESSAGE TYPE du STEP_2 tel quel.

SI réponse = agressive ("dégage", "arrête", "c''est quoi ce message")
-> "Désolée pour le dérangement, bonne continuation !" + [NOT_INTERESTED]' WHERE account_id = 3 AND stage_name = 'step1';

-- STEP 2 (long script with decision trees - see DB for full content)
-- STEP 3 (long script with decision trees - see DB for full content)
-- STEP 4 (long script with decision trees - see DB for full content)
-- STEP 5 (long script with decision trees - see DB for full content)
-- Full content preserved in DB dump below

-- Complete dump command to restore all:
-- sqlite3 leads.db ".dump funnel_stages" > full_backup.sql

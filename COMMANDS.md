# Guide des Commandes du Projet

Ce document référence toutes les commandes pour utiliser le système via le terminal ou le Dashboard.

## 🚀 Commandes Rapides (Racine)

Depuis la racine du projet (`/instagram-lead-engine`), vous pouvez lancer les agents directement :

| Action | Commande | Description |
|--------|----------|-------------|
| **Dashboard** | `npm run ui` | Lance l'interface visuelle (Stats, Logs, Config). |
| **Prospector** | `npm run prospect -- [options]` | ⭐ **Nouveau**. Pipeline unifié (Scrape + Qualification + Outreach). |
| **Inbox Responder** | `npm run respond:inbox` | Scanne la boîte de réception pour les nouveaux messages. |
| **Follower Outreach** | `npm run respond:followers` | ⭐ **Nouveau**. Souhaite la bienvenue aux nouveaux abonnés. |
| **Engagement Watcher** | `npm run respond:engagement` | ⭐ **Nouveau**. Contacte ceux qui likent/commentent tes posts. |
| **Follow-up** | `npm run reply:followup` | ⭐ **Nouveau**. Relance les leads silencieux (> 2 jours). |
| **Open Session** | `npm run open:session <profile>` | Ouvre Instagram manuellement pour un profil spécifique. |
| **DM Responder** | `npm run reply` | Lance l'assistant de réponse (Statut: `conversation`). |
| **Admin BDD** | `npm run db:admin` | Ouvre l'interface d'administration de la base de données (SQLite Web). |

---

## 🎭 Gestion Multi-Comptes (Nouveau)

Le système supporte désormais l'utilisation de plusieurs comptes Instagram en parallèle sans conflit de cookies/session.
Utilisez l'option `--profile <nom>` sur **tous les agents** (Collector, Outreach, DM Responder).
Chaque profil possède son propre dossier de données (`browser-data-<nom>`) et son propre `account_id` dans la base de données.

**Exemple :**
```bash
# Pour le compte "lifestyle"
npm run open:session lifestyle        # Ouvrir pour se connecter
npm run scrape -- --profile lifestyle -t yoga
npm run respond:inbox -- --profile lifestyle

# Pour le compte "business"
npm run scrape -- --profile business -t marketing
npm run send -- --profile business
npm run reply -- --profile business
```
**Note** : Dans le Dashboard, utilisez le sélecteur de compte en haut à droite pour basculer la vue.

#### 🛠️ Commande Utile : Open Session
Si vous avez besoin de vous connecter manuellement ou de vérifier quelque chose sur un compte sans lancer d'agent :
```bash
npm run open:session <nom_du_profil>
```
Cela ouvrira une fenêtre Chrome avec les cookies et la session isolée du profil demandé.

---

## 🤖 Détail des Agents & Options

### 1. Dashboard (Interface Visuelle)
L'outil central pour suivre l'activité sans toucher au code.
```bash
npm run ui
```
- **Port** : 3000 (par défaut)
- **Fonctions** : Stats en temps réel, édition des prompts, logs des agents.

### 2. Collector Agent (Collecte)
*Alias racine : `npm run scrape --`*

**Exemples :**
```bash
# Scraper 20 posts sur des hashtags
npm run scrape -- -t hypersensible dependanceaffective --max-posts 20

# Scraper les followers d'un concurrent
npm run scrape -- -p https://www.instagram.com/melanieportmann_coach/ --max-posts 10 --profile melanie
```

**Options Principales :**
- `--profile <nom>` : **Nouveau**. Utilise un profil de navigateur spécifique (ex: `compte1`).
- `-t, --hashtags <tags>` : Hashtags à cibler.
- `-p, --profiles <urls>` : Profils concurrents à analyser.
- `--max-posts <n>` : Nombre max de posts à scanner.
- `--max-comments <n>` : Nombre max de commentaires à récupérer par post (défaut: 50).
- `--scrape-profiles` : Active le scan approfondi des profils trouvés (plus lent mais plus riche).

✅ **Améliorations récentes :**
- **Résolution Interactive** : Si un CAPTCHA apparaît, le script se met en pause et sonne pour vous laisser le résoudre manuellement.
- **Détection Intelligente** : Ignore automatiquement les posts déjà scrapés (même session ou précédent).

---

### 3. Outreach Agent (Envoi de Messages)
*Alias racine : `npm run send --`*

**Exemples :**
```bash
# Prévisualiser qui sera contacté (DRY RUN)
npm run send -- --preview --limit 10

# Envoyer des messages aux "nouveaux" leads (par lots de 10)
npm run send -- --status new --limit 10

# Relancer les leads en échec
npm run send -- --status failed_outreach --limit 5
```

**Options Principales :**
- `--profile <nom>` : **Nouveau**. Utilise le profil spécifié pour l'envoi.
- `--limit <n>` : Nombre max de messages à envoyer.
- `--simple` : **Nouveau**. Envoie un message court ("[Prénom] ?") au lieu des templates complexes.
- `--status <s_status>` : Filtrer les leads par statut (`new`, `failed_outreach`, etc.). Défaut: `new`.
- `--preview` : Mode simulation (ne lance pas le navigateur).
- `--live` : Confirme l'envoi réel.

✅ **Améliorations récentes :**
- **Gestion "Pas de Contact"** : Détecte et ignore proprement les profils publics sans bouton "Contacter/Message".
- **Comptes Privés** : Ne tente plus d'ouvrir les DMs des comptes privés non suivis (évite les erreurs).
- **Extraction Prénom** : Cherche d'abord le "Vrai Nom" dans la bio avant d'utiliser le username.
- **Pause Challenge** : Comme le collector, se met en pause si Instagram demande une vérification.

---

### 3b. Prospector Agent (Pipeline Unifié) ⭐ NOUVEAU
*Alias racine : `npm run prospect --`*

**Le mode le plus efficace pour la prospection.** Combine Scraping + Qualification + Outreach en une seule session navigateur.

**Exemples :**
```bash
# Mode test (affiche ce qui serait fait sans ouvrir le navigateur)
npm run prospect -- --profile melanie --source "#dependanceaffective" --dry-run

# Prospecter depuis un hashtag (3 posts, 10 leads max par post)
npm run prospect -- --profile melanie --source "#dependanceaffective" --posts 3 --leads 10

# Prospecter depuis un profil concurrent
npm run prospect -- --profile melanie --source "@concurrent_username" --posts 2 --leads 5

# Limiter le total de contacts pour cette session
npm run prospect -- --profile melanie --source "#hypersensibilite" --total 15
```

**Options Principales :**
- `--profile <nom>` : **(Obligatoire)** Profil Instagram à utiliser.
- `--source <valeur>` : **(Obligatoire)** Hashtag (`#tag`) ou profil concurrent (`@username`).
- `--total <n>` : **(Objectif)** Nombre total de messages à envoyer avant de s'arrêter (défaut: 20).
- `--posts <n>` : Taille du "batch" (nombre de posts à scraper à la fois) (défaut: 3).
- `--leads <n>` : Nombre max de leads à traiter par post (défaut: 10).
- `--dry-run` : Mode simulation (pas de navigateur).

**Workflow Automatique :**
1. Cherche un lot de posts (défini par `--posts`)
2. Traite les leads de ces posts
3. **Tant que l'objectif `--total` n'est pas atteint** : cherche le lot suivant de posts récents
4. S'arrête une fois l'objectif atteint ou plus de posts disponibles

---

### 4. DM Responder (Gestion des Réponses)
*Alias racine : `npm run reply --`*

Aide à rédiger des réponses contextuelles grâce à l'IA.

**Mode Interactif (recommandé)**
Lance l'interface pour générer des réponses aux messages reçus.
```bash
# Uniquement les nouveaux messages reçus (Statut: conversation)
npm run reply:conversation -- --profile mon_compte

# Uniquement les prospects qui n'ont pas encore répondu (Statut: outreach)
# Note: Les leads sans réponse après 7 jours seront auto-désactivés.
npm run reply:outreach -- --profile mon_compte

# Toutes les discussions en cours (Statut: conversation, outreach, contacted)
npm run reply -- --interactive --profile mon_compte
```
*Le script vous demandera de coller le message du prospect et vous proposera une réponse.*

**Mode Inbox Scanner (RECOMMANDÉ pour la rapidité)**
Scanne directement votre boîte de réception Instagram pour trouver les conversations non lues et suggérer des réponses. Ne traite que les messages en gras (nouvelles réponses).
```bash
npm run respond:inbox -- --profile mon_compte
```

**Mode Automatique (Cron/URL)**
Vérifie les nouveaux messages des leads suivis en visitant chaque URL DM stockée en base.
```bash
npm run reply:auto -- --profile mon_compte
```
*Note : Cela visitera les profils via leur URL DM stockée en base.*

**Options :**
- `--profile <nom>` : **Nouveau**. Isole la session et les données par compte.
- `--conversation-only` : **Nouveau**. Filtre uniquement les leads en statut `conversation` (ceux qui ont répondu).
- `--outreach-only` : **Nouveau**. Filtre uniquement les leads en statut `outreach` (ceux qui n'ont pas encore répondu).
- `--limit <nombre>` : Augmente le nombre maximum de leads à parcourir (défaut: 1000).

---

### 4b. Follower Outreach (Accueil des nouveaux abonnés) ⭐ NOUVEAU
*Alias racine : `npm run respond:followers --`*

Scanne les notifications pour identifier les nouveaux abonnés et leur envoyer un message de bienvenue personnalisé (si configuré dans `melanie.config.js`).

**Exemples :**
```bash
# Scanner les abonnés ultra-récents (Aujourd'hui)
npm run respond:followers -- --profile melanie

# Scanner aussi ceux de la semaine (plus lent, nécessite du scroll)
npm run respond:followers -- --profile melanie --track-week

# Voir ce qui serait fait sans envoyer (Simulation)
npm run respond:followers -- --profile melanie --dry-run
```

**Options :**
- `--profile <nom>` : **(Obligatoire)** Profil Instagram à utiliser.
- `-w, --track-week` : Scanne aussi la section "Cette semaine" dans les notifications.
- `-d, --dry-run` : Analyse les profils mais n'envoie pas de message.
- `--show-browser` : Affiche la fenêtre (défaut: true).

---

### 4c. Follow-up Agent (Relances automatiques) ⭐ NOUVEAU
*Alias racine : `npm run reply:followup --`*

Identifie les leads qui ont reçu un message mais n'ont pas répondu depuis plus de 2 jours (48h). Envoie une relance basée sur le contexte et les étapes de la conversation.

**Exemples :**
```bash
# Lancer les relances pour un profil
npm run reply:followup -- --profile melanie
```

**Options :**
- `--profile <nom>` : **(Obligatoire)** Profil Instagram à utiliser.
- `--limit <n>` : Limite le nombre de relances (prévention spam).

---

### 4d. Engagement Watcher (Likes & Commentaires) ⭐ NOUVEAU
*Alias racine : `npm run respond:engagement --`*

Scanne tes notifications pour trouver les personnes qui interagissent avec tes propres posts (likes et commentaires) et leur envoie un message personnalisé.

**Exemples :**
```bash
# Lancer le scan des interactions récentes
npm run respond:engagement -- profile melanie

# Voir ce qui serait fait sans envoyer (Simulation)
npm run respond:engagement -- --profile melanie --dry-run
```

**Workflow :**
1. Scanne les notifications pour identifier les posts likés ou commentés.
2. Se rend sur chaque post.
3. Extrait la liste des personnes ayant liké et commenté.
4. Qualifie chaque profil et prépare un message d'approche spécifique.

**Options :**
- `--profile <nom>` : **(Obligatoire)** Profil Instagram à utiliser.
- `-w, --track-week` : Scanne aussi la section "Cette semaine" dans les notifications.
- `-d, --dry-run` : Analyse mais n'envoie pas de message.
- `--show-browser` : Affiche la fenêtre (défaut: true).

---

### 5. Administration Base de Données
Outil puissant pour voir et modifier les données brutes.

```bash
npm run db:admin
```
- Ouvre une interface web sur `http://localhost:8081`.
- Vous pouvez exécuter des requêtes SQL, supprimer des lignes, ou exporter des données.

---

*Alias racine : `npm run backup` ou `npm run restore`*

> [!IMPORTANT]
> Par sécurité, une sauvegarde vers Google Drive est lancée **automatiquement** à la fin de chaque commande `collect`, `send` et `reply`.

**Commandes manuelles :**
```bash
# Sauvegarde locale uniquement
npm run backup

# Sauvegarde + upload vers Google Drive
npm run backup:remote

# Restauration interactive
npm run restore         # Local
npm run restore:remote  # Cloud

# Tout réinitialiser (⚠️ SUPRESSION DÉFINITIVE)
rm agents/collector/permanent-data/leads.db*
```

**Options Sauvegarde :**
- `--upload` : Upload le backup vers Google Drive via rclone.
- `--keep <n>` : Nombre de backups à conserver (défaut: 7). 

**Fichiers sauvegardés :**
- `permanent-data/leads.db` (+ fichiers WAL/SHM)
- `permanent-data/scraped_posts.json`
- `.env`

**Configuration Google Drive (une seule fois) :**
```bash
# Installer rclone
brew install rclone

# Configurer le remote "gdrive"
rclone config
# Suivre les instructions pour Google Drive
```

**Automatisation (cron) :**
Pour lancer le backup tous les soirs à 2h :
```bash
crontab -e
# Ajouter :
0 2 * * * cd /chemin/vers/agents/collector && node scripts/backup.js --upload >> /tmp/backup.log 2>&1
```

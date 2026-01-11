# Guide des Commandes du Projet

Ce document référence toutes les commandes pour utiliser le système via le terminal ou le Dashboard.

## 🚀 Commandes Rapides (Racine)

Depuis la racine du projet (`/instagram-lead-engine`), vous pouvez lancer les agents directement :

| Action | Commande | Description |
|--------|----------|-------------|
| **Dashboard** | `npm run ui` | Lance l'interface visuelle (Stats, Logs, Config). |
| **Collector** | `npm run scrape -- [options]` | Lance la collecte de leads. |
| **Outreach** | `npm run send -- [options]` | Lance l'envoi de messages (Statut: `outreach`). |
| **DM Responder** | `npm run reply` | Lance l'assistant de réponse (Statut: `conversation`). |
| **Reply:Replied** | `npm run reply:replied` | **Nouveau**. Cible uniquement les leads qui ont répondu. |
| **Admin BDD** | `npm run db:admin` | Ouvre l'interface d'administration de la base de données (SQLite Web). |

---

## 🎭 Gestion Multi-Comptes (Nouveau)

Le système supporte désormais l'utilisation de plusieurs comptes Instagram en parallèle sans conflit de cookies/session.
Utilisez l'option `--profile <nom>` sur **tous les agents** (Collector, Outreach, DM Responder).
Chaque profil possède son propre dossier de données (`browser-data-<nom>`) et son propre `account_id` dans la base de données.

**Exemple :**
```bash
# Pour le compte "lifestyle"
npm run scrape -- --profile lifestyle -t yoga
npm run send -- --profile lifestyle
npm run reply -- --profile lifestyle

# Pour le compte "business"
npm run scrape -- --profile business -t marketing
npm run send -- --profile business
npm run reply -- --profile business
```
**Note** : Dans le Dashboard, utilisez le sélecteur de compte en haut à droite pour basculer la vue.

Chaque profil possède son propre dossier de données (`browser-data-<nom>`). La première fois, vous devrez vous connecter manuellement pour chaque profil.

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
npm run scrape -- -p https://instagram.com/competitor_profile/ --max-posts 50
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

### 4. DM Responder (Gestion des Réponses)
*Alias racine : `npm run reply --`*

Aide à rédiger des réponses contextuelles grâce à l'IA.

**Mode Interactif (recommandé)**
Lance l'interface pour générer des réponses aux messages reçus.
```bash
# Uniquement les nouveaux messages reçus (Statut: conversation)
npm run reply:conversation -- --profile mon_compte

# Toutes les discussions en cours (Statut: conversation, outreach, contacted)
npm run reply -- --interactive --profile mon_compte
```
*Le script vous demandera de coller le message du prospect et vous proposera une réponse.*

**Mode Automatique (Cron)**
Vérifie les nouveaux messages des leads suivis et génère des suggestions.
```bash
npm run reply:auto -- --profile mon_compte
```
*Note : Cela visitera les profils via leur URL DM stockée en base.*

**Options :**
- `--profile <nom>` : **Nouveau**. Isole la session et les données par compte.
- `--conversation-only` : **Nouveau**. Filtre uniquement les leads en statut `conversation` (ceux qui ont répondu).
- `--limit <nombre>` : Augmente le nombre maximum de leads à parcourir (défaut: 1000).

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

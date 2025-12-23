# Guide des Commandes du Projet

Ce document référence toutes les commandes pour utiliser le système via le terminal ou le Dashboard.

## 🚀 Commandes Rapides (Racine)

Depuis la racine du projet (`/instagram-lead-engine`), vous pouvez lancer les agents directement :

| Action | Commande | Description |
|--------|----------|-------------|
| **Dashboard** | `npm run ui` | Lance l'interface visuelle (Stats, Logs, Config). |
| **Collector** | `npm run scrape -- [options]` | Lance la collecte de leads. |
| **Outreach** | `npm run send -- [options]` | Lance l'envoi de messages. |
| **DM Responder** | `npm run reply` | Lance l'assistant de réponse. |
| **Admin BDD** | `npm run db:admin` | Ouvre l'interface d'administration de la base de données (SQLite Web). |

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
- `-t, --hashtags <tags>` : Hashtags à cibler.
- `-p, --profiles <urls>` : Profils concurrents à analyser.
- `--max-posts <n>` : Nombre max de posts à scanner.
- `--max-comments <n>` : Nombre max de commentaires à récupérer par post (défaut: 50).
- `--scrape-profiles` : Active le scan approfondi des profils trouvés (plus lent mais plus riche).

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
- `--limit <n>` : Nombre max de messages à envoyer (le script s'arrête une fois atteint ou si plus de leads).
- `--status <s_status>` : Filtrer les leads par statut (`new`, `failed`, `qualified`, etc.). Défaut: `new`.
- `--preview` : Mode simulation (ne lance pas le navigateur, affiche juste le plan).
- `--live` : Confirme l'envoi réel des messages (requis si pas en mode preview).

---

### 4. DM Responder (Gestion des Réponses)
*Alias racine : `npm run reply --`*

Aide à rédiger des réponses contextuelles grâce à l'IA.

**Mode Interactif**
Lance l'interface pour générer des réponses aux messages reçus.
```bash
npm run reply -- --interactive
```
*Le script vous demandera de coller le message du prospect et vous proposera une réponse.*

**Mode Automatique (Cron)**
Vérifie les nouveaux messages des leads suivis et génère des suggestions.
```bash
npm run reply:auto
```
*Note : Cela visitera les profils via leur URL DM stockée en base.*

**Options :**
- `--list` : Affiche les conversations actives nécessitant une attention.
- `--username <user>` : Charge l'historique d'un utilisateur spécifique depuis la base.

---

### 5. Administration Base de Données
Outil puissant pour voir et modifier les données brutes.

```bash
npm run db:admin
```
- Ouvre une interface web sur `http://localhost:8081`.
- Vous pouvez exécuter des requêtes SQL, supprimer des lignes, ou exporter des données.

# Guide des Commandes du Projet

Ce document référence toutes les commandes utiles pour installer, configurer et utiliser les différents agents du système.

## 📦 Installation et Configuration Initiale

Avant de commencer, assurez-vous d'avoir Node.js 18+ installé.

### 1. Installation des dépendances
Il faut installer les dépendances pour chaque agent individuellement.

```bash
# Collector (Collecte de données)
cd agents/collector
npm install

# Outreach (Envoi de messages)
cd ../outreach
npm install

# DM Responder (Réponse aux messages)
cd ../dmresponder
npm install

# Retour à la racine
cd ../..
```

### 2. Installation du navigateur (Playwright)
Nécessaire pour le Collector et l'Outreach.

```bash
npx playwright install chromium
```

### 3. Configuration de l'Auto-Login
Permet de stocker vos identifiants Instagram de manière sécurisée (localement).

```bash
cd agents/collector
./setup-autologin.sh
```

---

## 🤖 Utilisation des Agents

### 1. Collector Agent (Recherche et Scraping)
*Emplacement : `agents/collector`*

**Commande Principale (Pipeline Complet)**
Lance le scraping, sauvegarde en base de données, génère le rapport Excel et l'ouvre automatiquement.
```bash
npm run scrape -- [options]
```

**Exemples d'utilisation :**
```bash
# Recherche par hashtags (Fitness, Yoga)
npm run scrape -- -t fitness yoga --max-posts 20

# Recherche par profils concurrents
npm run scrape -- -p https://instagram.com/competitor1/ --max-posts 10

# Mode mixte (Hashtags + Profils)
npm run scrape -- -t fitness -p competitor1 --max-posts 10

# Obtenir uniquement les profils enrichis pour les leads existants
npm run scrape -- --only-profiles
```

**Arguments Disponibles (`npm run scrape`) :**

| Argument | Description | Défaut |
|----------|-------------|--------|
| `-t, --hashtags <tags...>` | Liste de hashtags (séparés par espace). | Aucun |
| `-p, --profiles <urls...>` | Liste d'URLs de profils concurrents. | Aucun |
| `--max-posts <number>` | Nombre max de posts à scraper par source. | `10` |
| `--max-comments <number>` | Nombre max de commentaires par post. | `50` |
| `--scrape-profiles` | Active le scraping enrichi des profils trouvés. | `false` |
| `--max-profile-age <hours>` | Age max avant re-scraping d'un profil (heures). | `168` (7 jours) |
| `--no-scrape` | Saute l'étape de scraping (traite les données existantes). | `false` |
| `--no-save` | Ne sauvegarde pas en base de données. | `false` |
| `--no-build` | Ne génère pas le fichier Excel. | `false` |
| `--no-open` | N'ouvre pas le fichier Excel à la fin. | `false` |

**Commandes Avancées / Maintenance :**

- **Scraper uniquement (Sans BDD/Excel) :**
  Utilisé pour le débogage ou si vous voulez juste les fichiers CSV bruts.
  ```bash
  npm run scrape-core -- -t fitness --max-posts 5
  ```

- **Générer l'Excel manuellement :**
  Si vous avez déjà des données en base et voulez juste refaire le fichier Excel.
  ```bash
  npm run build-final-db
  # Ou via le pipeline :
  npm run scrape -- --only-build
  ```

- **Sauvegarder et générer sans scraper :**
  ```bash
  npm run scrape -- --only-save-build
  ```

### 2. Outreach Agent (Premier Contact)
*Emplacement : `agents/outreach`*

**Mode Prévisualisation (Recommandé avant envoi)**
Vérifie qui va être contacté et avec quel message, sans rien envoyer.
```bash
npm run preview -- --limit 5
```

**Mode Envoi (Manuel)**
Ouvre le navigateur pour que vous puissiez confirmer l'envoi de chaque message.
```bash
npm run send -- --limit 5
```

**Vérifier le statut**
Affiche des statistiques sur les messages envoyés.
```bash
npm run status
```

### 3. DM Responder Agent (Gestion des Conversations)
*Emplacement : `agents/dmresponder`*

**Mode Interactif**
Lance l'interface pour générer des réponses aux messages reçus.
```bash
npm run start -- --interactive
```

---

## 🔄 Workflow Complet (Exemple)

Voici l'enchaînement typique pour une session de travail :

1. **Collecte** : Trouver 50 nouveaux prospects intéressés par le fitness.
   ```bash
   cd agents/collector
   npm run scrape -- --hashtags fitness --target-prospects 50
   ```

2. **Qualificaton & Analyse** : (Automatique via le workflow interne, ou scripts dédiés si présents).
   *Note : Le Collector enregistre directement en base de données.*

3. **Outreach** : Préparer et envoyer 10 messages par jour.
   ```bash
   cd ../outreach
   npm run preview -- --limit 10
   # Si tout est OK :
   npm run send -- --limit 10
   ```

4. **Suivi** : Répondre aux prospects qui ont répondu.
   ```bash
   cd ../dmresponder
   npm run start -- --interactive
   ```

## 🛠️ Commandes Utiles de Développement

**Tests**
Lancer les tests unitaires pour vérifier que tout fonctionne.
```bash
cd agents/collector && npm test
cd agents/outreach && npm test
cd agents/dmresponder && npm test
```

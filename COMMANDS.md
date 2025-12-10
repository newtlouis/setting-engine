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

**Lancer un scraping (Mode complet)**
Scrape des posts à partir de hashtags et de profils concurrents.
```bash
npm run scrape -- --hashtags fitness,coach --target-prospects 20
```

**Options utiles :**
- `--mode both` (par défaut) : Scrape hashtags ET profils.
- `--resume` : Reprend le scraping là où il s'est arrêté.
- `--headless` : Lance le navigateur sans interface visible (non recommandé pour éviter la détection).

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

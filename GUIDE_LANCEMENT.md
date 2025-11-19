# 🚀 Guide de Lancement - Instagram Lead Engine

Guide complet pour lancer votre système de génération de leads Instagram.

---

## 📋 Table des Matières

1. [Installation Initiale](#installation-initiale)
2. [Configuration](#configuration)
3. [Workflow Complet](#workflow-complet)
4. [Dépannage](#dépannage)

---

## 1️⃣ Installation Initiale

### Prérequis

- ✅ Node.js 18+ installé
- ✅ npm ou yarn
- ✅ Compte Instagram actif
- ✅ Terminal moderne (WezTerm, Alacritty, Kitty, etc.)

### Étape 1: Installer le Collector Agent

```bash
# 1. Aller dans le dossier Collector
cd agents/collector

# 2. Installer les dépendances
npm install

# 3. Installer Playwright et Chromium
npx playwright install chromium

# 4. Copier le fichier d'environnement
cp .env.example .env

# 5. Vérifier l'installation
node bin/run.js --help
```

**Sortie attendue:**
```
Instagram Lead Engine - Collector Agent
Options:
  -m, --mode <mode>             Mode: hashtags|profiles|both|...
  -t, --hashtags <tags...>      Hashtags to scrape
  ...
```

### Étape 2: Installer le DM Responder Agent

```bash
# 1. Aller dans le dossier DM Responder
cd ../dmresponder

# 2. Installer les dépendances
npm install

# 3. Copier le fichier d'environnement
cp .env.example .env

# 4. Vérifier l'installation
node bin/run.js --help
```

**Sortie attendue:**
```
Instagram Lead Engine - DM Responder Agent
Options:
  -c, --conversation <file>     Path to conversation_history.json
  --interactive                 Interactive mode
  ...
```

---

## 2️⃣ Configuration

### Configurer le Collector

Éditez `agents/collector/.env`:

```bash
# Optionnel - pour debug
DEBUG=false

# Délais entre actions (millisecondes)
MIN_DELAY=3000
MAX_DELAY=7000

# Limites par défaut
DEFAULT_MAX_POSTS=50
DEFAULT_MAX_COMMENTS=100
```

### Configurer le DM Responder

Éditez `agents/dmresponder/.env`:

```bash
# Optionnel - pour debug
DEBUG=false

# Température pour l'IA (si vous utilisez une API)
TEMPERATURE=0.7
```

---

## 3️⃣ Workflow Complet

### 🎯 Objectif

Collecter des leads Instagram → Qualifier → Analyser → Contacter

### Étape 1: Collecter les Données (Collector Agent)

#### Option A: Scraper des Hashtags

```bash
cd agents/collector

node bin/run.js \
  --mode hashtags \
  --hashtags fitness weightloss transformation \
  --max-posts 50 \
  --max-comments 100
```

**Ce qui se passe:**
1. ✅ Chromium s'ouvre (mode visible)
2. ✅ Vous devez vous connecter manuellement à Instagram
3. ✅ L'agent découvre les posts des hashtags
4. ✅ Scrape les commentaires
5. ✅ Sauvegarde dans `output/posts.csv` et `output/comments.csv`

#### Option B: Scraper des Profils Concurrents

```bash
node bin/run.js \
  --mode profiles \
  --profiles concurrent_coach fitness_influencer \
  --max-posts 30 \
  --max-comments 100
```

#### Option C: Combiner Hashtags + Profils

```bash
node bin/run.js \
  --mode both \
  --hashtags fitness transformation \
  --profiles concurrent_coach \
  --max-posts 25 \
  --max-comments 100
```

**⏱️ Durée estimée:** 10-30 minutes selon le nombre de posts

**📊 Résultats attendus:**
```
output/
├── posts.csv          # Liste des posts découverts
├── comments.csv       # Commentaires extraits
└── context/          # Métadonnées par post
    ├── post_123.json
    └── post_456.json
```

---

### Étape 2: Qualifier les Leads (Prospector Agent - À CRÉER)

⚠️ **CET AGENT N'EXISTE PAS ENCORE**

**Avec OpenCode, créez-le facilement:**

```bash
# Lancer OpenCode
opencode

# Changer vers l'agent architect
Tab → architect

# Demander la création
"Crée l'agent Prospector qui:
- Lit agents/collector/output/comments.csv
- Analyse chaque commentaire pour détecter pain points et goals
- Classifie comme warm/cold/irrelevant avec score 0-100
- Output vers agents/prospector/output/leads.json
Suis exactement le template dans AGENTS.md"
```

**Une fois créé, l'utiliser:**
```bash
cd agents/prospector

node bin/run.js \
  --input ../collector/output/comments.csv \
  --output leads.json \
  --min-score 60
```

**📊 Résultat attendu:**
```json
[
  {
    "username": "sarah_fitness23",
    "warmth": "warm",
    "score": 85,
    "pain_points": ["Lack of consistency", "No motivation"],
    "goals": ["Get in shape", "Build habits"],
    "comment_text": "I've been trying for months...",
    "post_url": "https://instagram.com/p/ABC123/"
  }
]
```

---

### Étape 3: Analyser les Top Prospects (Lead Analyzer - À CRÉER)

⚠️ **CET AGENT N'EXISTE PAS ENCORE**

**Avec OpenCode:**

```bash
# Changer vers l'agent architect
Tab → architect

"Crée l'agent Lead Analyzer qui:
- Lit agents/prospector/output/leads.json
- Identifie les 3-5 meilleurs prospects
- Génère des stratégies de contact personnalisées
- Output vers agents/lead-analyzer/output/messages.json
Suis le template dans AGENTS.md"
```

**Une fois créé:**
```bash
cd agents/lead-analyzer

node bin/run.js \
  --input ../prospector/leads.json \
  --output messages.json \
  --top 5
```

**📊 Résultat attendu:**
```json
{
  "persona_summary": {
    "common_pain_points": ["Consistency", "Motivation"],
    "common_goals": ["Get fit", "Build habits"]
  },
  "top_prospects": [
    {
      "username": "sarah_fitness23",
      "score": 85,
      "messages": [
        {
          "angle": "empathy_first",
          "script": "Hey Sarah! I saw your comment...",
          "purpose": "rapport"
        }
      ]
    }
  ]
}
```

---

### Étape 4: Outreach Manuel (VOUS)

⚠️ **CETTE ÉTAPE EST 100% MANUELLE - JAMAIS D'AUTOMATION**

1. **Lisez `messages.json`**
   ```bash
   cat agents/lead-analyzer/output/messages.json | jq
   ```

2. **Choisissez vos top prospects**
   - Regardez les scores
   - Lisez les pain points
   - Vérifiez que c'est pertinent

3. **Personnalisez les messages**
   - NE COPIEZ PAS les scripts tels quels
   - Adaptez à votre voix
   - Ajoutez du contexte personnel

4. **Envoyez manuellement sur Instagram**
   - Ouvrez Instagram (app ou web)
   - Trouvez le profil du prospect
   - Envoyez votre DM personnalisé
   - ⚠️ JAMAIS D'AUTOMATION DE SENDING

---

### Étape 5: Gérer les Conversations (DM Responder)

**Quand utiliser:** UNIQUEMENT après que le prospect a répondu à votre premier DM manuel.

#### Mode Interactif (Recommandé)

```bash
cd agents/dmresponder

node bin/run.js --interactive
```

**Workflow:**
1. Le terminal vous demande le message du prospect
2. Vous le collez
3. Appuyez Enter deux fois
4. L'agent génère une réponse suggérée

**Exemple:**
```
📝 Interactive mode

Enter the prospect's message (press Enter twice when done):
Yeah, I've been struggling for months and nothing works.

[Entrée]
[Entrée]

✅ Message received

🤖 Generating response...

─────────────────────────────────────────────────────────
💡 SUGGESTED RESPONSE:

I hear you. That's so frustrating when you're putting in 
effort but not seeing results. Can I ask—what have you 
tried so far?

─────────────────────────────────────────────────────────

📍 Stage: empathy_building
📝 Type: empathy

🧠 Reasoning:
User expressed frustration and lack of results. Respond 
with empathy before qualifying.

💭 Alternative approaches:
   1. Ask about their specific situation
   2. Share a relatable story

📋 Suggested next steps:
   1. Wait for their response
   2. Look for qualification signals
   3. Continue building trust

💾 Response saved to: response.json

⚠️  Remember to review and personalize before sending!
```

#### Mode Fichier

```bash
# 1. Créer conversation_history.json
cat > conversation_history.json << 'EOF'
[
  {
    "role": "assistant",
    "text": "Hey! I saw your comment. Are you dealing with something similar?"
  },
  {
    "role": "user",
    "text": "Yeah, I've been struggling for months and nothing works."
  }
]
EOF

# 2. Générer la réponse
node bin/run.js \
  -c conversation_history.json \
  -o response.json

# 3. Lire la réponse suggérée
cat response.json | jq '.next_message'
```

#### Avec Contexte Lead (Optionnel)

```bash
# Si vous avez les données du prospector
node bin/run.js \
  -c conversation_history.json \
  -l lead_context.json \
  -o response.json
```

**Où `lead_context.json`:**
```json
{
  "username": "sarah_fitness23",
  "warmth": "warm",
  "score": 85,
  "pain_points": ["Consistency", "Motivation"],
  "goals": ["Get fit"]
}
```

---

## 4️⃣ Workflow Complet Résumé

```
┌─────────────────────────────────────────────────────────────┐
│                    WORKFLOW INSTAGRAM                        │
└─────────────────────────────────────────────────────────────┘

1. [COLLECTOR] Scraper Instagram
   ↓
   posts.csv + comments.csv
   ↓
   
2. [PROSPECTOR - À CRÉER] Classifier les leads
   ↓
   leads.json (warm/cold/irrelevant)
   ↓
   
3. [LEAD ANALYZER - À CRÉER] Analyser les tops
   ↓
   messages.json (stratégies personnalisées)
   ↓
   
4. [VOUS] Outreach Manuel
   ✋ JAMAIS D'AUTOMATION
   ↓
   
5. [Prospect répond]
   ↓
   
6. [DM RESPONDER] Suggérer réponse
   ↓
   response.json
   ↓
   
7. [VOUS] Review + Personnaliser + Envoyer
   ✋ TOUJOURS REVIEW AVANT D'ENVOYER
```

---

## 🛠️ Dépannage

### Problème: Chromium ne s'ouvre pas

```bash
# Réinstaller Playwright
cd agents/collector
npx playwright install --force chromium
```

### Problème: "Challenge detected" sur Instagram

**Solution:**
- Attendez 24-48h
- Utilisez un compte différent
- Réduisez `--max-posts` et `--max-comments`
- Augmentez les délais dans `.env`

### Problème: Sélecteurs Instagram cassés

**Instagram a changé son UI**

1. Lisez `agents/collector/prompts/selector_notes.md`
2. Mettez à jour `agents/collector/src/config.js`
3. Section `SELECTORS`

### Problème: Pas de commentaires scrappés

**Causes possibles:**
- Posts avec commentaires désactivés
- Posts trop anciens
- Rate limit Instagram

**Solution:**
- Vérifiez `output/context/*.json` pour les détails
- Essayez avec des posts plus récents

### Problème: Réponses DM Responder trop génériques

**Solution:**
1. Ajoutez le contexte lead:
   ```bash
   node bin/run.js -c conversation.json -l lead_context.json
   ```

2. Ou créez un `business_context.json`:
   ```json
   {
     "service": "Coaching fitness 12 semaines",
     "target_audience": "Femmes 25-40 ans",
     "unique_value": "Approche holistique mind+body"
   }
   ```
   
   ```bash
   node bin/run.js -c conversation.json -b business_context.json
   ```

---

## ⚠️ Rappels Importants

### Éthique & ToS

1. **Manual Login UNIQUEMENT**
   - Ne jamais automatiser la connexion Instagram
   - Toujours compléter 2FA manuellement

2. **Pas d'Automation de DM**
   - ❌ JAMAIS automatiser l'envoi de messages
   - ✅ TOUJOURS envoyer manuellement
   - ✅ TOUJOURS personnaliser les messages

3. **Rate Limits**
   - Respecter les délais (3-7 secondes)
   - Ne pas scraper excessivement
   - Arrêter si challenge détecté

4. **Qualité > Quantité**
   - Mieux vaut 10 prospects qualifiés que 100 spams
   - Personnaliser chaque interaction
   - Construire de vraies relations

---

## 📊 Exemple de Session Complète

```bash
# 1. Collecter (30 min)
cd agents/collector
node bin/run.js --mode hashtags --hashtags fitness --max-posts 30
# → output/comments.csv créé

# 2. Créer Prospector avec OpenCode (15 min)
opencode
Tab → architect
"Crée l'agent Prospector..."
# → agents/prospector/ créé

# 3. Qualifier (5 min)
cd agents/prospector
node bin/run.js -i ../collector/output/comments.csv -o leads.json
# → leads.json créé avec 25 leads

# 4. Créer Lead Analyzer avec OpenCode (15 min)
opencode
Tab → architect
"Crée l'agent Lead Analyzer..."
# → agents/lead-analyzer/ créé

# 5. Analyser (2 min)
cd agents/lead-analyzer
node bin/run.js -i ../prospector/leads.json -o messages.json --top 5
# → messages.json avec 5 top prospects

# 6. Review et Outreach Manuel (1h)
cat messages.json | jq
# Lire, personnaliser, envoyer manuellement sur Instagram

# 7. Gérer Conversations (au fil de l'eau)
cd agents/dmresponder
node bin/run.js --interactive
# Coller réponse prospect → Obtenir suggestion → Review → Envoyer
```

**Temps total première fois:** ~2-3 heures
**Temps une fois setup:** ~30 min pour collecter + envoyer

---

## 🎯 Métriques de Succès

Suivez ces KPIs:

1. **Collection**
   - Nombre de posts découverts
   - Nombre de commentaires scrapés
   - Taux de réussite (commentaires/posts)

2. **Qualification**
   - % de leads warm/cold/irrelevant
   - Score moyen des leads warm
   - Pertinence des pain points extraits

3. **Conversion**
   - Taux de réponse aux premiers DMs
   - Taux de qualification (% qui passent les questions)
   - Taux de booking de calls

**Objectif réaliste:**
- 100 commentaires → 20 leads warm → 10 réponses → 3 calls → 1 client

---

## 📚 Ressources

- **AGENTS.md** - Architecture et conventions du projet
- **README.md** - Vue d'ensemble
- **OPENCODE_SETUP.md** - Configuration OpenCode
- **.opencode/README.md** - Guide des agents OpenCode
- **agents/*/README.md** - Documentation spécifique de chaque agent

---

## 🆘 Support

Besoin d'aide?

1. **Vérifiez AGENTS.md** pour l'architecture
2. **Lisez le README de l'agent** concerné
3. **Activez le mode debug**:
   ```bash
   DEBUG=true node bin/run.js ...
   ```

---

**Bon lancement! 🚀**

N'oubliez pas: Qualité > Quantité, Relations > Spam

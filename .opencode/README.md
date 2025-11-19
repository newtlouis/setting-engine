# OpenCode Agent Configuration

Ce dossier contient les configurations des agents OpenCode spécialisés pour le projet Instagram Lead Engine.

## 📋 Agents Disponibles

### 🏗️ Primary Agents (Tab pour changer)

#### 1. **architect** 
Agent principal pour créer de nouveaux agents et maintenir l'architecture globale.

**Utilisation**:
```
Tab → Sélectionner "architect"
"Crée l'agent Prospector en suivant les conventions du projet"
```

**Capacités**:
- ✅ Créer de nouveaux agents
- ✅ Maintenir la cohérence architecturale
- ✅ Modifier tous les fichiers
- ✅ Exécuter des commandes npm
- ⚠️ Demande confirmation pour git

**Température**: 0.3 (créatif pour l'architecture)

---

#### 2. **collector-dev**
Spécialisé dans le développement du Collector Agent (scraping Instagram).

**Utilisation**:
```
Tab → Sélectionner "collector-dev"
"Ajoute le scraping des captions de posts"
"Améliore la gestion d'erreurs pour les posts supprimés"
```

**Capacités**:
- ✅ Modifier le code du Collector
- ✅ Travailler avec Playwright
- ✅ Gérer les sélecteurs Instagram
- ✅ Respecter les contraintes ToS

**Température**: 0.2 (précis pour le code)

---

#### 3. **dmresponder-dev**
Spécialisé dans le développement du DM Responder Agent.

**Utilisation**:
```
Tab → Sélectionner "dmresponder-dev"
"Ajoute un nouveau stage de conversation pour le nurturing"
"Améliore la détection d'objections"
```

**Capacités**:
- ✅ Modifier la state machine
- ✅ Créer de nouveaux templates
- ✅ Améliorer la détection d'intent
- ✅ Maintenir l'approche empathique

**Température**: 0.2 (précis pour le code)

---

#### 4. **planner** 
Agent read-only pour planifier sans modifier.

**Utilisation**:
```
Tab → Sélectionner "planner"
"Analyse le code du Collector et propose un plan pour ajouter le scraping de stories"
```

**Capacités**:
- ✅ Lire et analyser le code
- ✅ Créer des plans détaillés
- ✅ Suggérer des améliorations
- ❌ NE PEUT PAS modifier de fichiers
- ❌ NE PEUT PAS exécuter de commandes

**Température**: 0.1 (très analytique)

---

## 🎯 Quand Utiliser Quel Agent?

### Pour Créer un Nouvel Agent
```bash
# Utiliser: architect
"Crée l'agent Prospector qui analyse les commentaires et classifie les leads"
```

### Pour Modifier un Agent Existant
```bash
# Pour Collector
Tab → collector-dev
"Ajoute le support des Reels Instagram"

# Pour DM Responder
Tab → dmresponder-dev
"Améliore la gestion des objections de prix"
```

### Pour Planifier Sans Risque
```bash
# Utiliser: planner
"Analyse le code et crée un plan pour refactoriser la state machine"
```

### Pour des Modifications Globales
```bash
# Utiliser: architect
"Ajoute une fonction de validation d'email dans shared/validators.js"
"Standardise la gestion d'erreurs dans tous les agents"
```

---

## 🔄 Changer d'Agent

### Méthode 1: Tab Key
```
Appuyez sur Tab pour cycler entre les agents primary
```

### Méthode 2: @ Mention
```
@planner analyse ce code et donne-moi un plan
@architect crée un nouvel agent
```

---

## ⚙️ Configuration

### Fichiers de Configuration

```
.opencode/
├── agent/
│   ├── architect.md          # Agent système
│   ├── collector-dev.md      # Agent Collector
│   ├── dmresponder-dev.md    # Agent DM Responder
│   └── planner.md            # Agent planification
└── README.md                 # Ce fichier

opencode.json                 # Config globale du projet
```

### Structure d'un Agent (Markdown)

```markdown
---
description: Description courte de l'agent
mode: primary|subagent
model: anthropic/claude-sonnet-4-20250514
temperature: 0.0-1.0
tools:
  write: true|false
  edit: true|false
  bash: true|false
permission:
  bash:
    "npm install": allow|ask|deny
---

Instructions système pour l'agent...
```

---

## 📚 Documentation des Agents

Chaque agent connaît:

1. **L'architecture du projet** (via AGENTS.md)
2. **Les conventions de code**:
   - ESM (import/export)
   - async/await
   - Naming conventions (camelCase, PascalCase, etc.)
3. **La structure des agents**:
   - bin/run.js (CLI)
   - src/index.js (logique)
   - src/config.js (config)
   - src/utils.js (helpers)
4. **Les patterns établis**:
   - Gestion d'erreurs
   - Configuration en cascade
   - Validation des inputs

---

## 🎨 Personnalisation

### Créer un Nouvel Agent

```bash
opencode agent create
```

Ou manuellement:

```bash
# 1. Créer le fichier
touch .opencode/agent/mon-agent.md

# 2. Ajouter la configuration
---
description: Mon agent spécialisé
mode: primary
model: anthropic/claude-sonnet-4-20250514
temperature: 0.2
tools:
  write: true
---

Instructions pour mon agent...
```

### Modifier un Agent Existant

Éditez directement le fichier `.md` dans `.opencode/agent/`

---

## 💡 Tips & Best Practices

### 1. Utilisez le Bon Agent
- **architect** → Changements structurels
- **collector-dev** → Code Collector
- **dmresponder-dev** → Code DM Responder  
- **planner** → Analyse sans risque

### 2. Planifiez Avant de Coder
```bash
# 1. Analyser avec planner
Tab → planner
"Analyse comment ajouter cette feature"

# 2. Implémenter avec l'agent approprié
Tab → collector-dev
"Implémente le plan suggéré"
```

### 3. Vérifiez les Permissions
Les agents ont des permissions différentes pour bash:
- `allow` → Exécute directement
- `ask` → Demande confirmation
- `deny` → Interdit

### 4. Utilisez la Température Appropriée
- **0.0-0.2** → Code précis (collector-dev, dmresponder-dev)
- **0.3-0.5** → Créativité modérée (architect)
- **0.6-1.0** → Très créatif (brainstorming)

---

## 🚀 Exemples Concrets

### Créer l'Agent Prospector
```bash
Tab → architect
"Crée l'agent Prospector qui:
- Lit comments.csv
- Analyse chaque commentaire
- Classifie comme warm/cold/irrelevant
- Extrait pain points et goals
- Score 0-100
- Output vers leads.json
Suis exactement le template dans AGENTS.md"
```

### Améliorer le Collector
```bash
Tab → collector-dev
"Ajoute le scraping des captions de posts:
1. Capture le texte complet de la caption
2. Ajoute au CSV
3. Gère les posts sans caption
4. Teste avec des captions longues"
```

### Planifier un Refactor
```bash
Tab → planner
"Analyse la state machine du DM Responder et propose:
1. Comment améliorer la séparation des responsabilités
2. Où ajouter de nouveaux stages
3. Comment rendre le code plus testable
Ne modifie rien, juste analyse et propose un plan"
```

---

## 📖 Ressources

- **AGENTS.md** → Documentation complète du projet
- **README.md** → Vue d'ensemble du système
- **Agents individuels** → agents/*/README.md

---

## ❓ Troubleshooting

### L'agent ne respecte pas les conventions?
→ Vérifiez que AGENTS.md est à jour et mentionnez explicitement les conventions

### L'agent modifie des fichiers non souhaités?
→ Utilisez `planner` pour analyser d'abord, puis un agent spécialisé

### Permissions bash refusées?
→ Vérifiez `permission.bash` dans opencode.json ou l'agent .md

### Agent non disponible?
→ Vérifiez que le fichier .md existe dans `.opencode/agent/`

---

**Bon coding avec OpenCode! 🎉**

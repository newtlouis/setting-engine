# 🎉 Configuration OpenCode Complète

Votre projet **Instagram Lead Engine** est maintenant **100% optimisé** pour OpenCode avec des agents spécialisés!

---

## 📁 Ce Qui A Été Créé

### 1. **AGENTS.md** (mis à jour)
Documentation complète pour OpenCode avec:
- Architecture & Design Patterns
- Coding Conventions
- Templates d'agents
- Guide "How to Add a New Agent"

### 2. **opencode.json**
Configuration globale du projet avec 4 agents configurés.

### 3. **.opencode/agent/** (nouveaux fichiers)
4 agents spécialisés au format Markdown:

```
.opencode/
├── agent/
│   ├── architect.md          # 🏗️ Créer de nouveaux agents
│   ├── collector-dev.md      # 🔍 Développer le Collector
│   ├── dmresponder-dev.md    # 💬 Développer le DM Responder
│   └── planner.md            # 📋 Planifier sans modifier
└── README.md                 # Guide d'utilisation des agents
```

---

## 🤖 Les 4 Agents Créés

### 1. **architect** - L'Architecte Système
**Rôle**: Créer de nouveaux agents et maintenir l'architecture globale

**Utilisation**:
```bash
Tab → architect
"Crée l'agent Prospector en suivant les conventions"
```

**Capacités**:
- ✅ Créer de nouveaux agents
- ✅ Modifier tous les fichiers
- ✅ Commandes npm (install, test)
- ⚠️ Git demande confirmation

**Température**: 0.3 (créatif mais structuré)

---

### 2. **collector-dev** - Spécialiste Collector
**Rôle**: Développer et maintenir l'agent de scraping Instagram

**Utilisation**:
```bash
Tab → collector-dev
"Ajoute le scraping des captions"
"Améliore la gestion d'erreurs pour les posts supprimés"
```

**Capacités**:
- ✅ Modifier agents/collector/
- ✅ Travailler avec Playwright
- ✅ Gérer les sélecteurs Instagram
- ✅ Respecter ToS Instagram

**Température**: 0.2 (précision maximale)

**Connaissances spécifiques**:
- Anti-détection Instagram
- Sélecteurs CSS pour Instagram
- Rate limiting et delays
- Gestion des challenges

---

### 3. **dmresponder-dev** - Spécialiste Conversations
**Rôle**: Développer et maintenir l'agent de conversation AI

**Utilisation**:
```bash
Tab → dmresponder-dev
"Ajoute un nouveau stage de nurturing"
"Améliore la détection d'objections de prix"
```

**Capacités**:
- ✅ Modifier agents/dmresponder/
- ✅ Travailler sur la state machine
- ✅ Créer des templates de messages
- ✅ Améliorer la détection d'intent

**Température**: 0.2 (précision maximale)

**Connaissances spécifiques**:
- 9 stages de conversation
- Types de messages (empathy, qualification, etc.)
- Templates et personnalisation
- Éthique et human-first approach

---

### 4. **planner** - L'Analyste Read-Only
**Rôle**: Analyser et planifier SANS faire de modifications

**Utilisation**:
```bash
Tab → planner
"Analyse le Collector et propose un plan pour ajouter les Reels"
```

**Capacités**:
- ✅ Lire tous les fichiers
- ✅ Analyser le code
- ✅ Créer des plans détaillés
- ❌ NE PEUT PAS modifier
- ❌ NE PEUT PAS exécuter bash

**Température**: 0.1 (analytique pur)

**Utilisation recommandée**:
1. Demandez un plan avec `planner`
2. Reviewez le plan
3. Implémentez avec l'agent approprié (`architect`, `collector-dev`, etc.)

---

## 🚀 Guide de Démarrage Rapide

### Scénario 1: Créer l'Agent Prospector
```bash
# 1. Lancer OpenCode
opencode

# 2. Changer vers l'agent architect
Tab (jusqu'à voir "architect")

# 3. Demander la création
"Crée l'agent Prospector qui:
- Lit comments.csv en entrée
- Analyse chaque commentaire pour extraire pain points et goals
- Classifie comme warm/cold/irrelevant avec score 0-100
- Output vers leads.json
Suis exactement le template dans AGENTS.md"

# 4. L'agent va créer toute la structure automatiquement!
```

### Scénario 2: Améliorer le Collector
```bash
# 1. Changer vers collector-dev
Tab → collector-dev

# 2. Demander l'amélioration
"Ajoute le scraping des captions de posts:
- Extrait le texte complet
- Ajoute au CSV
- Gère les posts sans caption
- Teste avec différents cas"

# 3. L'agent modifie les bons fichiers en respectant les conventions
```

### Scénario 3: Planifier d'Abord
```bash
# 1. Analyser avec planner
Tab → planner
"Analyse comment refactoriser la state machine du DM Responder 
pour la rendre plus modulaire. Propose un plan détaillé."

# 2. Review du plan
# L'agent donne un plan sans toucher au code

# 3. Implémenter avec dmresponder-dev
Tab → dmresponder-dev
"Implémente le plan de refactoring suggéré par planner"
```

---

## 📊 Comparaison des Agents

| Agent | Modifications | Bash | Spécialisation | Température |
|-------|--------------|------|----------------|-------------|
| **architect** | ✅ Toutes | ⚠️ Ask | Architecture système | 0.3 |
| **collector-dev** | ✅ Collector | ⚠️ Ask | Scraping Instagram | 0.2 |
| **dmresponder-dev** | ✅ DM Responder | ⚠️ Ask | Conversations AI | 0.2 |
| **planner** | ❌ Aucune | ❌ Non | Analyse & Plans | 0.1 |

---

## 🎯 Quand Utiliser Quel Agent?

### Utiliser **architect** pour:
- ✅ Créer un nouvel agent complet
- ✅ Modifier shared/constants.js ou shared/validators.js
- ✅ Changements structurels globaux
- ✅ Standardiser des patterns dans tous les agents

### Utiliser **collector-dev** pour:
- ✅ Ajouter/modifier des features de scraping
- ✅ Améliorer les sélecteurs Instagram
- ✅ Gérer les erreurs de réseau
- ✅ Optimiser la collection de données

### Utiliser **dmresponder-dev** pour:
- ✅ Modifier la state machine
- ✅ Créer de nouveaux templates
- ✅ Améliorer la détection d'intent
- ✅ Ajouter de nouveaux stages de conversation

### Utiliser **planner** pour:
- ✅ Comprendre du code existant
- ✅ Planifier des features complexes
- ✅ Analyser l'impact de changements
- ✅ Faire un audit sans risque

---

## 💡 Best Practices

### 1. **Workflow Recommandé**
```bash
# Étape 1: Planifier
Tab → planner
"Analyse X et propose un plan"

# Étape 2: Implémenter
Tab → [agent approprié]
"Implémente le plan"

# Étape 3: Tester
"Exécute les tests pour vérifier"
```

### 2. **Changements de Contexte**
```bash
# Quand vous travaillez sur plusieurs agents
Tab → collector-dev     # Travail sur Collector
Tab → dmresponder-dev   # Switch vers DM Responder
Tab → architect         # Changement global
```

### 3. **Sécurité avec Git**
Tous les agents demandent confirmation pour:
- `git add`
- `git commit`
- `git push`

### 4. **Permissions Bash**
Autorisations automatiques pour:
- `npm install`
- `npm test`
- `npx playwright install` (collector-dev seulement)
- `git status`, `git diff`, `git log`

---

## 🔧 Configuration Avancée

### Modifier un Agent
Éditez `.opencode/agent/[nom-agent].md`:

```markdown
---
description: ...
temperature: 0.2  # ← Modifiez ici
tools:
  write: true     # ← Ou ici
---

Instructions...  # ← Ou les instructions
```

### Créer un Nouvel Agent
```bash
# Méthode 1: Commande interactive
opencode agent create

# Méthode 2: Créer manuellement
touch .opencode/agent/mon-agent.md
# Puis suivre le format des agents existants
```

### Ajouter dans opencode.json
```json
{
  "agent": {
    "mon-agent": {
      "description": "Description",
      "mode": "primary",
      "model": "anthropic/claude-sonnet-4-20250514",
      "temperature": 0.2,
      "tools": {
        "write": true,
        "edit": true
      }
    }
  }
}
```

---

## 📚 Documentation Complète

Chaque agent a accès à:

1. **AGENTS.md** (26 KB de documentation)
   - Architecture complète
   - Design patterns
   - Coding conventions
   - Templates d'agents
   - Guide étape par étape

2. **Instructions spécialisées** (dans leur .md)
   - Rôle spécifique
   - Technologies utilisées
   - Contraintes importantes
   - Conventions de code
   - Exemples concrets

3. **Contexte du projet**
   - README.md
   - Documentation individuelle des agents
   - Schémas JSON
   - Exemples de données

---

## ✅ Checklist de Vérification

- [x] AGENTS.md mis à jour avec architecture et conventions
- [x] opencode.json créé avec 4 agents
- [x] .opencode/agent/ créé avec 4 fichiers .md
- [x] architect.md (création d'agents)
- [x] collector-dev.md (scraping Instagram)
- [x] dmresponder-dev.md (conversations AI)
- [x] planner.md (analyse read-only)
- [x] .opencode/README.md (guide d'utilisation)
- [x] Permissions bash configurées
- [x] Températures optimisées par agent
- [x] Documentation complète pour chaque agent

---

## 🎉 Vous êtes Prêt!

Votre projet est maintenant **parfaitement configuré** pour OpenCode avec:

✅ **4 agents spécialisés** pour différentes tâches
✅ **Documentation complète** dans AGENTS.md
✅ **Conventions de code** bien définies
✅ **Templates réutilisables** pour nouveaux agents
✅ **Permissions granulaires** pour la sécurité
✅ **Températures optimisées** par type de tâche

### Prochaines Étapes

1. **Testez les agents**:
   ```bash
   opencode
   Tab → architect
   "Explique-moi l'architecture du projet"
   ```

2. **Créez vos premiers agents manquants**:
   ```bash
   Tab → architect
   "Crée l'agent Prospector"
   ```

3. **Commencez à développer**:
   ```bash
   Tab → collector-dev
   "Ajoute une nouvelle feature"
   ```

**Bon coding! 🚀**

---

## 🆘 Support

- **Documentation**: Lisez `.opencode/README.md`
- **Conventions**: Consultez `AGENTS.md`
- **Troubleshooting**: Section dans `.opencode/README.md`


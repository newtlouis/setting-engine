# Architecture du Projet

Ce document décrit l'architecture Clean Architecture mise en place pour le projet Instagram Lead Engine.

## Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────────┐
│                         AGENTS                                   │
│  (collector, outreach, dmresponder, prospector, dashboard)      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      APPLICATION LAYER                           │
│                    (shared/application/)                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │   Use Cases     │  │     Ports       │  │                 │  │
│  │                 │  │  (Interfaces)   │  │                 │  │
│  │ RecordMessage   │  │ ILeadRepository │  │                 │  │
│  │ SaveLeadsFrom   │  │ IAccountRepo    │  │                 │  │
│  │ Comments        │  │ IOutreachQueue  │  │                 │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       DOMAIN LAYER                               │
│                      (shared/domain/)                            │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │    Entities     │  │ Value Objects   │  │    Services     │  │
│  │                 │  │                 │  │                 │  │
│  │  Lead           │  │  LeadStatus     │  │  SpamDetector   │  │
│  │  Message        │  │  Warmth         │  │  LeadQualifier  │  │
│  │                 │  │  ConversationSt │  │  EngagementScor │  │
│  │                 │  │  Username       │  │                 │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    INFRASTRUCTURE LAYER                          │
│                   (shared/infrastructure/)                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  Repositories   │  │    Database     │  │    Browser      │  │
│  │                 │  │                 │  │                 │  │
│  │ SqliteLeadRepo  │  │  SQLite/        │  │ BrowserService  │  │
│  │ SqliteAccount   │  │  better-sqlite3 │  │ loginHandler    │  │
│  │ SqliteOutreach  │  │                 │  │ interactions    │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Structure des dossiers

```
shared/
├── container.js              # DI Container - Point d'entrée unique
├── domain/                   # Couche Domaine (logique métier pure)
│   ├── entities/
│   │   ├── Lead.js          # Entité Lead avec méthodes métier
│   │   └── Message.js       # Entité Message
│   ├── value-objects/
│   │   ├── LeadStatus.js    # Enum + transitions d'état
│   │   ├── Warmth.js        # cold/warm/hot + calculs
│   │   ├── ConversationStep.js
│   │   └── Username.js      # Validation + normalisation
│   ├── services/
│   │   ├── SpamDetector.js  # Détection spam commentaires
│   │   ├── LeadQualifier.js # Qualification des leads
│   │   └── EngagementScorer.js
│   └── tests/               # Tests unitaires domaine
│
├── application/              # Couche Application (orchestration)
│   ├── use-cases/
│   │   ├── RecordMessage.js
│   │   ├── SaveLeadsFromComments.js
│   │   ├── QualifyLeads.js
│   │   └── ...
│   ├── ports/               # Interfaces (contrats)
│   │   ├── ILeadRepository.js
│   │   ├── IAccountRepository.js
│   │   └── IOutreachQueueRepository.js
│   └── tests/               # Tests unitaires avec mocks
│
├── infrastructure/           # Couche Infrastructure (implémentations)
│   └── repositories/
│       ├── SqliteLeadRepository.js
│       ├── SqliteAccountRepository.js
│       └── SqliteOutreachQueueRepository.js
│
├── browser/                  # Services browser partagés
│   ├── BrowserService.js    # Gestion sessions Playwright
│   ├── loginHandler.js      # Login Instagram
│   └── interactions.js      # delay, typeHumanLike, etc.
│
└── config/
    └── selectors.js         # Sélecteurs Instagram centralisés
```

## Principes SOLID appliqués

### Single Responsibility (S)
- Chaque classe/module a une seule raison de changer
- `SpamDetector` ne fait que détecter le spam
- `LeadQualifier` ne fait que qualifier les leads

### Open/Closed (O)
- Les Value Objects sont immutables (frozen)
- Nouvelles règles de spam = nouveaux patterns, pas modification du code existant

### Liskov Substitution (L)
- Les repositories implémentent des interfaces
- `SqliteLeadRepository` peut être remplacé par `PostgresLeadRepository`

### Interface Segregation (I)
- Interfaces spécifiques par domaine (`ILeadRepository`, `IAccountRepository`)
- Pas d'interface "god" avec toutes les méthodes

### Dependency Inversion (D)
- Les Use Cases dépendent d'interfaces (ports), pas d'implémentations
- Le container injecte les implémentations concrètes

## Container (Injection de Dépendances)

```javascript
import { getContainer } from './shared/container.js';

// Initialisation (une seule fois)
const container = await getContainer();

// Accès aux repositories
const lead = await container.repositories.lead.findByUsername('john_doe', accountId);
const account = await container.repositories.account.getOrCreate('melanie');
await container.repositories.outreachQueue.add({ username, preparedMessage, ... });

// Accès direct DB (pour requêtes complexes/stats)
const db = container.getDb();
const stats = db.prepare('SELECT COUNT(*) ...').get();
```

## Comment ajouter une nouvelle feature

### 1. Nouvelle règle métier → Domain Service

```javascript
// shared/domain/services/NewService.js
export const NewService = {
  calculate(input) {
    // Logique métier pure, pas de dépendances externes
    return result;
  }
};
```

### 2. Nouvelle opération complexe → Use Case

```javascript
// shared/application/use-cases/DoSomething.js
export class DoSomething {
  constructor({ leadRepository, otherRepository }) {
    this.leadRepository = leadRepository;
    // Injection des dépendances
  }

  async execute(input) {
    // Orchestration
    const lead = await this.leadRepository.findByUsername(input.username);
    // ... logique
    return result;
  }
}
```

### 3. Nouvel accès données → Repository

```javascript
// 1. Définir l'interface (port)
// shared/application/ports/INewRepository.js
export function createNewRepository(impl) {
  return {
    findById: impl.findById,
    save: impl.save,
    // ...
  };
}

// 2. Implémenter
// shared/infrastructure/repositories/SqliteNewRepository.js
export function createSqliteNewRepository({ getDb }) {
  return createNewRepository({
    async findById(id) {
      const db = getDb();
      return db.prepare('SELECT * FROM table WHERE id = ?').get(id);
    },
    // ...
  });
}

// 3. Enregistrer dans container.js
```

## Tests

### Lancer les tests

```bash
# Tous les tests
node --test shared/domain/tests/*.test.js shared/application/tests/*.test.js

# Tests domaine uniquement
node --test shared/domain/tests/*.test.js

# Tests application uniquement
node --test shared/application/tests/*.test.js
```

### Structure des tests

```javascript
// Tests Domain Services - pas de mocks nécessaires
import { SpamDetector } from '../services/SpamDetector.js';

test('should detect spam', () => {
  const result = SpamDetector.analyze({ text: '🔥🔥🔥', username: 'bot' });
  assert.strictEqual(result.isSpam, true);
});

// Tests Use Cases - avec mocks des repositories
function createMockRepositories() {
  return {
    leadRepository: {
      findByUsername: mock.fn(async () => mockLead),
      save: mock.fn(async (lead) => lead)
    }
  };
}

test('should record message', async () => {
  const repos = createMockRepositories();
  const useCase = new RecordMessage(repos);
  const result = await useCase.execute({ username: 'test', text: 'Hello', direction: 'outgoing' });
  assert.strictEqual(result.lead.status, 'contacted');
});
```

## Décisions d'architecture

### Ce qui est dans le Domain Layer
- Règles métier pures (spam detection, qualification, scoring)
- Value Objects avec validation
- Entités avec méthodes métier

### Ce qui est dans l'Application Layer
- Use Cases orchestrant plusieurs opérations
- Interfaces (ports) définissant les contrats

### Ce qui reste en SQL direct (acceptable)
- Requêtes de stats complexes (dashboard)
- Requêtes de reporting
- Migrations de données

### Ce qui n'est PAS implémenté (éviter over-engineering)
- Domain Events
- CQRS
- Event Sourcing
- Abstract Factories généralisées

## Diagramme de dépendances

```
Agents ──────► Application Layer ──────► Domain Layer
   │                  │
   │                  │ (interfaces)
   │                  ▼
   └────────► Infrastructure Layer
                      │
                      ▼
                   SQLite
```

**Règle clé:** Les flèches pointent vers le centre (Domain). Le Domain ne dépend de rien d'externe.

---

## Workflow des Conversations

### Schéma simplifié (v3)

| Champ | Type | Calcul | Usage |
|-------|------|--------|-------|
| `status` | ENUM | Semi-auto | Cycle de vie du lead (new → contacted → replied → qualified → converted) |
| `conversation_step` | INTEGER (0-8) | **Auto** | Compteur de messages (pour relances sans réponse) |
| `funnel_step` | INTEGER (1-9) | **Auto** | Étape du script de vente (parsé depuis [STEP_X]) |
| `warmth` | ENUM | **Auto** | Niveau d'engagement (cold/warm/hot) |
| `booking_status` | TEXT | Manuel | État de la réservation (pending/confirmed/completed) |

### Distinction conversation_step vs funnel_step

| Champ | Source | Usage |
|-------|--------|-------|
| `conversation_step` | Calculé depuis `total_messages_sent/received` | Savoir combien de relances envoyées |
| `funnel_step` | Parsé depuis `[STEP_X]` dans les messages LLM | Savoir où on en est dans le script de vente |

**Exemple:**
- Lead répond → `conversation_step = 2` (FIRST_REPLY)
- LLM génère `[STEP_3.1] Je vois...` → `funnel_step = 3` (Exploration)
- Lead ne répond pas → `conversation_step = 4` (FOLLOW_UP_1), mais `funnel_step` reste 3

### LeadStatus (machine à états)

```
new ──────► contacted ──────► replied ──────► qualified ──────► converted
  │              │                │                │
  ▼              ▼                ▼                ▼
ignored        ignored          ignored          ignored
  │              │
  ▼              ▼
failed ◄───── failed
  │              │
  ▼              ▼
manual ◄───── manual
```

**Statuts:**
- `new` - Lead identifié, pas encore contacté
- `contacted` - Premier DM envoyé
- `replied` - Lead a répondu
- `qualified` - Intéressé et qualifié
- `converted` - Booking confirmé
- `ignored` - Exclu manuellement
- `failed` - Erreur technique (compte bloqué, introuvable)
- `manual` - Nécessite intervention manuelle

### Progression automatique des steps

```
Messages envoyés (sans réponse) → conversation_step
─────────────────────────────────────────────────
0 messages                      → 0 (NO_CONTACT)
1 message                       → 1 (FIRST_MESSAGE)
2 messages                      → 4 (FOLLOW_UP_1)
3 messages                      → 5 (FOLLOW_UP_2)
4 messages                      → 6 (FOLLOW_UP_3)
5 messages                      → 7 (FOLLOW_UP_4)
6+ messages                     → 8 (FOLLOW_UP_5)

Dès qu'une réponse est reçue:
1 réponse                       → 2 (FIRST_REPLY)
2+ réponses                     → 3 (ONGOING)
```

### Fonctions utilitaires

```javascript
import {
  calculateStep,      // Calcule le step depuis sent/received counts
  needsFollowUp,      // True pour steps 1, 4, 5, 6, 7
  isAwaitingReply,    // True pour steps 1, 4, 5, 6, 7, 8
  isFollowUpExhausted,// True uniquement pour step 8
  isActiveConversation // True pour steps >= 2
} from './shared/domain/value-objects/ConversationStep.js';
```

### Synchronisation automatique

Le step est recalculé automatiquement dans:
- `Lead._syncConversationStep()` - Appelé par `markContacted()` et `markReplied()`
- `RecordMessage` use case - À chaque message enregistré
- `MarkMessageSent` use case - À chaque envoi confirmé

---

## Funnel Steps (Étapes du script de vente)

Le `funnel_step` track la progression dans le script de vente, parsé depuis les labels `[STEP_X]` générés par le LLM.

### Mapping des étapes

| funnel_step | Label LLM | Description | Relances |
|-------------|-----------|-------------|----------|
| 1 | [STEP_1] | Premier contact (Hey!) | 0 |
| 2 | [STEP_2] | Connexion (intérêt personnel?) | 1 max, puis ignore |
| 3 | [STEP_3.x] | Exploration (vécu, souffrance) | 3 max |
| 4 | [STEP_4.x] | Projection (objectifs) | 3 max |
| 5 | [STEP_5] | Proposition d'appel | 3 max (spécifiques) |
| 6 | [STEP_6] | Créneaux proposés | 3 max |
| 7 | [STEP_7] | Récupération infos | - |
| 8 | [STEP_8] | Confirmation RDV | - |
| 9 | [STEP_9] | Clôture | - |

### Configuration des relances (profiles/*.config.js)

```javascript
followups: {
  step1: { max: 0, templates: [] },           // Pas de relance
  step2: { max: 1, templates: ["..."] },      // 1 seule relance puis ignore
  step3: { max: 3, templates: ["...", "...", "..."] },
  step4: { max: 3, templates: ["...", "...", "..."] },
  step5: { max: 3, templates: ["...", "...", "..."] }  // Spécifiques booking
}
```

### Parsing automatique

Le `RecordMessage` use case parse automatiquement:
- `[STEP_X]` → Met à jour `funnel_step` (seulement si plus grand)
- `[NOT_INTERESTED]` → Passe le lead en `ignored`
- `[MANUAL]` → Passe le lead en `manual`
- `[ALERT_BOOKING]` → Détecté pour alerter (notification future)

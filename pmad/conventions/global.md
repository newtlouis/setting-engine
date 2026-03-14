# Convention Registry — Setting Engine

Single source of truth for all coding conventions in the Instagram Lead Engine project.

---

## JavaScript

### Language & Runtime

- **Runtime:** Node.js (latest LTS)
- **Module system:** ESM exclusively — `import`/`export`, never `require`/`module.exports`
- **Package type:** `"type": "module"` in all `package.json`
- **Async:** Always `async`/`await`, never callbacks, never raw `.then()` chains

### Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Variables/Functions | camelCase | `maxPosts`, `extractComments()` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRIES`, `API_TIMEOUT` |
| Classes | PascalCase | `Lead`, `RecordMessage` |
| Files | camelCase.js or kebab-case.js | `LeadStatus.js`, `spam-filter.js` |
| Frozen enums | PascalCase object | `LeadStatus`, `Warmth` |
| Config objects | PascalCase | `CONFIG`, `TEMPLATES` |

### Import Order

```javascript
// 1. Node built-ins
import { readFile } from 'fs/promises';
import { join } from 'path';

// 2. External dependencies
import { chromium } from 'playwright';
import { Command } from 'commander';

// 3. Internal modules (same layer)
import { CONFIG } from './config.js';
import { sanitize } from './utils.js';

// 4. Shared modules (cross-layer)
import { getContainer } from '../../shared/container.js';
```

### Error Handling

```javascript
// Standard exit codes in CLI agents
process.exit(0);  // Success
process.exit(1);  // User error (bad params, missing files)
process.exit(2);  // System error (network, parsing)

// Error logging
console.error('ERROR:', message);  // To stderr
console.log('INFO:', message);     // To stdout
```

### Class Design

- Use `class` for entities and use cases that hold state or dependencies
- Use plain objects/functions for stateless services and utilities
- Constructor dependency injection: `constructor({ leadRepository, conversationRepository })`
- No inheritance hierarchies — prefer composition

---

## Architecture

### Clean Architecture Layers

```
┌─────────────────────────────────────────┐
│            Agent Layer                  │  CLI entry points, orchestration
│       (agents/{name}/src/)              │
├─────────────────────────────────────────┤
│         Application Layer               │  Use Cases, Ports (interfaces)
│     (shared/application/)               │
├─────────────────────────────────────────┤
│           Domain Layer                  │  Entities, Value Objects, Domain Services
│        (shared/domain/)                 │
├─────────────────────────────────────────┤
│       Infrastructure Layer              │  Repositories, Browser, Platform Adapters
│     (shared/infrastructure/)            │
└─────────────────────────────────────────┘
```

**Rules:**
- Dependencies ALWAYS point inward (Agent → Application → Domain ← Infrastructure)
- Domain layer has ZERO external dependencies (no imports from infrastructure or agents)
- Ports (interfaces) are owned by the Application layer, implemented by Infrastructure
- Agents depend on Application layer (use cases), never directly on Infrastructure

### Folder Structure

```
shared/
├── domain/
│   ├── entities/          # Domain models (Lead, Message, Account, Conversation)
│   ├── value-objects/     # Immutable enums and validated types (LeadStatus, Warmth, Username)
│   ├── services/          # Stateless business logic (SpamDetector, LeadQualifier, EngagementScorer)
│   └── tests/             # Domain unit tests
├── application/
│   ├── use-cases/         # Application actions (RecordMessage, SaveLeadsFromComments, QualifyLeads)
│   ├── ports/             # Interface definitions (ILeadRepository, IAccountRepository)
│   └── tests/             # Use case tests with mocked dependencies
├── infrastructure/
│   └── repositories/      # SQLite implementations (SqliteLeadRepository, SqliteAccountRepository)
├── browser/               # Playwright automation (BrowserService, loginHandler, interactions)
├── platforms/             # Platform adapters (InstagramAdapter)
├── config/                # Shared configuration (selectors, constants)
├── utils/                 # Helper utilities (configLoader, embeddings, calendly)
└── container.js           # Dependency injection container
```

**Agent structure:**
```
agents/{agent-name}/
├── bin/
│   └── run.js             # CLI entry point (Commander.js)
├── src/
│   ├── index.js           # Main agent logic
│   ├── config.js          # Configuration constants
│   └── {modules}.js       # Agent-specific modules
├── tests/                 # Agent tests
└── package.json           # Agent dependencies (type: "module")
```

### Naming Conventions (Architecture)

| Component | Naming Pattern | Example |
|-----------|---------------|---------|
| Entity | Noun | `Lead`, `Message`, `Account` |
| Value Object | Noun or Adjective | `LeadStatus`, `Warmth`, `Username` |
| Domain Service | `{What}` | `SpamDetector`, `LeadQualifier`, `EngagementScorer` |
| Use Case | `{Verb}{Noun}` | `RecordMessage`, `SaveLeadsFromComments`, `QualifyLeads` |
| Port | `I{Noun}Repository` | `ILeadRepository`, `IAccountRepository` |
| Repository | `Sqlite{Noun}Repository` | `SqliteLeadRepository`, `SqliteAccountRepository` |
| Adapter | `{Platform}Adapter` | `InstagramAdapter` |

---

## Patterns

### Dependency Injection Container

The container (`shared/container.js`) wires all layers together:

```javascript
// Pattern: singleton container with lazy initialization
const container = new Container();
await container.initialize(dbPath);

// Repositories created with getDb factory
this.repositories = {
  lead: createSqliteLeadRepository({ getDb }),
  conversation: createSqliteConversationRepository({ getDb }),
};

// Use cases receive repositories as dependencies
this.useCases = {
  recordMessage: new RecordMessage({
    leadRepository: this.repositories.lead,
    conversationRepository: this.repositories.conversation
  }),
};
```

**Rules:**
- One container instance (singleton)
- Repositories receive `{ getDb }` factory — not a raw db instance
- Use cases receive repositories — never the container itself
- New repositories and use cases must be registered in the container

### Value Objects (Frozen Enums)

```javascript
// Pattern: Object.freeze for immutable enums
export const LeadStatus = Object.freeze({
  NEW: 'new',
  CONTACTED: 'contacted',
  REPLIED: 'replied',
  // ...
});

// Companion functions for validation and transitions
export function isValidStatus(status) {
  return Object.values(LeadStatus).includes(status);
}

export function canTransitionTo(currentStatus, newStatus) {
  return VALID_TRANSITIONS[currentStatus]?.includes(newStatus) ?? false;
}
```

### Repository Pattern (Ports & Adapters)

```javascript
// Port (interface) — shared/application/ports/ILeadRepository.js
export function createLeadRepository(impl) {
  return {
    findByUsername: impl.findByUsername,
    save: impl.save,
    updateStatus: impl.updateStatus,
  };
}

// Adapter (implementation) — shared/infrastructure/repositories/SqliteLeadRepository.js
export function createSqliteLeadRepository({ getDb }) {
  return createLeadRepository({
    async findByUsername(username, accountId) {
      const db = getDb();
      return db.prepare('SELECT * FROM leads WHERE username = ? AND account_id = ?').get(username, accountId);
    },
    async save(lead) {
      const db = getDb();
      // ... INSERT or UPDATE
    },
  });
}
```

### Use Case Pattern

```javascript
// Pattern: class with constructor DI and single execute() method
export class RecordMessage {
  constructor({ leadRepository, conversationRepository }) {
    this.leadRepository = leadRepository;
    this.conversationRepository = conversationRepository;
  }

  async execute(input) {
    // 1. Validate / fetch
    // 2. Apply domain logic
    // 3. Persist
    // 4. Return result
  }
}
```

**Rules:**
- One public method: `execute(input)`
- Constructor receives repositories (never raw DB access)
- Returns a result object, never throws for business logic (use status codes or result types)
- Throws only for truly exceptional situations (missing entity, invalid state transition)

### Entity Pattern

```javascript
// Pattern: class with constructor accepting data object
export class Lead {
  constructor(data = {}) {
    this.id = data.id || null;
    this.username = normalizeUsername(data.username);
    this.status = parseStatus(data.status);
    // Support both snake_case (DB) and camelCase (JS) field names
    this.accountId = data.account_id || data.accountId || null;
  }

  // Business methods on the entity
  markContacted() { /* ... */ }
  markReplied() { /* ... */ }
  canTransitionTo(status) { /* ... */ }
}
```

---

## Database

### SQLite Conventions

- **Driver:** `better-sqlite3` (synchronous API)
- **Parameterized queries always** — never string concatenation for SQL
- **Prepared statements** — use `db.prepare(sql).get()` / `.all()` / `.run()`
- **Transactions** — use `db.transaction()` for multi-statement operations
- **Column names:** snake_case in SQLite, camelCase in JavaScript

```javascript
// GOOD: parameterized query
const lead = db.prepare('SELECT * FROM leads WHERE username = ? AND account_id = ?').get(username, accountId);

// BAD: string concatenation (SQL injection risk)
const lead = db.prepare(`SELECT * FROM leads WHERE username = '${username}'`).get();
```

### Migration Pattern

```javascript
// scripts/migrate-{description}.js
import { getContainer } from '../shared/container.js';

const container = await getContainer();
const db = container.getDb();

db.exec(`
  ALTER TABLE leads ADD COLUMN new_field TEXT DEFAULT NULL;
`);

console.log('Migration complete: added new_field to leads');
```

---

## Testing

### Framework

- **Test runner:** `node:test` (built-in)
- **Assertions:** `node:assert`
- **Mocking:** `node:test` mock API (`mock.fn()`)

### Running Tests

```bash
# All domain tests
node --test shared/domain/tests/*.test.js

# All application tests
node --test shared/application/tests/*.test.js

# All tests
node --test shared/domain/tests/*.test.js shared/application/tests/*.test.js

# Specific test file
node --test shared/domain/tests/SpamDetector.test.js
```

### Test Structure

```javascript
import { test, describe, it, mock } from 'node:test';
import assert from 'node:assert';

describe('ComponentName', () => {
  describe('methodName', () => {
    it('should do X when Y', () => {
      // Arrange
      const input = createSampleInput();

      // Act
      const result = component.method(input);

      // Assert
      assert.strictEqual(result, expected);
    });

    it('should throw when invalid input', () => {
      assert.throws(
        () => component.method(null),
        { message: /expected pattern/i }
      );
    });
  });
});
```

### Testing Rules

- **Fresh mocks per test** — create mocks inside each `it()` block, never in `beforeEach()`
- **Test both paths** — nominal (success) AND error cases
- **Descriptive names** — behavior-driven: `it('should reject spam comments')`, not `it('test 1')`
- **No shared state** — each test is independent and self-contained
- **Domain tests are pure** — no mocks needed, just call functions with inputs
- **Use case tests mock repositories** — never hit the real database in unit tests
- **Repository tests can use real SQLite** — in-memory database for integration tests

### Mock Pattern

```javascript
// Mock a repository for use case testing
const mockLeadRepo = {
  findByUsername: mock.fn(async (username) => ({
    id: 1, username, status: 'new'
  })),
  save: mock.fn(async (lead) => lead),
  updateStatus: mock.fn(async () => {}),
};

const useCase = new RecordMessage({
  leadRepository: mockLeadRepo,
  conversationRepository: mockConversationRepo,
});

// Verify mock was called
assert.strictEqual(mockLeadRepo.findByUsername.mock.calls.length, 1);
```

---

## Documentation

### JSDoc Standards

Every exported class, function, and complex type must have JSDoc:

```javascript
/**
 * Records sent and received messages in conversations.
 * Updates lead status based on message direction.
 */
export class RecordMessage {
  /**
   * @param {Object} deps - Dependencies
   * @param {ILeadRepository} deps.leadRepository
   * @param {IConversationRepository} deps.conversationRepository
   */
  constructor({ leadRepository, conversationRepository }) { }

  /**
   * Execute the use case.
   *
   * @param {RecordMessageInput} input
   * @returns {Promise<RecordMessageResult>}
   */
  async execute(input) { }
}

/**
 * @typedef {Object} RecordMessageInput
 * @property {string} username - Lead username
 * @property {string} text - Message content
 * @property {'incoming'|'outgoing'} direction - Message direction
 */
```

**Rules:**
- **Language:** English
- **Style:** Imperative verb (Fetches, Persists, Validates, Records)
- **Classes:** Every class gets a class-level docblock
- **Exported functions:** Every exported function gets a docblock
- **@param:** Include when parameter name alone is not self-explanatory
- **@returns:** Include for non-obvious return types
- **@throws:** Document every exception the function can throw
- **@typedef:** Use for complex input/output objects
- **No obvious comments** — don't document self-evident code

---

## Git

### Commit Messages

- Short first line (imperative: "add", "fix", "update", not "added", "fixes")
- Body for context when needed
- Reference GitHub issues when applicable

### Branch Strategy

- `main` — stable, deployable
- Feature branches for significant changes
- Direct commits to main for small fixes

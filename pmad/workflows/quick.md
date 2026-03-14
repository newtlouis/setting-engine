---
workflow: quick
phases: [0, 3, 4, 6]
description: Fast implementation cycle — scan, implement, test, quality check
---

# Workflow: Quick

Fast development cycle for well-scoped features with clear architecture.

## When to Use

- The feature scope is already well-defined by the developer
- Architecture is clear and follows existing patterns
- Bug fixes, field additions, minor enhancements
- Adding a new method to an existing use case or repository

## Phase Sequence

| Phase | Agent | Mode | Communication | Description |
|-------|-------|------|---------------|-------------|
| 0 — Init | Scanner | Task | Non-blocking | Codebase analysis, pattern detection |
| 3 — Implementation | Coder | Inline | Non-blocking | Code generation, source citation |
| 4 — Tests | Tester | Task | Non-blocking | Test writing, execution verification |
| 6 — Quality | Quality | Task | Non-blocking | Run tests, iterative correction |

## Skipped Phases

| Phase | Reason |
|-------|--------|
| 1 — Scoping | Developer already knows the scope |
| 2 — Architecture | Developer already knows the architecture or it's obvious from patterns |
| 5 — Documentation | Coder generates JSDoc inline during Phase 3 |
| 7 — Review | Developer reviews the code themselves |

## Phase Transitions

### Phase 0 → Phase 3

**Exit criteria:** `.pmad/context.md` produced with status `success`.
**Entry:** Coder receives the developer's feature description directly. No validated architecture — the Coder follows existing patterns from the Scanner context and conventions.

### Phase 3 → Phase 4

**Exit criteria:** All files implemented.
**Entry:** Tester receives the list of implemented files.

### Phase 4 → Phase 6

**Exit criteria:** All tests pass. Tester output status is `success`.
**Entry:** Quality receives the project path.

### Phase 6 → End

**Exit criteria:** All tests pass with zero errors.
**End:** Session complete.

## Escape to Full

If during Phase 3 the Coder encounters complexity that warrants architecture validation:

```
**Decision needed** — architecture

This feature is more complex than expected. Switching to Full mode is recommended.

**Options:**
1. Switch to Full mode — run Phase 2 (Architecture) before continuing
2. Continue in Quick mode — I'll follow existing patterns

**My recommendation:** [based on context]
```

The developer decides whether to escalate or continue.

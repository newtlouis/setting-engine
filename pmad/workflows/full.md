---
workflow: full
phases: [0, 1, 2, 3, 4, 5, 6, 7]
description: Complete feature development cycle
---

# Workflow: Full

Complete development cycle for complex features, new functionality, or unclear scope.

## Phase Sequence

| Phase | Agent | Mode | Communication | Description |
|-------|-------|------|---------------|-------------|
| 0 — Init | Scanner | Task | Non-blocking | Codebase analysis, pattern detection |
| 1 — Scoping | Analyst | Inline | **Blocking** | Functional scoping, clarification questions |
| 2 — Architecture | Architect | Inline | **Blocking** | File tree, architecture validation |
| 3 — Implementation | Coder | Inline | Non-blocking | Code generation, source citation |
| 4 — Tests | Tester | Task | Non-blocking | Test writing, execution verification |
| 5 — Documentation | Coder | Inline | Non-blocking | JSDoc, CHANGELOG |
| 6 — Quality | Quality | Task | Non-blocking | Run tests, iterative correction |
| 7 — Review | 5 review agents + Orchestrator | Task×5 + Inline | **Blocking** | Parallel review, synthesis, modification proposals |

## Phase Transitions

### Phase 0 → Phase 1

**Exit criteria:** `.pmad/context.md` produced with status `success`.
**Entry:** Orchestrator reads context, identifies project structure.

### Phase 1 → Phase 2

**Exit criteria:** Developer has validated the functional scope.
**Entry:** Architect receives validated scope.

### Phase 2 → Phase 3

**Exit criteria:** Developer has validated the architecture (file tree, patterns).
**Entry:** Coder receives validated architecture as its working plan. **This is the critical gate — no code without validated architecture.**

### Phase 3 → Phase 4

**Exit criteria:** All files from the architecture plan are implemented.
**Entry:** Tester receives the list of implemented files.

### Phase 4 → Phase 5

**Exit criteria:** All tests pass. Tester output status is `success`.
**Entry:** Coder switches to documentation mode.

### Phase 5 → Phase 6

**Exit criteria:** JSDoc generated, CHANGELOG updated.
**Entry:** Quality receives the project path.

### Phase 6 → Phase 7

**Exit criteria:** All tests pass with zero errors.
**Entry:** Orchestrator launches 5 review agents in parallel. Each receives the list of produced files and relevant conventions. Orchestrator synthesizes results and presents to developer.

### Phase 7 → End

**Exit criteria:** Developer has validated the review. This means either:
- No pending modifications remain, or
- The developer explicitly declares the code ready (skipping remaining findings)

**Special:** If the review synthesis proposes modifications and the developer accepts them, the Coder applies the changes, then Phase 4 (Tests) and Phase 6 (Quality) re-run before returning to Phase 7. Phase 5 (Documentation) is not re-run — review corrections are targeted code changes.

## Review Cycle

When Phase 7 produces accepted modifications:

```
Phase 7 (review) → Coder applies changes → Phase 4 (re-test) → Phase 6 (re-quality) → Phase 7 (re-review)
```

**Maximum 3 review cycles.** The cycle repeats until the review synthesis produces no further findings, or the developer ends the session. After 3 cycles, the developer can declare the code acceptable and end the session. The developer can break the cycle at any point by declaring the code ready.

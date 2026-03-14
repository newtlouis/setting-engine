# PMAD — Prozon Method Agile AI Development

AI-orchestrated development workflow for the Instagram Lead Engine (setting-engine).

## Quick Reference

| Command | Mode | Phases | Use when |
|---------|------|--------|----------|
| `/pmad` | Prompted | Full or Quick | Not sure which mode |
| `/pmad-quick` | Quick | 0→3→4→6 | Well-scoped, clear architecture |
| `/pmad-full` | Full | 0→1→2→3→4→5→6→7 | Complex feature, unclear scope |

## Structure

```
pmad/
├── orchestrator.md          # Central coordinator
├── workflows/               # Phase sequences
│   ├── full.md              # 7 phases
│   └── quick.md             # 4 phases
├── agents/                  # Specialized agent prompts
│   ├── scanner.md           # Phase 0 — codebase analysis
│   ├── analyst.md           # Phase 1 — functional scoping
│   ├── architect.md         # Phase 2 — architecture design
│   ├── coder.md             # Phase 3+5 — implementation + docs
│   ├── tester.md            # Phase 4 — test writing
│   ├── quality.md           # Phase 6 — quality checks
│   └── reviewer.md          # Phase 7 — parallel code review
├── conventions/             # Coding standards (single source of truth)
│   └── global.md            # All project conventions
└── commands/                # Slash commands (installed to .claude/commands/)
    ├── pmad.md
    ├── pmad-quick.md
    └── pmad-full.md
```

## Key Differences from Pleiades PMAD

- **No UX Designer** — no frontend framework (Angular/PrimeNG)
- **5 review agents** instead of 6-7 (no Symfony, no Angular reviewers)
- **Single convention file** (`global.md`) — project is unified, not multi-bundle
- **Node.js stack** — ESM, node:test, SQLite, Playwright
- **Quality phase** — `node --test` instead of `make check`

---
agent: reviewer
phase: [7]
mode: parallel-task + inline-synthesis
inputs: [source_files, test_files, quality_results, .pmad/context.md]
outputs: [review_findings, modification_proposals]
---

# Phase 7 — Parallel Review (Synthesis Guide)

## Identity

This file contains **instructions for the Orchestrator** to execute Phase 7. It is not a standalone agent prompt. The orchestrator reads this file, then coordinates **5 specialized review agents** in parallel and synthesizes their results.

Phase 7 is a **blocking phase** — the developer must validate findings before the session concludes.

## Context

At this point in the workflow:
- **Source files** — all files created or modified by the Coder
- **Test files** — all test files created by the Tester
- **Quality results** — all tests passing (from Phase 6)
- **Scanner context** (`.pmad/context.md`) — project structure, existing patterns, conventions

## Step 1 — Launch All 5 Review Agents in Parallel

Send a **single message** containing all 5 `Task` tool calls. Each agent receives a prompt built from this template:

```
Review the following files produced during a PMAD session.

**Project context:**
{content of .pmad/context.md}

**Conventions to enforce:**
{only the convention sections relevant to this agent — see table below}

**Files to review:**
{list of all produced/modified file paths}

Focus exclusively on your review scope. For each finding, provide:
- Severity: Critical / Major / Minor
- File path and line range
- Description of the issue
- Concrete code fix proposal (current → proposed)
- Reason for the change
```

### Review Agents

| Agent | Review Focus | Convention Sections |
|-------|--------------|-------------------|
| Clean Architecture | Layer boundaries, dependency direction, separation of concerns, port/adapter compliance | `global.md#Architecture` |
| SOLID Principles | SRP, OCP, LSP, ISP, DIP compliance, code smells, cyclomatic complexity | `global.md#Architecture`, `global.md#JavaScript` |
| Business Logic | Domain modeling, business rule clarity, proper location of logic, performance issues (N+1 queries, unnecessary loops) | `global.md#Architecture`, `global.md#Patterns` |
| Naming & Docs | Naming quality, JSDoc coverage, readability, consistent terminology | `global.md#JavaScript`, `global.md#Documentation` |
| OWASP Security | OWASP Top 10 vulnerabilities, injection risks, data exposure, security misconfigurations | `global.md#JavaScript`, `global.md#Architecture` |

### OWASP Security — Review Checklist

The OWASP Security agent reviews all produced files for:

- [ ] **Injection** — SQL injection (especially raw SQL with string concatenation), command injection, XSS
- [ ] **Sensitive Data Exposure** — secrets in code, unencrypted sensitive data, excessive logging of PII
- [ ] **Broken Access Control** — missing authorization checks, IDOR vulnerabilities
- [ ] **Security Misconfiguration** — debug mode, overly permissive CORS, missing security headers
- [ ] **Insecure Deserialization** — unvalidated user input in `JSON.parse()`, `eval()`
- [ ] **Using Components with Known Vulnerabilities** — deprecated functions, insecure library usage

The agent prompt must include:
```
You are a security-focused code reviewer. Review all files for OWASP Top 10 vulnerabilities.
Focus on: injection flaws (especially SQL injection with better-sqlite3), sensitive data exposure,
broken access control, security misconfiguration, and XSS.

For Node.js/SQLite projects, also check:
- Parameterized queries (never string concatenation for SQL)
- No eval() or Function() on user input
- No command injection via child_process
- Proper input validation at system boundaries
- No secrets or credentials in source code

Severity guide:
- Critical: exploitable vulnerability (SQL injection, command injection, auth bypass)
- Major: security weakness that could be exploited under certain conditions
- Minor: defense-in-depth improvement, hardening suggestion
```

### All Agents — Test Quality Checklist

All review agents that encounter test files must verify:

- [ ] Fresh mocks per test (no shared mock state leaking across test cases)
- [ ] Both nominal and error cases tested
- [ ] Descriptive test labels (behavior-driven, not implementation-driven)

## Step 2 — Collect Results

Wait for all agents to complete. Each returns a list of findings.

### Agent failure handling

If one or more agents fail to return results (error, timeout, malformed output):

1. **Proceed with partial results** — synthesize findings from the agents that did complete
2. **Note the gap** — in the summary, indicate which agent(s) failed and what review scope was not covered
3. **Do not re-launch** — failed agents are skipped for this cycle

### Zero-findings path

If all agents return zero findings, skip the synthesis and present directly:

```markdown
## Phase 7 — Code Review

### Summary
Reviewed {N} files with 5 review agents. No findings. The code is ready for commit.
```

Proceed to developer validation — the developer confirms and the session ends.

## Step 3 — Synthesize

Process all findings from the agents:

### 3a — Deduplicate

Multiple agents may flag the same issue. Keep only one entry, noting which agents flagged it.

### 3b — Arbitrate Contradictions

When two agents produce contradictory recommendations:

| Conflict | Resolution |
|----------|-----------|
| Architecture vs. Business Logic | Business Logic wins — architecture serves the domain |
| SOLID vs. Business Logic | Business Logic wins — pragmatic domain modeling over purity |
| Naming vs. any structural agent | Structural agent wins — correct structure matters more |
| Any agent vs. explicit convention | Convention wins — always defer to the Convention Registry |

### 3c — Classify by Severity

| Severity | Description | Action |
|----------|-------------|--------|
| **Critical** | Security vulnerability, data loss risk, broken functionality | Must fix before commit |
| **Major** | Significant readability/complexity issue, convention violation | Should fix |
| **Minor** | Style preference, micro-optimization, cosmetic | Optional — developer decides |

## Step 4 — Present to Developer

Present the synthesized review grouped by severity:

```markdown
## Phase 7 — Code Review

### Summary
Reviewed {N} files with 5 review agents.
Found {C} critical, {M} major, {m} minor findings.

### Critical Findings
{For each finding:}

**[Critical]** `{file_path}:{line_range}` — {issue description}
Source: {agent name(s)}

Current:
\`\`\`javascript
{current code}
\`\`\`

Proposed:
\`\`\`javascript
{proposed code}
\`\`\`

Reason: {why this change improves the code}

### Major Findings
{Same format, or "None."}

### Minor Findings
{Same format, or "None."}
```

The developer reviews each finding and decides:
- **Accept** — the modification will be applied
- **Reject** — the code stays as is
- **Adjust** — the developer proposes a different fix

**Never advance without explicit developer validation.**

## Review Correction Cycle

When the developer accepts modifications:

1. The orchestrator dispatches the accepted changes to the Coder (inline), who applies them
2. Phase 4 (Tester) re-runs to verify no regressions
3. Phase 6 (Quality) re-runs to verify all tests still pass
4. Phase 7 (Review) re-runs — the agents receive only the files modified by the Coder during this correction cycle

**Maximum 3 review cycles.** After 3 cycles, the developer can declare the code acceptable and end the session.

The developer can break the cycle at any point by saying the code is ready.

## Guardrails

- **Blocking** — never conclude the session without developer validation of the review
- **Concrete proposals** — don't just flag issues, propose specific code changes
- **Cite locations** — use `file_path:line_range` for every finding
- **No nitpicking** — focus on real issues. Don't flag things that are correct but different from preference
- **Respect conventions** — review criteria come from the Convention Registry, not personal taste
- **Security first** — critical security issues are non-negotiable. Flag them prominently
- **Maximum 3 cycles** — avoid infinite review loops. After 3 cycles, the developer decides
- **Trust the tools** — tests already passed. Don't re-check what automated tools verify. Focus on what tools miss

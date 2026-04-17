---
name: audit-codebase
description: Run a comprehensive codebase audit covering memory leaks, async flows, render performance, large files, security, and more
user-invocable: true
argument-hint: "[scope: full | frontend | backend | <area>]"
---

# Codebase Audit

Orchestrate a thorough codebase audit and produce a structured report in `docs/audits/`.

## Process

1. **Read project context:**
   - `CLAUDE.md` — conventions and tech stack
   - `docs/architecture.md` — project structure, state management, core principles
   - Previous audits in `docs/audits/` — compare findings, track regressions

2. **Determine scope.** If the user provided a scope argument, narrow the audit:
   - `full` (default) — all 13 categories
   - `frontend` — categories 1-4, 7, 10, 11
   - `backend` — categories 5-6, 7
   - `dependencies` — category 13 only (SBOM, vulnerabilities, upgrades)
   - A specific area name (e.g., `memory-leaks`, `security`) — just that category

3. **Launch parallel audit agents.** For each category in scope, launch an Agent (`subagent_type: Explore`, `run_in_background: true`) with the corresponding sub-skill instructions. Each agent is research-only — no code changes. All agents run concurrently.

   The sub-skills are:

   | # | Skill | Scope |
   | --- | --- | --- |
   | 1 | `audit-memory-leaks` | Frontend + Rust process cleanup |
   | 2 | `audit-async-flows` | Frontend hooks and async patterns |
   | 3 | `audit-render-performance` | Zustand subscriptions, memoization, re-renders |
   | 4 | `audit-large-files` | File size, decomposition opportunities |
   | 5 | `audit-rust-backend` | Mutex, panics, process management, concurrency |
   | 6 | `audit-security` | SQL injection, XSS, credentials, sandboxing |
   | 7 | `audit-type-safety` | `any` usage, type assertions, missing types |
   | 8 | `audit-test-coverage` | Test inventory, gaps, missing test types |
   | 9 | `audit-dead-code` | Unused exports, deps, deprecated code |
   | 10 | `audit-error-ux` | Error boundaries, silent failures, empty states |
   | 11 | `audit-accessibility` | Keyboard nav, ARIA, contrast, focus |
   | 12 | `audit-documentation` | Doc drift, stale paths, wrong signatures |
   | 13 | `audit-dependencies` | SBOM, vulnerabilities, staleness, upgrades, licenses |

   **CRITICAL: Completeness instruction for every agent prompt.** Include this verbatim in each agent's prompt:

   > "You MUST complete every step in these instructions. Do NOT skip steps due to time, output length, or perceived low priority. Partial results are unacceptable. If a command fails, report the failure and try an alternative. If a section has no findings, explicitly state that — do not omit the section. Run every command listed. Process all output. The user depends on this for security and quality decisions."

   For each agent, read the corresponding sub-skill's SKILL.md and include its full instructions in the agent prompt. Tell each agent to return findings in this format:

   ```
   ### <SEVERITY>: <Finding title>
   **File:** `<path>:<line>`
   <Description>
   **Fix:** <Suggested fix>
   ```

   And to end with a `### Confirmed Good Patterns` section listing what was checked and found correct.

4. **Compile the report.** Once all agents complete, merge their findings into a single document following the output structure below. Count severities, write the summary table, and add section links.

5. **Compare with previous audits.** If a prior audit exists in `docs/audits/`, note in the summary which findings are new, fixed, or regressed.

6. **Save to** `docs/audits/YYYY-MM-DD-<scope>.md`.

7. **Present a summary** to the user with the findings-by-area table and top priorities.

8. **Log observations** to `.claude/skill-feedback.md` if any sub-skill missed relevant findings, over-delivered noise, or had unclear scope. Format per `/retrospect-skills`. Both user and agent contribute.

## Output Structure

```markdown
# <Scope> Audit — YYYY-MM-DD

**Date:** YYYY-MM-DD  **Status:** Audit complete

| Stage | Link | Status |
| --- | --- | --- |
| PRD | — | Pending |
| Tasks | — | Pending |

<1-2 sentence summary.>

## Summary

<Paragraph on overall health and main concerns.>

**Severity counts:** X HIGH, Y MEDIUM, Z LOW

### Findings by Area

| Area | HIGH | MED | LOW | Summary |
| --- | --- | --- | --- | --- |
| [1. Memory Leaks](#1-memory-leaks--resource-cleanup) | N | N | N | <one-line> |
| ... | ... | ... | ... | ... |

---

## 1. Memory Leaks & Resource Cleanup
<findings from audit-memory-leaks agent>

---

## 2. Async Flows & Race Conditions
<findings from audit-async-flows agent>

...
```

## Guidelines

- **Research only.** Never modify code during an audit.
- **Verify before flagging.** Read the actual code — don't flag based on pattern name alone.
- **Severity ratings:**
  - **HIGH** — Will cause bugs, data loss, leaks, or crashes in normal usage
  - **MEDIUM** — Degraded performance, fragile code, or edge-case incorrect behavior
  - **LOW** — Code smell, maintainability concern, or theoretical issue
- **Include good patterns.** Each section notes what was verified correct — saves time in future audits.
- **Be specific.** File paths, line numbers, and code snippets for every finding.

ARGUMENTS: Optional scope — `full` (default), `frontend`, `backend`, or a specific category name.

---
name: verify
description: Verify implementation against PRD requirements and quality gates
user-invocable: true
context: fork
allowed-tools: Read, Glob, Grep, Bash
argument-hint: "<prd-or-feature>"
---

# Verification

Check that an implementation meets its PRD requirements and project quality gates. Runs in an isolated fork to prevent bias from implementation context.

## Process

1. **Locate the PRD:**
   - If a path is given, read it directly
   - If a feature name is given, search `docs/prds/` for a matching PRD
   - If no PRD exists, verify against the feature description provided

2. **Read project standards:**
   - `CLAUDE.md` — code conventions, anti-patterns
   - `docs/design-system.md` — visual and UX requirements
   - `docs/architecture.md` — architectural patterns

3. **Run automated checks:**

   ```bash
   pnpm typecheck
   ```

   Report any TypeScript errors.

4. **Scan for anti-patterns** across all changed or relevant files:

   | Anti-pattern | How to detect |
   |-------------|---------------|
   | Hardcoded colors | Grep for `#[0-9a-fA-F]{3,8}`, `rgb(`, `hsl(` in `.tsx` files |
   | `any` types | Grep for `: any` in `.ts`/`.tsx` files |
   | Missing transitions | Check interactive elements lack `transition-` classes |
   | Chromatic accent colors | Grep for `text-blue`, `bg-indigo`, etc. in `.tsx` files |
   | Custom components replacing shadcn/ui | Manual inspection |
   | Direct editor mutation | Grep for `.state.doc =` or `.state.selection =` |
   | Relative imports | Grep for `from '\.\./` in `src/` |

5. **Check PRD requirements** one by one:
   - For each quality gate in the PRD, verify it's met
   - For each user story, confirm the workflow is implemented
   - For each UI/UX requirement, check the relevant component

6. **Output a verification report:**

   ```markdown
   # Verification Report: <feature>

   **PRD:** docs/prds/YYYY-MM-DD-slug.md
   **Date:** YYYY-MM-DD

   ## Automated Checks
   - [ ] TypeScript: PASS / FAIL (N errors)

   ## Anti-Pattern Scan
   - [ ] No hardcoded colors: PASS / FAIL
   - [ ] No `any` types: PASS / FAIL
   - [ ] Transitions on interactive elements: PASS / FAIL
   - [ ] No chromatic accents: PASS / FAIL
   - [ ] No relative imports: PASS / FAIL

   ## PRD Requirements
   - [ ] Requirement 1: PASS / FAIL — notes
   - [ ] Requirement 2: PASS / FAIL — notes
   ...

   ## Summary
   X/Y checks passed. [PASS | NEEDS WORK]
   ```

7. **Be honest and thorough.** The value of verification comes from catching real issues, not rubber-stamping. Flag anything questionable.

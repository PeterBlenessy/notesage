---
name: audit-test-coverage
description: Audit test coverage — inventory tests by type, find critical untested paths
user-invocable: true
---

# Audit: Test Coverage

Audit what is and isn't tested, and identify gaps in test coverage. This is a research-only audit — do not modify any code.

## What to Search For

### Test Inventory

Find all test files and categorize them:

- **Unit tests:** Isolated function or component tests (`.test.ts`, `.test.tsx`, `.spec.ts`)
- **Integration tests:** Tests that exercise multiple modules together or test Tauri commands
- **End-to-end tests:** Full app flow tests (Playwright, Cypress, Tauri test harness)
- **Round-trip tests:** Markdown parse/serialize fidelity tests
- **Rust tests:** `#[cfg(test)]` modules, `#[test]` functions in `src-tauri/`
- **Snapshot tests:** Jest/Vitest snapshot assertions

For each category, count the number of test files and test cases. Report which categories exist and which are entirely missing.

### Critical Paths Without Tests

Check if these core flows have any test coverage:

| Flow | Where to look |
| --- | --- |
| Markdown round-trip (parse → serialize → compare) | `tests/`, `src/lib/markdown.ts` |
| File save/load cycle | `src/hooks/useFileOperations.ts` |
| AI streaming (all providers) | `src/hooks/useAIOperations.ts` |
| Agent lifecycle (spawn → auth → prompt → cleanup) | `src/hooks/useAcpLifecycle.ts` |
| Store persistence and rehydration | All stores with `persist` middleware |
| Editor state cache (tab switch preserve/restore) | `src/components/editor/Editor.tsx` |
| Tauri command error handling | `src-tauri/src/commands/` |
| Comment delegation flow | `src/hooks/useCommentDelegation.ts` |
| Inline completion (ghost text) | `src/hooks/useCopilotCompletion.ts` |
| PDF export pipeline | `src-tauri/src/export/` |

### Test Quality

For existing tests, check:
- **Vacuous tests:** Tests that always pass (no meaningful assertions, or assert on mocks returning what was set up)
- **Missing edge cases:** Tests that only cover the happy path
- **Flaky patterns:** Tests with timing dependencies (`setTimeout`, `waitFor` with short timeouts)
- **Test isolation:** Tests that depend on execution order or shared mutable state

### Rust Test Coverage

Check `#[cfg(test)]` modules in `src-tauri/src/`:
- Which commands/modules have tests?
- Which have none?
- Are tests testing actual logic or just compilation?

### Missing Test Types

Flag entirely missing test categories:
- No E2E tests? → HIGH (no automated verification of user flows)
- No integration tests? → MEDIUM (modules tested in isolation only)
- No Rust tests for commands? → MEDIUM (Tauri commands untested)

## Output Format

Start with an overview table:

```markdown
### Test Inventory

| Type | Files | Tests | Coverage |
| --- | --- | --- | --- |
| Unit (TypeScript) | N | M | src/lib/, src/hooks/ |
| Round-trip | N | M | Markdown parse/serialize |
| Rust unit | N | M | src-tauri/src/ |
| Integration | 0 | 0 | None |
| End-to-end | 0 | 0 | None |
```

Then list critical untested paths:

```markdown
### HIGH: No end-to-end tests

The app has no E2E test suite. User-facing flows (open folder → edit file → save → verify) are only tested manually.

**Recommendation:** Add Playwright or Tauri's built-in WebDriver test support for critical flows.
```

## Example Finding

### MEDIUM: AI streaming paths have no test coverage

**Files:** `src/hooks/useAIOperations.ts`, `src-tauri/src/commands/ai.rs`

The AI streaming flow (SSE parsing, thinking detection, citation extraction, tool call handling) is entirely untested. Regressions in stream parsing would only be caught by manual testing.

**Recommendation:** Add unit tests for SSE chunk parsing and thinking tag extraction. Mock the HTTP layer, test the parsing logic.

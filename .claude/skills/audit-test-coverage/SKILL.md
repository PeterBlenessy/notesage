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

For each category, count test files and cases by actually running/globbing — do not
copy counts from any doc (docs drift; see the documentation audit). Suggested measured
commands:
- Unit files: `rg -l "it\(|test\(" src --glob '*.test.ts*' | wc -l`
- Unit cases: `rg -c "\bit\(|\btest\(" src --glob '*.test.ts*' | awk -F: '{s+=$2} END{print s}'`
- Playwright specs: `ls e2e/tests/**/*.spec.ts | wc -l`
- Real-E2E specs: `ls e2e-real/tests/**/*.ts | wc -l`
- Rust test files: `rg -l "#\[(tokio::)?test\]" src-tauri/src | wc -l`
Report which categories exist and which are entirely missing, with the measured numbers
and the date measured.

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

### Prioritize Untested Security-Boundary and Data-Loss Code

Rank untested code by blast radius, not by tier. The highest-value gaps are
(a) security boundaries and (b) silent-data-loss branches. Before reporting "well
covered," verify each boundary below has a *dedicated* test, then look for the
boundaries and async orchestrators that slip through because they live in hooks, not
in obviously-security-named files.

Security-boundary modules that MUST have dedicated tests (confirm each, name the test file):
- Sandbox writable/read scope — `src/lib/ai/acp-utils.ts` (`getChatSandboxScope`),
  `src-tauri/src/commands/sandbox.rs`
- Tool-call path gate — `src/lib/ai/path-filter.ts` / `src/lib/tool-executor.ts`
  (`isToolCallAllowed`, `FILESYSTEM_TOOLS`)
- URI scope gate — `src/lib/ai/uri-scope.ts` (`isUriInScope`)
- Tauri capability surface — `src/lib/__tests__/tauri-capability-surface.test.ts`
- Network domain allowlist — `src-tauri/src/commands/network_proxy.rs`
- Store migrations — every `persist` store, especially `permission-store`,
  `chat-store`, `editor-store`, `settings-store`

A boundary being "tested" is not enough — judge whether the tests are *adversarial*.
For a domain allowlist or path filter, a happy-path "allowed domain is allowed" test
does NOT protect the boundary. Demand lookalike / suffix-confusion / wildcard-abuse
cases (e.g. `evil-api.anthropic.com.attacker.com` must NOT match `api.anthropic.com`;
a sibling project path must NOT pass `isToolCallAllowed` for the selected project).
A security proxy with only a handful of happy-path tests is a MEDIUM-or-higher gap
(e.g. a network proxy with 7 happy-path tests and no lookalike/suffix cases, or a
capability-surface test that locks `assetProtocol` and the absence of `fs:allow-*` but
never asserts the `http:default` allowlist is narrow — so a widening to `https://**`
would slip through).

### Untested Async Orchestrators and Data-Loss Branches (hooks)

Async orchestrator hooks coordinate event-bus routing, job state machines, and
destructive filesystem moves — they are high-risk and easy to miss because they are
not in `commands/` or named "security". For each orchestrator hook, check for a
`__tests__/*.test.ts` sibling and, if absent, rank by whether a regression is silent.

Look specifically for:
- Background job orchestrators with event routing by an id field. A `jobId` mismatch
  or partial-progress crash ships silently if untested (e.g. a capture-stop →
  transcribe → render → bundle → move pipeline with no test — assert state
  transitions, jobId-scoped progress routing, and that a failed transcribe leaves the
  bundle re-runnable in the inbox).
- Branch points that choose between a destructive path and a safe path based on a
  setting. The destructive branch (e.g. silent auto-reload that discards in-memory
  edits on a dirty tab) is a HIGH data-loss gap when untested — test BOTH setting
  states against BOTH clean and dirty inputs (e.g. an external-change handler that
  routes on a `externalChangeDiffReview` setting between silent auto-reload and an
  Accept/Reject/Dismiss inline-diff path; assert the reload toast vs the
  external-change-store `addChange` + change toast per branch).

### Tests That Protect a Parallel Implementation (config drift)

A test that *reconstructs* production configuration instead of *importing* it protects
a copy, not the real thing — it can pass while production silently breaks. Flag any
test that hand-assembles a list the production code also assembles (extension sets,
provider lists, tool registries, schema node lists).

- Round-trip / editor tests must import the SAME extension array the production editor
  builds. If the test hand-assembles `StarterKit + Table + Callout + …`, a node added
  to production (Mermaid, page-break variants) is never round-tripped until someone
  also edits the test's import list — so the "#1 spec gate" passes on a stale parallel
  editor. Fix is single-sourcing: export the production array and import it in both.

### Test Quality

For existing tests, check:
- **Vacuous tests:** Tests that always pass (no meaningful assertions, or assert on mocks returning what was set up)
- **Over-mocked / assert-nothing tests:** A test that mocks the unit under test, or
  mocks every collaborator and then asserts only that a mock was called with the
  arguments the test itself passed, verifies nothing. Treat "asserts only on mock
  call args, never on a real transformation or state transition" as effectively
  vacuous. For the orchestrator hooks above, mock the IPC boundary (`transcribe_file`,
  the event bus) but assert on the resulting STORE STATE / TOAST, not on the mock.
- **Store-migration coverage:** For every `persist` store with a `version` bump or a
  shape change, there must be a test that feeds OLD persisted state and asserts the
  migration produces the new shape (e.g. permission-store flat→ScopedApproval triples,
  chat-store startMessageIndex→startMessageId). A migration with no old-state fixture
  is an untested upgrade path — rank MEDIUM, HIGH if the store holds security state
  (permission-store).
- **Config-reconstruction tests:** see "Tests That Protect a Parallel Implementation"
  — a test that rebuilds production config instead of importing it is a silent-drift
  hazard even if every assertion is meaningful.
- **Missing edge cases:** Tests that only cover the happy path
- **Flaky patterns:** Tests with timing dependencies (`setTimeout`, `waitFor` with short timeouts)
- **Test isolation:** Tests that depend on execution order or shared mutable state

### Rust Test Coverage

Check `#[cfg(test)]` modules in `src-tauri/src/`:
- Which commands/modules have tests?
- Which have none?
- Are tests testing actual logic or just compilation?

### Missing Test Types vs. Missing Coverage Within a Category

First confirm whether a category is *truly absent* or merely *incomplete* — a large
suite (hundreds of files, thousands of cases) usually has every category present, so
the real risk is a specific high-value module with zero tests, not a missing tier.

- A whole tier genuinely absent (no E2E at all, no Rust command tests at all) → HIGH.
- A tier present but a named critical module inside it untested → rank by what the
  module does, not by the tier (see "Prioritize Untested Security-Boundary and
  Data-Loss Code" above). An untested data-loss branch is HIGH even when the unit
  tier is otherwise dense.

Do NOT report "no E2E tests" / "no integration tests" without running the suite and
counting first — the inventory step must precede the verdict.

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

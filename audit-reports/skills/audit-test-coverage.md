# Proposal — improvements to `audit-test-coverage`

Source of evidence: `audit-reports/06-tests-docs.md` (Part A). Every change below is traceable to a finding. Frontmatter and section structure of the SKILL.md are preserved; only the content noted here changes.

---

## 1. Stale / incorrect guidance to fix

### 1a. "Missing Test Types" over-indexes on *entire categories* being absent

The audit found the suite is large and broad (298 unit files, ~5016 cases, 18 Playwright specs, 11 real-E2E specs, 44 Rust test files) — every category the skill warns about as "entirely missing" actually exists. The current guidance steers an auditor toward a conclusion ("No E2E tests? → HIGH") that is already false here, and away from the real risk (specific high-value modules untested, A1/A2).

**Current text (lines 59–64):**
```
### Missing Test Types

Flag entirely missing test categories:
- No E2E tests? → HIGH (no automated verification of user flows)
- No integration tests? → MEDIUM (modules tested in isolation only)
- No Rust tests for commands? → MEDIUM (Tauri commands untested)
```

**Replacement:**
```
### Missing Test Types vs. Missing Coverage Within a Category

First confirm whether a category is *truly absent* or merely *incomplete* — a large
suite (hundreds of files, thousands of cases) usually has every category present, so
the real risk is a specific high-value module with zero tests, not a missing tier.

- A whole tier genuinely absent (no E2E at all, no Rust command tests at all) → HIGH.
- A tier present but a named critical module inside it untested → rank by what the
  module does, not by the tier (see "Prioritize untested security-boundary and
  data-loss code" below). An untested data-loss branch is HIGH even when the unit
  tier is otherwise dense.

Do NOT report "no E2E tests" / "no integration tests" without running the suite and
counting first — the inventory step must precede the verdict.
```

### 1b. Inventory step does not require *measuring* counts

The doc's own stale inventory (B5: "99 unit files … ~2160 cases") was wrong by ~3x because nobody re-ran the counts. The skill should force measured counts, not estimates.

**Current text (line 24):**
```
For each category, count the number of test files and test cases. Report which categories exist and which are entirely missing.
```

**Replacement:**
```
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
```

---

## 2. New checks to add

Add a new subsection after "Critical Paths Without Tests" (before "Test Quality").

```markdown
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
A security proxy with only a handful of happy-path tests is a MEDIUM-or-higher gap.
[A4 — network_proxy.rs has 7 happy-path tests, no lookalike/suffix cases:
src-tauri/src/commands/network_proxy.rs]
[A5 — capability-surface test locks assetProtocol + absence of fs:allow-* but does NOT
assert the http:default allowlist is narrow, so a widening to `https://**` would pass:
src/lib/__tests__/tauri-capability-surface.test.ts]

### Untested Async Orchestrators and Data-Loss Branches (hooks)

Async orchestrator hooks coordinate event-bus routing, job state machines, and
destructive filesystem moves — they are high-risk and easy to miss because they are
not in `commands/` or named "security". For each orchestrator hook, check for a
`__tests__/*.test.ts` sibling and, if absent, rank by whether a regression is silent.

Look specifically for:
- Background job orchestrators with event routing by an id field. A `jobId` mismatch
  or partial-progress crash ships silently if untested.
  [A1 — useTranscriptionJob.ts (capture-stop → transcribe → render → bundle → move) has
  no test; assert state transitions, jobId-scoped progress routing, and that a failed
  transcribe leaves the bundle re-runnable in the inbox: src/hooks/useTranscriptionJob.ts]
- Branch points that choose between a destructive path and a safe path based on a
  setting. The destructive branch (e.g. silent auto-reload that discards in-memory edits
  on a dirty tab) is a HIGH data-loss gap when untested — test BOTH setting states
  against BOTH clean and dirty inputs.
  [A2 — useFileWatcherIntegration.ts routes on settings.externalChangeDiffReview between
  silent auto-reload (data loss for dirty tabs) and the Accept/Reject/Dismiss inline-diff
  path; untested. Assert toastExternalReload vs external-change-store.addChange +
  toastExternalChange per branch: src/hooks/useFileWatcherIntegration.ts]

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
  [A3 — markdown-roundtrip.test.ts hand-assembles its own extension set rather than
  importing useEditor.ts's production list: src/lib/__tests__/markdown-roundtrip.test.ts
  ~lines 19–44]
```

---

## 3. Modern-judgment additions (Test Quality section)

Augment the existing "Test Quality" bullets (lines 44–49). The current "Vacuous tests"
bullet is too narrow — it only mentions "assert on mocks returning what was set up".
Broaden it and add over-mocking and store-migration detection, both directly motivated
by the audit's emphasis on store migrations (intro of Part A) and the parallel-config
finding (A3).

**Add these bullets under "Test Quality":**
```
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
```

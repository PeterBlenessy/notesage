# PRD: Test Coverage Expansion — Stores, Hooks, Thresholds, and Markdown Hardening

|  |  |
| --- | --- |
| **Date** | 2026-03-27 |
| **Status** | Draft |
| **Priority** | High |
| **Impact** | Raises frontend line coverage from 42% to 65%+, prevents regression on all future changes, hardens the most bug-prone code paths |
| **Depends on** | [test-infrastructure](2026-03-26-test-infrastructure.md) (complete) |

## Problem

The test infrastructure is in place (322 Vitest tests, 28 Playwright E2E, CI pipeline), but coverage is shallow. Only 57 of 271 frontend source files are touched by tests. The biggest gaps are:

- **Stores** (26% line coverage) — hold all business logic for chat, editor tabs, routing, permissions, workspace. Bugs here cascade everywhere.
- **Hooks** (2 of 45 tested) — complex stateful logic with branching, error handling, and Tauri IPC orchestration. Most hooks have zero tests.
- **Coverage regression** — no mechanism to prevent new code from shipping untested. Coverage can silently drop.
- **Markdown conversion** (27% coverage) — a quality gate with only happy-path round-trip tests. Edge cases and complex nesting untested.

### Current state (2026-03-27)

| Layer | Files tested / total | Line coverage | Biggest gaps |
| --- | --- | --- | --- |
| Components | 26 / 125 | 42.4% | Tested via rendering smoke tests; interaction coverage thin |
| Hooks | 2 / 45 | 72.0% | Only useFileOperations + useAIOperations tested |
| Stores | 11 / 27 | 26.0% | chat-store 7%, editor-store 31%, routing-store 11% |
| Lib utilities | 14 / 42 | 44.2% | tauri.ts 11%, markdown.ts 27%, external-diff.ts 29% |
| **Frontend total** | **57 / 271** | **42.4%** |  |

### Top 20 files by uncovered lines

| File | Line% | Uncovered lines |
| --- | --- | --- |
| chat-store.ts | 7% | 132 |
| FileTreeItem.tsx | 36% | 127 |
| CommandPalette.tsx | 40% | 120 |
| tauri.ts | 11% | 93 |
| markdown.ts | 27% | 87 |
| SettingsDialog.tsx | 25% | 85 |
| editor-store.ts | 31% | 60 |
| external-diff.ts | 29% | 59 |
| ChatPanel.tsx | 51% | 55 |
| useFileOperations.ts | 66% | 54 |
| activity-store.ts | 14% | 54 |
| settings-store.ts | 9% | 43 |
| tauri-storage.ts | 42% | 41 |
| routing-store.ts | 11% | 40 |
| workspace-store.ts | 33% | 39 |
| skill-store.ts | 54% | 33 |
| permission-store.ts | 52% | 32 |
| StatusBar.tsx | 53% | 30 |
| pm-line-map.ts | 57% | 29 |
| project-metadata-store.ts | 3% | 28 |

## Goals

1. **Store coverage to 70%+** — all Zustand stores with business logic have unit tests covering state transitions, computed values, and edge cases
2. **Critical hooks tested** — 8 most complex hooks have tests covering happy path, error paths, and key branching logic
3. **Coverage regression gate** — CI blocks PRs where changed files drop below a coverage floor
4. **Markdown edge cases covered** — round-trip tests expanded to cover nested structures, complex tables, mixed formatting, and frontmatter edge cases
5. **Frontend line coverage to 65%+** — up from 42.4%

## Non-Goals

- 80%+ overall coverage — diminishing returns; focus on high-risk code
- Testing shadcn/ui components — auto-generated, well-tested upstream
- Testing editor extensions (ProseMirror plugins) — requires real editor instance; defer to E2E
- Rust backend coverage tooling — separate initiative
- Visual regression testing — separate initiative

## Technical Approach

### Phase A: Store Unit Tests

Pure logic, no DOM — highest ROI. Each store test file exercises state transitions, computed values, and persistence behavior.

**Target stores** (ordered by uncovered lines):

| Store | Current line% | Key behaviors to test |
| --- | --- | --- |
| `chat-store.ts` | 7% | Conversation CRUD, message add/update/delete, segment management, project path switching, conversation export |
| `editor-store.ts` | 31% | Tab open/close/switch, dirty tracking, external change handling, persisted tab sync, recent files |
| `routing-store.ts` | 11% | Route assignment, auto-assignment on first connection, capability matching, route clearing |
| `activity-store.ts` | 14% | Task lifecycle (create, update status, complete, error), activity log entries, rehydration cleanup |
| `settings-store.ts` | 9% | Theme toggle, soft contrast, startup ready flag, external change diff review toggle, persistence |
| `workspace-store.ts` | 33% | Project/folder add/remove, file tree update, recent projects, project expansion state |
| `permission-store.ts` | 52% | Permission granting (once/session/always), domain allowlists, session vs persisted permissions |
| `project-metadata-store.ts` | 3% | Metadata CRUD, AI override resolution, goal discovery |

**Test approach:**

- Import the real store (not mocked)
- Use `store.setState()` to set up initial state
- Call store actions
- Assert on `store.getState()` results
- Test persistence via the existing `simulateRestart` pattern from persistence-roundtrip tests
- Mock only Tauri IPC (via existing `tauri-mock.ts`)

**File location:** `src/stores/__tests__/<store-name>.test.ts`

### Phase B: Critical Hook Tests

Hooks orchestrate Tauri IPC, store mutations, and side effects. Test with `renderHook()` from RTL.

**Target hooks** (ordered by complexity and risk):

| Hook | Why critical | Key behaviors to test |
| --- | --- | --- |
| `useFileWatcher.ts` | External change detection — bugs cause data loss or stale content | Event handling (create/modify/delete), self-write suppression, dirty tab reload prompt, clean tab auto-reload |
| `useCommentDelegation.ts` | AI agent delegation — complex state machine | Delegation lifecycle (create → delegated → done), agent reply handling, multi-turn threads, apply-to-document flow |
| `useSkillOperations.ts` | Skill/agent discovery — startup critical path | Skill scanning, agent scanning, persona migration, bundled content extraction |
| `useAgentTaskOperations.ts` | Background agent tasks — concurrent state | Task creation, streaming updates, completion, error handling, task persistence |
| `useRecording.ts` | Audio recording — hardware interaction | Start/stop lifecycle, buffer management, error states (no microphone) |
| `useCopilotCompletion.ts` | LSP lifecycle — protocol state machine | Start/stop, auth flow, document sync, completion request/response, error backoff |
| `useLocalCompletion.ts` | Inline completions — multi-provider | Debouncing, FIM vs chat fallback, error backoff, connection/model change reset |
| `useEditorResize.ts` | Editor layout — subtle visual bugs | Resize observer setup/cleanup, width calculation, debouncing |

**Mocking strategy:**

- Tauri IPC: existing `tauri-mock.ts` with `setMockInvokeHandler`
- Tauri events: existing `emitMockEvent` for simulating file-changed, acp-session-update, etc.
- Tiptap editor: existing `mock-editor.ts` for hooks that need editor instance
- Timers: `vi.useFakeTimers()` for debounce/timeout testing

**File location:** `src/hooks/__tests__/<hook-name>.test.ts`

### Phase C: Coverage Regression Gate

Prevent coverage from dropping on changed files.

**Implementation:**

1. Add `perFile` coverage thresholds to `vitest.config.ts`:

```typescript
coverage: {
  provider: 'istanbul',
  reporter: ['text', 'json-summary', 'html'],
  reportsDirectory: './coverage',
  thresholds: {
    perFile: true,
    lines: 0,      // No global minimum yet
    branches: 0,
    functions: 0,
    statements: 0,
  },
},
```

2. Add a CI step that compares coverage on changed files against the base branch using `vitest-coverage-report-action` or a custom script:

   - Extract changed files from the PR diff
   - Check that no changed file's coverage decreased vs main
   - Post a coverage summary as a PR comment

3. Create a baseline coverage snapshot (JSON) that CI can compare against:

   - Generated by `pnpm test:coverage` on main
   - Stored as a CI artifact or committed as `coverage-baseline.json`

**Enforcement level:** Warning-only initially (PR comment), blocking after 2 weeks of green runs.

### Phase D: Markdown Round-Trip Hardening

Expand the markdown test fixtures and round-trip tests to cover edge cases that have caused bugs.

**New test fixtures** (`tests/fixtures/`):

| Fixture | What it covers |
| --- | --- |
| `nested-lists.md` | 3+ levels of nested bullets, ordered lists inside bullets, task lists inside ordered lists |
| `complex-tables.md` | Tables with inline formatting (bold, code, links), tables with empty cells, single-column tables, tables preceded by/followed by other blocks |
| `mixed-formatting.md` | Bold inside italic, code inside links, strikethrough with links, nested inline formatting |
| `frontmatter-edge-cases.md` | YAML with colons in values, multi-line strings, arrays, boolean values, empty frontmatter, frontmatter with special characters |
| `whitespace-edge-cases.md` | Trailing whitespace, multiple blank lines between blocks, indented code blocks vs fenced, tabs vs spaces |
| `unicode-content.md` | Emoji in headings, CJK characters in tables, RTL text in lists, accented characters in links |
| `large-document.md` | 500+ lines combining all block types — stress test for serializer state management |

**Additional unit tests for** `markdown.ts`**:**

- Parse → inspect intermediate ProseMirror doc → verify node types
- Serialize specific ProseMirror node shapes → verify markdown output
- Test the custom `serializeTable` function with edge case inputs
- Test `parseMarkdownToDoc` with malformed/unusual markdown

**File location:** `src/lib/__tests__/markdown-edge-cases.test.ts`, `tests/fixtures/*.md`

## Dependencies

| Dependency | Purpose | Status |
| --- | --- | --- |
| `@vitest/coverage-istanbul` | Coverage instrumentation | Installed |
| `@testing-library/react` | Hook testing via `renderHook` | Installed |
| `vitest-coverage-report-action` (optional) | PR coverage comments | Evaluate during Phase C |

## Quality Gates

### Store tests (Phase A)

- [ ] 8 store test files exist in `src/stores/__tests__/`

- [ ] Each store covers: initial state, all state-mutating actions, edge cases (empty/null inputs)

- [ ] `chat-store` line coverage ≥ 70%

- [ ] `editor-store` line coverage ≥ 70%

- [ ] `routing-store` line coverage ≥ 70%

- [ ] Combined store line coverage ≥ 70% (up from 26%)

- [ ] All tests pass in `pnpm test`

### Hook tests (Phase B)

- [ ] 8 hook test files exist in `src/hooks/__tests__/`

- [ ] Each hook covers: happy path, error path, key branching logic

- [ ] `useFileWatcher` tests verify create/modify/delete event handling

- [ ] `useCommentDelegation` tests verify delegation lifecycle

- [ ] `useSkillOperations` tests verify discovery flow

- [ ] Combined hook coverage ≥ 60%

- [ ] All tests pass in `pnpm test`

### Coverage regression gate (Phase C)

- [ ] `vitest.config.ts` has `perFile` threshold configuration

- [ ] CI posts coverage summary on PRs

- [ ] Changed files with decreased coverage flagged in PR

- [ ] Blocking enforcement enabled after 2-week warning period

### Markdown hardening (Phase D)

- [ ] 7 new test fixture files in `tests/fixtures/`

- [ ] All fixtures pass round-trip test (parse → serialize → compare)

- [ ] `markdown.ts` line coverage ≥ 60% (up from 27%)

- [ ] Edge case unit tests for `serializeTable`, `parseMarkdownToDoc`

- [ ] No regression in existing round-trip tests

### Overall

- [ ] Frontend line coverage ≥ 65% (up from 42.4%)

- [ ] All CI checks pass

- [ ] No existing tests broken

## Out of Scope

- Testing editor extensions (ProseMirror plugins) — needs real editor instance or ProseMirror test utilities
- Testing components beyond existing smoke tests — current rendering tests are sufficient for now
- Rust backend coverage — separate tooling (cargo-tarpaulin / cargo-llvm-cov)
- True E2E with real Tauri runtime — separate PRD under discussion
- Visual regression / screenshot testing
- Performance benchmarks
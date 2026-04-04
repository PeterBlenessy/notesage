# Audit v3 Fixes

|  |  |
| --- | --- |
| **Date** | 2026-04-04 |
| **Status** | In Progress |
| **Audit** | [2026-04-04-full](../audit/2026-04-04-full.md) |
| **Tasks** | [2026-04-04-audit-v3-tasks](../tasks/2026-04-04-audit-v3-tasks.md) |
| **Version** | 0.28.3 |

## Problem

The third full codebase audit (2026-04-04) found 9 HIGH, 27 MEDIUM, and 12 LOW issues across the Notesage codebase. While the Rust backend, security posture, and dead code are all clean, there are actionable findings in:

- **Async correctness:** Listener registration races, unbounded recursion in agent spawn, stale closures
- **Render performance:** Broad store subscriptions and inline callbacks in always-visible sidebar components
- **Type safety:** 26 `as any` casts (Tiptap storage, Web Speech API), stringly-typed Rust APIs
- **Error UX:** Silent save failures, no retry for direct API chat, empty command palette on index errors
- **Test coverage:** ACP lifecycle, file watcher, git/sync, and sandbox commands have zero tests
- **Large files:** 6 Rust command modules over 1,000 lines with mixed concerns
- **Minor polish:** Accessibility contrast, focus indicators, documentation gaps

## Approach: Test-First for Bug Fixes, Test-After for Refactors

To reduce the risk of incomplete fixes and missed regressions:

- **Tier 2 (bug fixes):** Write a failing test that reproduces the issue FIRST, then implement the fix. This proves the fix addresses the actual bug, not just that the code compiles.
- **Tier 3 (refactors):** Existing tests must keep passing. No new tests needed for mechanical extractions — the compiler and existing suite catch regressions.
- **Tier 4 (coverage gaps):** Add tests for critical untested paths independent of any fix — these are net-new coverage, not TDD.

## Scope

### In scope

- All 9 HIGH findings
- All 27 MEDIUM findings (prioritized by impact)
- Selected LOW findings (accessibility, error guidance)

### Out of scope

- Backend and security (0 findings — nothing to fix)
- Dead code (0 findings — already clean)
- Performance benchmark infrastructure (covered by existing perf tests)
- Large file decomposition of export converters (acceptable — specialized single-responsibility)

## Tier Breakdown

### Tier 1: Quick Wins (no tests needed)

Mechanical fixes that are self-evidently correct. Aria-labels, docs updates, CSS tweaks.

| # | Finding | Category | Complexity |
| --- | --- | --- | --- |
| 1 | Add mounted guard to useMcpOperations listener callback | Memory Leaks | S |
| 2 | Add mounted guard to useActionScanner listener | Memory Leaks | S |
| 3 | Fix web_search file location in tauri-commands.md | Documentation | S |
| 4 | Add `focus-visible` styling to ChatMessage plain buttons | Accessibility | S |
| 5 | Improve disabled button contrast (opacity-50 → explicit colors) | Accessibility | S |
| 6 | Add aria-live to StatusBar index progress | Accessibility | S |
| 7 | Add guidance text to Activity panel empty state | Error UX | S |
| 8 | Add "Ollama not running" actionable message | Error UX | S |

### Tier 2: Test-First Bug Fixes

Write a failing test FIRST, then implement the fix.

| # | Finding | Category | Complexity | Test Strategy |
| --- | --- | --- | --- | --- |
| 9 | useDirectApiChat: ai-stream-done listener registration race | Memory Leaks | M | Test: register listeners, emit done before all attached, assert cleanup |
| 10 | useAcpLifecycle: cancel escalation listener leak | Memory Leaks | M | Test: rapid cancel, assert no dangling listeners |
| 11 | ACP agent ensureAcpAgent unbounded recursion | Async Flows | M | Test: concurrent calls with connection changes, assert depth limit |
| 12 | Task agent ensureTaskAgent unbounded recursion | Async Flows | M | Test: concurrent calls with project changes, assert depth limit |
| 13 | useSpeechRecognition: stale whisper listeners on rapid toggle | Async Flows | M | Test: start/stop/start rapidly, assert single active listener |
| 14 | useCommentDelegation: stale closure captures full comment | Async Flows | M | Test: edit comment during delegation, assert correct ID used |
| 15 | useDirectApiChat: missing abort signal on stream listeners | Async Flows | M | Test: cancel mid-stream, assert all listeners cleaned up |
| 16 | useFileOperations: save failure doesn't re-mark tab dirty | Error UX | M | Test: mock write_file to fail, assert tab stays dirty |
| 17 | Direct API chat: no retry UI on failure | Error UX | M | Test: mock stream error, assert retry option shown |
| 18 | CommandPalette: silent index query failure | Error UX | M | Test: mock index search to fail, assert error state shown |
| 19 | File watcher debounce map unbounded growth | Async Flows | S | Test: simulate 600 rapid file changes, assert map size bounded |

### Tier 3: Compiler-Driven Refactors (existing tests must pass)

Type safety and render performance fixes verified by compiler + existing tests + manual profiling.

| # | Finding | Category | Complexity | Verification |
| --- | --- | --- | --- | --- |
| 20 | Migrate Tiptap storage `as any` to `getEditorStorage<T>()` | Type Safety | S | Compiler — utility already exists |
| 21 | Define WebSpeechRecognition interface, remove `as any` | Type Safety | S | Compiler — local interface |
| 22 | Replace Rust stringly-typed APIs with enums | Type Safety | M | Compiler — serde rename_all + frontend type updates |
| 23 | Add return types to public hooks | Type Safety | S | Compiler — explicit annotations |
| 24 | FileTreeItem: memoize destinations array | Render Perf | S | Manual profile — fewer re-renders |
| 25 | FileTreeItem: extract context menu callbacks to useCallback | Render Perf | S | Manual profile |
| 26 | SidebarPanel: memoize conditional style objects | Render Perf | S | Manual profile |
| 27 | ExplorerFolderItem: memoize isProjectFolder computation | Render Perf | S | Manual profile |
| 28 | ProjectItem: selector factory for project lookup | Render Perf | S | Manual profile |
| 29 | ChatFooter: replace getState() in useMemo with selectors | Render Perf | S | Manual profile |
| 30 | FileTreeItem: lift expensive store subscriptions to parent | Render Perf | M | Manual profile + existing tests |

### Tier 4: Coverage Gap Tests (net-new, not TDD)

Add tests for critical untested paths. These aren't fixing bugs — they're adding safety nets.

| # | Finding | Category | Complexity |
| --- | --- | --- | --- |
| 31 | ACP agent lifecycle: spawn, auth, permission, cleanup | Test Coverage | L |
| 32 | File watcher: change detection, debouncing, self-write filter | Test Coverage | L |
| 33 | Git commands: status parsing, commit flow | Test Coverage | M |
| 34 | Sandbox: policy enforcement, domain matching | Test Coverage | M |
| 35 | MCP server lifecycle: init, tool discovery, cleanup | Test Coverage | M |
| 36 | AI streaming: abort, network error, concurrent streams | Test Coverage | M |

### Tier 5: Large File Decomposition (if time permits)

Lower priority — these files work correctly, they're just large.

| # | Finding | Category | Complexity |
| --- | --- | --- | --- |
| 37 | ai_streaming.rs (1603): extract tool_execution.rs, segment_builder.rs | Decomposition | L |
| 38 | model_management.rs (1582): extract per-provider modules | Decomposition | L |
| 39 | PptxViewer.tsx (1088): extract search, zoom, chart sub-components | Decomposition | M |
| 40 | chat-store.ts (906): extract conversation/segment operation utilities | Decomposition | M |

## Quality Gates

- [ ] All existing tests pass (`pnpm test`, `cargo test`)
- [ ] TypeScript type check passes (`pnpm typecheck`)
- [ ] No new `as any` casts introduced
- [ ] Tier 2 fixes each have a corresponding test that fails without the fix
- [ ] Tier 3 refactors don't change behavior (existing tests sufficient)
- [ ] Performance benchmarks still pass (`pnpm test:perf`)
- [ ] Manual verification: both light/dark themes, soft contrast mode

## Risks

- **Zustand selector refactoring (#30)** touches FileTreeItem which renders hundreds of times — high regression risk. Test manually with large file trees.
- **Rust enum migration (#22)** changes the IPC contract — frontend and backend must update atomically. Use `#[serde(rename_all = "lowercase")]` for backward-compatible serialization.
- **ACP lifecycle tests (#31)** require mocking subprocess spawn — may need test harness infrastructure.
- **Stream listener race fix (#9)** changes the order of `Promise.all` registration — verify no timing assumptions in existing code.

## Non-Goals

- No new features
- No UI redesign
- No dependency upgrades
- No export converter decomposition (acceptable at current size)
- No changes to Rust backend architecture (0 findings)

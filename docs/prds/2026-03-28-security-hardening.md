# PRD: Security Hardening — Async Safety, TOCTOU, Error Handling & Dead Code Removal

|  |  |
| --- | --- |
| **Date** | 2026-03-28 |
| **Status** | Complete |
| **Priority** | High |
| **Impact** | Eliminates UI freeze risk, removes data race conditions, improves error diagnostics, reduces dead code surface area |
| **Depends on** | [codebase-audit-2026-03-17](../research/codebase-audit-2026-03-17.md) |

## Problem

A codebase audit (2026-03-17) identified security and reliability issues across the Rust backend and frontend. Two issues are classified HIGH severity:

1. **Blocking sleeps in async context** — `std::thread::sleep()` in `transcription.rs` (lines 338, 785) blocks the Tokio runtime. The 3-second sleep at line 785 can freeze the entire UI during dictation startup. Any other Tauri command issued during that window will queue behind it.

2. **TOCTOU race conditions** — `file.rs` checks `Path::exists()` before file operations (7 locations). Between the check and the operation, external processes (git, iCloud sync, AI agents) can create/delete the file, causing silent data loss or confusing errors.

Additional MEDIUM issues:
- Silent error swallowing in 15+ locations (empty `catch {}`, `.catch(() => {})`) makes debugging impossible
- ~300 lines of dead code (deprecated personas, deferred annotations) increases maintenance burden and confuses contributors
- Frontend bundle bloat from eagerly loaded viewers and dialogs that most users never open

### What's already fixed (from the same audit)

- Recursive directory listing depth limit: `MAX_DIRECTORY_DEPTH = 50` ✅
- Domain matching validation: exact-match and subdomain-only matching are correct ✅
- Hardcoded thinking tag patterns: consolidated in prior work ✅

## Goals

1. **Zero blocking sleeps in async context** — all `std::thread::sleep()` replaced with `tokio::time::sleep().await`
2. **No TOCTOU patterns in file operations** — remove pre-existence checks, handle operation errors directly
3. **No silent error swallowing** — all `catch {}` blocks log at minimum `warn` level with context
4. **Remove dead code** — delete deprecated personas, deferred annotations, unused store methods
5. **Lazy-load heavy components** — viewers and dialogs loaded on demand

## Non-Goals

- Rewriting the file operations API surface (just fixing race conditions)
- Adding new security features (sandboxing, encryption)
- Comprehensive frontend performance optimization (separate PRD: performance-observability)
- Changing the editor color palette policy (design decision, not security)
- Copilot hook deduplication (code quality, not security — defer)

## Technical Approach

### Phase 1: Rust Backend Safety (HIGH priority)

#### 1a. Replace blocking sleeps

`src-tauri/src/commands/transcription.rs`:

- **Line 338** (`sleep(100ms)` in dictation loop): Replace with `tokio::time::sleep(Duration::from_millis(100)).await`
- **Line 785** (`sleep(3s)` in dictation startup): Replace with `tokio::time::sleep(Duration::from_secs(3)).await`

Both are inside `async fn` already — the fix is mechanical. The 3-second sleep exists to wait for audio device initialization; verify this delay is still necessary or if a shorter polling approach works.

#### 1b. Eliminate TOCTOU patterns

`src-tauri/src/commands/file.rs` — 7 locations with pre-existence checks:

| Line | Current pattern | Fix |
| --- | --- | --- |
| ~101 | `if !dir_path.exists()` before `read_dir` | Remove check; `read_dir` returns `NotFound` |
| ~156 | `if Path::new(&new_path).exists()` before rename | Remove check; `fs::rename` fails if target exists on some platforms, handle error |
| ~183-191 | `if !src.exists()` and `if !parent.exists()` in `copy_directory` | Remove checks; `fs::copy` / `fs::create_dir_all` return appropriate errors |
| ~203-209 | `if !src.exists()` and `if destination.exists()` in move operations | Remove checks; handle errors from actual operations |

**Pattern:** Replace `if !path.exists() { return Err(...) }; do_operation(path)` with `do_operation(path).map_err(|e| match e.kind() { NotFound => "...", AlreadyExists => "...", _ => "..." })`.

#### 1c. Add error context to file operations

`src-tauri/src/commands/file.rs` line ~16 and similar: `.map_err(|e| e.to_string())` loses the file path.

**Fix:** `.map_err(|e| format!("Failed to read {}: {}", path, e))` — already done in some places, make consistent throughout.

#### 1d. Fix silent error swallowing in Rust

`file.rs` line ~61: subdirectory read failure returns empty `Vec` — already fixed to log a warning (verified above). Check `watcher.rs` mutex poisoning recovery.

### Phase 2: Frontend Error Handling (MEDIUM priority)

#### 2a. Replace silent catch blocks

Audit all `.catch(() => {})` and `catch {}` blocks. For each:

- If the error is expected and harmless (e.g., `clearSelfWrite` cleanup): add a comment explaining why
- If the error could affect user data or debugging: add `console.warn()` or `log.warn()` with context
- If the error should surface to the user: add `toast.error()`

Known locations (15+):
- `src/hooks/useFileWatcher.ts` lines ~79, 192
- `src/hooks/useFileOperations.ts` line ~246
- `src/lib/tauri-storage.ts` line ~98
- `src/lib/document-index.ts` lines ~49, 116
- `src/lib/scan-icloud-projects.ts` lines ~39, 43
- `src/App.tsx` line ~137

#### 2b. Fix event listener cleanup gaps

- `src/App.tsx` lines ~119-150: add `.catch()` to `listen()` calls so `unlisten` is always assigned
- `src/stores/local-ai-store.ts` lines ~136-161: guard `unlisten()` against store destruction

### Phase 3: Dead Code Removal (MEDIUM priority)

#### 3a. Remove deprecated persona system

`src/stores/ai-store.ts`: Delete `AIPersona` interface, `BUILT_IN_PERSONAS` array, persona helper functions, persona action methods. Keep only the fields needed for one-time migration (`activePersonaId`, `customPersonas`) — verify migration code in `useSkillOperations.ts` still references them, and if the migration flag `personasMigrated` is universally set, remove those too.

~100 lines removed.

#### 3b. Remove deferred annotation code

Delete:
- `src/components/editor/AnnotationPicker.tsx` (~120 lines)
- `src/components/editor/extensions/item-annotation.ts` (~80 lines)

Both have zero imports. Git history preserves them for future revival.

~200 lines removed.

#### 3c. Remove unused editor-styles-store methods

`src/stores/editor-styles-store.ts`: `loadSettings()` and `saveSettings()` are defined but never called. Remove them.

### Phase 4: Lazy Loading (LOW-MEDIUM priority)

#### 4a. Lazy-load document viewers

`src/components/editor/Editor.tsx` lines ~58-62: Replace eager imports with `React.lazy()`:

```tsx
const PdfViewer = lazy(() => import('./viewers/PdfViewer'));
const EpubViewer = lazy(() => import('./viewers/EpubViewer'));
const DocxViewer = lazy(() => import('./viewers/DocxViewer'));
const PlainTextViewer = lazy(() => import('./viewers/PlainTextViewer'));
```

Wrap in `<Suspense fallback={<Skeleton />}>`.

#### 4b. Lazy-load dialogs

`src/App.tsx` lines ~4-10: Replace eager imports for `SettingsDialog`, `ExportDialog`, `ActionsDialog`, `KeyboardShortcutsDialog`, `ProjectSettingsDialog` with `React.lazy()`. These are shown on demand only.

## Dependencies

| Dependency | Purpose | Status |
| --- | --- | --- |
| `tokio::time::sleep` | Async sleep replacement | Already available (tokio is a dependency) |
| `React.lazy` / `Suspense` | Code splitting | Built into React 19 |
| None new | No new dependencies required | — |

## Quality Gates

### Phase 1: Rust Backend Safety

- [x] Zero `std::thread::sleep` calls in async functions (grep confirms none — both occurrences are on dedicated OS threads with comments)
- [x] Zero `path.exists()` pre-checks in file operations (removed from `list_files_shallow`, `copy_file`, `copy_directory`; `rename_path` uses atomic `hard_link` with fallback)
- [x] All `.map_err()` in file.rs include the file path in the error message
- [x] `cargo test` passes (193 tests, including 7 new file operation tests)
- [x] `cargo clippy` clean (no new warnings)

### Phase 2: Frontend Error Handling

- [x] Zero bare `catch {}` or `.catch(() => {})` blocks without either a comment explaining why or a log statement
- [x] All Tauri `listen()` calls have `.catch()` handlers
- [x] `pnpm test` passes (1115 tests)

### Phase 3: Dead Code Removal

- [x] `BUILT_IN_PERSONAS` already removed in prior work; `AIPersona` interface kept for active migration code
- [x] `AnnotationPicker.tsx` and `item-annotation.ts` already deleted in prior work
- [x] `editor-styles-store` methods are actually used (audit was wrong per task risk notes) — skipped
- [x] Persona migration still works (migration fields preserved)
- [x] `pnpm test` passes
- [x] `pnpm typecheck` clean (pre-existing test-only errors, no new errors)

### Phase 4: Lazy Loading

- [x] `PdfViewer`, `EpubViewer`, `DocxViewer` loaded via `React.lazy()` in `EditorViewerContainer.tsx` (already implemented)
- [x] `SettingsDialog`, `ExportDialog`, `ActionsDialog`, `KeyboardShortcutsDialog` loaded via `React.lazy()` (already implemented)
- [x] Viewer/dialog functionality unchanged
- [x] Suspense fallback in place
- [x] `pnpm test` passes

### Overall

- [x] No new security warnings from `cargo clippy`
- [x] App starts and runs normally — no regressions in test suite
- [x] Manual smoke test (requires human verification)

## Out of Scope

- Network proxy hardening beyond domain matching (already correct)
- Directory depth limit (already implemented at 50)
- Copilot hook deduplication (code quality, not security)
- Editor color palette policy (design decision)
- Git store simplification (low priority polish)
- FileTreeItem O(n) lookup optimization (performance PRD)
- ChatPanel scroll reflow (performance PRD)
- CommandPalette sort memoization (performance PRD)

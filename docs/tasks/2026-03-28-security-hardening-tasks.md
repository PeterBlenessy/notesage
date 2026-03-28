# Security Hardening Tasks

|  |  |
| --- | --- |
| **Date** | 2026-03-28 |
| **Status** | Complete |
| **PRD** | [security-hardening](../prds/2026-03-28-security-hardening.md) |
| **Total** | 12 tasks: 5S, 5M, 2L |
| **Suggested order** | Backend safety (#1-#4) → Frontend error handling (#5-#7) → Dead code (#8-#9) → Lazy loading (#10-#11) → Verification (#12) |

**Risks:**

- TOCTOU fixes in `file.rs` change error messages — frontend code may match on specific error strings. Grep for error text matches before changing.
- The `rename_path` pre-existence check for destination is intentional safety — `fs::rename` silently overwrites on Unix. The fix must preserve this safety without TOCTOU.
- `ai-store.ts` persona fields are still read by migration code in `useSkillOperations.ts`. Only remove `BUILT_IN_PERSONAS` (already gone) and dead helper functions, NOT the interface or migration fields.
- `AnnotationPicker.tsx` and `item-annotation.ts` are already deleted — skip that sub-task.
- `editor-styles-store` `loadSettings`/`saveSettings` are actually used (`useAppLifecycle.ts`, `TypographyPopover.tsx`) — the audit was wrong. Skip that sub-task.
- Watcher mutex poisoning is a non-issue — uses `parking_lot::Mutex` which doesn't poison.

---

## Phase 1: Rust Backend Safety

### #1 — Replace blocking sleeps in transcription.rs ✅

**Description:** Replace `std::thread::sleep()` with `tokio::time::sleep().await` at two locations in `transcription.rs`:

1. **Line 338** — `sleep(100ms)` in the recording level-emit loop. This runs on a dedicated thread (not an async task), so it's actually correct as-is — `cpal::Stream` is `!Send` and requires a real thread. Add a comment explaining why `std::thread::sleep` is used here intentionally.

2. **Line 785** — `sleep(3s)` in dictation loop. This is inside a `tokio::spawn` block where the audio chunking loop runs. Since dictation uses a separate thread for recording (same `!Send` constraint), verify whether this sleep runs on the recording thread or on a Tokio task. If it's on the Tokio runtime, replace with `tokio::time::sleep(Duration::from_secs(3)).await`. If it's on the dedicated thread, add a comment.

**Acceptance criteria:** `cargo clippy` clean, `cargo test` passes, no `std::thread::sleep` in async contexts (sleep on dedicated `!Send` threads is fine with a comment).

**Complexity:** M | **Category:** backend | **Dependencies:** None

**Files:** modified: `src-tauri/src/commands/transcription.rs`

---

### #2 — Eliminate TOCTOU in file.rs: list_files_shallow and rename_path ✅

**Description:** Fix 2 TOCTOU patterns:

1. `list_files_shallow` **(line \~101):** Remove `if !dir_path.exists()` pre-check. Let `fs::read_dir()` return the error naturally. Map the error kind to a user-friendly message.

2. `rename_path` **(line \~156):** Remove `if Path::new(&new_path).exists()` pre-check. **Important:** On Unix, `fs::rename` silently overwrites the destination. To preserve the "don't overwrite" safety, use `std::fs::hard_link` + `std::fs::remove_file` pattern, or check the error from rename and roll back. Simplest: keep the atomicity by attempting `fs::hard_link(&old_path, &new_path)` (fails if dest exists on most filesystems) then `fs::remove_file(&old_path)`, falling back to rename for cross-device moves.

**Acceptance criteria:** No `path.exists()` pre-checks in these functions. `rename_path` still rejects if destination exists. `cargo test` passes.

**Complexity:** M | **Category:** backend | **Dependencies:** None

**Files:** modified: `src-tauri/src/commands/file.rs`

---

### #3 — Eliminate TOCTOU in file.rs: copy_file and copy_directory ✅

**Description:** Fix 4 TOCTOU patterns:

1. `copy_file` **(lines \~183-191):** Remove `if !src.exists()` and `if !parent.exists()` pre-checks. Let `fs::copy()` and `fs::create_dir_all()` return natural errors. Always call `create_dir_all` (it's a no-op if dir exists).

2. `copy_directory` **(lines \~203-209):** Remove `if !src.exists()`, `if !src.is_dir()`, and `if destination.exists()` pre-checks. Let `copy_dir_recursive` return natural errors. For destination-exists check, `fs::create_dir_all(dst)` inside `copy_dir_recursive` doesn't fail if dir exists — need `fs::create_dir(dst)` (without `_all`) which fails on `AlreadyExists`.

**Acceptance criteria:** No `path.exists()` pre-checks in these functions. Error messages include file paths. `cargo test` passes.

**Complexity:** M | **Category:** backend | **Dependencies:** None

**Files:** modified: `src-tauri/src/commands/file.rs`

---

### #4 — Rust backend tests for file operations ✅

**Description:** Add or extend Rust `#[test]` functions in `file.rs` (or a new `tests/file_ops.rs`) to verify:

1. `create_file` returns error with path context for permission denied
2. `rename_path` rejects when destination exists
3. `copy_directory` rejects when destination already exists
4. `list_files_shallow` returns error for non-existent path
5. Error messages include the relevant file paths (not just raw IO error text)

**Acceptance criteria:** `cargo test` covers the TOCTOU-fix behaviors. At least 5 test cases.

**Complexity:** M | **Category:** backend | **Dependencies:** #2, #3

**Files:** modified or new: `src-tauri/src/commands/file.rs` or `src-tauri/tests/file_ops.rs`

---

## Phase 2: Frontend Error Handling

### #5 — Audit and fix silent catch blocks in lib/ ✅

**Description:** Review all bare `catch {}` and `.catch(() => {})` blocks in `src/lib/`. For each (15+ locations):

- **Expected/harmless errors:** Add a `// Expected: <reason>` comment
- **Diagnostic errors:** Add `log.warn('context', 'message', error)` or `console.warn()`
- **User-facing errors:** Add `toast.error()`

Known locations in `src/lib/`:

- `document-index.ts:49,116` — index operations
- `tauri-storage.ts:98` — storage read
- `refresh-notes-tree.ts:21` — tree refresh
- `drag-utils.ts:19` — drag operation
- `migrate-project-path.ts:31` — path migration
- `external-diff.ts:156` — diff computation
- `logger.ts:64` — log flush (`.catch(() => {})`)
- `pm-replace.ts:41,65` — ProseMirror replace
- `scan-icloud-projects.ts:39,43` — iCloud scan
- `frontmatter.ts:91` — YAML parse
- `markdown.ts:123` — markdown parse
- `ai/errors.ts:156,160` — AI error parsing
- `ai/path-filter.ts:65,190` — path filtering
- `ai/acp-agent-state.ts:37,58` — agent cleanup
- `copilot-shared.ts:69,87` — LSP cleanup

**Acceptance criteria:** Zero bare catch blocks without either a comment or a log call. `pnpm test` passes.

**Complexity:** L | **Category:** frontend | **Dependencies:** None

**Files:** modified: \~15 files in `src/lib/`

---

### #6 — Audit and fix silent catch blocks in hooks/ ✅

**Description:** Review catch blocks in `src/hooks/`:

- `useFileOperations.ts:79,83,152,246` — file ops error handling
- `useSkillOperations.ts:108,116` — skill discovery
- `useAIContext.ts:39` — agent body fetch
- `useChangelog.ts:55` — changelog read

Same triage as #5: add comments for expected errors, add logging for diagnostic errors.

**Acceptance criteria:** Zero unexplained catch blocks in hooks. `pnpm test` passes.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** modified: \~4 files in `src/hooks/`

---

### #7 — Fix event listener cleanup gaps in App.tsx ✅

**Description:** In `src/App.tsx`:

1. Add `.catch()` handlers to all `listen()` calls so that if `listen()` rejects, the `unlisten` variable is still safely handled (set to a no-op function).

2. Pattern:

```typescript
const unlisten = await listen('event', handler).catch((e) => {
  log.warn('app', 'Failed to register listener', e);
  return () => {}; // no-op unlisten
});
```

Also check `src/stores/local-ai-store.ts` — verify `unlisten()` is guarded against calls after the store or component is destroyed.

**Acceptance criteria:** All `listen()` calls have `.catch()` fallbacks. `pnpm test` passes.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** modified: `src/App.tsx`, possibly `src/stores/local-ai-store.ts`

---

## Phase 3: Dead Code Removal

### #8 — Clean up ai-store.ts deprecated code ✅

**Description:** The `ai-store.ts` has been trimmed significantly since the audit — `BUILT_IN_PERSONAS` array is already gone. What remains:

- `AIPersona` interface (6 lines) — **still needed** by migration code in `useSkillOperations.ts`
- `activePersonaId` and `customPersonas` fields — **still needed** by migration

Review `useSkillOperations.ts` migration code: the `personasMigrated` flag gates re-running. For users who installed after the migration shipped, `customPersonas` will always be `[]` and `personasMigrated` will be `true` after first launch.

**Action:** Check if there are any other dead methods/fields in `ai-store.ts` beyond the persona migration fields. Remove any that are truly unused (e.g., dead action methods, unreferenced helpers). Keep `AIPersona`, `activePersonaId`, `customPersonas` for now.

**Acceptance criteria:** No dead code in `ai-store.ts` beyond the documented migration fields. `pnpm typecheck` clean.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** modified: `src/stores/ai-store.ts`

---

### #9 — Remove drag-handle.ts if present ✅

**Description:** Check if `src/components/editor/extensions/drag-handle.ts` still exists (marked as deferred in CLAUDE.md). If so, verify zero imports and delete it. The `AnnotationPicker.tsx` and `item-annotation.ts` are already deleted.

**Acceptance criteria:** No deferred/unused extension files remain. `pnpm typecheck` clean.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** possibly deleted: `src/components/editor/extensions/drag-handle.ts`

---

## Phase 4: Lazy Loading

### #10 — Lazy-load document viewers ✅

**Description:** In `src/components/editor/Editor.tsx`, replace eager imports of viewer components with `React.lazy()`:

```tsx
const PdfViewer = lazy(() => import('./viewers/PdfViewer'));
const EpubViewer = lazy(() => import('./viewers/EpubViewer'));
const DocxViewer = lazy(() => import('./viewers/DocxViewer'));
const PlainTextViewer = lazy(() => import('./viewers/PlainTextViewer'));
```

Wrap the viewer render section in `<Suspense fallback={<Skeleton className="h-full w-full" />}>`.

**Acceptance criteria:** Viewers load on demand (visible in network tab — separate chunks). Opening a PDF/EPUB/DOCX still works correctly. No blank flash (skeleton shown). `pnpm test` and `pnpm build` pass.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** modified: `src/components/editor/Editor.tsx`

---

### #11 — Lazy-load dialogs in App.tsx ✅

**Description:** In `src/App.tsx`, replace eager imports of dialog components with `React.lazy()`:

```tsx
const SettingsDialog = lazy(() => import('./components/settings/SettingsDialog'));
const ExportDialog = lazy(() => import('./components/ExportDialog'));
const ActionsDialog = lazy(() => import('./components/ActionsDialog'));
const KeyboardShortcutsDialog = lazy(() => import('./components/KeyboardShortcutsDialog'));
```

Wrap each in `<Suspense fallback={null}>` (dialogs are modal, no visible loading state needed — they appear after a click which has inherent latency).

**Note:** Check that these components use default exports. If they use named exports, either add a default export or use the `lazy(() => import(...).then(m => ({ default: m.ComponentName })))` pattern.

**Acceptance criteria:** Dialogs load on demand. Opening Settings/Export/Actions/Shortcuts still works. `pnpm test` and `pnpm build` pass. Initial bundle size decreased.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** modified: `src/App.tsx`

---

## Phase 5: Verification

### #12 — Verify all quality gates ✅

**Description:** Run full verification:

1. `cargo test` — Rust tests pass
2. `cargo clippy` — no new warnings
3. `grep -r 'std::thread::sleep' src-tauri/src/commands/` — only in non-async thread contexts (with comments)
4. `pnpm test` — all 1115+ frontend tests pass
5. `pnpm typecheck` — clean
6. `pnpm build` — succeeds, compare bundle sizes before/after lazy loading
7. Grep for unexplained bare `catch {}` blocks — zero remaining
8. Update PRD quality gate checkboxes

**Acceptance criteria:** All quality gates in the PRD are checked. No regressions.

**Complexity:** S | **Category:** both | **Dependencies:** #1-#11

**Files:** modified: `docs/prds/2026-03-28-security-hardening.md`
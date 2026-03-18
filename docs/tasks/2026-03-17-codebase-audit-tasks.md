# Tasks: Codebase Audit Improvements

**Source:** [docs/research/codebase-audit-2026-03-17.md](../research/codebase-audit-2026-03-17.md)**Total:** 15 tasks (8S, 5M, 2L) **No task depends on another** — all independently shippable.

## Suggested Implementation Order

**Quick wins (5-15 min each):** Tasks 1, 2, 3, 4, 5, 8, 11 **Focused refactors (30 min - 1 hr):** Tasks 6, 7, 9, 10, 12, 13 **Larger refactors (1-2 hrs):** Tasks 14, 15

## Risks

- **#14 (Copilot hook consolidation):** Highest risk — must preserve exact LSP behavior for both WYSIWYG and source mode. Test inline completions in both modes after.
- **#9 (design system colors):** Needs a design decision first — should editor content colors (text color, highlights) be exempt from the neutral-only mandate? See audit section 6.1.

---

## Backend — Security & Reliability

### #1 — ~~Replace blocking sleeps with async sleeps in transcription.rs~~ N/A

> **Finding:** Both sleeps are in dedicated `std::thread::spawn` threads (cpal audio is `!Send`, whisper-rs is CPU-bound), not async context. `std::thread::sleep` is correct here. No change needed.

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/src/commands/transcription.rs` |

Replace `std::thread::sleep()` with `tokio::time::sleep().await` in async functions. The 3-second blocking sleep at line \~634 can starve the tokio runtime and freeze the UI.

**Acceptance criteria:**

- No `std::thread::sleep` in async functions in transcription.rs
- Recording and transcription still work identically
- `cargo check` passes

---

### #2 — Add depth limit to recursive list_directory ✅

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/src/commands/file.rs` |

Add a `max_depth` guard (e.g., 50) to `list_directory()` to prevent stack overflow on deeply nested directories or symlink loops. Add the depth as an internal counter, not a public parameter.

**Acceptance criteria:**

- Recursion stops at depth 50 (returns empty children)
- Normal directory listings work identically
- `cargo check` passes

---

### #3 — Remove TOCTOU pre-checks in file operations ✅

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/src/commands/file.rs` |

Remove `Path::new(&path).exists()` checks before file operations (\~lines 135, 144, 153, 213). Instead, attempt the operation and handle the specific error codes (`AlreadyExists`, `NotFound`, `PermissionDenied`).

**Acceptance criteria:**

- File create/rename/copy operations handle errors from the operation itself
- No pre-existence checks remain
- Frontend behavior unchanged
- `cargo check` passes

---

### #4 — Add error context to file operation error messages ✅

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/src/commands/file.rs` |

Replace bare `.map_err(|e| e.to_string())` calls with `format!("Failed to {action} {path}: {e}")` across all file commands (`read_file`, `write_file`, `create_file`, `create_directory`, `rename_path`, `delete_path`, `copy_directory`).

**Acceptance criteria:**

- Every error message includes the file path and operation attempted
- `cargo check` passes

---

### #5 — Log warnings for swallowed errors ✅

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/src/commands/file.rs`, `src-tauri/src/commands/watcher.rs` |

Add `log::warn!` calls where errors are currently silently swallowed:

- `file.rs` line \~61: subdirectory recursion failure returns empty Vec — add log warning
- `watcher.rs` lines \~10-18: mutex poisoning recovery — log the panic backtrace if available

**Acceptance criteria:**

- Silent error points now log warnings
- No behavior change for callers
- `cargo check` passes

---

### #6 — Audit domain_matches for subdomain safety ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/src/commands/network_proxy.rs` |

Verify that `domain_matches()` correctly:

- Permits `sub.example.com` when `example.com` is allowed
- Rejects `evilexample.com` when `example.com` is allowed (must not suffix-match)
- Handles edge cases: empty domains, trailing dots, IP addresses

If issues found, fix them. If correct, add unit tests to lock the behavior.

**Acceptance criteria:**

- Unit tests cover exact match, subdomain match, suffix rejection, edge cases
- `cargo check` and `cargo test` pass

---

## Frontend — Dead Code Removal

### #7 — Remove deprecated persona system from ai-store ✅

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/stores/ai-store.ts` |

Remove all `@deprecated` persona code: `AIPersona` interface, `BUILT_IN_PERSONAS` array, persona action methods (`setActivePersona`, `addCustomPersona`, `updateCustomPersona`, `deleteCustomPersona`), and helper functions (`getAllPersonas`, `getActivePersona`).

Keep only: `activePersonaId` and `customPersonas` store fields (needed by one-time migration in `useSkillOperations.ts`).

**Acceptance criteria:**

- No `@deprecated` markers remain in ai-store.ts
- Migration code in useSkillOperations.ts still compiles and works
- App starts without errors

---

### #8 — Delete deferred AnnotationPicker and item-annotation ✅

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/components/editor/AnnotationPicker.tsx` (delete), `src/components/editor/extensions/item-annotation.ts` (delete) |

Delete both files — deferred features with zero imports. Git history preserves them if needed later.

**Acceptance criteria:**

- Both files deleted
- No import errors (grep confirms zero references)
- App builds without errors

---

## Frontend — Performance

### #9 — Lazy-load document viewers ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/components/editor/Editor.tsx` |

Replace eager viewer imports with `React.lazy()`:

```tsx
const PdfViewer = lazy(() => import('./viewers/PdfViewer'));
const EpubViewer = lazy(() => import('./viewers/EpubViewer'));
const DocxViewer = lazy(() => import('./viewers/DocxViewer'));
const ImageViewer = lazy(() => import('./viewers/ImageViewer'));
```

Wrap viewer rendering in `<Suspense fallback={<Skeleton />}>`. Keep `PlainTextViewer` eager (tiny, no heavy deps).

Ensure each viewer file uses a default export (or named export compatible with `lazy()`).

**Acceptance criteria:**

- Opening a markdown file does NOT load pdfjs-dist, mammoth.js, or foliate-js
- Opening a PDF/EPUB/DOCX/image still works (lazy loads on demand)
- No flash of unstyled content (Suspense fallback shown briefly)

---

### #10 — Lazy-load settings and export dialogs

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/App.tsx` or `src/components/Layout.tsx` |

Replace eager imports of `SettingsDialog`, `ExportDialog`, `ActionsDialog`, `KeyboardShortcutsDialog`, `ProjectSettingsDialog` with `React.lazy()`. These are hidden by default and only shown on demand.

**Acceptance criteria:**

- Initial bundle does not include dialog code
- Opening each dialog still works (loads on demand)
- No visible delay when opening settings (dialogs are small)

---

### #11 — FileTreeItem git status Map lookup

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/components/sidebar/FileTreeItem.tsx`, `src/components/sidebar/FileTree.tsx` |

Convert `fileStatuses` array to a `Map<string, GitFileStatus>` before passing to `FileTreeItem`. Currently each item does `.find()` on the full array — O(n) per item, O(n\*m) total.

**Acceptance criteria:**

- Git status indicators still display correctly
- Large repos with many changed files render faster
- No visual change

---

## Frontend — Cleanup

### #12 — Fix uncaught promise rejections and event listener cleanup

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/App.tsx`, `src/hooks/useFileWatcher.ts`, `src/stores/local-ai-store.ts` |

1. Add `.catch(e => console.warn(...))` to silently-swallowed promises:
   - `useFileWatcher.ts` lines \~79, 192: `tauriApi.indexFile().catch(() => {})`
   - `App.tsx` line \~137: `listDirectory().catch(() => {})`
2. Add `.catch()` to Tauri `listen()` chains in App.tsx (line \~119-150)
3. Review `local-ai-store.ts` downloadModel IIFE for cleanup safety

**Acceptance criteria:**

- No silent `.catch(() => {})` without at least a `console.warn`
- All `listen()` chains have error handling
- No behavior change for users

---

### #13 — Clean up debounce map growth in useFileWatcher

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/hooks/useFileWatcher.ts` |

Delete debounce map entries after the debounce timer fires (in the `setTimeout` callback). Currently entries accumulate until the 500-entry reactive guard triggers.

**Acceptance criteria:**

- Debounce map entries cleaned up after timer fires
- File watcher still debounces correctly
- No memory growth over time

---

## Frontend — Simplification

### #14 — Consolidate Copilot completion hooks

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/hooks/useCopilotCompletion.ts`, `src/hooks/useCopilotCompletionCM.ts` |

Extract shared LSP lifecycle logic (\~60% overlap) into a shared module:

1. Extract LSP start/stop/auth lifecycle to a shared utility or lower-level hook
2. Extract document sync (didOpen/didChange/didClose) to a parameterized function that accepts a content-extraction callback
3. Keep mode-specific adapters (ProseMirror text extraction vs CodeMirror lineAt) in each hook

**Acceptance criteria:**

- Inline completions work in WYSIWYG mode (ProseMirror)
- Inline completions work in source mode (CodeMirror)
- No duplicated LSP lifecycle or document sync logic
- Total LOC reduced by \~150-200

---

### #15 — Centralize editor colors as CSS variables

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | Design decision on #6.1 from audit |
| **Files** | `src/styles/globals.css`, `src/styles/editor.css`, `src/components/editor/Toolbar.tsx` |

1. Define diff colors as CSS variables in `globals.css`:
   - `--color-diff-insert`, `--color-diff-insert-bg`
   - `--color-diff-delete`, `--color-diff-delete-bg`
2. Define highlight mark colors as CSS variables (or update design-system.md to allow content colors)
3. Replace all hardcoded RGB/RGBA/hex in editor.css with CSS variable references
4. Move text color and highlight swatch definitions to a shared constant or CSS variables
5. Fix date badge and comment highlight to use neutral hues (zero chroma) unless exempted

**Acceptance criteria:**

- No hardcoded RGB/RGBA/hex in editor.css (except within CSS variable definitions in globals.css)
- Diff decorations, highlights, date badges all render correctly in light and dark mode
- Toolbar swatches match the CSS-defined colors
- design-system.md updated if content color exception is adopted

---

## Summary

| Category | Count | Tasks |
| --- | --- | --- |
| Backend — security & reliability | 6 | #1, #2, #3, #4, #5, #6 |
| Frontend — dead code | 2 | #7, #8 |
| Frontend — performance | 3 | #9, #10, #11 |
| Frontend — cleanup | 2 | #12, #13 |
| Frontend — simplification | 2 | #14, #15 |
| **Total** | **15** | 8S, 5M, 2L |

All tasks are independent — no dependency graph. Suggested order by impact-to-effort ratio:

 1. #8 (delete dead files, 5 min)
 2. #7 (remove deprecated personas, 15 min)
 3. #1 (async sleeps, 10 min)
 4. #4 (error context, 15 min)
 5. #2 (depth limit, 15 min)
 6. #5 (log swallowed errors, 10 min)
 7. #11 (FileTreeItem Map, 15 min)
 8. #13 (debounce cleanup, 10 min)
 9. #3 (TOCTOU fixes, 20 min)
10. #9 (lazy viewers, 30 min)
11. #10 (lazy dialogs, 30 min)
12. #12 (promise/listener cleanup, 30 min)
13. #6 (domain matching audit, 45 min)
14. #14 (Copilot hooks, 1-2 hrs)
15. #15 (CSS variable centralization, 1-2 hrs)
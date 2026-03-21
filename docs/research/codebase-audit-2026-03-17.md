# Codebase Audit: Simplifications, Performance, Security & Design Alignment

**Date:** 2026-03-17 **Status:** Research complete

| Stage | Link | Status |
| --- | --- | --- |
| PRD | — | Pending implementation decisions |
| Tasks | [codebase-audit-tasks](../tasks/2026-03-17-codebase-audit-tasks.md) | Partial |

**Codebase version:** v0.22.3

---

## 1. Security Issues

### 1.1 Blocking Sleeps in Async Context (HIGH)

`src-tauri/src/commands/transcription.rs` uses `std::thread::sleep()` inside async functions, which can starve the tokio runtime and freeze the UI.

- Line ~248: `std::thread::sleep(Duration::from_millis(100))`
- Line ~634: `std::thread::sleep(Duration::from_secs(3))` (3 seconds!)

**Fix:** Replace with `tokio::time::sleep().await`.

### 1.2 Recursive Directory Listing Without Depth Limit (MEDIUM)

`src-tauri/src/commands/file.rs` `list_directory()` recurses infinitely. A deeply nested directory (or symlink loop) could cause stack overflow or excessive memory usage.

**Fix:** Add a `max_depth` parameter (e.g., 50) or use an iterative approach with `walkdir`.

### 1.3 TOCTOU Race Conditions in File Operations (LOW-MEDIUM)

`src-tauri/src/commands/file.rs` checks `Path::new(&path).exists()` before operating on files (lines ~135, 144, 153, 213). Between the check and the operation, the file could change.

**Fix:** Remove pre-checks and rely on operation return codes. Handle `AlreadyExists`, `NotFound` errors from the actual operation.

### 1.4 Domain Matching Validation (MEDIUM)

`src-tauri/src/commands/network_proxy.rs` — verify that domain matching is precise. Permitting `example.com` must NOT automatically permit `evilexample.com`.

**Fix:** Audit `domain_matches()` for exact-match and subdomain-only matching.

### 1.5 Silent Error Swallowing (MEDIUM)

Multiple locations return empty results on error instead of propagating:
- `file.rs` line ~61: subdirectory read failure returns empty `Vec` silently
- `watcher.rs` lines ~10-18: mutex poisoning recovery returns potentially corrupt state

**Fix:** Log warnings at minimum; propagate errors where possible.

---

## 2. Performance — Rust Backend

### 2.1 N+1 Pattern in Index Reindexing (LOW-MEDIUM)

`src-tauri/src/index/mod.rs` lines ~155-200: `reindex_file_in_db()` reads each file from disk and queries the DB separately. Could batch hash checks.

### 2.2 Error Messages Missing Context (LOW)

`file.rs` line ~16: `fs::read_to_string(&path).map_err(|e| e.to_string())` — doesn't include the path in the error message, making debugging harder.

**Fix:** `format!("Failed to read file {}: {}", path, e)`

---

## 3. Performance — Frontend

### 3.1 Eager Viewer Imports (MEDIUM — bundle size)

`src/components/editor/Editor.tsx` lines ~58-62 imports ALL viewers eagerly:
- `ImageViewer`, `PlainTextViewer`, `PdfViewer`, `DocxViewer`, `EpubViewer`
- Each pulls in heavy libraries (pdfjs-dist, mammoth.js, foliate-js)
- Most users primarily edit markdown files

**Fix:** Use `React.lazy()` for viewer components:
```tsx
const PdfViewer = lazy(() => import('./viewers/PdfViewer'));
const EpubViewer = lazy(() => import('./viewers/EpubViewer'));
```

### 3.2 Eager Dialog Imports (MEDIUM — bundle size)

`src/App.tsx` lines ~4-10 eagerly imports `SettingsDialog`, `ProjectSettingsDialog`, `ExportDialog`, `ActionsDialog`, `KeyboardShortcutsDialog`. All hidden by default.

**Fix:** Lazy-load dialogs that are only shown on demand.

### 3.3 FileTreeItem O(n) Status Lookup (LOW-MEDIUM)

`src/components/sidebar/FileTreeItem.tsx` lines ~115-116: uses `.find()` on `fileStatuses` array for every item. With large repos this is O(n*m).

**Fix:** Create a `Map<string, GitFileStatus>` from `fileStatuses` for O(1) lookup.

### 3.4 ChatPanel Scroll Reflow (LOW)

`src/components/chat/ChatPanel.tsx` line ~171: `scrollToBottom()` fires on every message/permission/domain update, causing continuous DOM reflows.

**Fix:** Wrap in `requestAnimationFrame()`.

### 3.5 CommandPalette Inline Sorting (LOW)

`src/components/CommandPalette.tsx` lines ~215-221: sorts path arrays inside a `useCallback`, defeating memoization.

**Fix:** Memoize the sorted arrays separately.

---

## 4. Memory & Cleanup

### 4.1 Event Listener Cleanup Gaps (MEDIUM)

- `src/App.tsx` line ~119-150: Tauri `listen()` missing `.catch()` — if `listen()` rejects, `unlisten` is never assigned
- `src/stores/local-ai-store.ts` line ~136-161: async IIFE `downloadModel` — `unlisten()` may fire after store destruction

### 4.2 Uncaught Promise Rejections (MEDIUM)

- `src/hooks/useFileWatcher.ts` lines ~79, 192: `.catch(() => {})` silently swallows indexing errors
- `src/App.tsx` line ~137: `listDirectory().catch(() => {})` swallows errors without logging

**Fix:** At minimum `.catch(e => console.warn(...))` to aid debugging.

### 4.3 Debounce Map Unbounded Growth (LOW)

`src/hooks/useFileWatcher.ts` lines ~62-65: `modifyDebounce` object grows without cleanup. Guard at line ~179 checks for MAX_DEBOUNCE_ENTRIES (500) reactively.

**Fix:** Delete entries after debounce timer fires.

---

## 5. Dead Code & Simplifications

### 5.1 Deprecated Persona System (HIGH — ~100 LOC)

`src/stores/ai-store.ts` lines ~7-73, 80-98, 170-179: `AIPersona` interface, `BUILT_IN_PERSONAS`, persona actions, helper functions — all marked `@deprecated`. Only referenced by migration code.

**Fix:** Remove everything except the fields needed for one-time migration (`activePersonaId`, `customPersonas`).

### 5.2 Deferred AnnotationPicker & ItemAnnotation (MEDIUM — ~200 LOC)

- `src/components/editor/AnnotationPicker.tsx` (~120 LOC)
- `src/components/editor/extensions/item-annotation.ts` (~80 LOC)

Both marked as deferred in CLAUDE.md, never rendered anywhere. Zero imports found.

**Fix:** Delete both files. Git history preserves them.

### 5.3 Copilot Completion Hook Duplication (HIGH — ~200 LOC reducible)

- `src/hooks/useCopilotCompletion.ts` (~357 LOC) — for WYSIWYG mode
- `src/hooks/useCopilotCompletionCM.ts` (~255 LOC) — for source mode

~60% code duplication (LSP lifecycle, document sync, completion requests). Differ only in document API (ProseMirror vs CodeMirror).

**Fix:** Extract shared `useLSPLifecycle()` and `useLSPDocumentSync()`, keep mode-specific adapters.

### 5.4 Git Store Over-Generalized (LOW)

`src/stores/git-store.ts`: supports multiple repos keyed by path, but only one project is active at a time.

**Fix:** Simplify to single-repo store (~30 lines saved).

### 5.5 Editor Styles Store Dead Methods (LOW)

`src/stores/editor-styles-store.ts`: `loadSettings()` and `saveSettings()` methods exist but are never called.

**Fix:** Remove or wire up.

---

## 6. Design System Violations

### 6.1 Chromatic Colors in Text & Highlight Palettes (CRITICAL)

`src/components/editor/Toolbar.tsx` lines ~187-206:
- Text color palette includes: Red, Orange, Yellow, Green, **Blue `#3b82f6`**, **Purple `#a855f7`**
- Highlight palette includes: Yellow, Green, **Blue**, Pink, Orange

Design system mandate: "STRICTLY NEUTRAL — NO CHROMATIC ACCENT COLOR." The only non-grey color allowed is destructive red.

**Decision needed:** Either migrate to neutral-only palette or update `design-system.md` to allow editor content colors as an exception.

### 6.2 Hardcoded RGB/RGBA in Inline Diff Styles (HIGH)

`src/styles/editor.css` lines ~522-547:
- Hardcoded red: `rgba(239, 68, 68, 0.15)`, `rgb(220, 38, 38)`
- Hardcoded green: `rgba(34, 197, 94, 0.2)`, `rgb(21, 128, 61)`

**Fix:** Define as CSS variables in `globals.css` (e.g., `--color-diff-insert`, `--color-diff-delete`).

### 6.3 Date Badge Uses Non-Neutral Hue (MEDIUM)

`src/styles/editor.css` lines ~716-738: uses `oklch(93% 0.03 85)` — hue 85 (yellow range) violates zero-chroma requirement.

**Fix:** Change to `oklch(93% 0 0)` (pure neutral).

### 6.4 Comment Highlight Uses Non-Neutral Hue (MEDIUM)

`src/styles/editor.css` lines ~480-509: uses `oklch(88% 0.11 80)` — hue 80, chroma 0.11.

**Fix:** Change to neutral grey or update design-system.md to allow functional colors.

### 6.5 Highlight Marks Use Hardcoded Hex (MEDIUM)

`src/styles/editor.css` lines ~908-920: all highlight colors are hardcoded Tailwind hex values (`#fef08a`, `#bfdbfe`, etc.) instead of CSS variables.

**Fix:** Define as CSS variables for centralized management.

### 6.6 Hardcoded Box Shadows (LOW)

`src/styles/editor.css` lines ~276, 564: uses `rgb(0 0 0 / 0.05)` instead of oklch neutrals.

---

## 7. Architecture Alignment

### 7.1 Color Configuration Not Centralized (MEDIUM)

Text color and highlight color palettes are defined in TWO places:
1. `Toolbar.tsx` — defines swatches for UI display
2. `editor.css` — defines actual render colors

These can drift. Should have a single source of truth.

### 7.2 No Critical Violations Found

- No frontend code bypasses Tauri IPC for file/system operations
- ProseMirror remains the single source of truth for document state
- shadcn/ui components are used appropriately throughout
- Store persistence patterns are correct (runtime-only state excluded)
- Naming conventions are consistent (PascalCase components, camelCase functions)

---

## Priority Action Items

### High Priority (reliability + performance)

1. **Replace `std::thread::sleep` with `tokio::time::sleep`** in transcription.rs — prevents UI freezes
2. **Add depth limit to recursive `list_directory()`** — prevents stack overflow
3. **Lazy-load viewers** (PdfViewer, EpubViewer, DocxViewer, ImageViewer) — reduces main bundle
4. **Delete deprecated persona code** from ai-store.ts — removes dead code
5. **Delete deferred AnnotationPicker + item-annotation** — removes dead code

### Medium Priority (maintainability + design)

6. **Consolidate Copilot completion hooks** — eliminates ~200 LOC duplication
7. **Lazy-load settings/export dialogs** — reduces initial bundle
8. **Fix TOCTOU race conditions** in file.rs — remove existence pre-checks
9. **Define diff/highlight/badge colors as CSS variables** — design system compliance
10. **Decide on editor color palette policy** — update design-system.md or migrate to neutral

### Low Priority (polish)

11. **FileTreeItem status Map** — O(1) lookup instead of O(n) find
12. **Add error context to file operation errors** — include path in error messages
13. **Clean up event listener patterns** — add missing .catch(), proper unlisten
14. **Simplify git-store** to single-repo design
15. **Remove unused editor-styles-store methods**

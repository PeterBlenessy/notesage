# Internal Document Linking Tasks

|  |  |
| --- | --- |
| **Date** | 2026-03-28 |
| **Status** | Complete |
| **PRD** | Feature request (no PRD) |
| **Total** | 8 tasks: 3S, 3M, 2L |
| **Suggested order** | Shortcut cleanup (#1) → Link detection (#2) → File search util (#3) → Link popover (#4) → Editor click handler (#5) → Link styling (#6) → Round-trip test (#7) → Docs (#8) |

**Risks:**

- The Tiptap Link extension (via StarterKit) may have its own Cmd+K keybinding registered internally — removing it from `useKeyboardShortcuts.ts` may not be sufficient, may need to disable it in the extension config too
- Relative path resolution depends on knowing the active file's directory — files opened outside a project/explorer folder may not resolve correctly
- Workspace store file trees are lazy-loaded per folder — the document search needs to handle cases where trees aren't loaded yet

---

### #1 — Remove Cmd+K link shortcut and clean up references ✅

**Description:** Remove the Cmd+K → link insertion path. In `useKeyboardShortcuts.ts`, the Cmd+K handler currently lets Tiptap handle link insertion when text is selected (lines 56-66). Change this so Cmd+K **always** opens the command palette regardless of selection. In `useEditor.ts`, disable the Link extension's built-in Cmd+K keybinding by passing `keyboard: false` or overriding the keyboard shortcut config. Update `LinkButton.tsx` tooltip to remove "(Cmd+K)" reference. Update `docs/keyboard-shortcuts.md` to remove the link shortcut entry.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/hooks/useKeyboardShortcuts.ts`, `src/hooks/useEditor.ts`, `src/components/editor/toolbar/LinkButton.tsx`, `docs/keyboard-shortcuts.md`

---

### #2 — Stop auto-prepending https:// to local file paths ✅

**Description:** In `LinkButton.tsx` `handleSubmit()`, the href processing line auto-prepends `https://` to any input without a protocol. Change this to detect local file paths — if the input matches a file extension pattern (`.md`, `.txt`, `.json`, etc.) or starts with `./`, `../`, `/`, or `~`, treat it as a local path and do NOT prepend `https://`. Reuse the `OPENABLE_EXTENSIONS` regex from `MarkdownContent.tsx` (extract to a shared constant in `src/lib/link-utils.ts`).

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/editor/toolbar/LinkButton.tsx`, new: `src/lib/link-utils.ts`

---

### #3 — Create file search utility for workspace documents ✅

**Description:** Create a `searchWorkspaceFiles(query: string): FileSearchResult[]` function in `src/lib/link-utils.ts` that searches all open project and explorer folder file trees from `workspace-store` for files matching a query. Return results with `{ name, relativePath, absolutePath, project }`. The `relativePath` should be computed relative to the active file's directory (from `editor-store`). Use case-insensitive substring matching on file names. Limit results to 20. Filter to openable file types only.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** `src/lib/link-utils.ts`, reads from `src/stores/workspace-store.ts`, `src/stores/editor-store.ts`

---

### #4 — Enhance LinkButton popover with document search ✅

**Description:** Redesign the `LinkButton.tsx` popover to support both document search and external URL entry. When the user types in the input: (a) if it looks like a URL (starts with `http`, `mailto`, etc.), show no suggestions — behave as today. (b) Otherwise, call `searchWorkspaceFiles()` and show matching documents as a dropdown list below the input. Each result shows the file name and its parent folder. Selecting a result fills the href with the relative path and the display text with the file name (without extension). Keyboard navigation: arrow keys to select, Enter to confirm, Escape to close. Follow the visual pattern of the tag autocomplete popup. The input placeholder should change to "Search documents or paste URL...".

**Complexity:** L | **Category:** frontend | **Dependencies:** #2, #3

**Files:** `src/components/editor/toolbar/LinkButton.tsx`

---

### #5 — Add editor click handler for internal document links ✅

**Description:** Add a ProseMirror click handler to the editor that opens links on click. In `useEditor.ts`, add `handleClick` to the editor's `editorProps` that detects link marks on the clicked position. For the click handler: (a) detect if the link href is a local file path (using the shared detection from `link-utils.ts`), (b) if local: resolve the path relative to the active file's directory and open it as a tab via `openTab()` from `useFileOperations`, (c) if external URL: open in system browser via `@tauri-apps/plugin-opener`. Extract and reuse the `tryOpenFile` / `resolveRelativePath` logic from `MarkdownContent.tsx` into `link-utils.ts` so both the editor and chat use the same resolution. Show a toast error if the file can't be found.

**Complexity:** L | **Category:** frontend | **Dependencies:** #2

**Files:** `src/hooks/useEditor.ts` or new: `src/components/editor/extensions/link-click.ts`, `src/lib/link-utils.ts`, `src/components/MarkdownContent.tsx` (extract shared logic)

---

### #6 — Style internal document links distinctly ✅

**Description:** Internal document links should be visually distinguishable from external URLs. Add a CSS class or data attribute to link marks that point to local files. In the editor CSS, style internal links with a subtle file icon or different underline style (e.g., dashed underline for internal vs solid for external). Keep it minimal — the link should still look like a link, just with a hint that it's an internal document reference.

**Complexity:** S | **Category:** frontend | **Dependencies:** #5

**Files:** `src/styles/editor.css`, possibly `src/hooks/useEditor.ts` (link mark rendering)

---

### #7 — Add round-trip test for internal document links ✅

**Description:** Add a test fixture and round-trip test case for internal document links. Create a markdown fixture with both internal links (`[Editor docs](docs/features/editor.md)`) and external links (`[Google](https://google.com)`). Verify that both parse correctly and serialize back to identical markdown. Ensure relative paths are preserved without modification. Add to the existing markdown round-trip test suite.

**Complexity:** M | **Category:** frontend | **Dependencies:** #2

**Files:** `tests/fixtures/internal-links.md` (new fixture), existing round-trip test file

---

### #8 — Update documentation ✅

**Description:** Update `docs/keyboard-shortcuts.md` to remove Cmd+K as link shortcut (moved to #1). Update `docs/features/editor.md` to document internal document linking: how to create links to other documents, how clicking works, relative path resolution. Update `docs/product-description.md` features table if applicable.

**Complexity:** M | **Category:** docs | **Dependencies:** #1, #4, #5

**Files:** `docs/keyboard-shortcuts.md`, `docs/features/editor.md`
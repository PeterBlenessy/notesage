# Document Format Support — Task Breakdown

**PRD:** `docs/prds/2026-02-24-document-format-support.md`**Status:** ✅ Complete **Total:** 20 tasks: 6S, 9M, 5L — all implemented

## Part 1: Fix Local Images

| \# | Title | Complexity | Category | Dependencies | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Configure Tauri asset protocol | S | backend | — | ✅ Done |
| 2 | Add `read_binary_file` Tauri command | S | both | — | ✅ Done |
| 3 | Add image URL resolution for local paths | S | frontend | #1 | ✅ Done |
| 4 | Override Tiptap Image extension to resolve local paths | M | frontend | #1, #3 | ✅ Done |
| 5 | Replace `window.prompt` with ImageInsertDialog | M | frontend | #3 | ✅ Done |

## Part 2: Multi-Format Tab Infrastructure

| \# | Title | Complexity | Category | Dependencies | Status |
| --- | --- | --- | --- | --- | --- |
| 6 | Extend Tab interface with `fileType` and `viewMode` | M | frontend | — | ✅ Done |
| 7 | Add file type detection utility | S | frontend | #6 | ✅ Done |
| 8 | Route file opening by type | M | both | #2, #6, #7 | ✅ Done |
| 9 | Create multi-format editor router | L | frontend | #6, #8 | ✅ Done |
| 10 | Update tab icons by file type | S | frontend | #6 | ✅ Done |

## Part 3: Source Mode (CodeMirror)

| \# | Title | Complexity | Category | Dependencies | Status |
| --- | --- | --- | --- | --- | --- |
| 11 | Install CodeMirror dependencies | S | frontend | — | ✅ Done |
| 12 | Create Notesage CodeMirror theme | M | frontend | #11 | ✅ Done |
| 13 | Build SourceEditor component | L | frontend | #11, #12 | ✅ Done |
| 14 | Wire source mode toggle | L | frontend | #6, #9, #13 | ✅ Done |
| 15 | Add Copilot completions to source mode | L | frontend | #13, #14 | ✅ Done |
| 16 | Add AI text actions to source mode | M | frontend | #13, #14 | ✅ Done |

## Part 4: PDF Viewer

| \# | Title | Complexity | Category | Dependencies | Status |
| --- | --- | --- | --- | --- | --- |
| 17 | Install pdf.js and build PdfViewer component | L | frontend | #8, #9 | ✅ Done |

## Part 5: DOCX Viewer + Import

| \# | Title | Complexity | Category | Dependencies | Status |
| --- | --- | --- | --- | --- | --- |
| 18 | Install docx-preview/mammoth and build DocxViewer | M | frontend | #8, #9 | ✅ Done |
| 19 | Implement DOCX-to-markdown import | M | frontend | #18 | ✅ Done |

## Part 6: Other Document Imports

| \# | Title | Complexity | Category | Dependencies | Status |
| --- | --- | --- | --- | --- | --- |
| 20 | Add PPTX/ODT/ODP import to markdown | L | both | #7, #8 | ✅ Done |

## Task Details

### 1. Configure Tauri asset protocol ✅ DONE

Enable asset protocol in `tauri.conf.json` security section with scope `["**"]`. Add permission to capabilities. Test that `asset://localhost/<absolute-path>` serves local files in the webview. **Files:** `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`

### 2. Add `read_binary_file` Tauri command ✅ DONE

Add command in `commands/file.rs` that reads a file as `Vec<u8>`. Follow existing `read_file` pattern. Register in `generate_handler![]` in `lib.rs`. Add typed wrapper in `lib/tauri.ts`. **Files:** `src-tauri/src/commands/file.rs`, `src-tauri/src/lib.rs`, `src/lib/tauri.ts`

### 3. Add image URL resolution for local paths ✅ DONE

Create `resolveImageSrc(src: string, documentDir: string): string` — converts relative and absolute file paths to `asset://localhost/` URLs, passes through remote URLs unchanged. **Files:** `src/lib/image-utils.ts` (new)

### 4. Override Tiptap Image extension to resolve local paths ✅ DONE

Extend Image extension with custom rendering that calls `resolveImageSrc`. Markdown stores original relative path; rendered `src` uses asset URL. Test with relative, absolute, and remote URLs. **Files:** `src/hooks/useEditor.ts`, `src/components/editor/extensions/`

### 5. Replace `window.prompt` with ImageInsertDialog ✅ DONE

shadcn/ui dialog with two tabs: "URL" (text input) and "Local File" (Tauri open dialog filtered to image types). Alt text input and image preview. Wire into Toolbar and SlashCommand. Local files stored as relative paths. **Files:** `src/components/editor/ImageInsertDialog.tsx` (new), `src/components/editor/Toolbar.tsx`, `src/components/editor/extensions/slash-command.tsx`

### 6. Extend Tab interface with `fileType` and `viewMode` ✅ DONE

Add `fileType: FileType` and `viewMode?: ViewMode` to Tab. Add type definitions. Add `setViewMode` / `toggleViewMode` actions. Exclude from persist. Update `openTab` to accept optional `fileType`. **Files:** `src/stores/editor-store.ts`

### 7. Add file type detection utility ✅ DONE

Create `getFileType(fileName: string): FileType` mapping extensions to file types. **Files:** `src/lib/file-utils.ts` (new)

### 8. Route file opening by type ✅ DONE

Modify `openFile` to detect file type, use `read_binary_file` for binary types, `read_file` for text. Store binary data in module-level cache (not Zustand). For images, just open tab with path. **Files:** `src/hooks/useFileOperations.ts`, `src/lib/binary-cache.ts` (new)

### 9. Create multi-format editor router ✅ DONE

Refactor `Editor.tsx` to route by `fileType`. Extract Tiptap into `MarkdownEditor`. Add placeholder viewer components. **High blast radius.Files:** `src/components/editor/Editor.tsx`, `src/components/editor/MarkdownEditor.tsx` (new), viewer components (new)

### 10. Update tab icons by file type ✅ DONE

Show file-type-appropriate lucide icons in `Tab.tsx`. **Files:** `src/components/tabs/Tab.tsx`

### 11. Install CodeMirror dependencies ✅ DONE

Install `@codemirror/view`, `@codemirror/state`, `@codemirror/lang-markdown`, `@codemirror/language`, `@codemirror/commands`, `@codemirror/search`. **Files:** `package.json`

### 12. Create Notesage CodeMirror theme ✅ DONE

Custom theme matching neutral greyscale palette. CSS variables. Light/dark mode. JetBrains Mono. No chromatic syntax colors. **Files:** `src/components/editor/codemirror-theme.ts` (new)

### 13. Build SourceEditor component ✅ DONE

CodeMirror wrapper with markdown lang support, custom theme. Props: content, onChange, onSave. 720px centered layout. Cmd+S save. Expose editor ref for Copilot. **Files:** `src/components/editor/SourceEditor.tsx` (new)

### 14. Wire source mode toggle ✅ DONE

`Cmd+/` shortcut and toolbar button. WYSIWYG↔Source conversion. Toast on parse failure. Status bar mode indicator. **Files:** `src/components/editor/MarkdownEditor.tsx`, `src/components/editor/Toolbar.tsx`, `src/components/editor/StatusBar.tsx`

### 15. Add Copilot completions to source mode ✅ DONE

Extend `useCopilotCompletion` for CodeMirror. Ghost text as CodeMirror decoration. Tab accept, Escape dismiss. **Files:** `src/hooks/useCopilotCompletion.ts`, `src/components/editor/codemirror-ghost-text.ts` (new)

### 16. Add AI text actions to source mode ✅ DONE

AI actions on selected text in CodeMirror. Reuse `useAIOperations.generateText()`. Context menu or floating toolbar. **Files:** `src/components/editor/SourceEditor.tsx`, `src/hooks/useAIOperations.ts`

### 17. Install pdf.js and build PdfViewer component ✅ DONE

`pdfjs-dist`. Canvas rendering, virtual scroll. Toolbar: page nav, zoom, fit modes. Keyboard nav. Dark mode. Worker config. **Files:** `src/components/editor/PdfViewer.tsx`, `package.json`

### 18. Install docx-preview/mammoth and build DocxViewer ✅ DONE

`docx-preview` + `mammoth`. Render via `renderAsync()`. Scoped CSS. Toolbar with "Convert to Markdown". **Files:** `src/components/editor/DocxViewer.tsx`, `package.json`

### 19. Implement DOCX-to-markdown import ✅ DONE

mammoth.js → HTML → markdown. Save dialog. Write file. Open in tab. Sidebar context menu "Import as Markdown". **Files:** `src/components/editor/DocxViewer.tsx`, `src/components/sidebar/FileTreeItem.tsx`, `src/lib/import-utils.ts` (new)

### 20. Add PPTX/ODT/ODP import to markdown ✅ DONE

ZIP+XML extraction. Rust or JS-side. Slide text → heading+bullets. Context menu. Progress toast. **Files:** `src-tauri/src/commands/import.rs` (new, if Rust-side), `src/lib/import-utils.ts`, `src/components/sidebar/FileTreeItem.tsx`
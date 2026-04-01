# PRD: Code File Editing & Syntax Highlighting

|  |  |
| --- | --- |
| **Date** | 2026-03-30 |
| **Status** | Complete |
| **Priority** | High |
| **Impact** | Code files become editable with syntax highlighting, line numbers, and code navigation. WYSIWYG code blocks gain muted chromatic syntax highlighting. |
| **Research** | [document-format-enhancements](../research/2026-03-30-document-format-enhancements.md) |
| **Tasks** | [code-file-highlighting-tasks](../tasks/2026-03-30-code-file-highlighting-tasks.md) |

## Problem

**Two separate but related issues:**

1. **Code files are broken.** Opening code files (`.js`, `.py`, `.rs`, `.ts`, `.go`, etc.) in Notesage renders them as unstyled monospace text in a `<pre>` element via `PlainTextViewer.tsx`. No syntax highlighting, no line numbers, no editing. This makes Notesage feel broken when browsing code files in a project.

2. **WYSIWYG code blocks are unstyled.** Code blocks in the rich text editor (`CodeBlockLowlight`) generate the correct highlight.js semantic spans (`.hljs-keyword`, `.hljs-string`, etc.) but have zero CSS rules styling them — all code renders as flat monochrome text. Every modern editor (Bear, Craft, Obsidian, Notion) highlights code blocks inline.

## Goals

### Part A: Code File Editing

1. **Full editing** of code files using CodeMirror 6 — not a read-only viewer. Save, dirty indicators, auto-save, undo/redo all work like markdown source mode.
2. **Syntax highlighting** for 22+ programming languages
3. **Code navigation** — line numbers, code folding, bracket matching, active line highlight
4. **Find in document** via CodeMirror's built-in search (replacing the current DOM-based search for code files)
5. **Theme integration** — light/dark mode and contrast slider work seamlessly using the existing `notesageExtensions` CodeMirror theme
6. **Lazy loading** — language packages loaded on demand, not bundled at startup
7. **Graceful fallback** — unknown file extensions retain the existing plain `<pre>` rendering
8. **Status bar language indicator** — detected language name shown in the toolbar

### Part B: WYSIWYG Code Block Highlighting

 9. **Muted chromatic syntax highlighting** for code blocks in the Tiptap rich text editor — style the existing lowlight/highlight.js spans with a tasteful color palette (keywords purple, strings green, comments olive, numbers orange, functions blue, types teal)
10. **All supported lowlight languages** highlighted automatically (lowlight `common` bundle covers \~37 languages)
11. **Light and dark mode** support via CSS variables (`--ns-code-*` in `globals.css`)
12. **Consistent aesthetic** with the CodeMirror code highlight style used in code files — same palette, same CSS variables

## Non-Goals

- **Running/executing code** — out of scope for a note-taking app
- **LSP integration for code files** — no autocomplete, go-to-definition, or diagnostics
- **Custom syntax themes** — uses a single muted chromatic palette; user-configurable themes may come later
- **Adding code files to the** `FileType` **enum** — code files remain `"other"` in the type system; the viewer internally detects whether to use CodeMirror or plain `<pre>` based on file extension

## User Stories

- As a developer, I want to **edit** `.ts`, `.py`, and `.rs` files directly in Notesage so I don't need to switch to another editor for quick changes
- As a developer browsing a project in Notesage, I want code files to render with syntax highlighting so I can quickly scan code structure
- As a user reviewing code referenced in my notes, I want line numbers and code folding so I can navigate large files efficiently
- As a user, I want Cmd+F in a code file to work with CodeMirror's search (match highlighting, regex support) rather than the basic DOM search
- As a user opening a `.txt` or `.log` file, I want the plain text viewer to continue working as before
- As a writer embedding code snippets in my notes, I want code blocks in the WYSIWYG editor to have syntax highlighting so I can visually distinguish keywords, strings, and comments

## Technical Approach

### Part A: Code File Editing

#### Architecture Overview

The existing `SourceModeEditor.tsx` / `SourceEditor.tsx` already implements a full CodeMirror 6 editor for markdown files — with editing, save, dirty tracking, undo/redo, find/replace, Copilot ghost text, and AI bubble menu. The code file editor reuses this proven infrastructure with language-specific configuration instead of markdown.

The change is contained within `PlainTextViewer.tsx` and new utility/component modules. The `PlainTextViewer` component currently handles ALL non-markdown, non-EPUB, non-PDF, non-DOCX text files (the `"other"` file type). The approach:

1. Detect if the file has a known code extension → render with CodeMirror in **editable** mode
2. Unknown extensions → keep the existing `<pre>` rendering unchanged

No changes to `FileType`, `getFileType()`, or `EditorViewerContainer.tsx` are needed. The `PlainTextViewer` component remains the single entry point for `"other"` files.

#### New Module: `src/lib/codemirror-languages.ts`

A language registry that maps file extensions to CodeMirror language packages with lazy loading.

```typescript
// Extension → language mapping with dynamic imports
const LANGUAGE_MAP: Record<string, () => Promise<LanguageSupport>> = {
  js:   () => import("@codemirror/lang-javascript").then(m => m.javascript({ jsx: false })),
  jsx:  () => import("@codemirror/lang-javascript").then(m => m.javascript({ jsx: true })),
  mjs:  () => import("@codemirror/lang-javascript").then(m => m.javascript()),
  ts:   () => import("@codemirror/lang-javascript").then(m => m.javascript({ typescript: true })),
  tsx:  () => import("@codemirror/lang-javascript").then(m => m.javascript({ jsx: true, typescript: true })),
  py:   () => import("@codemirror/lang-python").then(m => m.python()),
  rs:   () => import("@codemirror/lang-rust").then(m => m.rust()),
  go:   () => import("@codemirror/lang-go").then(m => m.go()),
  java: () => import("@codemirror/lang-java").then(m => m.java()),
  c:    () => import("@codemirror/lang-cpp").then(m => m.cpp()),
  h:    () => import("@codemirror/lang-cpp").then(m => m.cpp()),
  cpp:  () => import("@codemirror/lang-cpp").then(m => m.cpp()),
  hpp:  () => import("@codemirror/lang-cpp").then(m => m.cpp()),
  html: () => import("@codemirror/lang-html").then(m => m.html()),
  css:  () => import("@codemirror/lang-css").then(m => m.css()),
  json: () => import("@codemirror/lang-json").then(m => m.json()),
  yaml: () => import("@codemirror/lang-yaml").then(m => m.yaml()),
  yml:  () => import("@codemirror/lang-yaml").then(m => m.yaml()),
  toml: () => import("@codemirror/lang-toml").then(m => m.toml()),
  md:   () => import("@codemirror/lang-markdown").then(m => m.markdown()),
  sh:   () => import("@codemirror/legacy-modes/mode/shell").then(/* StreamLanguage wrapper */),
  bash: () => import("@codemirror/legacy-modes/mode/shell").then(/* StreamLanguage wrapper */),
  zsh:  () => import("@codemirror/legacy-modes/mode/shell").then(/* StreamLanguage wrapper */),
  sql:  () => import("@codemirror/lang-sql").then(m => m.sql()),
  xml:  () => import("@codemirror/lang-xml").then(m => m.xml()),
  swift:() => import("@codemirror/legacy-modes/mode/swift").then(/* StreamLanguage wrapper */),
  kt:   () => import("@codemirror/legacy-modes/mode/clike").then(/* kotlin StreamLanguage wrapper */),
  rb:   () => import("@codemirror/legacy-modes/mode/ruby").then(/* StreamLanguage wrapper */),
  php:  () => import("@codemirror/lang-php").then(m => m.php()),
};

export function getLanguageName(extension: string): string | null { /* ... */ }
export function isCodeFile(fileName: string): boolean { /* ... */ }
export async function loadLanguage(extension: string): Promise<LanguageSupport | null> { /* ... */ }
```

**Language display names** map extensions to human-readable names (e.g., `ts` → `"TypeScript"`, `rs` → `"Rust"`, `py` → `"Python"`).

**Lazy loading strategy:** Each language import is a dynamic `import()` that Vite splits into separate chunks. The first time a user opens a `.py` file, only the Python language package is fetched. Subsequent `.py` files reuse the cached module. Languages that lack a dedicated `@codemirror/lang-*` package use `@codemirror/legacy-modes` with `StreamLanguage` from `@codemirror/language`.

#### New Component: `src/components/editor/viewers/CodeEditor.tsx`

An editable CodeMirror 6 instance for code files. Follows the same patterns as `SourceEditor.tsx` but without markdown/frontmatter handling.

```typescript
interface CodeEditorProps {
  content: string;
  fileName: string;
  filePath: string;
  tabId: string;
  isDirty: boolean;
  updateTabContent: (content: string) => void;
  saveFile: () => void;
}
```

**CodeMirror extensions:**

- `lineNumbers()` — line number gutter
- `foldGutter()` — code folding indicators
- `bracketMatching()` — matching bracket highlight
- `highlightActiveLine()` — subtle active line background
- `highlightSelectionMatches()` — highlight other occurrences of selected text
- `history()` — full undo/redo support
- `keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap])` — standard keybindings
- Cmd+S keymap → calls `saveFile()` prop
- `searchKeymap` — Cmd+F opens CodeMirror's native search panel
- `notesageExtensions` — the existing Notesage CodeMirror theme (from `codemirror-theme.ts`)
- Language extension loaded dynamically based on file extension

**Editing & save pipeline:**

- `EditorView.updateListener` dispatches content changes to `updateTabContent()` — same pattern as `SourceEditor.tsx`
- Cmd+S triggers `saveFile()` which writes via Tauri `write_file` command
- Tab dirty indicator works automatically (editor-store tracks content vs. disk)
- Auto-save on tab switch/blur works via the existing `useFileOperations` hook (watches `tab.content` changes)
- No frontmatter parsing, no Tiptap sync — the CodeMirror document IS the content

**Lifecycle:**

1. On mount: create CodeMirror `EditorState` with content + base extensions (no language yet)
2. Immediately start loading the language package via `loadLanguage(extension)`
3. When the language loads: reconfigure the language compartment to add syntax highlighting
4. On content/fileName change: dispatch a full document replacement and reload the language if the extension changed
5. On unmount: destroy the `EditorView`

**Find in document:** CodeMirror's built-in search panel activates on Cmd+F. The `notesage:find-open` custom event (dispatched by the global keyboard handler) is intercepted and forwarded to `openSearchPanel()` on the CodeMirror view, same pattern as `SourceModeEditor.tsx`. This replaces the DOM-based `FindBar` + `dom-search.ts` approach used by the plain text viewer.

#### Changes to `PlainTextViewer.tsx`

Minimal changes — the component gains a code file detection check:

```typescript
import { isCodeFile } from "@/lib/codemirror-languages";
import { CodeEditor } from "./CodeEditor";

export function PlainTextViewer({ content, fileName, filePath, tabId, isDirty, updateTabContent, saveFile }: PlainTextViewerProps) {
  if (isCodeFile(fileName)) {
    return <CodeEditor content={content} fileName={fileName} filePath={filePath} tabId={tabId} isDirty={isDirty} updateTabContent={updateTabContent} saveFile={saveFile} />;
  }

  // ... existing <pre> rendering unchanged ...
}
```

Props will need to be threaded from `EditorViewerContainer.tsx` through `PlainTextViewer` to `CodeEditor`. The existing save/dirty infrastructure from the editor store and `useFileOperations` handles the rest.

#### Theme Integration

The `CodeEditor` reuses `notesageExtensions` from `src/components/editor/codemirror-theme.ts`, which already:

- Reads CSS variables from `globals.css` for background, foreground, gutters, selection
- Includes dark mode overrides
- Styles the search panel, scrollbars, fold gutter, and bracket matching
- Follows the Notesage greyscale design system

A new code-specific highlight style is needed that goes beyond the existing `notesageHighlightStyle` (which is tuned for markdown source editing). Code content is a semantic exception to the UI-chrome greyscale rule — just like diffs, text highlights, and callout colors. The palette uses muted, desaturated tones (oklch chroma 0.1–0.15) via CSS variables (`--ns-code-*`) that switch automatically between light and dark mode:

- **Keywords:** muted purple (hue 280), semibold
- **Strings:** muted green (hue 155)
- **Comments:** muted olive (hue 110), italic
- **Numbers/constants:** muted orange (hue 55)
- **Functions/definitions:** muted blue (hue 250)
- **Types:** muted teal (hue 195)
- **HTML tags:** muted red (hue 20)
- **Operators/punctuation:** subtle blue-grey

#### Status Bar

The `PlainTextViewer` already renders its own toolbar bar with the file name. For code files, the `CodeEditor` component renders a similar toolbar that additionally shows the detected language name:

```
┌─ main.ts ────────────────────────── TypeScript ─┐
│ 1  import { useState } from "react";             │
│ 2                                                 │
│ 3  export function App() {                        │
```

The language name appears right-aligned in the toolbar, styled as `text-xs text-muted-foreground`.

#### Performance

CodeMirror 6 uses virtual scrolling by default — only visible lines are rendered in the DOM. This handles large files (10K+ lines) efficiently without custom optimization.

**Benchmarks to validate:**

- 10K-line file: initial render &lt; 100ms, smooth scrolling at 60fps
- 50K-line file: initial render &lt; 500ms, no visible lag
- Language package load: &lt; 200ms on first import (varies by language size)

### Part B: WYSIWYG Code Block Highlighting

#### Problem

The Tiptap editor uses `CodeBlockLowlight` with `lowlight` (highlight.js) and the `common` language bundle (\~37 languages). Lowlight correctly parses code and generates semantic `<span>` elements with `.hljs-*` classes (`.hljs-keyword`, `.hljs-string`, `.hljs-comment`, etc.). However, **no CSS rules exist to style these spans**, so all code renders as flat monochrome text.

#### Solution

Add a highlight.js theme in `editor.css` that styles the `.hljs-*` classes using the same muted chromatic palette as the CodeMirror code highlight style — via `--ns-code-*` CSS variables from `globals.css`. No new dependencies needed; lowlight is already configured and working.

#### Highlight Styles

All `.hljs-*` rules reference `--ns-code-*` CSS variables from `globals.css`, which provide light and dark mode values automatically. This is CSS-only — no JavaScript changes to the editor, no new extensions, no new dependencies. The lowlight integration already generates the right DOM; we just need to style it.

#### Visual Consistency

The muted chromatic palette is a semantic content exception to the UI greyscale rule — the same exception used by diff colors, text highlights, and callout backgrounds. The palette is consistent between WYSIWYG code blocks (`.hljs-*` in `editor.css`) and code file editing (`notesageCodeHighlightStyle` in `codemirror-theme.ts`) because both read the same `--ns-code-*` CSS variables:

- **Keywords/builtins:** muted purple, semibold
- **Strings/attributes:** muted green
- **Comments:** muted olive, italic
- **Numbers:** muted orange
- **Functions/definitions:** muted blue
- **Types/classes:** muted teal
- **HTML tags:** muted red
- **Operators/punctuation:** subtle blue-grey

### New Dependencies

CodeMirror language packages to add to `package.json`:

```json
"@codemirror/lang-javascript": "^6.x",
"@codemirror/lang-python": "^6.x",
"@codemirror/lang-rust": "^6.x",
"@codemirror/lang-go": "^6.x",
"@codemirror/lang-java": "^6.x",
"@codemirror/lang-cpp": "^6.x",
"@codemirror/lang-html": "^6.x",
"@codemirror/lang-css": "^6.x",
"@codemirror/lang-json": "^6.x",
"@codemirror/lang-yaml": "^6.x",
"@codemirror/lang-toml": "^6.x",
"@codemirror/lang-sql": "^6.x",
"@codemirror/lang-xml": "^6.x",
"@codemirror/lang-php": "^6.x",
"@codemirror/legacy-modes": "^6.x"
```

Already installed (no change needed): `@codemirror/commands`, `@codemirror/lang-markdown`, `@codemirror/language`, `@codemirror/search`, `@codemirror/state`, `@codemirror/view`.

All language packages are tree-shaken by Vite and only loaded via dynamic `import()` — they add zero bytes to the initial bundle.

No new dependencies needed for Part B — lowlight is already configured.

## UI/UX

### Code File Editor

```
┌─ utils.ts ──────────────── ● ─────── TypeScript ─┐
│ ▾  1  import { invoke } from "@tauri-apps/api";   │
│    2                                               │
│ ▾  3  export async function readFile(              │
│    4    path: string                               │
│    5  ): Promise<string> {                         │
│    6    return invoke("read_file", { path });      │
│    7  }                                            │
│    8                                               │
│ ▾  9  export function getExtension(                │
│   10    fileName: string                           │
│   11  ): string {                                  │
│   12    return fileName.split(".").pop() ?? "";    │
│   13  }                                            │
└────────────────────────────────────────────────────┘
```

- Line numbers in a subtle gutter (matching the existing source editor gutter style)
- Fold markers (`▾`) for foldable blocks (functions, classes, imports)
- Active line has a subtle background highlight
- Bracket matching highlighted when cursor is adjacent
- Muted chromatic syntax highlighting — keywords purple, strings green, comments olive italic, functions blue
- Dirty indicator (●) in toolbar when file has unsaved changes
- No max-width constraint — code files use the full available width (unlike the 720px editor)
- Horizontal scrolling for long lines (no word wrap by default)
- Full editing: type, paste, undo/redo, select, delete — standard code editor behavior
- Cmd+S saves to disk

### WYSIWYG Code Block Highlighting

Code blocks in the rich text editor gain muted chromatic syntax highlighting:

```
┌─ Markdown Note ─────────────────────────────────────┐
│                                                      │
│  Here's an example function:                         │
│                                                      │
│  ┌─────────────────────────────────────────────┐     │
│  │ function greet(name: string) {              │     │
│  │   const msg = `Hello, ${name}!`;            │     │
│  │   // Log the greeting                       │     │
│  │   console.log(msg);                         │     │
│  │   return 42;                                │     │
│  │ }                                           │     │
│  └─────────────────────────────────────────────┘     │
│                                                      │
│  The function returns a number.                      │
│                                                      │
└──────────────────────────────────────────────────────┘
```

In the code block above:

- `function`, `const`, `return` — **muted purple, semibold** (keywords)
- `"Hello, ${name}!"` — **muted green** (strings)
- `// Log the greeting` — **muted olive, italic** (comments)
- `42` — **muted orange** (numbers)
- `greet`, `console.log` — **muted blue** (functions)

The colors are deliberately desaturated (oklch chroma 0.1–0.15) to add structure without competing with the document's content.

### Find in Document (Cmd+F)

CodeMirror's native search panel appears at the top of the code editor:

- Input field with match count ("3 of 12")
- Previous/next navigation buttons
- Case sensitivity and regex toggles
- All matches highlighted; current match distinguished
- Escape closes the search panel

This replaces the custom `FindBar` component used by the plain `<pre>` viewer. The CodeMirror search panel is already styled by `notesageExtensions` (`.cm-panels`, `.cm-textfield`, `.cm-button`, `.cm-searchMatch` rules).

### Plain Text Fallback

Files without a recognized code extension (`.txt`, `.log`, unknown) render exactly as they do today:

- No line numbers, no gutter
- Max-width 720px centered layout
- Custom `FindBar` with DOM-based search
- Monospace font, wrapped text

### Theme Behavior

- Light mode: light background, dark text, subtle grey gutters
- Dark mode: dark background, light text, same gutter style
- Contrast slider: CodeMirror reads CSS variables, so contrast adjustments apply automatically
- Theme transitions: smooth color transitions via CSS variable changes (already handled by `notesageExtensions`)
- WYSIWYG code blocks: `.hljs-*` styles use oklch with light/dark mode variants

## Data Model

No new stores, no persistence changes. The `CodeEditor` uses the existing tab content and dirty tracking from `editor-store` — same as `SourceModeEditor`. The WYSIWYG highlighting is pure CSS with no state.

### New Files

| File | Purpose |
| --- | --- |
| `src/lib/codemirror-languages.ts` | Extension → language mapping, lazy loader, language name resolver |
| `src/components/editor/viewers/CodeEditor.tsx` | Editable CodeMirror 6 code editor component |

### Modified Files

| File | Change |
| --- | --- |
| `src/components/editor/viewers/PlainTextViewer.tsx` | Add `isCodeFile()` check to conditionally render `CodeEditor`; thread save/edit props |
| `src/components/editor/EditorViewerContainer.tsx` | Pass save/edit props through to `PlainTextViewer` for code file editing |
| `src/components/editor/codemirror-theme.ts` | Add a code-specific highlight style (the existing one is markdown-tuned) |
| `src/styles/editor.css` | Add `.hljs-*` muted chromatic theme rules for WYSIWYG code block highlighting |
| `docs/features/document-formats.md` | Document the code editor feature |
| `docs/features/editor.md` | Note code file editing and WYSIWYG code block highlighting |

### Unchanged Files

| File | Why unchanged |
| --- | --- |
| `src/lib/file-utils.ts` | `FileType` stays the same — code files are still `"other"` |
| `src/stores/editor-store.ts` | No new tab properties needed — existing content/dirty tracking works |
| `src/hooks/useEditor.ts` | CodeBlockLowlight already configured with lowlight; no JS changes needed |
| `src/lib/dom-search.ts` | Still used by DOCX viewer and plain text fallback |

## Dependencies

- **New (Part A):** 14 CodeMirror language packages + `@codemirror/legacy-modes` (all lazy-loaded, zero initial bundle impact)
- **Existing:** `@codemirror/view`, `@codemirror/state`, `@codemirror/language`, `@codemirror/commands`, `@codemirror/search` (already installed)
- **Existing:** `codemirror-theme.ts` (reused for styling)
- **No new deps (Part B):** lowlight + CodeBlockLowlight already installed and configured
- No new Tauri commands needed
- No new Rust dependencies

## Quality Gates

### Functional — Part A (Code File Editing)

- [ ] 22+ languages highlighted correctly (JavaScript, TypeScript, Python, Rust, Go, Java, C, C++, HTML, CSS, JSON, YAML, TOML, Markdown, Shell, SQL, XML, Swift, Kotlin, Ruby, PHP, JSX/TSX)

- [ ] Line numbers visible and correctly numbered

- [ ] Code folding works (collapse/expand functions, classes, blocks)

- [ ] Bracket matching highlights corresponding brackets

- [ ] Active line has subtle background highlight

- [ ] Cmd+F opens CodeMirror search panel with match highlighting

- [ ] Search supports case sensitivity toggle and regex

- [ ] **Editing works** — can type, paste, delete, undo/redo in code files

- [ ] **Cmd+S saves** code files to disk

- [ ] **Dirty indicator** appears when code file has unsaved changes

- [ ] **Auto-save on tab switch** works for code files

- [ ] Large files (&gt;10K lines) render without visible lag

- [ ] 50K-line files scroll smoothly at 60fps

- [ ] Unknown file extensions (`.txt`, `.log`, etc.) still render as plain text with the existing `<pre>` viewer

- [ ] Language name displayed in the toolbar for recognized code files

- [ ] No language indicator shown for plain text fallback files

- [ ] Content updates correctly when switching between tabs with different code files

### Functional — Part B (WYSIWYG Code Blocks)

- [x] Code blocks in the rich text editor show muted chromatic syntax highlighting

- [x] Keywords render in muted purple, semibold

- [x] Strings render in muted green

- [x] Comments render in muted olive, italic

- [x] Numbers render in muted orange

- [x] Functions/definitions render in muted blue

- [ ] Highlighting works for all languages in the lowlight `common` bundle

- [ ] Highlighting persists through edit operations (typing in code block, adding/removing lines)

- [ ] No visual change to code blocks without a language specified (plain code blocks stay unstyled)

### Design

- [x] Syntax highlighting uses a muted chromatic palette via `--ns-code-*` CSS variables

- [ ] Part A gutter styling matches the existing source mode editor

- [ ] Part B code block highlighting is tasteful — muted colors don't compete with document content

- [ ] Looks polished in both light and dark mode (both parts)

- [ ] Contrast slider affects the code editor correctly

- [ ] Code files use full available width (no 720px max-width constraint)

- [ ] Scrollbars are thin and styled (not browser default)

- [ ] Font matches the editor monospace font (JetBrains Mono / SF Mono / Fira Code)

- [x] Part A and Part B highlighting feel visually consistent (same `--ns-code-*` variables)

### Testing

- [ ] Unit tests for `codemirror-languages.ts` — extension mapping, language name resolution, `isCodeFile()` for all supported extensions

- [ ] Unit tests for unknown extensions returning `null` / `false`

- [ ] Component test for `CodeEditor` — renders with line numbers, supports editing

- [ ] Component test for `PlainTextViewer` — code files route to `CodeEditor`, plain text files render `<pre>`

- [ ] All existing tests continue to pass

- [ ] TypeScript type check passes

### Performance

- [ ] Language packages are lazy-loaded (verified via network tab — no language JS loaded until a code file is opened)

- [ ] Initial app bundle size does not increase (language packages are separate chunks)

- [ ] 10K-line file renders in &lt; 100ms

- [ ] No memory leaks from CodeMirror view lifecycle (create/destroy on tab switch)

## Out of Scope

- **LSP features** — no autocomplete, diagnostics, hover tooltips, or go-to-definition for code files
- **Custom syntax themes** — uses a single muted chromatic palette; user-configurable themes may come later
- **Minimap** — adds complexity for minimal benefit
- **Git blame/annotations in gutter** — future enhancement, not part of this PRD
- **Word wrap toggle** — code files default to horizontal scrolling; a toggle could be added later
- **Printing/PDF export of code files** — out of scope
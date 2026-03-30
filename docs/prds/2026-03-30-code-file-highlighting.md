# PRD: Code File Syntax Highlighting

|  |  |
| --- | --- |
| **Date** | 2026-03-30 |
| **Status** | Draft |
| **Priority** | High |
| **Impact** | Code files render with syntax highlighting, line numbers, and code navigation — matching developer expectations |
| **Research** | [document-format-enhancements](../research/2026-03-30-document-format-enhancements.md) |
| **Tasks** | [code-file-highlighting-tasks](../tasks/2026-03-30-code-file-highlighting-tasks.md) |

## Problem

Opening code files (`.js`, `.py`, `.rs`, `.ts`, `.go`, etc.) in Notesage renders them as unstyled monospace text in a `<pre>` element via `PlainTextViewer.tsx`. This is a poor experience for developers who expect syntax highlighting, line numbers, code folding, and bracket matching — features available in every code editor and many note-taking apps. The current plain text rendering makes Notesage feel broken when browsing code files in a project.

## Goals

1. **Syntax highlighting** for 22+ programming languages using CodeMirror 6 in read-only mode
2. **Code navigation** — line numbers, code folding, bracket matching, active line highlight
3. **Find in document** via CodeMirror's built-in search (replacing the current DOM-based search for code files)
4. **Theme integration** — light/dark mode and contrast slider work seamlessly using the existing `notesageExtensions` CodeMirror theme
5. **Lazy loading** — language packages loaded on demand, not bundled at startup
6. **Graceful fallback** — unknown file extensions retain the existing plain `<pre>` rendering
7. **Status bar language indicator** — detected language name shown in the toolbar

## Non-Goals

- **Editing code files** — this is a read-only viewer, not a code editor. Source mode editing of markdown files already exists via `SourceEditor.tsx`.
- **Running/executing code** — out of scope for a note-taking app
- **LSP integration for code files** — no autocomplete, go-to-definition, or diagnostics
- **Custom syntax themes** — uses the existing Notesage CodeMirror theme (monochrome greyscale)
- **Adding code files to the `FileType` enum** — code files remain `"other"` in the type system; the viewer internally detects whether to use CodeMirror or plain `<pre>` based on file extension

## User Stories

- As a developer browsing a project in Notesage, I want `.ts` and `.py` files to render with syntax highlighting so I can quickly scan code structure
- As a user reviewing code referenced in my notes, I want line numbers and code folding so I can navigate large files efficiently
- As a user, I want Cmd+F in a code file to work with CodeMirror's search (match highlighting, regex support) rather than the basic DOM search
- As a user opening a `.txt` or `.log` file, I want the plain text viewer to continue working as before

## Technical Approach

### Architecture Overview

The change is contained within `PlainTextViewer.tsx` and a new utility module. The `PlainTextViewer` component currently handles ALL non-markdown, non-EPUB, non-PDF, non-DOCX text files (the `"other"` file type). The approach:

1. Detect if the file has a known code extension → render with CodeMirror in read-only mode
2. Unknown extensions → keep the existing `<pre>` rendering unchanged

No changes to `FileType`, `getFileType()`, `EditorViewerContainer.tsx`, or the editor store are needed. The `PlainTextViewer` component remains the single entry point for `"other"` files.

### New Module: `src/lib/codemirror-languages.ts`

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

### New Component: `src/components/editor/viewers/CodeViewer.tsx`

A read-only CodeMirror 6 instance for code files.

```typescript
interface CodeViewerProps {
  content: string;
  fileName: string;
}
```

**CodeMirror extensions:**

- `EditorState.readOnly.of(true)` — prevents editing
- `EditorView.editable.of(false)` — removes cursor and input handling
- `lineNumbers()` — line number gutter
- `foldGutter()` — code folding indicators
- `bracketMatching()` — matching bracket highlight
- `highlightActiveLine()` — subtle active line background
- `highlightSelectionMatches()` — highlight other occurrences of selected text
- `searchKeymap` — Cmd+F opens CodeMirror's native search panel
- `notesageExtensions` — the existing Notesage CodeMirror theme (from `codemirror-theme.ts`)
- Language extension loaded dynamically based on file extension

**Lifecycle:**

1. On mount: create CodeMirror `EditorState` with content + base extensions (no language yet)
2. Immediately start loading the language package via `loadLanguage(extension)`
3. When the language loads: reconfigure the language compartment to add syntax highlighting
4. On content/fileName change: dispatch a full document replacement and reload the language if the extension changed
5. On unmount: destroy the `EditorView`

**Find in document:** CodeMirror's built-in search panel activates on Cmd+F. The `notesage:find-open` custom event (dispatched by the global keyboard handler) is intercepted and forwarded to `openSearchPanel()` on the CodeMirror view, same pattern as `SourceModeEditor.tsx`. This replaces the DOM-based `FindBar` + `dom-search.ts` approach used by the plain text viewer.

### Changes to `PlainTextViewer.tsx`

Minimal changes — the component gains a code file detection check:

```typescript
import { isCodeFile } from "@/lib/codemirror-languages";
import { CodeViewer } from "./CodeViewer";

export function PlainTextViewer({ content, fileName }: PlainTextViewerProps) {
  if (isCodeFile(fileName)) {
    return <CodeViewer content={content} fileName={fileName} />;
  }

  // ... existing <pre> rendering unchanged ...
}
```

This keeps the change surface minimal and maintains backward compatibility for `.txt`, `.log`, and unknown extensions.

### Theme Integration

The `CodeViewer` reuses `notesageExtensions` from `src/components/editor/codemirror-theme.ts`, which already:

- Reads CSS variables from `globals.css` for background, foreground, gutters, selection
- Includes dark mode overrides
- Styles the search panel, scrollbars, fold gutter, and bracket matching
- Follows the Notesage greyscale design system

A new code-specific highlight style is needed that goes beyond the existing `notesageHighlightStyle` (which is tuned for markdown source editing). The code highlight style should use weight and subtle neutral tones to differentiate:

- **Keywords:** semibold, foreground color
- **Strings:** slightly muted (e.g., `oklch(55% 0 0)` light / `oklch(72% 0 0)` dark)
- **Comments:** muted, italic
- **Numbers/constants:** regular weight, slightly different grey
- **Functions/definitions:** semibold
- **Types:** medium weight
- **Operators/punctuation:** muted

All highlight colors remain greyscale (zero chroma) to match the design system. No blue, green, or colored syntax highlighting.

### Status Bar

The `PlainTextViewer` already renders its own toolbar bar with the file name. For code files, the `CodeViewer` component renders a similar toolbar that additionally shows the detected language name:

```
┌─ main.ts ────────────────────────── TypeScript ─┐
│ 1  import { useState } from "react";             │
│ 2                                                 │
│ 3  export function App() {                        │
```

The language name appears right-aligned in the toolbar, styled as `text-xs text-muted-foreground`.

### Performance

CodeMirror 6 uses virtual scrolling by default — only visible lines are rendered in the DOM. This handles large files (10K+ lines) efficiently without custom optimization. The read-only mode further reduces overhead by disabling input handling, undo history, and change tracking.

**Benchmarks to validate:**

- 10K-line file: initial render < 100ms, smooth scrolling at 60fps
- 50K-line file: initial render < 500ms, no visible lag
- Language package load: < 200ms on first import (varies by language size)

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

## UI/UX

### Code File View

```
┌─ utils.ts ───────────────────────── TypeScript ─┐
│ ▾  1  import { invoke } from "@tauri-apps/api";  │
│    2                                              │
│ ▾  3  export async function readFile(             │
│    4    path: string                              │
│    5  ): Promise<string> {                        │
│    6    return invoke("read_file", { path });     │
│    7  }                                           │
│    8                                              │
│ ▾  9  export function getExtension(               │
│   10    fileName: string                          │
│   11  ): string {                                 │
│   12    return fileName.split(".").pop() ?? "";   │
│   13  }                                           │
└───────────────────────────────────────────────────┘
```

- Line numbers in a subtle gutter (matching the existing source editor gutter style)
- Fold markers (`▾`) for foldable blocks (functions, classes, imports)
- Active line has a subtle background highlight
- Bracket matching highlighted when cursor is adjacent
- Greyscale syntax highlighting — keywords bold, comments muted/italic, strings slightly dimmed
- No max-width constraint — code files use the full available width (unlike the 720px editor)
- Horizontal scrolling for long lines (no word wrap by default)

### Find in Document (Cmd+F)

CodeMirror's native search panel appears at the top of the editor:

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

## Data Model

No new stores, no persistence changes. The `CodeViewer` is purely a rendering component — it receives `content` and `fileName` as props, creates a local CodeMirror instance, and renders it. No state escapes the component.

### New Files

| File | Purpose |
| --- | --- |
| `src/lib/codemirror-languages.ts` | Extension → language mapping, lazy loader, language name resolver |
| `src/components/editor/viewers/CodeViewer.tsx` | Read-only CodeMirror 6 viewer component |

### Modified Files

| File | Change |
| --- | --- |
| `src/components/editor/viewers/PlainTextViewer.tsx` | Add `isCodeFile()` check to conditionally render `CodeViewer` |
| `src/components/editor/codemirror-theme.ts` | Add a code-specific highlight style (the existing one is markdown-tuned) |
| `docs/features/document-formats.md` | Document the code viewer feature |
| `docs/features/editor.md` | Note code file support in the editor features list |

### Unchanged Files

| File | Why unchanged |
| --- | --- |
| `src/lib/file-utils.ts` | `FileType` stays the same — code files are still `"other"` |
| `src/components/editor/EditorViewerContainer.tsx` | Still routes `"other"` to `PlainTextViewer` |
| `src/stores/editor-store.ts` | No new tab properties needed |
| `src/lib/dom-search.ts` | Still used by DOCX viewer and plain text fallback |

## Dependencies

- **New:** 14 CodeMirror language packages + `@codemirror/legacy-modes` (all lazy-loaded, zero initial bundle impact)
- **Existing:** `@codemirror/view`, `@codemirror/state`, `@codemirror/language`, `@codemirror/commands`, `@codemirror/search` (already installed)
- **Existing:** `codemirror-theme.ts` (reused for styling)
- No new Tauri commands needed
- No new Rust dependencies

## Quality Gates

### Functional

- [ ] 22+ languages highlighted correctly (JavaScript, TypeScript, Python, Rust, Go, Java, C, C++, HTML, CSS, JSON, YAML, TOML, Markdown, Shell, SQL, XML, Swift, Kotlin, Ruby, PHP, JSX/TSX)
- [ ] Line numbers visible and correctly numbered
- [ ] Code folding works (collapse/expand functions, classes, blocks)
- [ ] Bracket matching highlights corresponding brackets
- [ ] Active line has subtle background highlight
- [ ] Cmd+F opens CodeMirror search panel with match highlighting
- [ ] Search supports case sensitivity toggle and regex
- [ ] Large files (>10K lines) render without visible lag
- [ ] 50K-line files scroll smoothly at 60fps
- [ ] Unknown file extensions (`.txt`, `.log`, etc.) still render as plain text with the existing `<pre>` viewer
- [ ] Language name displayed in the toolbar for recognized code files
- [ ] No language indicator shown for plain text fallback files
- [ ] Content updates correctly when switching between tabs with different code files

### Design

- [ ] Syntax highlighting uses greyscale only — no chromatic colors
- [ ] Gutter styling matches the existing source mode editor
- [ ] Looks polished in both light and dark mode
- [ ] Contrast slider affects the code viewer correctly
- [ ] Search panel styling is consistent with the source mode editor
- [ ] Code files use full available width (no 720px max-width constraint)
- [ ] Scrollbars are thin and styled (not browser default)
- [ ] Font matches the editor monospace font (JetBrains Mono / SF Mono / Fira Code)

### Testing

- [ ] Unit tests for `codemirror-languages.ts` — extension mapping, language name resolution, `isCodeFile()` for all supported extensions
- [ ] Unit tests for unknown extensions returning `null` / `false`
- [ ] Component test for `CodeViewer` — renders with line numbers, applies read-only mode
- [ ] Component test for `PlainTextViewer` — code files route to `CodeViewer`, plain text files render `<pre>`
- [ ] All existing tests continue to pass
- [ ] TypeScript type check passes

### Performance

- [ ] Language packages are lazy-loaded (verified via network tab — no language JS loaded until a code file is opened)
- [ ] Initial app bundle size does not increase (language packages are separate chunks)
- [ ] 10K-line file renders in < 100ms
- [ ] No memory leaks from CodeMirror view lifecycle (create/destroy on tab switch)

## Out of Scope

- **Code editing** — files opened as `"other"` are read-only; source mode editing is for markdown only
- **LSP features** — no autocomplete, diagnostics, hover tooltips, or go-to-definition for code files
- **Custom syntax themes** — the greyscale theme is consistent with the design system; user-configurable themes may come later
- **Minimap** — adds complexity for minimal benefit in a read-only viewer
- **Git blame/annotations in gutter** — future enhancement, not part of this PRD
- **Word wrap toggle** — code files default to horizontal scrolling; a toggle could be added later
- **Printing/PDF export of code files** — out of scope for the viewer

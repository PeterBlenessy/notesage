# PRD: Document Format Support

**Date:** 2026-02-24 **Phase:** 7a — Multi-Format Documents **Status:** ✅ Complete (v0.16.0)

## Problem

Notesage currently treats every file as markdown text. This creates three gaps:

1. **No source mode** — Users cannot view or edit the raw markdown behind the WYSIWYG rendering. Power users and developers need to inspect/fix markdown directly, and AI features (completions, send-to-AI) should work in source mode too.
2. **No document viewing** — PDFs, Word documents, and other common formats cannot be opened. Users working with mixed-format projects (research notes + reference PDFs + shared .docx files) must leave Notesage to read them.
3. **Broken images** — The editor's Image extension accepts only remote URLs via `window.prompt()`. Local images (relative paths in markdown, pasted images, drag-dropped files) don't render because Tauri's asset protocol is not configured. This is a bug in core functionality.
4. **No document import** — Users receiving .docx/.pptx/.odt files cannot convert them to markdown for editing in Notesage.

## Goals

1. **Source mode toggle** — Switch between WYSIWYG and raw markdown editing with CodeMirror, with Copilot completions and AI text actions working in both modes
2. **PDF viewing** — Open and navigate PDF files inline in a tab using pdf.js
3. **DOCX support** — View Word documents with high fidelity (docx-preview) and import to markdown (mammoth.js)
4. **Document import** — Convert .pptx, .odt, .odp files to markdown
5. **Fix local images** — Configure Tauri asset protocol so images with local/relative paths render correctly

## Non-Goals

- Editing PDFs, DOCX, or other non-markdown formats (view and import only)
- PPTX/ODT/ODP viewing (import to markdown only — no faithful viewer libraries exist)
- Full parity of all WYSIWYG features in source mode (comments/decorations are WYSIWYG-only; completions and AI actions carry over)
- Image editing, cropping, or annotation
- Drag-and-drop image embedding with automatic file copying (future enhancement)

## User Stories

### Source Mode

- As a power user, I want to toggle to raw markdown view so that I can inspect and fix formatting issues directly
- As a writer, I want Copilot completions to work in source mode so that I get AI assistance regardless of editing mode
- As a user, I want to select text in source mode and send it to AI (improve, expand, summarize) so that AI features aren't limited to WYSIWYG

### PDF Viewing

- As a researcher, I want to open a PDF in a Notesage tab so that I can reference it alongside my notes without switching apps
- As a user, I want to scroll, zoom, and navigate pages in a PDF viewer so that I can read documents comfortably

### DOCX Support

- As a user, I want to preview a .docx file in a Notesage tab so that I can read Word documents without opening another app
- As a writer, I want to import a .docx file as markdown so that I can continue editing it in Notesage

### Document Import

- As a user, I want to convert a .pptx presentation to markdown so that I can extract its text content into my notes
- As a user, I want to import .odt/.odp files as markdown so that I can work with OpenDocument content

### Local Images

- As a writer, I want images with relative paths (e.g., `![photo](./images/photo.png)`) to render in the editor so that my markdown documents display correctly
- As a user, I want to insert images by picking a local file so that I don't need to host images online

## Technical Approach

### Part 1: Fix Local Images (Bug Fix)

**Tauri asset protocol:**

Configure the Tauri asset protocol in `tauri.conf.json` so the webview can serve local files:

```json
{
  "app": {
    "security": {
      "assetProtocol": {
        "enable": true,
        "scope": ["**"]
      }
    }
  }
}
```

Add the `asset-protocol-scope` permission in capabilities.

**Image URL resolution:**

When the Tiptap Image extension renders, resolve image `src` attributes:

- Absolute URLs (`https://...`) — pass through unchanged
- Relative paths (`./images/photo.png`, `images/photo.png`) — resolve against the document's directory, convert to `asset://localhost/` URL
- Absolute file paths (`/Users/.../photo.png`) — convert to `asset://localhost/` URL

This resolution happens in a custom Image extension override or a ProseMirror plugin that transforms node attributes on render.

**Image insertion improvement:**

Replace `window.prompt("Image URL")` with a proper dialog offering:

- URL input (existing behavior)
- Local file picker (via Tauri `open` dialog filtered to image types)

When a local file is selected, store the path relative to the document directory in markdown (e.g., `![alt](./images/photo.png)`).

### Part 2: Source Mode (CodeMirror)

**New dependency:** `@codemirror/view`, `@codemirror/state`, `@codemirror/lang-markdown`, `@codemirror/theme-one-dark` (or a custom neutral theme matching Notesage's palette).

**Editor mode toggle:**

Add a `viewMode` field to the `Tab` interface: `'wysiwyg' | 'source'` (default: `'wysiwyg'`, non-persisted).

Toggle via:

- Keyboard shortcut: `Cmd+/` (toggle source mode)
- Toolbar button (code icon)

**Mode switching flow:**

1. WYSIWYG → Source: serialize Tiptap to markdown string → pass to CodeMirror
2. Source → WYSIWYG: take CodeMirror text → parse to ProseMirror doc → load into Tiptap
3. If parsing fails (malformed markdown), show toast and stay in source mode
4. Dirty state tracked normally — edits in either mode mark the tab dirty

**CodeMirror integration:**

New component: `SourceEditor.tsx`

- Renders CodeMirror instance with markdown syntax highlighting
- Monospace font (JetBrains Mono, matching code blocks)
- Theme matching Notesage's light/dark palette (neutral greys, no chromatic colors)
- Same max-width (720px) and centered layout as WYSIWYG mode
- Line numbers, active line highlight, bracket matching

**AI features in source mode:**

- **Copilot completions:** The LSP already works with plain text positions. `useCopilotCompletion` sends `didChange` with CodeMirror's text content and requests completions at cursor position. Ghost text rendered as a CodeMirror decoration (widget or inline) instead of ProseMirror decoration.
- **AI text actions:** When text is selected in CodeMirror, show a context menu or floating toolbar with Improve / Expand / Summarize. These call `useAIOperations.generateText()` with the selected text, then replace the selection with the result. Same backend path — just different editor surface.
- **Comments:** Not supported in source mode (comments are ProseMirror decorations tied to document structure). If the document has comments, they remain in the Tiptap model and reappear when switching back to WYSIWYG.

**Conditional rendering in Editor.tsx:**

```tsx
if (activeTab.viewMode === 'source') {
  return <SourceEditor content={markdown} onChange={handleSourceChange} />;
}
return <EditorContent editor={editor} />;
```

### Part 3: Multi-Format Tab Rendering

**File type detection:**

Extend the `Tab` interface with a `fileType` field:

```typescript
type FileType = 'markdown' | 'pdf' | 'docx' | 'image' | 'other';

interface Tab {
  // ... existing fields
  fileType: FileType;
  viewMode?: 'wysiwyg' | 'source'; // only for markdown
  binaryData?: number[];            // for binary files (PDF, DOCX)
}
```

Determine `fileType` from the file extension when opening a file.

**New Tauri command:** `read_binary_file`

```rust
#[tauri::command]
async fn read_binary_file(path: String) -> Result<Vec<u8>, String>
```

Needed because the existing `read_file` command reads as UTF-8 text, which corrupts binary files.

**File opening routing (in** `useFileOperations.openFile`**):**

```
.md        → read as text   → fileType: 'markdown' → Tiptap editor
.pdf       → read as binary → fileType: 'pdf'      → PDF viewer
.docx      → read as binary → fileType: 'docx'     → DOCX viewer
.png/.jpg  → fileType: 'image'                      → Image viewer (simple <img> via asset protocol)
other      → read as text   → fileType: 'other'     → read-only plain text view
```

**Editor area routing (in Editor.tsx or a new parent component):**

```tsx
switch (activeTab.fileType) {
  case 'markdown':
    return activeTab.viewMode === 'source'
      ? <SourceEditor ... />
      : <TiptapEditor ... />;
  case 'pdf':
    return <PdfViewer data={activeTab.binaryData} />;
  case 'docx':
    return <DocxViewer data={activeTab.binaryData} onImport={handleImport} />;
  case 'image':
    return <ImageViewer path={activeTab.filePath} />;
  default:
    return <PlainTextViewer content={activeTab.content} />;
}
```

### Part 4: PDF Viewer

**New dependency:** `pdfjs-dist` (Mozilla's pdf.js)

**Component:** `PdfViewer.tsx`

- Receives binary data (or file path via asset protocol)
- Renders pages to canvas elements in a scroll container
- Controls: page navigation (prev/next, page number input), zoom (+/- buttons, fit-width/fit-page), scroll position
- Toolbar at top of viewer area (not in the main app toolbar)
- Read-only — no editing, annotation, or form filling
- Keyboard: arrow keys for page nav, +/- for zoom

**Implementation:**

- Use pdf.js worker for off-thread rendering
- Render visible pages + 1 ahead/behind (virtual scrolling for large PDFs)
- Respect light/dark theme for viewer chrome (toolbar, background)

### Part 5: DOCX Viewer + Import

**New dependencies:** `docx-preview` (viewing), `mammoth` (import)

**Component:** `DocxViewer.tsx`

- Renders DOCX using `docx-preview`'s `renderAsync()` into a container div
- Read-only — faithful rendering of formatting, tables, images, colors
- Import button in viewer toolbar: "Convert to Markdown"
- Import uses `mammoth.js` to convert DOCX → HTML → markdown
- On import: creates new `.md` file alongside the original (e.g., `document.docx` → `document.md`), opens it in a new tab

**Import flow:**

1. User clicks "Convert to Markdown" in DOCX viewer toolbar
2. mammoth.js converts binary data → HTML
3. Convert HTML → markdown (use a lightweight HTML-to-markdown converter, or Tiptap's own HTML parsing → serialize to markdown)
4. Show save dialog with suggested filename
5. Write markdown file to disk
6. Open the new file in a tab

### Part 6: Document Import (PPTX, ODT, ODP)

**Approach:** Rust-side conversion using available crates, or lightweight JS extraction.

**PPTX → Markdown:**

- Extract slide text content, titles, and speaker notes
- Map to markdown: each slide becomes a heading + bullet points
- Images and charts described as placeholders (`[Slide image: chart title]`)

**ODT → Markdown:**

- Similar to DOCX — XML-based format with text structure
- Extract headings, paragraphs, lists, tables
- Use a lightweight parser (odt content is zipped XML)

**ODP → Markdown:**

- Same approach as PPTX — extract slide text structure

**Import trigger:**

- Right-click context menu on supported files in sidebar: "Import as Markdown"
- Also available when opening a non-viewable format: show a prompt offering import

**Supported extensions:**

| Extension | View | Import to MD |
| --- | --- | --- |
| `.md` | Edit (WYSIWYG + Source) | — |
| `.pdf` | View (pdf.js) | No |
| `.docx` | View (docx-preview) + Import (mammoth.js) | Yes |
| `.pptx` | Import only | Yes |
| `.odt` | Import only | Yes |
| `.odp` | Import only | Yes |
| `.png/.jpg/.gif/.svg/.webp` | View (asset protocol) | No |
| Other text files | Read-only plain text | No |

## UI/UX

### Source Mode Toggle

- Toolbar icon: `Code` (lucide-react) in the top toolbar, next to existing controls
- Active state: icon highlighted when in source mode
- Transition: smooth crossfade between WYSIWYG and CodeMirror (150ms opacity transition)
- Status bar shows current mode: "WYSIWYG" or "Source"
- CodeMirror styled to match Notesage palette — neutral greys, no syntax highlighting colors beyond the greyscale palette (strings and keywords can use slightly different grey weights)

### PDF Viewer

- Full-width rendering (no 720px max-width — PDFs have their own layout)
- Viewer toolbar: `[< Page 3 of 12 >] [- 100% +] [Fit Width | Fit Page]`
- Dark mode: dark background around pages, pages remain white (standard PDF viewer behavior)
- Loading state: skeleton placeholder while pages render

### DOCX Viewer

- Rendered content in a scroll container, similar to how the document looks in Word
- Toolbar: `[Convert to Markdown]` button on the right
- Content respects its own styling (docx-preview handles this)
- Wrapper background matches Notesage theme

### Document Import

- Context menu: "Import as Markdown" on supported file types
- Progress toast during conversion
- On completion: toast with "Imported — opened document.md" + opens the new file

### Image Insertion Dialog

- Replace `window.prompt()` with a proper dialog
- Two tabs: "URL" (text input) and "Local File" (file picker button + preview)
- Alt text input field
- Preview of selected image before insertion

### Tab Indicators

- Tabs show file-type-appropriate icons: `FileText` for .md, `FileImage` for images, `FileType` for PDF, `FileSpreadsheet` for DOCX
- Source mode tabs show a small code indicator overlay

## Data Model

### Tab Interface Changes

```typescript
type FileType = 'markdown' | 'pdf' | 'docx' | 'image' | 'other';
type ViewMode = 'wysiwyg' | 'source';

interface Tab {
  id: string;
  filePath: string;
  fileName: string;
  isDirty: boolean;
  content: string;                  // text content (markdown, plain text)
  frontmatter: Frontmatter | null;
  fileType: FileType;               // NEW: determined from extension
  viewMode?: ViewMode;              // NEW: only for markdown tabs
  copilotDisabled?: boolean;
}
```

Binary file data (PDF, DOCX) is NOT stored in the tab — it's loaded on demand and passed directly to the viewer component. This keeps the Zustand store lightweight.

### New Tauri Commands

```rust
#[tauri::command]
async fn read_binary_file(path: String) -> Result<Vec<u8>, String>

#[tauri::command]
async fn convert_docx_to_html(data: Vec<u8>) -> Result<String, String>
// Optional: if we want Rust-side conversion for PPTX/ODT

#[tauri::command]
async fn resolve_asset_path(base_dir: String, relative_path: String) -> Result<String, String>
// Resolves relative image paths to absolute paths for asset protocol
```

### Settings Store Addition

```typescript
// In settings-store.ts
interface Settings {
  // ... existing
  defaultViewMode: ViewMode;  // User preference for default editor mode
}
```

## Dependencies

| Package | Purpose | Size |
| --- | --- | --- |
| `@codemirror/view` | CodeMirror editor view | \~100KB |
| `@codemirror/state` | CodeMirror state management | \~30KB |
| `@codemirror/lang-markdown` | Markdown syntax highlighting | \~15KB |
| `@codemirror/language` | Language support infrastructure | \~40KB |
| `pdfjs-dist` | PDF rendering | \~400KB (with worker) |
| `docx-preview` | DOCX rendering | \~80KB |
| `mammoth` | DOCX → HTML conversion | \~60KB |

**Total new JS dependencies:** \~725KB (before tree-shaking)

No new Rust crate dependencies required for Part 1-5. PPTX/ODT import (Part 6) may need Rust crates for XML/ZIP parsing if JS libraries are insufficient.

## Implementation Order

1. **Fix local images** (Part 1) — Bug fix, unblocks image use, small scope
2. **Source mode** (Part 2) — Most requested, highest value
3. **Multi-format tab routing** (Part 3) — Infrastructure for Parts 4-6
4. **PDF viewer** (Part 4) — High value, standalone
5. **DOCX viewer + import** (Part 5) — High value, depends on Part 3
6. **Document import** (Part 6) — Lower priority, incremental

## Quality Gates

### Functional

- [x]Local images with relative paths render in the editor

- [x]Images with absolute file paths render in the editor

- [x]Remote URL images continue to work unchanged

- [x]Image insertion offers both URL and local file picker

- [x]Source mode toggle preserves document content (no data loss on switch)

- [x]Copilot ghost text completions work in source mode

- [x]AI text actions (improve, expand, summarize) work on selected text in source mode

- [x]PDF files open in a viewer tab with page navigation and zoom

- [x]DOCX files render with formatting preserved (colors, tables, fonts)

- [x]DOCX import produces clean markdown with headings, lists, and tables

- [x]Opening a non-markdown file does not crash or corrupt the editor

- [x]Tab icons reflect file type

- [x]File type detection works for all supported extensions

### Design

- [x]CodeMirror theme matches Notesage's neutral greyscale palette in both light and dark modes

- [x]Source mode has the same centered layout feel as WYSIWYG (max-width, padding)

- [x]PDF viewer toolbar is clean and minimal, consistent with Notesage design

- [x]DOCX viewer wrapper matches the app theme

- [x]Mode toggle transition is smooth (no flash or layout jump)

- [x]Image insertion dialog follows shadcn/ui patterns

- [x]All new UI works in both light and dark mode

## Out of Scope

- **PDF annotation or editing** — View only
- **DOCX editing** — View and import only
- **PPTX/ODT viewing** — Import to markdown only (no viewer)
- **Image drag-and-drop with file copying** — Future enhancement (would copy dropped images to a project assets folder and insert relative path)
- **Image paste from clipboard** — Future enhancement
- **Collaborative editing in source mode** — CRDT support is future work
- **CodeMirror vim/emacs keybindings** — Could be added later as a setting
- **PDF text extraction / import to markdown** — Complex and lossy; not included
- **Markdown preview in source mode** (split view) — Future enhancement; single-mode toggle is sufficient for now
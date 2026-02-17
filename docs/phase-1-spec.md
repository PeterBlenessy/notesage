# Phase 1 Specification — The Editor

## Overview

Phase 1 focuses on building a beautiful, functional WYSIWYG markdown editor with file management. AI features are in Phase 2 (already implemented).

## Must Have (MVP)

### 1. Tiptap WYSIWYG Editor

Support these node types:

- Headings (H1-H6)
- Paragraphs
- Bold, italic, underline, strikethrough, code (inline)
- Bullet lists, ordered lists, task lists (checkboxes)
- Blockquotes
- Code blocks with syntax highlighting (use `lowlight` or `shiki`)
- Horizontal rules
- Links (with URL editing popup)
- Images (display from local path, paste from clipboard)
- Tables (insert, add/remove rows/columns)

### 2. Floating Toolbar

Appears on text selection with:

- Bold, italic, underline, strikethrough, code
- Link creation
- Heading level selector
- Text alignment

**Note:** Must be toggleable in settings (some users find it disruptive)

### 3. Slash Commands

Type `/` at start of line to insert:

- Heading 1-3
- Bullet list, numbered list, task list
- Code block
- Blockquote
- Table
- Horizontal rule
- Image

### 4. Markdown Round-Tripping

- Open .md file → parse to ProseMirror document
- Edit in WYSIWYG → serialize back to clean markdown
- **Critical**: No data loss. Markdown in must equal markdown out (modulo whitespace normalization)
- Use `prosemirror-markdown` for serialization/parsing via Tiptap's markdown extension or direct integration

**Test strategy**: Create a set of reference .md files covering all syntax. Round-trip test: parse → serialize → compare. Must pass before any PR.

### 5. File Operations

Via Tauri commands:

- Open folder (native dialog → reads directory tree)
- Open file (click in sidebar or Cmd+O)
- Save file (Cmd+S → serialize to markdown → write to disk)
- Auto-save on blur / tab switch (debounced, 1 second)
- Create new file / folder (from sidebar context menu)
- Rename file / folder
- Delete file / folder (with confirmation)

See @docs/tauri-commands.md for command signatures.

### 6. Sidebar File Tree

- Shows all files/folders in opened project directory
- Expandable/collapsible folders
- File icons based on extension (.md, .txt, images, etc.)
- Right-click context menu (New file, New folder, Rename, Delete)
- Highlight currently open file
- Ignore hidden files/folders (dotfiles) by default

### 7. Multi-tab Editing

- Tab bar above editor showing open files
- Click tab to switch (preserves editor state)
- Close tab (with unsaved changes warning)
- Dirty indicator (dot) on tabs with unsaved changes
- Middle-click to close tab
- Cmd+W to close active tab

### 8. Theme

- Light and dark mode
- Follow system preference by default
- Toggle in settings or via Cmd+Shift+T
- Use shadcn/ui's built-in dark mode support (CSS variables)

### 9. Tauri Desktop Packaging

- macOS as primary target (arm64 + x86_64)
- App name: "Notesage"
- Window: 1200x800 default, resizable, min 800x600
- Native title bar (not custom)
- Remember window position and size between launches

## Nice to Have (Phase 1 Stretch Goals)

- Drag-and-drop files in sidebar to reorder/move
- Cmd+F quick-open with fuzzy file search
- Word count in status bar
- Outline/TOC panel (generated from headings)
- Recent files list on empty state

## Explicitly NOT in Phase 1

**These are in Phase 2+ (see @docs/future-phases.md):**

- AI features (no AI provider integration, no inline suggestions, no chat) — **NOW IN PHASE 2**
- Project management (.notesage/ directory, goals, workflows)
- Document generation (PDF, DOCX, PPTX export)
- GitHub/Git integration
- Web search
- Settings UI beyond theme toggle — **NOW EXPANDED IN PHASE 2**
- Mobile builds

## Quality Gates

Before Phase 1 is considered complete, ALL of these must pass:

### Functional Requirements

- [ ] Can open a folder of .md files via native dialog

- [ ] File tree displays all files and folders correctly

- [ ] Clicking a .md file opens it in the WYSIWYG editor

- [ ] All markdown syntax renders correctly in WYSIWYG mode

- [ ] Saving serializes back to clean, valid markdown

- [ ] **Round-trip test passes**: Open → edit nothing → save → file is identical (whitespace-normalized)

- [ ] Multi-tab editing works (switch tabs preserves state)

- [ ] Unsaved changes indicator works

- [ ] Auto-save on tab switch works

- [ ] Slash commands insert correct block types

- [ ] Floating toolbar appears on selection and applies formatting

- [ ] Create/rename/delete files from sidebar works

- [ ] Light/dark theme works and follows system preference

- [ ] App builds and runs on macOS without errors

- [ ] App starts in under 1 second

- [ ] No console errors during normal operation

### Design Quality (Equally Important)

**These are NOT optional. The app must look production-ready.**

- [ ] App looks like it belongs next to Linear, Bear, or Craft — not a hackathon project

- [ ] Sidebar has smooth hover transitions and clear active state

- [ ] Editor content area is max 720px wide and beautifully typeset

- [ ] All interactive elements have hover, active, and focus states

- [ ] Theme switching is smooth with color transitions

- [ ] No default browser UI elements visible (checkboxes, scrollbars, selects)

- [ ] Consistent border-radius, spacing, and color palette throughout

- [ ] Code blocks have syntax highlighting with a tasteful theme

- [ ] Floating toolbar has backdrop blur and smooth animation

- [ ] Typography is polished: proper hierarchy, readable sizes, intentional weight usage

- [ ] Looks great in BOTH light and dark mode

## Getting Started

```bash
# Prerequisites
# - Rust (latest stable)
# - Node.js 20+
# - pnpm

# Create project (if starting fresh)
pnpm create tauri-app note-sage --template react-ts
cd note-sage

# Install dependencies
pnpm add @tiptap/react @tiptap/starter-kit @tiptap/pm
pnpm add @tiptap/extension-placeholder @tiptap/extension-link
pnpm add @tiptap/extension-image @tiptap/extension-table
pnpm add @tiptap/extension-table-row @tiptap/extension-table-cell
pnpm add @tiptap/extension-table-header @tiptap/extension-task-list
pnpm add @tiptap/extension-task-item @tiptap/extension-code-block-lowlight
pnpm add @tiptap/extension-underline @tiptap/extension-text-align
pnpm add @tiptap/extension-horizontal-rule @tiptap/extension-heading
pnpm add @tiptap/extension-bubble-menu @tiptap/extension-floating-menu
pnpm add lowlight zustand
pnpm add -D tailwindcss @tailwindcss/vite

# shadcn/ui setup
pnpm dlx shadcn@latest init
# Then add components as needed:
pnpm dlx shadcn@latest add button dropdown-menu dialog context-menu tabs tooltip

# For markdown support
pnpm add tiptap-markdown
# OR integrate prosemirror-markdown directly:
pnpm add prosemirror-markdown

# Tauri plugins
cd src-tauri
cargo add tauri-plugin-dialog
cargo add tauri-plugin-fs
cd ..

# Run dev
pnpm tauri dev
```

## Phase 1 Status

**Current Status:** Phase 1 complete, Phase 2 (AI Collaboration) implemented.

Phase 2 additions (not in original Phase 1 scope):

- AI provider abstraction (Anthropic, OpenAI, Ollama)
- Settings dialog with AI configuration
- Chat panel for AI conversations
- Inline AI actions (Improve, Summarize, Expand) via BubbleMenu
- AI provider logos with dark mode support
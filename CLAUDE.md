# CLAUDE.md — Notesage Project Spec

## What is Notesage?

Notesage is a WYSIWYG markdown editor with AI collaboration capabilities, packaged as a lightweight desktop application using Tauri v2. It will eventually include project management, document generation (PDF/DOCX/PPTX), GitHub integration, and workflow management — but we are building it in phases.

**Current phase: Phase 1 — The Editor**

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Desktop shell | Tauri | v2 (latest stable) |
| Frontend framework | React | 19+ |
| Language | TypeScript | 5+ |
| Editor engine | Tiptap | v2 (wraps ProseMirror) |
| Component library | shadcn/ui | latest (Radix UI + Tailwind) |
| Styling | Tailwind CSS | v4 |
| State management | Zustand | latest |
| Package manager | pnpm | latest |

## Project Structure

```
note-sage/
├── src-tauri/              # Rust backend (Tauri)
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   └── commands/       # Tauri IPC commands
│   │       ├── mod.rs
│   │       ├── file.rs     # File read/write/list operations
│   │       └── dialog.rs   # Native file/folder dialogs
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── capabilities/
├── src/                    # React frontend
│   ├── main.tsx            # Entry point
│   ├── App.tsx             # Root layout
│   ├── components/
│   │   ├── editor/         # Tiptap editor components
│   │   │   ├── Editor.tsx          # Main editor wrapper
│   │   │   ├── EditorContent.tsx   # Tiptap content area
│   │   │   ├── Toolbar.tsx         # Floating format toolbar
│   │   │   ├── SlashCommand.tsx    # Slash command menu
│   │   │   ├── BubbleMenu.tsx      # Selection bubble menu
│   │   │   └── extensions/         # Custom Tiptap extensions
│   │   │       ├── index.ts
│   │   │       └── slash-command.ts
│   │   ├── sidebar/
│   │   │   ├── Sidebar.tsx         # Main sidebar container
│   │   │   ├── FileTree.tsx        # File/folder tree
│   │   │   └── FileTreeItem.tsx    # Individual tree node
│   │   ├── tabs/
│   │   │   ├── TabBar.tsx          # Tab bar for open files
│   │   │   └── Tab.tsx             # Single tab
│   │   └── ui/             # shadcn/ui components (auto-generated)
│   ├── hooks/
│   │   ├── useEditor.ts            # Tiptap editor instance hook
│   │   ├── useFileSystem.ts        # Tauri file operations
│   │   └── useProject.ts           # Open folder / file tree state
│   ├── stores/
│   │   ├── editor-store.ts         # Open tabs, active file
│   │   ├── project-store.ts        # Project folder, file tree
│   │   └── settings-store.ts       # App settings, theme
│   ├── lib/
│   │   ├── markdown.ts             # Markdown ↔ ProseMirror conversion
│   │   ├── tauri.ts                # Typed Tauri invoke wrappers
│   │   └── utils.ts                # General utilities
│   └── styles/
│       └── editor.css              # Editor-specific styles (ProseMirror overrides)
├── CLAUDE.md               # This file
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── vite.config.ts
├── components.json         # shadcn/ui config
└── index.html
```

## Phase 1 Scope: The Editor

### Must Have (MVP)

1. **Tiptap WYSIWYG editor** with these node types:
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

2. **Floating toolbar** that appears on text selection:
   - Bold, italic, underline, strikethrough, code
   - Link creation
   - Heading level selector
   - Text alignment

3. **Slash commands** (type `/` at start of line):
   - Heading 1-3
   - Bullet list, numbered list, task list
   - Code block
   - Blockquote
   - Table
   - Horizontal rule
   - Image

4. **Markdown round-tripping**:
   - Open .md file → parse to ProseMirror document
   - Edit in WYSIWYG → serialize back to clean markdown
   - **Critical**: No data loss. Markdown in must equal markdown out (modulo whitespace normalization)
   - Use `prosemirror-markdown` for serialization/parsing via Tiptap's markdown extension or direct integration

5. **File operations** (via Tauri commands):
   - Open folder (native dialog → reads directory tree)
   - Open file (click in sidebar or Cmd+O)
   - Save file (Cmd+S → serialize to markdown → write to disk)
   - Auto-save on blur / tab switch (debounced, 1 second)
   - Create new file / folder (from sidebar context menu)
   - Rename file / folder
   - Delete file / folder (with confirmation)

6. **Sidebar file tree**:
   - Shows all files/folders in opened project directory
   - Expandable/collapsible folders
   - File icons based on extension (.md, .txt, images, etc.)
   - Right-click context menu (New file, New folder, Rename, Delete)
   - Highlight currently open file
   - Ignore hidden files/folders (dotfiles) by default

7. **Multi-tab editing**:
   - Tab bar above editor showing open files
   - Click tab to switch (preserves editor state)
   - Close tab (with unsaved changes warning)
   - Dirty indicator (dot) on tabs with unsaved changes
   - Middle-click to close tab
   - Cmd+W to close active tab

8. **Theme**:
   - Light and dark mode
   - Follow system preference by default
   - Toggle in settings or via Cmd+Shift+T
   - Use shadcn/ui's built-in dark mode support (CSS variables)

9. **Tauri desktop packaging**:
   - macOS as primary target (arm64 + x86_64)
   - App name: "Notesage"
   - Window: 1200x800 default, resizable, min 800x600
   - Native title bar (not custom)
   - Remember window position and size between launches

### Nice to Have (Phase 1 stretch goals)

- Drag-and-drop files in sidebar to reorder/move
- Cmd+P quick-open with fuzzy file search
- Word count in status bar
- Outline/TOC panel (generated from headings)
- Recent files list on empty state

### Explicitly NOT in Phase 1

- AI features (no AI provider integration, no inline suggestions, no chat)
- Project management (.note-sage/ directory, goals, workflows)
- Document generation (PDF, DOCX, PPTX export)
- GitHub/Git integration
- Web search
- Settings UI beyond theme toggle
- Mobile builds

## Architecture Principles

### Editor State

- **ProseMirror is the single source of truth** for the currently open document
- All modifications flow through ProseMirror transactions
- The React component receives editor state updates via Tiptap's `useEditor` hook
- Do NOT maintain a separate "document content" state in Zustand — the editor IS the state

### File Operations

- **All filesystem access goes through Tauri commands** (IPC)
- Frontend NEVER reads/writes files directly
- Tauri commands are defined in `src-tauri/src/commands/`
- Frontend calls them via `@tauri-apps/api/core` invoke

### Markdown Conversion

- Use Tiptap's built-in markdown support or integrate `prosemirror-markdown` directly
- The conversion must handle all supported node types
- **Test strategy**: Create a set of reference .md files covering all syntax. Round-trip test: parse → serialize → compare. Must pass before any PR.

### State Management (Zustand)

- `editor-store`: Open tabs (file path + dirty state), active tab index
- `project-store`: Root folder path, file tree structure, expanded folders
- `settings-store`: Theme, window state, recent projects

### Styling

- Tailwind for layout and general styling
- shadcn/ui for interactive components (buttons, dropdowns, dialogs, context menus, tabs)
- Editor content area uses ProseMirror's default styles with custom CSS overrides in `editor.css`
- Do NOT use styled-components, CSS modules, or emotion

## Tauri Commands API

Define these Rust commands for Phase 1:

```rust
// File operations
#[tauri::command]
async fn read_file(path: String) -> Result<String, String>

#[tauri::command]
async fn write_file(path: String, content: String) -> Result<(), String>

#[tauri::command]
async fn list_directory(path: String) -> Result<Vec<FileEntry>, String>

#[tauri::command]
async fn create_file(path: String) -> Result<(), String>

#[tauri::command]
async fn create_directory(path: String) -> Result<(), String>

#[tauri::command]
async fn rename_path(old_path: String, new_path: String) -> Result<(), String>

#[tauri::command]
async fn delete_path(path: String) -> Result<(), String>

#[tauri::command]
async fn path_exists(path: String) -> Result<bool, String>

// Dialogs
#[tauri::command]
async fn open_folder_dialog(app: tauri::AppHandle) -> Result<Option<String>, String>

// FileEntry struct
#[derive(Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_directory: bool,
    children: Option<Vec<FileEntry>>, // populated for directories
}
```

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Save | Cmd+S |
| Open file | Cmd+O |
| Close tab | Cmd+W |
| New file | Cmd+N |
| Bold | Cmd+B |
| Italic | Cmd+I |
| Underline | Cmd+U |
| Strikethrough | Cmd+Shift+X |
| Code | Cmd+E |
| Link | Cmd+K |
| Undo | Cmd+Z |
| Redo | Cmd+Shift+Z |
| Toggle theme | Cmd+Shift+T |

## Code Style & Conventions

- **Language**: All code, comments, variable names, and function names in English
- **Components**: Functional React components with hooks. No class components.
- **Naming**: PascalCase for components, camelCase for functions/variables, UPPER_SNAKE for constants
- **Files**: One component per file. File name matches component name.
- **Imports**: Use absolute imports from `src/` (configure in tsconfig paths)
- **Types**: Prefer interfaces over types. Export types from the file that defines them.
- **Error handling**: Tauri command results are always `Result<T, String>`. Handle errors in the frontend, show toast notifications for user-facing errors.
- **No `any`**: Use proper types. If truly unknown, use `unknown` and narrow.

## Getting Started

```bash
# Prerequisites
# - Rust (latest stable)
# - Node.js 20+
# - pnpm

# Create project
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

# For markdown support - evaluate these options:
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

## Quality Gates (Phase 1 Exit Criteria)

Before Phase 1 is considered complete:

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

## Future Phases (Context Only — Do Not Build)

These are documented here so architectural decisions in Phase 1 don't accidentally block future work:

- **Phase 2 — AI Collaboration**: Inline AI suggestions shown as ProseMirror decorations (green insert, red delete). Chat panel. Provider abstraction (Anthropic, OpenAI, Ollama). This is WHY we chose ProseMirror — its decoration system is critical.
- **Phase 3 — Project Workspace**: .note-sage/ metadata directory, project goals, Git integration, web search.
- **Phase 4 — Document Generation**: Export to PDF, DOCX, PPTX from markdown content.
- **Phase 5 — Workflows & Advanced AI**: YAML-defined workflows, bundled llama-server for local AI, GitHub Copilot integration.

**Key future-proofing decisions for Phase 1:**
- Keep the editor component cleanly separated (easy to add decoration layer later)
- File operations go through Tauri commands (will add Git operations in same pattern)
- Use Zustand stores with clear boundaries (will add ai-store, project-store later)
- Don't hardcode any paths or assumptions about project structure

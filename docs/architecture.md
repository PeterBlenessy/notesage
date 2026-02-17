# Architecture

## Tech Stack

| Layer | Technology | Version |
| --- | --- | --- |
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
│   │       ├── dialog.rs   # Native file/folder dialogs
│   │       └── ai.rs       # AI provider commands
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
│   │   ├── NewNoteDialog.tsx        # New note creation dialog
│   │   ├── NewProjectDialog.tsx     # New project creation dialog
│   │   ├── settings/
│   │   │   ├── SettingsDialog.tsx  # Main settings modal
│   │   │   ├── AISettings.tsx      # AI provider configuration
│   │   │   └── ProjectSettings.tsx # Project-level settings
│   │   ├── chat/
│   │   │   ├── ChatPanel.tsx       # AI chat sidebar
│   │   │   ├── ChatMessage.tsx     # Individual message
│   │   │   └── ChatInput.tsx       # Message input
│   │   └── ui/             # shadcn/ui components (auto-generated)
│   ├── hooks/
│   │   ├── useEditor.ts            # Tiptap editor instance hook
│   │   ├── useFileOperations.ts    # File create/open/save/delete operations
│   │   ├── useProjectMetadata.ts   # Auto-bootstrap .notesage/project.json
│   │   └── useAIOperations.ts      # AI generation and chat operations
│   ├── stores/
│   │   ├── editor-store.ts         # Open tabs, active file
│   │   ├── project-store.ts        # Project folder, file tree
│   │   ├── project-metadata-store.ts # Project metadata (.notesage/project.json)
│   │   ├── settings-store.ts       # App settings, theme
│   │   ├── ai-store.ts             # AI provider configuration
│   │   └── chat-store.ts           # Chat conversation state
│   ├── lib/
│   │   ├── markdown.ts             # Markdown ↔ ProseMirror conversion
│   │   ├── tauri.ts                # Typed Tauri invoke wrappers
│   │   ├── utils.ts                # General utilities
│   │   └── ai/                     # AI provider abstraction
│   │       ├── types.ts            # AI interfaces and types
│   │       ├── index.ts            # Provider factory
│   │       └── providers/
│   │           ├── anthropic.ts    # Anthropic implementation
│   │           ├── openai.ts       # OpenAI implementation
│   │           └── ollama.ts       # Ollama implementation
│   └── styles/
│       ├── globals.css             # Global styles and CSS variables
│       └── editor.css              # Editor-specific styles (ProseMirror overrides)
├── public/
│   └── logos/                      # AI provider logos
│       ├── anthropic.svg
│       ├── openai.svg
│       └── ollama-official.png
├── docs/                           # Documentation
├── CLAUDE.md                       # Project spec (this references docs/)
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── vite.config.ts
├── components.json                 # shadcn/ui config
└── index.html
```

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

All state stores use Zustand with the persist middleware for localStorage:

- **editor-store**: Open tabs (file path + dirty state), active tab index
- **project-store**: Root folder path, file tree structure, expanded folders
- **project-metadata-store**: Project metadata from `.notesage/project.json` (name, description, AI overrides)
- **settings-store**: Theme, window state, recent projects, UI preferences (floating toolbar toggle)
- **ai-store**: AI provider selection, API keys, Ollama URL, suggestions enabled
- **chat-store**: Chat conversation messages, loading state, errors

### Styling

- Tailwind for layout and general styling
- shadcn/ui for interactive components (buttons, dropdowns, dialogs, context menus, tabs)
- Editor content area uses ProseMirror's default styles with custom CSS overrides in `editor.css`
- Do NOT use styled-components, CSS modules, or emotion
- All colors defined as CSS variables in `globals.css` (supports light/dark mode)

### AI Provider Abstraction

Clean provider interface that all AI backends implement:

```typescript
interface AIProvider {
  name: 'anthropic' | 'openai' | 'ollama';
  generateText(prompt: string, options?: GenerateOptions): Promise<string>;
  chat(messages: ChatMessage[]): Promise<string>;
}
```

**Why this design:**

- Single interface for all providers
- Easy to add new providers later
- Type-safe with TypeScript
- Secure: all API calls through Tauri backend (Rust)

**Provider implementation:**

- Anthropic: Claude Sonnet 4.5
- OpenAI: GPT-4 Turbo
- Ollama: Local AI models

### Security Model

**API Key Storage:**

- Stored in localStorage via Zustand persist middleware
- Keys stored in plaintext (browser developer tools visible)
- **Trade-off**: Convenience vs security - documented limitation
- All API calls go through Tauri backend (Rust) so keys never exposed in frontend console

**File System Access:**

- All file operations through Tauri IPC commands
- Rust backend enforces filesystem boundaries
- No direct frontend filesystem access

## Data Flow

### Opening and Editing a File

1. User clicks file in sidebar → `useFileSystem.openFile(path)`
2. Frontend calls Tauri command `read_file(path)`
3. Rust reads file from disk → returns markdown string
4. Frontend parses markdown → ProseMirror document
5. Tiptap editor displays rich content
6. User edits → ProseMirror transactions update editor state
7. On save (Cmd+S or auto-save):
   - Serialize ProseMirror → markdown
   - Call Tauri command `write_file(path, content)`
   - Rust writes to disk

### AI Operations

1. User selects text → clicks "Improve" in BubbleMenu
2. Frontend calls `useAIOperations.generateText(prompt)`
3. Hook retrieves provider + API key from ai-store
4. Frontend calls Tauri command `ai_generate_text(request)`
5. Rust makes HTTP request to AI provider API
6. AI response returned to frontend
7. Frontend updates editor content

### Chat Panel

1. User types message in ChatInput
2. Frontend calls `useChatStore.addMessage(userMessage)`
3. Frontend calls `useAIOperations.sendChatMessage(content, messages)`
4. Hook calls Tauri command `ai_chat(messages, provider, apiKey)`
5. Rust makes HTTP request to AI provider API
6. AI response streamed back to frontend
7. Frontend calls `useChatStore.addMessage(aiResponse)`
8. Chat history persisted to localStorage

## Future-Proofing Decisions

These architectural choices enable future phases:

- **ProseMirror decorations**: Core reason for choosing ProseMirror - enables Phase 2 AI suggestions shown as inline decorations (green insert, red delete)
- **Tauri commands**: Pattern established for file operations extends to Git operations (Phase 3)
- **Zustand stores**: Clean boundaries allow adding new stores (ai-store, project-store added in Phase 2)
- **Provider abstraction**: Easy to add new AI providers (Gemini, local models, etc.)
- **No hardcoded paths**: `.notesage/` metadata directory auto-bootstrapped per project
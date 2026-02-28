# Notesage

A polished rich text markdown editor with AI collaboration capabilities, built as a native desktop app with Tauri v2.

## Features

### Editor
- Tiptap rich text editor with full markdown round-tripping
- Raw markdown mode with CodeMirror 6 (toggle with Cmd+/)
- Multi-tab editing with file tree sidebar
- Slash commands, floating toolbar, bubble menu
- Inline tag badges (`#tag` → styled pills) with autocomplete and cross-file search (Cmd+3)
- YAML frontmatter support with fold/collapse
- Light and dark themes following system preference

### AI Collaboration
- **Multi-Provider Connections**: Anthropic Claude, OpenAI, Ollama (local), and ACP agents (Claude Code, Codex, Copilot CLI, Gemini CLI)
- **Per-Use-Case Routing**: Separate provider assignment for chat, agent tasks, and inline completions
- **AI Chat Panel**: Streaming responses, web search with citations, agent activity log (Cmd+Shift+A)
- **Inline AI Actions**: Improve, summarize, or expand selected text — works in both rich text and raw mode
- **Copilot Inline Completions**: Ghost text autocomplete via GitHub Copilot Language Server
- **Agent Comment Delegation**: Delegate comments to AI agents with threaded replies and activity tracking

### Document Export
- **PDF Export**: Typst-powered typesetting with three templates (Clean, Academic, Report)
- **PDF Viewing**: Built-in PDF viewer for non-markdown files
- **DOCX Viewing & Import**: View Word documents and import them as markdown

### Project Workspace
- **Git Integration**: File status indicators, commit dialog, branch switching, branch diff review
- **Comments**: Inline comments with delegation to AI agents, lifecycle tracking, bulk operations
- **External Change Detection**: Filesystem watcher with inline diff review or auto-accept
- **Project Goals**: YAML frontmatter-based goals with AI context injection
- **Notesage Library**: Central `~/Notesage` folder with selective iCloud sync per project

## Getting Started

### Prerequisites
- Rust (latest stable)
- Node.js 20+
- pnpm

### Development

```bash
pnpm install        # Install dependencies
pnpm tauri dev      # Run in development mode
pnpm tauri build    # Build for production
```

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Save | Cmd+S |
| New note | Cmd+N |
| Close tab | Cmd+W |
| Command palette | Cmd+K |
| Search files | Cmd+Shift+F |
| Toggle sidebar | Cmd+B |
| Toggle theme | Cmd+T |
| Toggle chat panel | Cmd+Shift+A |
| Toggle raw mode | Cmd+/ |
| Export as PDF | Cmd+Shift+E |
| Focus mode | Cmd+. |
| Tag search | Cmd+3 |
| Document outline | Cmd+Shift+O |
| Settings | Cmd+, |
| Add comment | Cmd+Shift+M |

### Formatting
| Action | Shortcut |
|--------|----------|
| Bold | Cmd+B |
| Italic | Cmd+I |
| Underline | Cmd+U |
| Strikethrough | Cmd+Shift+X |
| Inline code | Cmd+E |
| Link | Cmd+K |

## AI Provider Setup

Open Settings (Cmd+,) and go to the **Connections** tab.

### API Key Providers
- **Anthropic Claude**: Add connection with API key (Claude Sonnet 4.5, web search)
- **OpenAI**: Add connection with API key (GPT-4o, web search)
- **Ollama**: Add local connection (any model, no API key needed)

### Agent Providers (ACP)
- **Claude Code**: `npm install -g @anthropic-ai/claude-code` + Anthropic subscription
- **Codex**: `npm install -g @openai/codex` + OpenAI subscription
- **Copilot CLI**: `npm install -g @githubnext/github-copilot-cli` + Copilot subscription
- **Gemini CLI**: `npm install -g @anthropic-ai/gemini-cli` + Google account (free)

### Inline Completions
- **Copilot LSP**: `npm install -g @anthropic-ai/copilot-language-server` + Copilot subscription
- Routed separately via Advanced Routing in Settings

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2 |
| Frontend | React 19 + TypeScript 5 |
| Editor | Tiptap v2 (ProseMirror) + CodeMirror 6 |
| UI components | shadcn/ui (Radix + Tailwind v4) |
| State management | Zustand with persist |
| PDF export | Typst (embedded) |
| AI agents | Agent Client Protocol (ACP) |
| Inline completions | Copilot Language Server (LSP) |
| Package manager | pnpm |

## Project Structure

```
note-sage/
├── src/                        # React frontend
│   ├── components/
│   │   ├── editor/            # Tiptap + CodeMirror editor
│   │   ├── chat/              # AI chat panel
│   │   ├── settings/          # Settings dialog
│   │   ├── sidebar/           # File tree
│   │   └── ui/                # shadcn/ui components
│   ├── stores/                # Zustand state stores
│   ├── hooks/                 # React hooks
│   └── lib/ai/               # AI provider abstraction
├── src-tauri/                 # Rust backend
│   ├── src/commands/          # Tauri IPC commands
│   ├── src/export/            # Typst PDF engine
│   ├── fonts/                 # Bundled fonts
│   └── templates/             # Typst templates
└── docs/                      # Documentation
    ├── architecture.md
    ├── design-system.md
    ├── product-description.md
    ├── prds/                  # Product requirements
    └── history/               # Release history
```

## Roadmap

- Phase 1: The Editor
- Phase 2: AI Collaboration
- Phase 3: Project Workspace
- Phase 4: Document Generation (PDF export)
- Phase 5: Comments & Change Detection
- Phase 5.5: Notesage Library & iCloud Sync
- Phase 6: AI Provider Architecture v2 (ACP agents, Copilot LSP)
- Phase 6.5: Chat UX & Agent Polish (current)
- **Phase 7: AI-Assisted Research** (next)
- Phase 8: Workflows & Automation
- Phase 9: Local AI

## License

MIT License. See [LICENSE](LICENSE) for details.

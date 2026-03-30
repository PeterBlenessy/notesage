# Notesage

A polished rich text markdown editor with AI collaboration capabilities, built as a native desktop app with Tauri v2.

## Features

### Editor
- Tiptap rich text editor with full markdown round-tripping
- Source mode with CodeMirror 6
- Multi-tab editing with file tree sidebar
- Slash commands, floating toolbar, bubble menu
- Inline tag badges (`#tag` → styled pills) with autocomplete and cross-file search (Cmd+3)
- Mention search (`@mention` → Cmd+2) and document outline (Cmd+Shift+O)
- Find and replace (Cmd+F) across all file types (WYSIWYG, source, PDF, EPUB, DOCX, plain text)
- SQLite document index with FTS5 full-text search, AST-parsed tags, mentions, tasks, goals
- Light and dark themes following system preference

### Rich Content Blocks
- **Callout blocks**: Note, Tip, Warning, Important — Obsidian `> [!type]` compatible
- **Drawing canvas**: Inline Excalidraw editor with SVG preview and sidecar storage
- **Inline charts**: Bar, line, area, pie, radar, radial — with visual data editor
- **Link preview cards**: Rich cards with OpenGraph metadata, favicon, preview image
- **Dynamic tables**: Column types (number, currency, percentage, date), aggregation footer (sum/avg/count/min/max), click-to-sort, row filtering, inline sparkline charts, right-click column configuration

### AI Collaboration
- **Multi-Provider Connections**: Anthropic Claude, OpenAI, GitHub Copilot, Google Gemini, Ollama (local), Local AI (bundled llama-server), any OpenAI-compatible API
- **Per-Use-Case Routing**: Separate provider assignment for chat, agent tasks, and inline completions
- **AI Chat Panel**: Streaming responses, conversation branching, web search with citations, quick reply chips, multi-project context
- **Inline AI Actions**: Improve, summarize, or expand selected text via bubble menu
- **Inline Completions**: Ghost text autocomplete via Copilot LSP, Ollama, bundled llama-server, or OpenAI-compatible endpoints
- **Agent Comment Delegation**: Delegate comments to AI agents with threaded replies, apply-to-document, and activity tracking
- **Addressable Agents**: File-based agent system with `@agent-name` addressing, bundled and custom agents
- **Skills & MCP**: Skill discovery, script execution, MCP client with tool discovery and server management
- **Tool Calling**: Client-side tool calling for all direct API providers with tiered permission model
- **Voice Transcription**: On-device Whisper speech-to-text with live dictation and meeting recording

### Agent Security
- **Managed Agent Install**: One-click download from GitHub Releases to `~/.notesage/agents/` (no npm required)
- **Filesystem Sandbox**: OS-level Seatbelt sandbox restricts agent writes to project folders
- **Network Sandbox**: HTTP proxy filters agent network traffic by domain, with kernel-enforced deny and per-request approval
- **ACP Permissions**: Tiered tool call approval (allow once / session / always)

### Document Formats
- **PDF Export**: Typst-powered typesetting with three templates (Clean, Academic, Report), dynamic table support
- **EPUB Reader**: Paginated and scroll modes with bookmarks, TOC, and in-document search
- **PDF / DOCX / Plain Text Viewers**: Built-in with search

### Project Workspace
- **Git Integration**: File status indicators, commit dialog, branch switching, branch diff review
- **Comments**: Inline comments with AI delegation, lifecycle tracking, bulk operations
- **External Change Detection**: Filesystem watcher with inline diff review or auto-accept
- **Notesage Library**: Central `~/Notesage` folder with selective iCloud sync per project
- **Actions Dashboard**: Task and goal scanning across projects
- **Research**: AI-assisted web research with save, search, synthesize, and cite workflows

For detailed feature documentation, see [docs/features/](docs/features/).

## Getting Started

### Prerequisites
- Rust (latest stable)
- Node.js 22+ (pinned in `.nvmrc`)
- pnpm

### Development

```bash
pnpm install        # Install dependencies
pnpm tauri dev      # Run in development mode
pnpm tauri build    # Build for production
```

### Testing

```bash
pnpm test           # Unit tests (Vitest)
pnpm test:e2e       # Playwright E2E tests
pnpm typecheck      # TypeScript type checking
pnpm test:perf      # Performance benchmarks
cd src-tauri && cargo test  # Rust backend tests
```

## Keyboard Shortcuts

See [docs/keyboard-shortcuts.md](docs/keyboard-shortcuts.md) for the full list. Key shortcuts:

| Action | Shortcut |
|--------|----------|
| Command palette | Cmd+K |
| Save | Cmd+S |
| Find in document | Cmd+F |
| Toggle chat panel | Cmd+Shift+C |
| Toggle sidebar | Cmd+Shift+L |
| Export as PDF | Cmd+Shift+E |
| Tag search | Cmd+3 |
| Settings | Cmd+, |

## AI Provider Setup

Open Settings (Cmd+,) → **Connections** tab.

| Type | Providers |
|------|-----------|
| Subscription (ACP) | Claude Code, OpenAI Codex, GitHub Copilot CLI/LSP, Gemini CLI |
| API Key | Anthropic, OpenAI, any OpenAI-compatible API |
| Local | Ollama, Local AI (bundled llama-server with model catalog) |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2 |
| Frontend | React 19 + TypeScript 5 |
| Editor | Tiptap v2 (ProseMirror) |
| UI components | shadcn/ui (Radix + Tailwind v4) |
| State management | Zustand with persist |
| Document index | SQLite (rusqlite) with FTS5 |
| PDF export | Typst (embedded) |
| EPUB reader | foliate-js (vendored) |
| AI agents | Agent Client Protocol (ACP) |
| Local inference | llama-server (bundled sidecar) |
| Voice | whisper-rs with Metal acceleration |
| Package manager | pnpm |

## Project Structure

```
note-sage/
├── src/                        # React frontend
│   ├── components/editor/      # Tiptap editor, viewers, extensions
│   ├── components/chat/        # AI chat panel
│   ├── components/settings/    # Settings dialog
│   ├── components/sidebar/     # File tree
│   ├── stores/                 # Zustand state stores
│   ├── hooks/                  # React hooks
│   └── lib/                    # Utilities
├── src-tauri/                  # Rust backend
│   ├── src/commands/           # Tauri IPC commands
│   ├── src/index/              # SQLite document index
│   └── src/export/             # Typst PDF engine
├── bundled-skills/             # Built-in agent skills
├── bundled-agents/             # Built-in agent personas
├── docs/                       # Documentation
│   ├── features/               # Feature-specific docs
│   ├── prds/                   # Product requirements
│   └── history/                # Release history
├── tests/                      # Test fixtures
├── e2e/                        # Playwright E2E tests
└── e2e-real/                   # WebDriverIO real E2E tests
```

For detailed architecture documentation, see [docs/architecture.md](docs/architecture.md).

## Documentation

| Document | Purpose |
|----------|---------|
| [Architecture](docs/architecture.md) | Tech stack, project structure, core principles |
| [Design System](docs/design-system.md) | UI/UX requirements, typography, color palette |
| [Editor Features](docs/features/editor.md) | Editor capabilities including dynamic tables |
| [Editor Architecture](docs/features/editor-architecture.md) | ProseMirror internals, extensions, decorations |
| [AI Providers](docs/features/ai-providers.md) | Multi-provider architecture, tool calling, sandboxing |
| [AI Workflows](docs/features/ai-workflows.md) | Chat, agents, skills, MCP, delegation, research, voice |
| [Document Formats](docs/features/document-formats.md) | PDF export, EPUB/DOCX/PDF viewers |
| [Workspace](docs/features/workspace.md) | Projects, git, iCloud sync, external changes |
| [Keyboard Shortcuts](docs/keyboard-shortcuts.md) | All keyboard shortcuts |
| [Tauri Commands](docs/tauri-commands.md) | IPC command signatures |

## License

MIT License. See [LICENSE](LICENSE) for details.

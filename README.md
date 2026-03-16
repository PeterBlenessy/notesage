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

### AI Collaboration
- **Multi-Provider Connections**: Anthropic Claude, OpenAI, GitHub Copilot, Google Gemini, Ollama (local), Local AI (bundled llama-server), any OpenAI-compatible API
- **Per-Use-Case Routing**: Separate provider assignment for chat, agent tasks, and inline completions
- **AI Chat Panel**: Streaming responses, web search with citations, quick reply chips, multi-project context
- **Inline AI Actions**: Improve, summarize, or expand selected text via bubble menu
- **Copilot Inline Completions**: Ghost text autocomplete via GitHub Copilot Language Server
- **Local AI Completions**: FIM completions from Ollama, bundled llama-server, or OpenAI-compatible endpoints
- **Agent Comment Delegation**: Delegate comments to AI agents with threaded replies, apply-to-document, and activity tracking
- **Addressable Agents**: File-based agent system with `@agent-name` addressing, bundled and custom agents
- **Skills & MCP**: Skill discovery, script execution, MCP client with tool discovery and server management
- **Voice Transcription**: On-device Whisper speech-to-text with live dictation and meeting recording
- **Provider Context Isolation**: Start fresh or include history when switching providers mid-conversation

### Agent Security
- **Managed Agent Install**: One-click download from GitHub Releases to `~/.notesage/agents/` (no npm required)
- **Filesystem Sandbox**: OS-level Seatbelt sandbox restricts agent writes to project folders, blocks ~/.ssh, ~/.aws
- **Network Sandbox**: HTTP proxy filters agent network traffic by domain, with per-request approval for unknown domains
- **Telemetry Control**: Per-connection toggle for agent telemetry (e.g., Sentry crash reports)
- **Custom Sandbox Paths**: User-configurable writable directories per connection
- **ACP Permissions**: Tiered tool call approval (allow once / session / always)

### Document Formats
- **PDF Export**: Typst-powered typesetting with three templates (Clean, Academic, Report)
- **EPUB Reader**: Paginated and scroll modes with bookmarks, TOC, and in-document search
- **PDF Viewer**: Built-in with text layer search
- **DOCX Viewer**: mammoth.js-powered with search
- **Plain Text Viewer**: With search

### Project Workspace
- **Git Integration**: File status indicators, commit dialog, branch switching, branch diff review
- **Comments**: Inline comments with AI delegation, lifecycle tracking, bulk operations
- **External Change Detection**: Filesystem watcher with inline diff review or auto-accept
- **Project Goals**: YAML frontmatter-based goals with templates and AI context injection
- **Notesage Library**: Central `~/Notesage` folder with selective iCloud sync per project
- **Actions Dashboard**: Task and goal scanning across projects (Cmd+5)
- **Research**: AI-assisted web research with save, search, synthesize, and cite workflows

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
| New project | Cmd+Shift+N |
| Close tab | Cmd+W |
| Command palette | Cmd+K |
| Search files | Cmd+Shift+F |
| Toggle sidebar | Cmd+Shift+L |
| Toggle theme | Cmd+T |
| Toggle chat panel | Cmd+Shift+C |
| Toggle agent panel | Cmd+Shift+A |
| Export as PDF | Cmd+Shift+E |
| Focus mode | Cmd+. |
| Find in document | Cmd+F |
| Find and replace | Cmd+Shift+H |
| Mention search | Cmd+2 |
| Tag search | Cmd+3 |
| Research search | Cmd+4 |
| Actions dashboard | Cmd+5 |
| Document outline | Cmd+Shift+O |
| Keyboard shortcuts | Cmd+7 |
| Settings | Cmd+, |
| Add comment | Cmd+Shift+M |
| Toggle recording | Cmd+Shift+R |

## AI Provider Setup

Open Settings (Cmd+,) and go to the **Connections** tab.

### Subscription Providers (ACP)
Agents are downloaded automatically when you add a connection — no npm required.
- **Claude Code**: Anthropic Pro or Max subscription
- **OpenAI Codex**: ChatGPT Plus or Pro subscription
- **GitHub Copilot CLI**: Copilot subscription (chat and agents)
- **GitHub Copilot LSP**: Copilot subscription (inline completions, chat, agents)
- **Gemini CLI**: Free with Google account, or Gemini Code Assist subscription

### API Key Providers
- **Anthropic**: Pay-per-use API key (Claude Sonnet, web search)
- **OpenAI**: Pay-per-use API key (GPT models, web search)
- **OpenAI-Compatible**: Any compatible API (vLLM, LiteLLM, Together AI, Groq)

### Local Providers
- **Ollama**: Local models, no API key needed
- **Local AI**: Bundled llama-server with curated model catalog, Metal GPU acceleration

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
| Inline completions | Copilot Language Server (LSP) |
| Local inference | llama-server (bundled sidecar) |
| Voice | whisper-rs with Metal acceleration |
| Package manager | pnpm |

## Project Structure

```
note-sage/
├── src/                        # React frontend
│   ├── components/
│   │   ├── editor/            # Tiptap editor, viewers, extensions
│   │   ├── chat/              # AI chat panel, permission cards
│   │   ├── settings/          # Settings dialog, connection config
│   │   ├── sidebar/           # File tree
│   │   ├── activity/          # Agent activity strip/panel
│   │   └── ui/                # shadcn/ui components
│   ├── stores/                # Zustand state stores
│   ├── hooks/                 # React hooks
│   └── lib/ai/               # AI provider abstraction
├── src-tauri/                 # Rust backend
│   ├── src/commands/          # Tauri IPC commands
│   ├── src/index/             # SQLite document index
│   ├── src/export/            # Typst PDF engine
│   ├── binaries/              # Bundled sidecar binaries
│   ├── fonts/                 # Bundled fonts
│   └── templates/             # Typst templates
├── bundled-skills/            # Built-in agent skills
├── bundled-agents/            # Built-in agent personas
├── public/foliate-js/         # Vendored EPUB renderer
└── docs/                      # Documentation
    ├── features/              # Feature-specific docs
    ├── prds/                  # Product requirements
    ├── tasks/                 # Implementation tasks
    └── history/               # Release history
```

## Roadmap

### Completed
- Phase 1: The Editor
- Phase 2: AI Collaboration
- Phase 3: Project Workspace
- Phase 4: Document Generation (PDF export)
- Phase 5: Comments & Change Detection
- Phase 5.5: Notesage Library & iCloud Sync
- Phase 6: AI Provider Architecture v2 (ACP agents, Copilot LSP)
- Phase 7: Skills, Agents, MCP, Research, Voice
- Phase 8: Document Formats (EPUB, DOCX, PDF viewers)
- Phase 9: Local AI (bundled llama-server, model catalog)
- Phase 10: Agent Install Wizard, Filesystem Sandbox, Network Sandbox

### Future
- Workflows & Automation (user-defined YAML workflows)
- Collaboration (real-time CRDT-based editing)
- Mobile apps (iOS, Android)
- Plugin API (Rust/WASM marketplace)
- Advanced editor (canvas, diagrams, math)
- Knowledge base (backlinks, graph view)

## License

MIT License. See [LICENSE](LICENSE) for details.

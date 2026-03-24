# Architecture

Core technical architecture for Notesage. For feature-specific details, see [docs/features/](features/).

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
│   │   ├── lib.rs          # Tauri builder + RunEvent::Exit cleanup hook
│   │   ├── commands/       # Tauri IPC commands
│   │   │   ├── mod.rs
│   │   │   ├── file.rs     # File read/write/list/copy operations
│   │   │   ├── dialog.rs   # Native file/folder dialogs
│   │   │   ├── ai.rs       # AI provider commands (direct API)
│   │   │   ├── acp.rs      # ACP agent management (spawn, auth, sessions, permissions, cleanup)
│   │   │   ├── copilot_lsp.rs # Copilot Language Server (JSON-RPC, inline completions)
│   │   │   ├── mcp.rs      # MCP client (JSON-RPC stdio transport, server lifecycle, tool discovery/call)
│   │   │   ├── skills.rs   # Skill discovery, YAML parsing, bundled skill extraction
│   │   │   ├── agents.rs   # Agent discovery, bundled agents, agent instructions
│   │   │   ├── script_exec.rs # Skill script execution, interpreter resolution, sandboxing
│   │   │   ├── json_rpc.rs # Shared JSON-RPC 2.0 types, Content-Length framing, pending requests
│   │   │   ├── export.rs   # PDF export commands
│   │   │   ├── git.rs      # Git operations
│   │   │   ├── watcher.rs  # Filesystem watcher (notify crate)
│   │   │   ├── ai_streaming.rs # AI streaming helpers (Ollama thinking detection)
│   │   │   ├── actions.rs  # Actions dashboard (task/goal scanning)
│   │   │   ├── health.rs   # Backend health check
│   │   │   ├── logging.rs  # Debug logging control
│   │   │   ├── store.rs    # Key-value store operations
│   │   │   ├── sync.rs     # iCloud sync settings
│   │   │   ├── shell_path.rs # Shell PATH resolution
│   │   │   ├── transcription.rs # Voice recording, Whisper transcription, dictation, model management
│   │   │   ├── local_inference.rs # Bundled llama-server lifecycle, model catalog, download, FIM completions
│   │   │   ├── model_metadata.rs  # Model metadata merge, HF API fetcher, runtime metadata
│   │   │   ├── gguf_parser.rs     # GGUF binary header parser
│   │   │   ├── network_proxy.rs   # HTTP proxy for agent network sandboxing, domain allowlists
│   │   │   ├── credentials.rs  # OS keychain credential storage (keyring crate)
│   │   │   └── sandbox_monitor.rs # Seatbelt violation monitoring (macOS log stream)
│   │   ├── index/          # SQLite document index (tags, mentions, tasks, goals, FTS5)
│   │   │   ├── mod.rs      # IndexState, Tauri commands, indexing pipeline
│   │   │   ├── db.rs       # Schema creation, migrations, connection management
│   │   │   ├── parser.rs   # comrak AST walking — tags, mentions, headings, tasks, goals
│   │   │   ├── queries.rs  # SQL query builders for all search operations
│   │   │   ├── tasks.rs    # Task toggle via context-based matching
│   │   │   └── icloud.rs   # iCloud exclusion (xattr on macOS)
│   │   └── export/         # PDF export engine
│   │       ├── mod.rs
│   │       ├── typst_world.rs      # Typst World trait implementation
│   │       ├── markdown_to_typst.rs # Markdown → Typst markup converter
│   │       └── templates.rs        # Template loading and parameterization
│   ├── binaries/           # Bundled sidecar binaries (llama-server + dylibs)
│   ├── model-catalog.json  # Curated LLM model catalog (embedded at compile time)
│   ├── fonts/              # Bundled fonts (Inter, Source Serif 4, JetBrains Mono)
│   ├── templates/          # Typst template presets (clean.typ, academic.typ, report.typ)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── capabilities/
├── src/                    # React frontend
│   ├── main.tsx            # Entry point
│   ├── App.tsx             # Root component — mounts lifecycle hooks, renders Layout + dialogs
│   ├── components/
│   │   ├── Layout.tsx      # Main layout (ResizablePanelGroup: sidebar, editor, chat, activity)
│   │   ├── ErrorBoundary.tsx # Reusable error boundary (wraps editor, chat, sidebar)
│   │   ├── editor/         # Tiptap editor components
│   │   │   ├── Editor.tsx, EditorContent.tsx, Toolbar.tsx, SlashCommand.tsx
│   │   │   ├── BubbleMenu.tsx, CommentPopover.tsx, CommentListPopover.tsx
│   │   │   ├── CommentThread.tsx, DelegationPanel.tsx
│   │   │   ├── TranscriptionOverlay.tsx, SourceModeEditor.tsx
│   │   │   ├── ChangeListPopover.tsx, FindBar.tsx, StatusBar.tsx
│   │   │   └── extensions/ # Custom Tiptap extensions (see editor-architecture.md)
│   │   ├── sidebar/        # Sidebar.tsx, FileTree.tsx, FileTreeItem.tsx, ExplorerFolderItem.tsx
│   │   ├── tabs/           # TabBar.tsx, Tab.tsx
│   │   ├── settings/       # SettingsDialog, ConnectionsSettings, LocalAISettings, TranscriptionSettings, etc.
│   │   ├── chat/           # ChatPanel, ChatMessage, ChatInput, PermissionCard, DomainApprovalCard, AgentSwitchCard, etc.
│   │   ├── activity/       # ActivityStrip.tsx, ActivityTaskCard.tsx
│   │   ├── editor/viewers/ # EpubViewer, PdfViewer, DocxViewer, PlainTextViewer
│   │   └── ui/             # shadcn/ui components (auto-generated)
│   ├── hooks/              # React hooks (useEditor, useAIOperations, useAcpLifecycle, useAppLifecycle, useScrollPersistence, useEditorResize, etc.)
│   ├── stores/             # Zustand stores (editor, workspace, ai, chat, skill, etc.)
│   ├── lib/                # Utilities (markdown, tauri, ai/{context,errors}, dom-search, etc.)
│   └── styles/             # globals.css, editor.css
├── public/
│   ├── foliate-js/         # Vendored EPUB renderer (MIT)
│   └── logos/              # AI provider logos
├── bundled-skills/         # Built-in skills (extracted to ~/.notesage/skills/)
├── bundled-agents/         # Built-in agents (extracted to ~/.notesage/agents/)
├── docs/                   # Documentation
│   ├── features/           # Feature-specific docs (editor, ai-providers, ai-workflows, etc.)
│   ├── prds/               # Product requirements documents
│   ├── tasks/              # Implementation task breakdowns
│   └── history/            # Implementation history
├── CLAUDE.md               # Project spec (references docs/)
├── package.json
├── tsconfig.json
├── vite.config.ts
└── index.html
```

## Core Principles

### Editor State

- **ProseMirror is the single source of truth** for the currently open document
- All modifications flow through ProseMirror transactions
- Do NOT maintain a separate "document content" state in Zustand — the editor IS the state
- See [features/editor-architecture.md](features/editor-architecture.md) for extension and decoration details

### File Operations

- **All filesystem access goes through Tauri commands** (IPC)
- Frontend NEVER reads/writes files directly
- Tauri commands defined in `src-tauri/src/commands/`
- Frontend calls them via `@tauri-apps/api/core` invoke

### Markdown Conversion

- Uses `prosemirror-markdown` for parse/serialize
- Must handle all supported node types
- **Test strategy**: Reference `.md` files covering all syntax. Round-trip test: parse → serialize → compare. Must pass before any PR.

### Document Index (SQLite)

A persistent SQLite index provides instant search for tags, mentions, tasks, goals, research, and full-text content. Replaces the previous regex-based filesystem scanning approach.

- **Backend**: `src-tauri/src/index/` module with `rusqlite` (bundled SQLite) and `comrak` AST parsing
- **Per-scope databases**: `~/.notesage/index.db` (global) and `<project>/.notesage/index.db` (per-project)
- **AST-parsed extraction**: Tags, mentions, tasks, goals extracted from comrak's document tree — no false positives from code blocks, frontmatter, or inline code
- **FTS5**: Full-text search with porter stemming for content search across all text files
- **Incremental updates**: Filesystem watcher triggers reindex of changed files via SHA-256 content hashing
- **iCloud safe**: `index.db` excluded from iCloud sync via xattr; each device rebuilds its own index from synced files

### State Management (Zustand)

All state stores use Zustand with the persist middleware for localStorage:

| Store | Purpose | Persistence |
| --- | --- | --- |
| `editor-store` | Open tabs, active tab, per-tab flags | Full |
| `workspace-store` | Explorer folders, projects, notes tree | Full |
| `project-metadata-store` | Project metadata from `.notesage/project.json` | Full |
| `settings-store` | Theme, soft contrast mode, UI preferences, `startupReady` flag | Full (except `startupReady`) |
| `ai-store` | AI provider config (legacy, fallback) | Full |
| `skill-store` | Skills registry, agents, instructions, active agent | Partial (overrides + active agent) |
| `connections-store` | Multi-provider connections, sandbox/network config, kernel enforcement, writable paths | Full |
| `routing-store` | Per-use-case provider routing | Full |
| `permission-store` | ACP tool call permissions, domain allowlists, session domains | Partial (`alwaysAllowed`, `alwaysAllowedDomains` only) |
| `chat-store` | Chat conversation messages | Full |
| `comment-store` | Comments, replies, delegation | JSON sidecar files |
| `mcp-store` | MCP server registry | Partial (enabled overrides) |
| `epub-store` | EPUB view mode + bookmarks | Full |
| ~~`tag-store`~~ | ~~Workspace tag index~~ | Removed — replaced by SQLite document index |
| `activity-store` | Agent task registry | Full |
| `recording-store` | Whisper models, downloads, language | Partial (`speechLanguage`, `defaultModel`) |
| `external-change-store` | Pending external changes with hunks | None |
| `local-ai-store` | Local AI server state, models | Partial (`enabled`, `activeModelId`, etc.) |

### Styling

- Tailwind for layout and general styling
- shadcn/ui for interactive components
- Editor content area uses ProseMirror's default styles with custom CSS overrides in `editor.css`
- Do NOT use styled-components, CSS modules, or emotion
- All colors defined as CSS variables in `globals.css` (supports light/dark mode)

### Security Model

**API Key Storage (OS Keychain):**

- API keys stored in the OS credential manager (macOS Keychain via `keyring` crate)
- Keys never written to localStorage — only non-sensitive connection metadata persisted via Zustand
- Backend resolves keys directly from keychain using `connection_id` — keys never transit through Tauri IPC
- Transparent migration: existing plaintext keys in localStorage are automatically moved to keychain on first launch
- Tauri commands: `store_credential`, `get_credential`, `delete_credential`, `migrate_credentials` in `credentials.rs`

**File System Access:**

- All file operations through Tauri IPC commands
- Rust backend enforces filesystem boundaries
- No direct frontend filesystem access
- OS-level filesystem sandboxing (Seatbelt on macOS) with configurable writable paths per connection

**Network Sandboxing:**

- **Two layers of enforcement:**
  - **Kernel-level (Seatbelt):** `(deny default)` blocks all network; only the proxy port on localhost is allowed. Agents physically cannot bypass the proxy. Enabled via `kernelNetworkDeny` toggle per connection (default: on for new connections).
  - **Proxy-level:** HTTP proxy on localhost (`network_proxy.rs`) filters by domain, prompts for unknown domains. This is the domain-aware filtering layer.
- Per-agent domain allowlists: built-in defaults per provider + user-configurable additions
- Domain approval cards in chat UI: allow once / allow for session / allow always / deny
- 30-second auto-deny timeout for unanswered domain requests
- Telemetry toggle per connection (e.g., sentry.io)
- Network restriction toggle + kernel enforcement toggle in connection config dialog
- Sandbox profiles written to temp files (ephemeral, cleaned up on agent exit)

**Violation Monitoring:**

- `sandbox_monitor.rs` streams macOS unified log for Seatbelt deny entries
- Filters by registered agent PIDs, deduplicates within 5s windows
- Violations surface as error entries in the Activity panel alongside tool calls

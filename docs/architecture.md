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
│   │   │   ├── sandbox_monitor.rs # Seatbelt violation monitoring (macOS log stream)
│   │   │   ├── acp_binary.rs   # ACP agent binary path resolution (PATH, Homebrew, npm, bundled)
│   │   │   ├── acp_client.rs   # ACP Client trait impl (Tauri event forwarding, permission channels)
│   │   │   ├── agent_manager.rs # Agent binary installation, versioning, progress tracking
│   │   │   ├── model_management.rs # Local LLM model lifecycle (catalog, download, RAM, capabilities)
│   │   │   ├── thinking_tags.rs # Thinking tag detection from llama-server Jinja2 chat templates
│   │   │   └── fonts.rs    # System font enumeration (font-kit crate)
│   │   ├── index/          # SQLite document index (tags, mentions, tasks, goals, FTS5)
│   │   │   ├── mod.rs      # IndexState, Tauri commands, indexing pipeline
│   │   │   ├── db.rs       # Schema creation, migrations, connection management
│   │   │   ├── parser.rs   # comrak AST walking — tags, mentions, headings, tasks, goals
│   │   │   ├── queries.rs  # SQL query builders for all search operations
│   │   │   ├── tasks.rs    # Task toggle via context-based matching
│   │   │   └── icloud.rs   # iCloud exclusion (xattr on macOS)
│   │   └── export/         # Document export engines (PDF, DOCX, PPTX, HTML)
│   │       ├── mod.rs
│   │       ├── typst_world.rs      # Typst World trait implementation
│   │       ├── markdown_to_typst.rs # Markdown → Typst markup converter
│   │       ├── markdown_to_docx.rs  # Markdown → DOCX converter (docx-rs)
│   │       ├── table_utils.rs       # Shared table utilities (metadata, aggregation, formatting)
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
│   │   │   ├── DrawingPreview.tsx, DrawingEditor.tsx
│   │   │   ├── ChangeListPopover.tsx, FindBar.tsx, StatusBar.tsx
│   │   │   ├── TableHeaderMenu.tsx  # Column type/aggregation context menu
│   │   │   └── extensions/ # Custom Tiptap extensions (see editor-architecture.md)
│   │   ├── sidebar/        # Sidebar.tsx, FileTree.tsx, FileTreeItem.tsx, ExplorerFolderItem.tsx
│   │   ├── tabs/           # TabBar.tsx, Tab.tsx
│   │   ├── settings/       # SettingsDialog, ConnectionsSettings, LocalAISettings, TranscriptionSettings, etc.
│   │   ├── chat/           # ChatPanel, ChatMessage, ChatInput, BranchSwitcher, PermissionCard, DomainApprovalCard, AgentSwitchCard, etc.
│   │   ├── activity/       # ActivityStrip.tsx, ActivityTaskCard.tsx
│   │   ├── editor/viewers/ # EpubViewer, PdfViewer, DocxViewer, PlainTextViewer, CodeEditor
│   │   └── ui/             # shadcn/ui components (auto-generated)
│   ├── hooks/              # React hooks (useEditor, useAIOperations, useAcpLifecycle, useAppLifecycle, useScrollPersistence, useEditorResize, etc.)
│   ├── stores/             # Zustand stores (editor, workspace, ai, chat, skill, etc.)
│   ├── lib/                # Utilities (markdown, tauri, ai/{context,errors}, dom-search, chat-tree, etc.)
│   └── styles/             # globals.css, editor.css
├── public/
│   ├── foliate-js/         # Vendored EPUB renderer (MIT)
│   └── logos/              # AI provider logos
├── bundled-skills/         # Built-in skills (extracted to ~/.notesage/skills/)
├── bundled-agents/         # Built-in agents (extracted to ~/.notesage/agents/)
├── src/perf/               # Performance benchmarks
│   ├── harness.ts          # Benchmark runner (median timing, budget multiplier, test editor factory)
│   ├── harness.test.ts     # Harness self-tests
│   ├── setup.ts            # jsdom setup for ProseMirror benchmarks
│   ├── markdown.perf.test.ts    # Parse/serialize benchmarks (1KB–100KB)
│   ├── decorations.perf.test.ts # Search + tag decoration rebuild benchmarks
│   └── stores.perf.test.ts      # Store ops + command palette filter benchmarks
├── src/test/               # Test infrastructure
│   ├── tauri-mock.ts       # Vitest Tauri IPC mock (invoke handlers, event listeners, toast)
│   ├── component-harness.tsx # React testing utilities
│   ├── mock-data.ts        # Test data generators
│   └── mock-editor.ts      # Mock editor instance
├── tests/fixtures/         # Test fixtures
│   ├── *.md                # Markdown round-trip test files
│   └── perf/               # Pre-generated perf fixtures (1KB, 10KB, 50KB, 100KB)
├── e2e/                    # Playwright E2E tests (mocked Tauri IPC)
│   ├── tests/              # Test specs (app-loads, chat, editor, file-operations, navigation)
│   └── fixtures/           # Sample data + Tauri mock injection
├── e2e-real/               # Real E2E tests (WebDriverIO + Tauri WebDriver)
│   ├── tests/              # Test specs (editor, external-changes, navigation, performance, startup, tabs)
│   ├── fixtures/           # Real filesystem test project
│   └── helpers/            # Setup, actions, timing utilities
├── scripts/                # Build and test scripts
│   ├── coverage-check.sh   # Coverage regression detection vs baseline
│   ├── update-coverage-baseline.js # Generate coverage-baseline.json from Istanbul output
│   └── run-real-e2e.sh     # Full real E2E orchestrator (app + driver lifecycle)
├── docs/                   # Documentation
│   ├── features/           # Feature-specific docs (editor, ai-providers, ai-workflows, etc.)
│   ├── prds/               # Product requirements documents
│   ├── tasks/              # Implementation task breakdowns
│   ├── history/            # Implementation history
│   └── performance-baseline.md # Benchmark baseline with budget thresholds
├── coverage-baseline.json  # Per-file coverage snapshot for regression detection
├── CLAUDE.md               # Project spec (references docs/)
├── package.json
├── tsconfig.json
├── vitest.config.ts        # Main test config (excludes perf tests)
├── vitest.perf.config.ts   # Performance benchmark config
├── playwright.config.ts    # Playwright E2E config
├── wdio.conf.ts            # WebDriverIO real E2E config
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
| `settings-store` | Theme, soft contrast mode, UI preferences, `startupReady` flag, `toolCallingEnabled`, `searchProvider` | Full (except `startupReady`) |
| `ai-store` | AI provider config (legacy, fallback) | Full |
| `skill-store` | Skills registry, agents, instructions, active agent | Partial (overrides + active agent) |
| `connections-store` | Multi-provider connections, sandbox/network config, kernel enforcement, writable paths | Full |
| `routing-store` | Per-use-case provider routing | Full |
| `permission-store` | ACP tool call permissions, domain allowlists, session domains, tool call permissions (`toolCallSession`, `toolCallAlways`) | Partial (`alwaysAllowed`, `alwaysAllowedDomains`, `toolCallAlways` only) |
| `chat-store` | Chat conversations with tree-based branching (id/parentId/activeLeafId), memoized thread selectors | Full |
| `comment-store` | Comments, replies, delegation | JSON sidecar files |
| `mcp-store` | MCP server registry | Partial (enabled overrides) |
| `epub-store` | EPUB view mode + bookmarks | Full |
| ~~`tag-store`~~ | ~~Workspace tag index~~ | Removed — replaced by SQLite document index |
| `activity-store` | Agent task registry | Full |
| `recording-store` | Whisper models, downloads, language | Partial (`speechLanguage`, `defaultModel`) |
| `external-change-store` | Pending external changes with hunks | None |
| `local-ai-store` | Local AI server state, models | Partial (`enabled`, `activeModelId`, etc.) |
| `action-store` | Actions dashboard (task/goal scanning, comments, agent tasks) | Partial (`actionCache`, `filter` only) |
| `diff-review-store` | Git branch diff review with per-hunk accept/reject | None |
| `editor-styles-store` | Editor font family, size, line height, paragraph spacing | Disk file (`editor-styles.json`) |
| `git-store` | Git repo state per path (branch, file statuses, loading) | None |
| `pdf-store` | PDF viewer preferences (zoom, fit mode, bookmarks) | Full |
| `sync-store` | iCloud sync settings (enabled flag, synced projects) | Disk file (settings JSON) |
| `tool-permission-store` | Pending tool call permission requests for direct API tool calling | None |

### Styling

- Tailwind for layout and general styling
- shadcn/ui for interactive components
- Editor content area uses ProseMirror's default styles with custom CSS overrides in `editor.css`
- Do NOT use styled-components, CSS modules, or emotion
- All colors defined as CSS variables in `globals.css` (supports light/dark mode)

### Testing

| Command | What it runs | Notes |
| --- | --- | --- |
| `pnpm test` | Vitest unit tests | Fast, one-shot run |
| `pnpm test:coverage` | Unit tests + Istanbul coverage | Reports: text (console), JSON summary, HTML in `./coverage/` |
| `cd src-tauri && cargo test` | Rust backend tests | Runs all `#[test]` functions in the Tauri crate |
| `pnpm test:e2e` | Playwright end-to-end tests | Chromium, Tauri IPC mocked, starts Vite dev server |
| `pnpm test:e2e-real` | Real E2E tests (WebDriverIO) | Requires running app (`pnpm tauri:test`) + `tauri-webdriver` |
| `pnpm test:e2e-real-full` | Real E2E full lifecycle | Starts app + driver, runs tests, cleans up |
| `pnpm test:perf` | Performance benchmarks | Markdown parse/serialize, decorations, stores — uses `vitest.perf.config.ts` |
| `pnpm test:all` | All of the above (excludes real E2E and perf) | Full suite |
| `pnpm typecheck` | TypeScript type checking | `tsc --noEmit` |
| `pnpm coverage:check` | Coverage regression detection | Compares changed files against `coverage-baseline.json` |
| `pnpm coverage:update-baseline` | Update coverage baseline | Runs tests + writes `coverage-baseline.json` |

**Test inventory (2026-03-30):** 65 unit test files (18 stores, 10 components, 11 hooks, 11 libraries, 6 extensions, 4 perf harness), 5 Playwright E2E specs, 7 real E2E specs. ~1537 total test cases.

**Frontend coverage** uses `@vitest/coverage-istanbul` and requires Node 22 (pinned in `.nvmrc`). Coverage output lands in `./coverage/` (gitignored). Coverage baseline tracked in `coverage-baseline.json` with per-file metrics. Regression detection via `scripts/coverage-check.sh`: identifies changed `.ts`/`.tsx` files via git diff, compares per-file coverage against baseline, reports regressions. Currently warning-only (exit 0).

**Rust coverage** uses `cargo-tarpaulin` or `cargo-llvm-cov` in CI. Neither is required locally — contributors run `cargo test` directly.

**CI pipeline** (`.github/workflows/test.yml`) runs on push to `main` and PRs with three parallel jobs:

1. **Frontend tests:** typecheck → unit tests with coverage → performance benchmarks (`PERF_BUDGET_MULTIPLIER=1.5`) → coverage regression check (PR only) → post coverage summary to PR via `vitest-coverage-report-action`
2. **Playwright E2E:** install Chromium → run E2E specs → upload report on failure
3. **Rust backend:** install stable toolchain → `cargo test` in `src-tauri/`

All jobs must pass for merge. Perf benchmark results uploaded as CI artifacts (14-day retention).

### Performance Benchmarks

Performance benchmark infrastructure in `src/perf/` measures critical editor operations against budget thresholds. Baseline recorded on Apple M3 (24GB) in `docs/performance-baseline.md`.

**Benchmark harness** (`src/perf/harness.ts`):

- `benchmark(name, fn, budgetMs, iterations)` — runs N times (default 3), uses median elapsed, multiplies budget by `PERF_BUDGET_MULTIPLIER` env var (default 1.0)
- `generateMarkdown(sizeKB)` — synthetic markdown with realistic mixed content (headings, lists, code blocks, tables, tags, mentions)
- `createTestEditor(content)` — Tiptap editor factory matching production extension set
- Pre-generated fixtures in `tests/fixtures/perf/` (1KB, 10KB, 50KB, 100KB)

**Benchmark suites:**

| Suite | What it measures | Budget range |
| --- | --- | --- |
| `markdown.perf.test.ts` | Parse (markdown → ProseMirror) and serialize (ProseMirror → markdown) at 4 sizes | Parse: 34–364ms, Serialize: 1–15ms |
| `decorations.perf.test.ts` | Search highlight and tag decoration rebuilds at 4 sizes | All under 2ms |
| `stores.perf.test.ts` | `updateTabContent` (10–100 tabs), `listDirectory` (100–1000 entries), command palette filter (500 entries) | 1–20ms |

**Budget multipliers:** Dev 1x (strict), CI 1.5x (runner variability). Baseline doc records dev 2x and CI 3x as recommended maximums.

### Performance Instrumentation

Structured performance logging embedded in production code via `src/lib/logger.ts`. All entries use `[perf:category]` prefixes for filtering. Logger batches entries (flush every 500ms or 20 entries) and forwards to Rust backend via Tauri IPC.

| Category | Location | What it measures |
| --- | --- | --- |
| `[perf:startup]` | `useAppLifecycle.ts` | Tree validation, index init (per-project + total), tab restoration, total startup time |
| `[perf:save]` | `useFileOperations.ts` | Serialization time, Tauri write time, total save time per file |
| `[perf:tree]` | `useFileOperations.ts`, `workspace-store.ts` | Per-directory load time, entry count, total tree refresh |
| `[perf:find]` | `search-highlight.ts` | Query, match count, doc node size, elapsed time |
| `[perf:typing]` | `tag-highlight.ts`, `search-highlight.ts`, `comment-mark.ts` | Decoration rebuild per keystroke (sampled every 10th keystroke) |
| `[perf:palette]` | `CommandPalette.tsx`, `SymbolSearchResults.tsx` | Mode, query, result count, IPC timing for index-backed modes |
| `[perf:tab-load]` | `Editor.tsx` | File type, size, load elapsed time |
| `[perf:skills]` | `useSkillOperations.ts` | Skill/agent/instruction discovery timing |
| `[perf:ai-chat]` | `useDirectApiChat.ts` | First token latency, stream complete (provider, total tokens, elapsed) |
| `[perf:index]` | `src-tauri/src/index/mod.rs` | Index build (project, files, changed, ms), query timing per type |

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

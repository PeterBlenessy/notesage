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
│   │   │   ├── copilot_lsp.rs # Copilot Language Server orchestrator (commands, state)
│   │   │   ├── copilot_protocol.rs # JSON-RPC transport, reader loop, server→client handlers
│   │   │   ├── copilot_signin.rs   # Device code auth helpers (field extraction)
│   │   │   ├── copilot_models.rs   # CopilotModel type, parser, fallback list
│   │   │   ├── mcp.rs      # MCP client (JSON-RPC stdio transport, server lifecycle, tool discovery/call)
│   │   │   ├── skills.rs   # Skill discovery, bundled skill extraction, commands
│   │   │   ├── skills_frontmatter.rs # YAML frontmatter parsing, SkillFrontmatter struct
│   │   │   ├── skills_tool_parser.rs # Tool definition extraction, usage comment parsing, ArgMapping
│   │   │   ├── agents.rs   # Agent discovery, cleanup legacy bundled agents, agent instructions
│   │   │   ├── script_exec.rs # Skill script execution, interpreter resolution, sandboxing
│   │   │   ├── json_rpc.rs # Shared JSON-RPC 2.0 types, Content-Length framing, pending requests
│   │   │   ├── export.rs   # PDF export commands
│   │   │   ├── git.rs      # Git operations
│   │   │   ├── watcher.rs  # Filesystem watcher (notify crate)
│   │   │   ├── ai_streaming.rs # AI streaming orchestrators (Anthropic, OpenAI, Ollama, compatible)
│   │   │   ├── tool_execution.rs # Tool call parsing, accumulators (extracted from ai_streaming)
│   │   │   ├── segment_builder.rs # Thinking tag detection, template extraction (extracted from ai_streaming)
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
│   │   │   ├── sandbox.rs       # Seatbelt profile generation (kernel network deny)
│   │   │   ├── sandbox_monitor.rs # Seatbelt violation monitoring (macOS log stream)
│   │   │   ├── web_search.rs   # DuckDuckGo web search (no API key required)
│   │   │   ├── link_preview.rs # OpenGraph metadata fetch for link preview cards
│   │   │   ├── constants.rs    # Shared constants (app paths, defaults)
│   │   │   ├── acp_binary.rs   # ACP agent binary path resolution (PATH, Homebrew, npm, bundled)
│   │   │   ├── acp_client.rs   # ACP Client trait impl (Tauri event forwarding, permission channels)
│   │   │   ├── agent_manager.rs # Agent binary installation, versioning, progress tracking
│   │   │   ├── model_management.rs # Local LLM model lifecycle (catalog, download, custom models)
│   │   │   ├── model_providers/   # Extracted from model_management
│   │   │   │   ├── hf_search.rs   # HuggingFace model search & details API
│   │   │   │   └── binary_resolution.rs # llama-server binary resolution & diagnostics
│   │   │   ├── thinking_tags.rs # Thinking tag detection from llama-server Jinja2 chat templates
│   │   │   ├── fonts.rs    # System font enumeration (font-kit crate)
│   │   │   └── theme.rs    # `get_system_accent_color` (macOS NSColor → oklch for accent picker)
│   │   ├── tray.rs         # System tray icon, menu (no global Quick Capture shortcut yet), close-to-tray
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
│   │       ├── markdown_to_typst.rs # Markdown → Typst markup converter (PDF)
│   │       ├── markdown_to_docx.rs  # Markdown → DOCX converter (docx-rs)
│   │       ├── markdown_to_pptx.rs  # Markdown → PPTX converter (ppt-rs)
│   │       ├── markdown_to_html.rs  # Markdown → standalone HTML / clipboard fragment (comrak + syntect)
│   │       ├── html_styles.rs       # Embedded CSS templates for HTML export (light + dark)
│   │       ├── page_settings.rs     # Page-size + margin parsing (A4, Letter, A5)
│   │       ├── typography.rs        # Shared typography helpers (font lookup, fallbacks)
│   │       ├── table_utils.rs       # Shared table utilities (metadata, aggregation, formatting)
│   │       └── templates.rs        # PDF + PPTX template loading and parameterization
│   ├── binaries/           # Bundled sidecar binaries (llama-server + dylibs)
│   ├── model-catalog.json  # Curated LLM model catalog (embedded at compile time)
│   ├── fonts/              # Bundled fonts (Inter, Source Serif 4, JetBrains Mono)
│   ├── templates/          # Typst template presets (clean.typ, academic.typ, report.typ)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── capabilities/
├── src/                    # React frontend
│   ├── main.tsx            # Entry point
│   ├── App.tsx             # Root component — mounts lifecycle hooks, renders Layout (or QuietLayout) + dialogs
│   ├── components/
│   │   ├── Layout.tsx      # Legacy layout (ResizablePanelGroup: sidebar, editor, chat, activity)
│   │   ├── QuietLayout.tsx # Quiet Composer layout — gated on settings.uiPreview === "quiet-composer" (PRD 2026-04-21-ui-refresh)
│   │   ├── ErrorBoundary.tsx # Reusable error boundary (wraps editor, chat, sidebar)
│   │   ├── editor/         # Tiptap editor components
│   │   │   ├── Editor.tsx, EditorContent.tsx, Toolbar.tsx, SlashCommand.tsx
│   │   │   ├── BubbleMenu.tsx, CommentPopover.tsx, CommentListPopover.tsx
│   │   │   ├── CommentThread.tsx, DelegationPanel.tsx
│   │   │   ├── TranscriptionOverlay.tsx, SourceModeEditor.tsx
│   │   │   ├── DrawingPreview.tsx, DrawingEditor.tsx
│   │   │   ├── ChangeListPopover.tsx, FindBar.tsx, StatusBar.tsx
│   │   │   ├── FocusPill.tsx     # Floating exit affordance for focus mode
│   │   │   ├── StatusTray.tsx    # Quiet Composer status tray popover
│   │   │   ├── TableHeaderMenu.tsx  # Column type/aggregation context menu
│   │   │   └── extensions/ # Custom Tiptap extensions (see editor-architecture.md)
│   │   ├── cmd/            # Floating command bar (Quiet Composer)
│   │   │   ├── FloatingCommandBar.tsx, CommandBarContext.tsx, CommandBarHistory.tsx
│   │   │   ├── CommandBarStream.tsx, AttachmentChips.tsx, prefix-modes.ts
│   │   │   └── modes/      # Prefix-mode pickers (SkillMode, ReferenceMode, TagMode, TaskMode, ResearchMode, PaletteMode)
│   │   ├── sidebar/        # Sidebar.tsx, FileTree.tsx, FileTreeItem.tsx, ExplorerFolderItem.tsx
│   │   │   └── quiet/      # Quiet Composer sidebar — QuietSidebar.tsx, PinnedSection.tsx, ProjectsSection.tsx, RecentSection.tsx, TagsSection.tsx, MentionsSection.tsx, SidebarContextMenu.tsx, SidebarInlineEdit.tsx, SidebarRowIndicators.tsx, FilePreview.tsx, FolderPeek.tsx, TreeOverlay.tsx, aria-announcer.ts, useRovingTabindex.ts, useSidebarItemShortcuts.ts, rename-utils.ts, sidebar-clipboard.ts, file-drag.ts
│   │   ├── tabs/           # TabBar.tsx, Tab.tsx
│   │   ├── settings/       # Legacy SettingsDialog, ConnectionsSettings, LocalAISettings, TranscriptionSettings, etc.
│   │   │   └── v2/         # Quiet Composer settings shell — SettingsDialogV2, SettingsShell, SettingsRow, SettingsGroup, SettingsSearch + per-area panels (Appearance, General, Editor, AI, Skills, Projects, Privacy, Advanced, About)
│   │   ├── chat/           # ChatPanel, ChatMessage, ChatInput, BranchSwitcher, PermissionCard, DomainApprovalCard, AgentSwitchCard, AttachmentStrip, segments/, etc.
│   │   ├── activity/       # ActivityStrip.tsx, ActivityTaskCard.tsx, AgentOrb.tsx, AgentPanel.tsx
│   │   ├── editor/viewers/ # EpubViewer, PdfViewer, DocxViewer, PlainTextViewer, CodeEditor, PptxViewer (+ PptxSlideRenderer, PptxChartRenderer, PptxSearchBar, PptxZoomControls)
│   │   └── ui/             # shadcn/ui components (auto-generated)
│   ├── hooks/              # React hooks (useEditor, useAIOperations, useAcpLifecycle, useAppLifecycle, useScrollPersistence, useEditorResize, useTrayEvents, useTraySync, useFadeOnType, useFocusMode, useWindowFocus, useReducedMotion, useCommandBarShortcuts, useDoubleTapCmd, useRecentDocumentCycle, etc.)
│   ├── stores/             # Zustand stores (editor, workspace, ai, chat, skill, tree-overlay, quiet-sidebar, etc.)
│   ├── lib/                # Utilities (markdown, tauri, ai/{context,errors,vision}, dom-search, chat-tree, conversationOps, segmentOps, image-compress, cmd-bar-events, contrast-math, quiet-chrome, quiet-chrome-presets, accent, saved-ago, tray-recents, etc.)
│   └── styles/             # globals.css, editor.css (+ __tests__/reduced-motion-sweep.test.ts, __tests__/accent.test.ts)
├── public/
│   ├── foliate-js/         # Vendored EPUB renderer (MIT)
│   └── logos/              # AI provider logos
├── bundled-skills/         # Built-in skills (extracted to ~/.notesage/skills/)
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
│   ├── contrast-audit.ts   # WCAG contrast audit for design-system palette (`pnpm audit:contrast`)
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
- **Scope**: Only projects and `~/Notesage` are indexed. Explorer folders are intentionally excluded — this is a data security decision (users may open arbitrary system directories via Explorer; indexing them would persist their content in our SQLite databases)
- **iCloud safe**: `index.db` excluded from iCloud sync via xattr; each device rebuilds its own index from synced files

### State Management (Zustand)

All state stores use Zustand with the persist middleware for localStorage:

| Store | Purpose | Persistence |
| --- | --- | --- |
| `editor-store` | Open documents (`openDocuments[]` — renamed from legacy `openTabs`), `activeTabId`, `closeTab`, per-document flags. The store property names retain "tab" for the active-id and close action; only the array was renamed. UI surfaces (Quiet Composer) show the document via `TitleBar` + sidebar, not as tabs | Full |
| `workspace-store` | Explorer folders, projects, notes tree | Full |
| `project-metadata-store` | Project metadata from `.notesage/project.json` (incl. optional `aiLock: { connectionId, lockedAt, reason? }`) | Full |
| `settings-store` | Theme, accent (`accent`, `tintHue`, `tintChroma`), contrast slider, UI preferences, `startupReady` flag, `toolCallingEnabled`, `searchProvider`, `showHiddenFiles`, tray settings (`showInTray`, `closeToTray`, `startAtLogin`), notification settings (`notifyAgentCompletion`, `notifyExternalChanges`), isolation flags (`crossProjectMode`, `completionsOnOutOfScope`, `requireAllToolConfirmations`), Quiet Composer flags (`uiPreview`, `cmdBarPinned`, `cmdBarPinnedWidth`, `quietChromePreset`, `quietChromeOverrides`, `sidebarRecentCap`, `sidebarTagsCap` (clamp `[0, 15]`; `0` hides the section), `sidebarMentionsCap` (clamp `[0, 15]`; `0` hides the section)), home directory | Full (except `startupReady`) |
| `ai-store` | AI provider config — predates `routing-store` / `connections-store`; kept for one-time migration of v1 settings and as a fallback when no routing entry exists. Not deprecated for usage, deprecated for new features | Full |
| `skill-store` | Skills registry (`{ global, byProject }`), agents, instructions, active agent (default: none) | Partial (overrides + active agent) |
| `connections-store` | Multi-provider connections, sandbox/network config, kernel enforcement, writable paths | Full |
| `routing-store` | Per-use-case provider routing | Full |
| `permission-store` | ACP tool call permissions, domain allowlists, session domains, tool call permissions. Scoped `ScopedApproval[]` triples: `{ toolName, connectionId, projectRoot, grantedAt }` | Partial (`alwaysAllowed`, `alwaysAllowedDomains`, `toolCallAlways`, `skillScriptAlways` only — all as `ScopedApproval[]`) |
| `chat-store` | Chat conversations with tree-based branching (id/parentId/activeLeafId), memoized thread selectors, chronological message segments. `ConversationSegment.startMessageId` (stable id, v5+) replaces `startMessageIndex` (deprecated); `sliceThreadBySegment` uses LCA walk for branching-aware slicing | Full |
| `comment-store` | Comments, replies, delegation | JSON sidecar files |
| `mcp-store` | MCP server registry (`{ global, byProject }` with `projectRoot` per entry); scope-gated `getActiveServers` / `getActiveTools` | Partial (enabled overrides) |
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
| `agent-status-store` | ACP agent unresponsive/exited banner state | None |
| `tree-overlay-store` | Quiet Composer TreeOverlay open/closed state + optional `focusedPath` for FolderPeek footer link (PRD 2026-04-21-ui-refresh) | None |
| `quiet-sidebar-store` | Quiet Composer sidebar inline-edit signals: `pendingCreate` (new file under a project) and `pendingCreateProject` (new project under notes root) | None |

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

**Test inventory (2026-04-07):** 99 unit test files, 5 Playwright E2E specs, 7 real E2E specs. ~2160 total test cases.

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
| `[perf:startup]` | `useAppLifecycle.ts` | Tree validation, index init (per-project + total), tab restoration, total startup time. Also `log.info("startup", ...)` at each major step (forwarded to backend log) for production debugging. 30s global timeout + 10s per-step timeouts for cloud storage paths. |
| `[perf:save]` | `useFileOperations.ts` | Serialization time, Tauri write time, total save time per file |
| `[perf:tree]` | `useFileOperations.ts`, `workspace-store.ts` | Per-directory load time, entry count, total tree refresh |
| `[perf:find]` | `search-highlight.ts` | Query, match count, doc node size, elapsed time |
| `[perf:typing]` | `tag-highlight.ts`, `search-highlight.ts`, `comment-mark.ts` | Decoration rebuild per keystroke (sampled every 10th keystroke) |
| `[perf:palette]` | `CommandPalette.tsx`, `SymbolSearchResults.tsx` | Mode, query, result count, IPC timing for index-backed modes |
| `[perf:tab-load]` | `Editor.tsx` | File type, size, load elapsed time |
| `[perf:skills]` | `useSkillOperations.ts` | Skill/agent/instruction discovery timing |
| `[perf:ai-chat]` | `useDirectApiChat.ts` | First token latency, stream complete (provider, total tokens, elapsed) |
| `[perf:index]` | `src-tauri/src/index/mod.rs` | Index build (project, files, changed, ms), query timing per type |
| `[perf:cmdbar]` | `FloatingCommandBar` | Focus, dismiss, prefix morph, attachment chips |
| `[perf:orb]` | `AgentOrb` | Panel open, pulse cost |
| `[perf:status]` | `StatusBar`, `StatusTray` | StatusBar render, StatusTray popover open |
| `[perf:peek]` | `FolderPeek` | Hover popover unfurl |
| `[perf:tree-overlay]` | `TreeOverlay` | Slide-in, expand/collapse |
| `[perf:sidebar]` | `Sidebar` | Sidebar render, type-to-filter |
| `[perf:focus]` | Focus mode | Focus mode enter/exit transition timing |

Category names are exported as `PERF` constants from `src/lib/logger.ts` (`PERF.cmdbar`, `PERF.orb`, etc.) — call sites should reference the constant rather than the raw `'perf:foo'` string literal so typos surface at typecheck time.

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
- **Chat agents:** writable paths = `getChatSandboxScope(conv, connection, crossProjectMode)` — the chat footer's selected projects (plus `extraWritablePaths`), or all workspace paths if cross-project mode is on. Scope change triggers agent respawn.
- **Read policy (task #6d):** `(deny file-read* (subpath "$HOME"))` + curated allow-list for Bucket B (language tooling runtime) and Bucket C (per-agent config, narrowed by agent binary — `claude-agent-acp` gets `~/.claude`, `codex-acp` gets `~/.codex`, etc.). Sibling projects at neutral `$HOME` paths are no longer mutually readable when only one is selected.
- **Direct-API tool executor:** `src/lib/tool-executor.ts` gates `read_file`, `list_directory`, `write_file`, and the implicit-FS tools (`add_comments`, `list_comments`, `resolve_comments`, `generate_pptx`) on `isToolCallAllowed(name, JSON.stringify(args), scope.projectRoots, scope.homeDir)`. Missing scope defaults to deny. Call sites pass scope from `selectProjectPaths(chat-store)`.
- **Copilot LSP:** document sync (`didOpen`, `didChange`, `didFocus`), context requests (`copilot/context-request`), and inline completion requests (`textDocument/inlineCompletion`) all gate on `isUriInScope(uri, scope)` from `src/lib/ai/uri-scope.ts`. Out-of-scope tabs suppressed; per-tab toast explains. Opt out via `completionsOnOutOfScope: true`.

**Project isolation enforcement points (summary):**

| Surface | Gate | File |
| --- | --- | --- |
| ACP agent writable paths | Seatbelt writable block from `getChatSandboxScope` | `src/lib/ai/acp-utils.ts` → `src-tauri/src/commands/sandbox.rs` |
| ACP kernel read policy | Deny `$HOME` + Bucket B/C re-allow + writable paths | `src-tauri/src/commands/sandbox.rs` |
| ACP path filter | `isToolCallAllowed` on every tool call (auto-allow AND user-approve paths) | `src/lib/ai/path-filter.ts`, `useAcpSessionListeners.ts` |
| Direct-API tool executor | `FILESYSTEM_TOOLS` + implicit-FS tools scope gate | `src/lib/tool-executor.ts` |
| Copilot LSP document sync | `isUriInScope` on every doc event | `src/hooks/useCopilotChat.ts`, `useCopilotCompletion.ts` |
| Inline completions (all providers) | `isUriInScope` before request | `src/hooks/useCopilotCompletion.ts`, `useLocalCompletion.ts` |
| Active-tab auto-attach | `isUriInScope` or explicit opt-in | `src/hooks/useChatContext.ts` |
| System-prompt "Currently editing" | `isUriInScope` on active tab path | `src/hooks/useAIContext.ts` |
| System-prompt file tree | `isUriInScope` per entry + 200-file / 4-level cap | `src/lib/ai/context.ts`, `useAIContext.ts` |
| Skills / agents / MCP injection | `{ global, byProject }` registries merged by `selectedProjectPaths` | `src/stores/skill-store.ts`, `mcp-store.ts`, `useSkillOperations.ts` |
| Approvals persistence | `ScopedApproval` triples with migration from legacy flat strings | `src/stores/permission-store.ts` |
| `aiLock` enforcement | `ProjectLockViolation` at every send path | `src/lib/ai/project-lock.ts`, `useAIOperations.ts`, `useAgentTaskOperations.ts`, `ChatFooter.tsx` |
| Resend/edit provider mismatch | `ResendProviderDialog` on `ChatMessage.connectionId` mismatch | `src/components/chat/ChatPanel.tsx`, `ResendProviderDialog.tsx` |
| Command palette / history / tray | Scope by `selectedProjectPaths` with "all" opt-in | `CommandPalette.tsx`, `HistoryTab.tsx`, `useTraySync.ts` |
| Segment boundary slicing | `startMessageId` anchor + branching-aware LCA walk | `src/stores/chat-store.ts` (`sliceThreadBySegment`) |

Most isolation work is covered by PRD `2026-04-18-project-data-isolation.md` and its task breakdown. The 2026-04-20 red-team pass (`docs/audits/2026-04-20-red-team.md`) confirms every Critical and High leak from the audit is no longer reproducible, with permanent regression-lock tests for each.

**Tauri capability surface (hardened 2026-04-19, task #21 in project-data-isolation):**

- `src-tauri/capabilities/default.json` grants only `core:default`, `dialog:default`, `opener:default`, `updater:default`, `process:default`, a narrow `http:default` allowlist scoped to the Notesage GitHub release endpoint, `notification:*`, and `autostart:default`. No `fs:allow-*` permissions are granted — the renderer never imports `@tauri-apps/plugin-fs`, so a compromised frontend dependency cannot bypass the vetted Rust commands in `commands/file.rs`.
- `tauri.conf.json`'s `assetProtocol.scope.allow` is a finite list of Tauri path variables (`$HOME`, `$APPDATA`, `$APPLOCALDATA`, `$APPCACHE`, `$RESOURCE`, `$TEMP`) instead of `**`. The asset protocol (used by `convertFileSrc` for images, drawing SVGs, and the PDF/EPUB/DOCX/PPTX viewers) can no longer serve files outside the user's home directory or the app's own sandboxed areas, closing the silent-exfil path where agent-authored markdown could point to `/etc/hosts`, `/private/var/...`, etc.
- Regression lock: `src/lib/__tests__/tauri-capability-surface.test.ts` asserts the narrowed scope and the absence of `fs:allow-*` permissions; future config tweaks that re-open the hole will fail this test.

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

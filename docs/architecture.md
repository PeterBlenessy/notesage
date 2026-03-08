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
│   │   ├── lib.rs          # Tauri builder + RunEvent::Exit cleanup hook
│   │   ├── commands/       # Tauri IPC commands
│   │   │   ├── mod.rs
│   │   │   ├── file.rs     # File read/write/list/copy operations
│   │   │   ├── dialog.rs   # Native file/folder dialogs
│   │   │   ├── ai.rs       # AI provider commands (direct API)
│   │   │   ├── acp.rs      # ACP agent management (spawn, auth, sessions, permissions, cleanup)
│   │   │   ├── copilot_lsp.rs # Copilot Language Server (JSON-RPC, inline completions)
│   │   │   ├── mcp.rs      # MCP client (JSON-RPC stdio transport, server lifecycle, tool discovery/call)
│   │   │   ├── skills.rs   # Skill/agent discovery, script execution, bundled extraction
│   │   │   ├── export.rs   # PDF export commands
│   │   │   ├── git.rs      # Git operations
│   │   │   └── watcher.rs  # Filesystem watcher (notify crate)
│   │   └── export/         # PDF export engine
│   │       ├── mod.rs
│   │       ├── typst_world.rs      # Typst World trait implementation
│   │       ├── markdown_to_typst.rs # Markdown → Typst markup converter
│   │       └── templates.rs        # Template loading and parameterization
│   ├── fonts/              # Bundled fonts (Inter, Source Serif 4, JetBrains Mono)
│   ├── templates/          # Typst template presets (clean.typ, academic.typ, report.typ)
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
│   │   │   ├── CommentPopover.tsx   # Comment create/view/delegate popover
│   │   │   ├── CommentListPopover.tsx # Status bar comment list with delegation
│   │   │   ├── ChangeListPopover.tsx  # Status bar external change list
│   │   │   ├── FindBar.tsx             # Find and replace bar (Cmd+F / Cmd+Shift+H)
│   │   │   ├── StatusBar.tsx          # Editor status bar
│   │   │   └── extensions/         # Custom Tiptap extensions
│   │   │       ├── index.ts
│   │   │       ├── ghost-text.ts   # Copilot ghost text (ProseMirror widget decorations)
│   │   │       ├── comment-mark.ts # Comment highlight decorations with status classes
│   │   │       ├── inline-diff.ts  # Inline diff decorations (external changes + git review)
│   │   │       ├── search-highlight.ts # Find-in-document match decorations (ProseMirror plugin)
│   │   │       ├── tag-highlight.ts # Inline tag badge decorations (#tag → styled pill)
│   │   │       ├── tag-suggestion.tsx # Tag autocomplete popup (triggered by # character)
│   │   │       └── slash-command.ts
│   │   ├── sidebar/
│   │   │   ├── Sidebar.tsx         # Main sidebar container
│   │   │   ├── FileTree.tsx        # File/folder tree
│   │   │   ├── FileTreeItem.tsx    # Individual tree node
│   │   │   ├── ExplorerFolderItem.tsx # Collapsible explorer folder entry
│   │   ├── tabs/
│   │   │   ├── TabBar.tsx          # Tab bar for open files
│   │   │   └── Tab.tsx             # Single tab
│   │   ├── ExportDialog.tsx          # PDF export options dialog
│   │   ├── NewNoteDialog.tsx        # New note creation dialog
│   │   ├── NewProjectDialog.tsx     # New project creation dialog
│   │   ├── settings/
│   │   │   ├── SettingsDialog.tsx  # Main settings modal
│   │   │   ├── AISettings.tsx      # AI provider configuration (legacy)
│   │   │   ├── ConnectionsSettings.tsx # Multi-provider connections management
│   │   │   ├── ConnectionCard.tsx  # Single connection display card
│   │   │   ├── UseCaseRoutingSettings.tsx # Per-use-case provider routing
│   │   │   ├── SkillsSettings.tsx  # Skills & Agents settings tab (skills browser, agents, agent instructions, management)
│   │   │   ├── McpServersSettings.tsx # MCP Servers section (server cards, add/edit/import dialogs)
│   │   │   └── ProjectSettings.tsx # Project-level settings
│   │   ├── chat/
│   │   │   ├── ChatPanel.tsx       # AI chat sidebar (context-aware footer: Tools popover for ACP, Search toggle for direct API)
│   │   │   ├── ChatMessage.tsx     # Individual message with activity log
│   │   │   ├── ChatInput.tsx       # Message input (/ for skills, @ for agents)
│   │   │   ├── QuickReplies.tsx   # Quick reply chips parsed from AI responses
│   │   │   ├── SkillCommandMenu.tsx # Skill slash command autocomplete (/skill-name)
│   │   │   ├── AgentCommandMenu.tsx # Agent @ command autocomplete (@agent-name)
│   │   │   └── PermissionCard.tsx  # ACP tool call approval (allow once/session/always, deny)
│   │   ├── activity/
│   │   │   ├── ActivityStrip.tsx   # Agent activity strip (ActivityRail: 40px rail) + agent activity panel (ActivityPanel: resizable sidebar)
│   │   │   └── ActivityTaskCard.tsx # Individual agent task card with streaming output
│   │   ├── AgentIcon.tsx           # Agent icon renderer (Lucide name or emoji, fallback to UserRound)
│   │   ├── MarkdownContent.tsx     # Shared markdown renderer (ReactMarkdown + remarkGfm)
│   │   ├── editor/viewers/        # Non-markdown file viewers
│   │   │   ├── EpubViewer.tsx     # EPUB reader (foliate-js Web Component, Cmd+F search)
│   │   │   ├── PdfViewer.tsx      # PDF viewer (pdfjs-dist, Cmd+F search)
│   │   │   ├── DocxViewer.tsx     # DOCX viewer (mammoth HTML, Cmd+F DOM search)
│   │   │   └── PlainTextViewer.tsx # Plain text viewer (Cmd+F DOM search)
│   │   └── ui/             # shadcn/ui components (auto-generated)
│   ├── hooks/
│   │   ├── useEditor.ts            # Tiptap editor instance hook
│   │   ├── useFileOperations.ts    # File create/open/save/delete operations
│   │   ├── useFileWatcher.ts       # Filesystem watcher event handler
│   │   ├── useExportOperations.ts  # PDF export flow orchestration
│   │   ├── useProjectMetadata.ts   # Auto-bootstrap .notesage/project.json
│   │   ├── useAIOperations.ts      # AI generation, chat, and ACP routing
│   │   ├── useAgentTaskOperations.ts # Background agent task management (singleton)
│   │   ├── useActivityNavigation.ts # Click-to-navigate from activity tasks to source comments
│   │   ├── useCommentDelegation.ts # Comment → agent delegation flow
│   │   ├── useCommentOperations.ts # Comment CRUD, decorations, status filtering
│   │   ├── useCopilotCompletion.ts # Copilot LSP lifecycle + ghost text completions
│   │   ├── useMcpOperations.ts  # MCP server discovery (useMcpDiscovery mounted in App.tsx), start/stop/restart/callTool operations
│   │   └── useSkillOperations.ts   # Skill/agent discovery orchestration (useSkillDiscovery mounted in App.tsx), persona migration, skill-aware prompt building
│   ├── stores/
│   │   ├── editor-store.ts         # Open tabs, active file
│   │   ├── workspace-store.ts       # Explorer folders, projects, notes tree
│   │   ├── project-metadata-store.ts # Project metadata (.notesage/project.json)
│   │   ├── settings-store.ts       # App settings, theme
│   │   ├── ai-store.ts             # AI provider configuration (personas deprecated — replaced by addressable agents)
│   │   ├── chat-store.ts           # Chat conversation state
│   │   ├── skill-store.ts         # Skills registry, agent entries, agent instructions (persisted overrides)
│   │   ├── mcp-store.ts           # MCP server registry, enabled overrides (partially persisted)
│   │   ├── epub-store.ts          # EPUB viewer preferences and bookmarks
│   │   ├── activity-store.ts      # Agent task registry (persisted)
│   │   └── tag-store.ts           # Workspace tag index (non-persisted)
│   ├── lib/
│   │   ├── markdown.ts             # Markdown ↔ ProseMirror conversion
│   │   ├── tauri.ts                # Typed Tauri invoke wrappers
│   │   ├── utils.ts                # General utilities
│   │   ├── dom-search.ts           # Shared DOM text search utility (DOCX, plain text viewers)
│   │   ├── scan-icloud-projects.ts # iCloud project auto-discovery (startup + runtime)
│   │   └── ai/                     # AI provider abstraction
│   │       ├── types.ts            # AI interfaces and types
│   │       ├── connections.ts      # Connection types, capabilities, routing, provider options
│   │       ├── migration.ts        # V1 ai-store → connections/routing migration
│   │       ├── index.ts            # Provider factory
│   │       └── providers/
│   │           ├── anthropic.ts    # Anthropic implementation
│   │           ├── openai.ts       # OpenAI implementation
│   │           └── ollama.ts       # Ollama implementation
│   └── styles/
│       ├── globals.css             # Global styles and CSS variables
│       └── editor.css              # Editor-specific styles (ProseMirror overrides)
├── public/
│   ├── foliate-js/                 # Vendored EPUB renderer (MIT, pinned commit)
│   │   ├── view.js                 # <foliate-view> Web Component (patched: search annotation removal)
│   │   ├── paginator.js            # Paginated layout engine
│   │   ├── epub.js                 # EPUB parser
│   │   ├── epubcfi.js              # EPUB CFI navigation
│   │   └── ...                     # Supporting modules (overlayer, progress, zip)
│   └── logos/                      # AI provider logos
│       ├── anthropic.svg
│       ├── openai.svg
│       ├── google.svg
│       └── ollama-official.png
├── bundled-skills/                 # Built-in skills shipped with app (extracted to ~/.notesage/skills/)
│   ├── create-skill/              # Meta-skill for scaffolding new skills
│   ├── create-agent/              # Meta-skill for creating agent instruction files
│   ├── download-webpage/          # Fetch URL and save as research markdown
│   ├── save-research/             # Save and organize research files
│   ├── search-research/           # Search research corpus
│   ├── synthesize-sources/        # AI synthesis across sources
│   └── insert-citation/           # Citation insertion
├── bundled-agents/                 # Built-in agents shipped with app (extracted to ~/.notesage/agents/)
│   ├── general-assistant.md       # Default agent (replaces General Assistant persona)
│   └── ...                        # 6 more bundled agents (creative-writer, technical-editor, etc.)
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

- **editor-store**: Open tabs (file path + dirty state + per-tab copilotDisabled flag), active tab index
- **workspace-store**: Explorer folders (multiple), open projects, notes tree, expanded folders, section collapse state
- **project-metadata-store**: Project metadata from `.notesage/project.json` (name, description, AI overrides, citationFormat/citationStyle (citation preferences))
- **settings-store**: Theme, window state, recent projects, UI preferences (floating toolbar toggle, external change diff review toggle, `skillManagement` toggle for advanced skill/agent management), runtime-only `startupReady` flag (gates filesystem watchers until startup validation completes)
- **ai-store**: AI provider selection, API keys, Ollama URL, suggestions enabled (legacy — used as fallback). Personas deprecated — replaced by addressable agents in skill-store. Custom persona data kept for one-time migration to agent `.md` files.
- **skill-store**: Discovered skills registry with enable/disable overrides, discovered addressable agents (from `~/.notesage/agents/`, project `.notesage/agents/`, provider-specific paths), agent instruction files, active agent name, `rescanCounter` (bumped by `requestRescan()`, observed by `useSkillDiscovery` to trigger re-scan). Skills, agents, and instructions rebuilt from scan; enable/disable overrides and active agent name persisted. Agent discovery replaces the legacy persona system.
- **connections-store**: Multi-provider connections with auth method, status, capabilities
- **routing-store**: Per-use-case provider routing (interactive, agent_tasks, inline_completion)
- **permission-store**: ACP tool call permission tracking with tiered approval (`sessionAllowed`: Set non-persisted, `alwaysAllowed`: string[] persisted); actions: `allowSession`, `removeSession`, `allowAlways`, `removeAlways`, `getToolTier` → `'none' | 'session' | 'always'`
- **chat-store**: Chat conversation messages, loading state, errors, agent activities
- **comment-store**: Comments per document, replies, delegation status, activity log (non-persisted activities, JSON-persisted comments), `scrollToCommentId` for external navigation (Editor.tsx scrolls to comment position before activating popover)
- **mcp-store**: MCP server registry with enabled overrides (persisted), server list rebuilt from config scan, `rescanCounter` for re-discovery, `getActiveTools()` for all tools from running servers
- **epub-store**: EPUB viewer mode (scroll/paginated), per-file bookmarks keyed by file path (CFI + chapter)
- **tag-store**: Workspace tag index — all known tags and tag-to-file mapping (non-persisted, rebuilt from scan)
- **activity-store**: Agent task registry — background task tracking with status, activities, streaming output, thinking output (persisted; running tasks marked as error on rehydration). Controls agent activity strip (40px rail) and agent activity panel (resizable sidebar) visibility.
- **external-change-store**: Pending external file changes with hunks (non-persisted)

### Styling

- Tailwind for layout and general styling
- shadcn/ui for interactive components (buttons, dropdowns, dialogs, context menus, tabs)
- Editor content area uses ProseMirror's default styles with custom CSS overrides in `editor.css`
- Do NOT use styled-components, CSS modules, or emotion
- All colors defined as CSS variables in `globals.css` (supports light/dark mode)

### AI Provider Abstraction

Three paths for AI operations, transparently routed based on the connection's auth method and use case:

**Path 1: Direct API** (for `api_key` and `local` connections)

```typescript
interface AIProvider {
  name: 'anthropic' | 'openai' | 'ollama';
  generateText(prompt: string, options?: GenerateOptions): Promise<string>;
  chat(messages: ChatMessage[]): Promise<string>;
}
```

- Anthropic: Claude Sonnet 4.5 (Messages API with server-side web search via `web_search_20250305`)
- OpenAI: GPT-4o (Responses API `/v1/responses` with `web_search_preview` tool)
- Ollama: Local AI models (no web search support). Generic thinking/reasoning model support via runtime capability detection — queries `/api/show` before streaming to determine whether the model supports native `think: true` (separate `message.thinking` field), has thinking tags in its template (`{{.Thinking}}`), or uses `<think>` tags by convention. No hardcoded model-specific tags.

**Path 2: ACP (Agent Client Protocol)** (for `agent_managed` connections)

- Uses the `agent-client-protocol` Rust crate to communicate with agent subprocesses over stdio
- Agent processes spawned with `kill_on_drop(true)` — SIGKILL sent when `Child` is dropped (thread exit, app shutdown)
- Agents handle their own auth (subscription login via browser popup)
- Prompts sent via `acp_session_prompt`, responses streamed as `acp-session-update` Tauri events
- Four supported agents: Claude Code (`claude-agent-acp`), Codex (`codex-acp`), Copilot (`copilot --acp`), Gemini CLI (`gemini --acp`)
- Process cleanup: `AcpState::stop_all_sync()` called from `RunEvent::Exit` hook; frontend `beforeunload` as secondary defense

**Path 3: Copilot LSP** (for `inline_completion` use case)

- Spawns `copilot-language-server --stdio` subprocess managed by `CopilotLspState`
- JSON-RPC 2.0 transport for LSP document sync and `textDocument/inlineCompletion` requests
- Ghost text rendered as ProseMirror widget decorations via `GhostText` Tiptap extension
- Separate from ACP — the Copilot CLI (`copilot --acp`) handles chat/agents, the LSP handles completions

**Routing:** `useAIOperations` reads the `interactive` connection from `routing-store`. If the connection is `api_key`/`local`, it uses Path 1 (direct API). If `agent_managed`, it uses Path 2 (ACP). `useCopilotCompletion` independently reads the `inline_completion` connection and manages the Copilot LSP. The rest of the app (chat panel, bubble menu) is unaware of which path is used.

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

**Direct API path** (api_key / local connections):

1. User selects text → clicks "Improve" in BubbleMenu
2. Frontend calls `useAIOperations.generateText(prompt)`
3. Hook reads `interactive` connection from `routing-store`, resolves credentials
4. Frontend calls Tauri command `ai_generate_text(request)`
5. Rust makes HTTP request to AI provider API
6. AI response returned to frontend
7. Frontend updates editor content

**ACP path** (agent_managed connections):

1. User selects text → clicks "Improve" in BubbleMenu
2. Frontend calls `useAIOperations.generateText(prompt)`
3. Hook reads `interactive` connection from `routing-store`, sees `agent_managed`
4. Hook ensures ACP agent is spawned and has an active session (lazy init)
5. Frontend calls `acp_session_prompt` with the prompt
6. Agent processes prompt, streams `acp-session-update` events (text chunks, tool calls)
7. Hook translates events to chat store updates
8. Frontend updates editor content

### Chat Panel

**Direct API path:**

1. User types message in ChatInput
2. Frontend calls `useChatStore.addMessage(userMessage)`
3. Frontend calls `useAIOperations.sendChatMessage(content, messages)`
4. Hook calls Tauri command `ai_chat_stream(messages, provider, apiKey, webSearchEnabled)`
5. Rust makes streaming HTTP request to AI provider API (SSE)
6. For Ollama: `detect_thinking_support()` queries `/api/show` before streaming to determine thinking tag structure; thinking content emitted via `ai-stream-thinking-chunk` events, regular content via `ai-stream-chunk` events
7. For Anthropic/OpenAI: text deltas emitted via `ai-stream-chunk` events, citations via `ai-citation` events
8. Frontend accumulates tokens locally (50ms throttled flush) and updates assistant message via `useChatStore.updateMessage` and `updateMessageThinking`
9. On stream completion (`ai-stream-done`), citations attached to final message
10. Chat history persisted to localStorage

**ACP path:**

1-3. Same as above
4. Hook calls `acp_session_prompt` on the interactive agent's session
5. Agent streams `acp-session-update` notifications (text chunks, tool calls, permission requests)
6. Hook translates to chat store updates; tool calls tracked as `AgentActivity` entries
7. On `tool_call`: new activity added (status `running`). On `tool_result`: last running activity marked done via `completeLastActivity`
8. Permission requests: hook checks `permission-store.isAutoAllowed(toolKind)` — if auto-allowed (session or always tier), responds immediately; otherwise shows `PermissionCard` inline with Allow (once/session/always) and Deny options
9. On `agent_turn_complete`, any remaining running activities marked done via `completeAllActivities`
10. Chat history persisted to localStorage

### Web Search

When web search is enabled (toggle in chat footer — only visible for direct API connections; ACP connections show a Tools popover instead):

1. `webSearchEnabled` flag read from chat-store, passed to `ai_chat_stream`
2. Anthropic: `web_search_20250305` server tool added to request — Anthropic executes search server-side
3. OpenAI: `web_search_preview` tool added to Responses API request — OpenAI executes search server-side
4. Ollama: Search toggle disabled in UI (toast notification)
5. Search status emitted via `ai-tool-use` event ("Searching the web..." indicator)
6. Citations extracted from provider-specific response formats, emitted via `ai-citation` events
7. Citations displayed as numbered "Sources" section below assistant messages

### Inline Completions (Copilot LSP)

Ghost text completions via the Copilot Language Server, a separate path from both Direct API and ACP.

**Path 3: LSP** (for `inline_completion` routing slot)

1. `useCopilotCompletion` hook reads `inline_completion` connection from `routing-store`
2. If connection exists and working directory is available, spawns `copilot-language-server --stdio` via `copilot_lsp_start`
3. LSP completes `initialize` → `initialized` → `workspace/didChangeConfiguration` handshake
4. On tab activation: sends `textDocument/didOpen` with ProseMirror plain text content
5. On editor update: sends `textDocument/didChange` (full content replacement), debounces 150ms
6. After debounce: sends `textDocument/inlineCompletion` request at cursor position (line/character)
7. LSP returns `InlineCompletionItem[]` with `insertText`, `range`, and acceptance `command`
8. Hook strips already-typed prefix from suggestion, dispatches `setGhostText` to ProseMirror plugin
9. `GhostText` extension renders a `Decoration.widget()` span at cursor position (dimmed, italic)
10. On Tab: inserts text, notifies LSP via `copilot_lsp_accept_completion`, clears decoration
11. On Escape or any keystroke: clears decoration (auto-dismiss on `docChanged` transaction)

**Per-document toggle:**

- `copilotDisabled` boolean on the `Tab` interface (session-only, not persisted)
- When disabled: completion requests suppressed, existing ghost text cleared, `didChange` still sent (LSP stays in sync)
- Status bar shows GitHub icon with popover toggle; icon dims when disabled

**Architecture:**

- Rust: `CopilotLspState` managed state with `CopilotLspProcess` (child process, JSON-RPC transport, pending requests map, status)
- JSON-RPC 2.0 over stdio: `Content-Length` header framing, async reader task dispatching responses and notifications
- Auth: OAuth device flow via `signIn` command → user code → browser verification → `didChangeStatus` notification
- Frontend: `GhostText` Tiptap extension (ProseMirror plugin with widget decoration state), `useCopilotCompletion` hook

### Comment Delegation (Agent Tasks)

Comments can be delegated to AI agents via the `agent_tasks` routing slot. The delegation flow:

1. User clicks "Delegate" on a comment (create mode, view mode, or comment list)
2. `useCommentDelegation` hook sets comment status to `delegated`, builds prompt from anchor text + comment body
3. Hook calls `useAgentTaskOperations.startTask()` with four callbacks: `onComplete`, `onActivity`, `onError`, `onChunk`
4. `startTask` spawns/reuses the `agent_tasks` ACP agent, creates a session, sends the prompt
5. Agent streams `acp-session-update` events: tool calls → `onActivity` → activity log entries in `comment-store`
6. On `agent_turn_complete`: `onComplete` fires → `addReply()` with agent response → status set to `done` → saved to disk
7. On error: `onError` fires → status reverted to `open` → toast error
8. User can cancel active delegation: `cancelTask()` stops ACP session → status reverted to `open`
9. User can resolve completed comments: status set to `resolved` → decoration removed from editor

**Multi-turn threads:**

10. User replies to agent in comment popover → `delegateReply()` adds user reply to thread, sets status to `delegated`
11. Prompt includes full conversation history (anchor text + original comment + all previous replies + new user reply)
12. `existingTaskId` on `TaskMeta` reuses the same activity store task via `resetTaskForContinuation` — multi-turn conversations appear as a single task in the activity panel
13. On error during reply: status reverts to `done` (not `open`) since thread already has replies

**Apply-to-document:**

14. User clicks "Apply" on an agent reply → `extractReplacementText()` strips AI preamble/sign-offs
15. `resolveAnchorRange()` finds current anchor position via `CommentMarkPluginKey` decorations (primary) or text search (fallback)
16. `setSuggestion()` shows inline diff decoration (red strikethrough + green insert) on the anchor text
17. User accepts (`Cmd+Enter`) or rejects (`Cmd+Backspace`) — same UX as Improve/Summarize/Expand
18. Collision prevention: toast warning if another suggestion is active; toast error if anchor text was deleted

**Architecture:**

- `useCommentDelegation` hook: encapsulates delegation flow (`delegateComment`, `delegateReply`), cancel, delegate-all
- `comment-store.activitiesByComment`: runtime-only activity log per comment (not persisted)
- `comment-store.replies`: persisted agent responses in sidecar JSON
- `useAgentTaskOperations`: singleton module-level agent state, shared across all callers; supports `existingTaskId` for multi-turn task reuse
- `pm-replace.ts`: `extractReplacementText()` (preamble stripping) and `resolveAnchorRange()` (anchor position lookup via CommentMark decorations)
- `ai-suggestion.ts`: `setSuggestion()` / `hasActiveSuggestion()` reused for inline diff display (no changes needed)

### Filesystem Watcher (External Change Detection)

Detects external file changes (from other editors, AI agents, terminal commands) and updates the sidebar tree and editor content.

**Rust backend (`watcher.rs`):**

1. `watch_directory(path)` starts recursive watching via `notify` crate with `notify_debouncer_full` (500ms debounce)
2. Self-write filter: `mark_self_write(path)` records a timestamp for paths Notesage writes; events for these paths are suppressed for 5 seconds (covers debounce + macOS FSEvents re-reporting)
3. Events filtered: `.git/` internals and `.DS_Store` are silently dropped (prevents iCloud-synced repo event floods)
4. macOS FSEvents quirk: file deletions often arrive as `Modify` events — reclassified as `delete` when the path no longer exists on disk
5. Directory events skipped (except deletes, since deleted paths return `is_dir() == false`)
6. Surviving events emitted as `file-changed` Tauri events with `{ path, kind }` payload

**Frontend event handler (`useFileWatcher.ts`):**

7. `listen("file-changed")` receives events and normalizes paths (strips `/private/` prefix for macOS symlinks, trailing slashes)
8. Create/delete: debounced `refreshFileTree()` (no target path — avoids canonicalization mismatches) + debounced git status refresh
9. Create inside iCloud folder: debounced (1s) check for `.notesage/` metadata in the top-level subfolder — if found, auto-adds as a synced project (runtime discovery of projects from other machines)
10. Modify: looks up open tab by normalized path comparison
11. Content guard: reads file from disk, compares against both `tab.content` and any pending `externalChanges` entry — skips if identical (prevents self-write false positives)
12. Clean-tab behavior gated on `settings-store.externalChangeDiffReview`:
    - **Off (default):** `editor-store.setExternalChange()` → Editor.tsx auto-reloads with toast
    - **On (beta):** `external-change-store.addChange()` → inline diff decorations for review

**Editor auto-reload (`Editor.tsx`):**

13. `useEffect` watches for external changes on the active tab
14. Clean tabs: auto-reloads via `editor.commands.setContent()` (Tiptap is the source of truth — must push content to ProseMirror, not just Zustand) + shows "File updated from disk" toast
15. Dirty tabs: shows reload/keep banner for user decision

**Critical implementation notes:**

- **Tiptap is source of truth**: Updating `tab.content` in Zustand does NOT update the editor. Must use `editor.commands.setContent()` to visually reflect changes.
- **Self-write TTL (5s)**: Covers the 500ms debounce window + macOS FSEvents re-reporting the same event multiple times over ~3 seconds + iCloud sync latency.
- **Path normalization**: macOS FSEvents canonicalizes `/var` → `/private/var`, `/tmp` → `/private/tmp`. The frontend strips the `/private/` prefix for comparison.
- **Toast dedup**: Uses stable `id: "external-change"` on toast to prevent duplicate notifications from FSEvents re-reporting.
- **Startup gating (`startupReady`)**: `useStartWatchers` does not start filesystem watchers until `settings-store.startupReady` is `true`. This flag is set by `App.tsx` after `reloadTrees()` finishes validating paths, removing stale projects, and discovering iCloud projects — preventing watchers from firing on paths that no longer exist.
- **iCloud project auto-discovery**: At startup, `scanICloudForProjects()` scans the iCloud Notesage folder for top-level directories with `.notesage/` metadata and adds them as synced projects. At runtime, `useFileWatcher` detects create events inside the iCloud folder and performs the same check with a 1s debounce (accounts for gradual iCloud file sync).

## Future-Proofing Decisions

These architectural choices enable future phases:

- **ProseMirror decorations**: Enables inline diff display (Phase 5) and AI suggestion decorations
- **Tauri commands**: Pattern established for file/git operations extends to filesystem watching (Phase 5) and agent task management (Phase 6)
- **Zustand stores**: Clean boundaries allow adding new stores (comment-store for Phase 5, workflow-store for Phase 8)
- **Provider abstraction**: Easy to add new providers — local AI (Phase 9), Anthropic Agent SDK (Phase 6)
- **No hardcoded paths**: `.notesage/` metadata directory supports sidecar comments (Phase 5), research storage (Phase 7), workflow definitions (Phase 8)
- **YAML frontmatter**: Document identity via lazy UUID enables stable cross-document references for comments, research, and AI task assignments (project files only — non-project files use path-based comment keys to avoid modifying external files)
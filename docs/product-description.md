---
id: ""
---

# Notesage — Product Description

Notesage is a rich text markdown editor with AI collaboration capabilities, packaged as a lightweight desktop application using Tauri v2.

**Current version:** 0.46.0-alpha.11

## Features

| Feature | Summary | Details |
| --- | --- | --- |
| Editor | Tiptap rich text editor with markdown round-tripping, find & replace, inline tag badges, dynamic tables (column types, aggregation, sorting, filtering, sparklines) | features/editor.md |
| Document Index | SQLite-backed index with AST-parsed tags, mentions, tasks, goals, and FTS5 content search | prds/2026-03-14-sqlite-document-index.md |
| AI Providers | Multi-provider architecture (Anthropic, OpenAI, Ollama, Local AI, ACP agents, Copilot LSP), tool calling, network sandboxing | features/ai-providers.md |
| AI Workflows | Chat with history/export/branching, agents, skills, MCP, tool calling, chronological message segments, provider context isolation, comment delegation, research, voice transcription | features/ai-workflows.md |
| Document Formats | EPUB viewer, PDF export, DOCX/PDF/plain text viewers, code file editor (22+ languages) | features/document-formats.md |
| Workspace | Projects, file tree, iCloud sync, git integration, external change detection | features/workspace.md |

For editor architecture internals (ProseMirror, decorations, extensions): features/editor-architecture.md

## Roadmap

### Phase 10 — Agent Binary Management & Runtime Sandboxing (Completed)

**Goal:** Zero-dependency agent installation, isolated runtime execution, and automatic updates.

- Managed agent binary installation to `~/.notesage/bin/` (download from GitHub Releases)
- Portable Node.js runtime for Gemini CLI
- OS-level filesystem sandboxing (Seatbelt on macOS, Bubblewrap/Landlock on Linux)
- Network sandboxing via HTTP proxy with per-agent domain allowlists and domain approval cards
- Kernel-enforced network deny (Seatbelt `(deny default)` with proxy-only localhost allow) — agents cannot bypass the proxy
- Seatbelt violation monitoring streamed to Activity panel via macOS unified log
- Automatic update checking with one-click updates
- Provider context isolation on mid-conversation provider switch
- Chat history tab view with conversation export (Markdown/JSON)
- Thinking effort slider for Codex ACP (Default/Low/Medium/High/Extra High)
- PRD: `docs/prds/2026-02-21-agent-install-wizard.md`

### Rich Content Blocks (Completed)

**Goal:** Transform the editor from a plain text surface into a rich document authoring tool with embedded drawings, charts, callouts, link previews, and dynamic tables.

- Callout blocks (Note, Tip, Warning, Important) with Obsidian `> [!type]` syntax and Typst PDF export
- Inline Excalidraw drawing canvas with SVG preview, sidecar storage, and markdown round-tripping
- Inline charts (6 types: bar, line, area, pie, radar, radial) with visual data editor, sidecar JSON, and PDF export
- Rich link preview cards with OpenGraph metadata fetch, paste detection, and `> [!link](url)` markdown
- Dynamic table enhancements: column types (text/number/currency/percentage/date), aggregation footer (sum/avg/count/min/max), click-to-sort, row filtering, inline sparkline charts, right-click column configuration, PDF export with footer rows
- PRD: `docs/prds/2026-03-29-dynamic-table-enhancements.md`

### Chronological Chat Message Segments (Completed)

**Goal:** Render assistant messages as an interleaved chronological stream of text, thinking, tool calls, and tool results — matching the UX standard set by Claude Code, Cursor, and Cline.

- `Segment` discriminated union type (text, thinking, tool_call, tool_result) on `ChatMessage`
- Descriptive tool labels via `formatToolLabel` (file basenames, truncated commands, search queries)
- Dual-write: segments for rendering, `content` for search/export, backward compat with old messages
- Four segment view components: `TextSegmentView`, `ThinkingSegmentView`, `ToolCallSegmentView`, `ToolResultSegmentView`
- Works for all AI paths: direct API with tool calling and ACP agents
- Conversation export renders segments chronologically (Markdown and JSON)
- PRD: `docs/prds/2026-04-02-chronological-chat-segments.md`

### ACP Session Resilience (Completed)

**Goal:** Never auto-kill working agents. Preserve conversation context across restarts. Let users decide when agents are unresponsive.

- Replaced auto-kill recovery with user decision flow (AgentStatusBanner: Wait/Retry/Cancel)
- `acp-agent-exited` Tauri event for instant process death detection
- `acp_is_agent_alive` command for liveness checking
- Retry uses `acp_agent_reconnect` + ACP `session/load` for context restoration
- Same-branch retry — reuses assistant message, no dead branches
- 5-minute unresponsive timer (shows banner, not kill), 30-minute backend hard timeout
- PRD: `docs/prds/2026-04-02-acp-session-resilience.md`

### System Tray & Background Intelligence (Completed)

**Goal:** Persistent menu bar presence with quick actions, notifications, and background behavior.

- System tray icon (italic "N" template image, adapts to light/dark menu bar)
- Tray menu: New Note, New Quick Note, Open Actions (badge count), Recent files, Show/Quit
- Click tray icon to toggle window visibility
- Close-to-tray: optional hide-on-close instead of quit
- Desktop notifications for agent task completion/errors (via `tauri-plugin-notification`)
- ~~Quick Capture window (`Cmd+Shift+Space`) — floating 480x320 textarea with destination picker~~ — **REMOVED, not deferred.** Never shipped (no `tauri-plugin-global-shortcut` plugin, no separate quick-capture window). PRD `2026-04-28-cmd-bar-verb-prefixes` deleted the PaletteMode entry, the App.tsx routing branch, and this claim end-to-end. The System Tray phase shipped the tray + notifications + autostart pieces; Quick Capture is no longer a planned feature.
- Start at login via `tauri-plugin-autostart` (macOS LaunchAgent)
- Settings: System Tray section (show in tray, close to tray, start at login) + Notification toggles
- PRD: `docs/prds/2026-03-11-system-tray.md`

### UI Refresh — The Quiet Composer (Completed — Classic Layout removed)

**Goal:** Move from "feature-rich IDE" to "premium native writing tool" — single floating composer for chat/commands/search, ambient agent orb instead of activity rail, flat curated sidebar with summonable tree overlay, fade-on-type chrome.

- Phase 1 (opt-in preview) shipped in v0.39.0 — `QuietLayout`, `FloatingCommandBar`, `AgentOrb`, `QuietSidebar` with Pinned / Projects / Recent / Tags / Mentions sections, `TreeOverlay` (`⌘⇧E`), `FolderPeek`, `FocusPill`, `StatusTray`, accent picker (Default / Orange / Blue / System), Quiet chrome presets (Relaxed / Default / Aggressive), Settings v2 shell
- Phase 2 (default-on for new installs)
- Phase 3 (Classic Layout deletion) — issue #325, PRD `docs/prds/2026-05-22-classic-layout-removal.md`. Removed `Layout.tsx`, `TabBar`, `ChatPanel`, `ChatFooter`, `ActivityStrip`, `CommandPalette`, `NewNoteDialog`, `NewProjectDialog`, `KeyboardShortcutsDialog`, `PreviewInvitation`, `RevertInvitation`, and the legacy `SettingsDialog`. Quiet Composer is the only shell.
- PRD: `docs/prds/2026-04-21-ui-refresh.md`

### Beyond — Ideas

- **Workflows & Automation:** User-defined YAML workflows as skills
- **Collaboration:** Real-time collaborative editing (CRDT-based), share notes via link
- **Mobile apps:** iOS app (Swift + Tauri Mobile), Android, sync across devices
- **Plugins:** Plugin API (Rust or WASM), community marketplace
- **Advanced editor:** Canvas mode, Mermaid diagrams, math equations
- **Knowledge base:** Backlinks, daily notes, graph view of note connections
- **Advanced AI:** Multi-file context, semantic search, knowledge graph visualization

## Architectural Decisions

1. **ProseMirror over simpler editors** — Decoration system enables inline diffs and AI suggestion overlays. Plugin system allows comment marks without rewriting the editor. CRDT-friendly for future collaboration.
2. **Tauri commands for all I/O** — Security boundary for all file, AI, and agent operations.
3. **Zustand stores with clear boundaries** — Persist middleware supports offline-first approach.
4. `.notesage/` **metadata directory** — Sidecar comments, skill directories, agent instructions, research storage. Project-relative paths keep everything portable.
5. **YAML frontmatter with lazy document UUID** — Stable document identity for comments that survive renames and cross-document references.
6. **Provider abstraction (**`AIProvider` **interface)** — Extends to local AI, new providers. Web search implemented as provider-native tools.
7. **Component modularity** — Sidebar, editor, command bar, and agent orb are separate and composable.
8. **Open standards (Agent Skills + MCP)** — Skills and tools follow widely adopted cross-tool standards. No proprietary format.
9. **SQLite document index** — Persistent, structure-aware index built from comrak AST parsing. Replaces regex-based filesystem scanning with instant SQL queries for tags, mentions, tasks, goals, and FTS5 content search. Each device rebuilds its own index from files (iCloud safe).
10. **OS keychain for credentials** — API keys stored in macOS Keychain (via `keyring` crate), never in localStorage. Backend resolves keys directly — they never transit through IPC. Transparent one-time migration for existing users.

## Implementation Philosophy

1. **Don't break existing features** — completed work must continue to function
2. **Graceful degradation** — advanced features should be opt-in
3. **Performance first** — don't slow down the editor
4. **Privacy by default** — local-first, cloud-optional
5. **Stay focused** — each phase has a clear goal, don't scope-creep
6. **Ship iteratively** — release features when they're ready

## Quality Gates

Before any release, ALL of these must pass:

### Functional

- [ ] Can open a folder of .md files via native dialog

- [ ] File tree displays all files and folders correctly

- [ ] Clicking a .md file opens it in the rich text editor

- [ ] All markdown syntax renders correctly in rich text mode

- [ ] Saving serializes back to clean, valid markdown

- [ ] **Round-trip test passes**: Open → edit nothing → save → file is identical (whitespace-normalized)

- [ ] Multi-tab editing works (switch tabs preserves state)

- [ ] Unsaved changes indicator works

- [ ] Auto-save on tab switch works

- [ ] Slash commands insert correct block types

- [ ] Top toolbar applies formatting; bubble menu appears on selection with AI actions

- [ ] Create/rename/delete files from sidebar works

- [ ] Light/dark theme works and follows system preference

- [ ] App builds and runs on macOS without errors

- [ ] App starts in under 1 second

- [ ] No console errors during normal operation

### Testing & Performance

- [ ] All unit tests pass (`pnpm test`)

- [ ] All Playwright E2E tests pass (`pnpm test:e2e`)

- [ ] TypeScript type check passes (`pnpm typecheck`)

- [ ] Performance benchmarks pass within budget (`pnpm test:perf`)

- [ ] No coverage regressions in changed files (`pnpm coverage:check`)

- [ ] Markdown round-trip tests pass (parse → serialize → compare)

### Design

- [ ] App looks like it belongs next to Linear, Bear, or Craft

- [ ] Sidebar has smooth hover transitions and clear active state

- [ ] Editor content area is max 720px wide and beautifully typeset

- [ ] All interactive elements have hover, active, and focus states

- [ ] Theme switching is smooth with color transitions

- [ ] No default browser UI elements visible (checkboxes, scrollbars, selects)

- [ ] Consistent border-radius, spacing, and color palette throughout

- [x] Code blocks have syntax highlighting with a tasteful muted chromatic theme

- [ ] Bubble menu has backdrop blur and smooth animation

- [ ] Typography is polished: proper hierarchy, readable sizes, intentional weight usage

- [ ] Looks great in BOTH light and dark mode
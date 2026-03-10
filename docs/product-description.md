---
id: ""
---

# Notesage — Product Description

Notesage is a rich text markdown editor with AI collaboration capabilities, packaged as a lightweight desktop application using Tauri v2.

**Current version:** 0.19.0

## Current Features

### Editor

Tiptap-powered rich text editor with full markdown round-tripping.

**Supported content:**

- Headings (H1-H6), paragraphs

- Bold, italic, underline, strikethrough, code (inline)

- Bullet lists, ordered lists, task lists (checkboxes)

- Blockquotes, horizontal rules

- Code blocks with syntax highlighting (lowlight)

- Links (rendered inline, clickable), images (via URL prompt)

- Tables (insert, add/remove rows/columns) testing **Editing features:**

- Top toolbar with formatting controls: undo/redo, bold, italic, underline, strikethrough, code, bullet list, ordered list, task list, blockquote, code block, horizontal rule, table, image

- Bubble menu on text selection with AI actions (Improve, Summarize, Expand) — toggleable in settings

- Slash commands (`/` at start of line) for inserting headings, lists, code blocks, blockquotes, tables, horizontal rules, images

- Multi-tab editing with dirty indicator, auto-save on blur/tab switch (debounced 1s)

- Open tabs restored on app restart (persisted file paths, re-opened from disk)

**File management:**

- Sidebar file tree with expand/collapse, file icons by extension, right-click context menu (new file, new folder, rename, delete)

- File operations via Tauri commands: open folder (native dialog), open/save/create/rename/delete files

- Hidden files/folders ignored by default

**Markdown round-tripping**:

- Open .md file -&gt; parse to ProseMirror -&gt; edit in rich text -&gt; serialize back to clean markdown
- Lossless: markdown in must equal markdown out (modulo whitespace normalization)
- Test fixtures in `tests/fixtures/*.md` covering all syntax

**Desktop packaging:**

- macOS primary (arm64 + x86_64), window 1200x800 default, min 800x600
- Native title bar, resizable
- Light/dark mode following system preference (Cmd+T to toggle)

### Find in Document

In-document search across all supported file types, with replace for editable documents.

**Find (Cmd+F):**

- Floating find bar anchored to the top of the content area
- Case-insensitive text matching across the entire document
- Match count display (e.g., "3 of 12") with prev/next navigation (Enter / Shift+Enter or arrow buttons)
- Current match highlighted distinctly; all other matches highlighted with neutral grey decorations
- Document scrolls to bring the current match into view
- Selected text pre-fills the search input when the find bar opens
- Find state clears on tab switch
- Escape closes find bar from anywhere (global keyboard listener)

**Replace (Cmd+Shift+H):**

- Opens find bar with replace row expanded
- Replace current match or Replace All in one click
- Replace row can be toggled open/closed independently
- Only available for editable documents (markdown)

**Per-viewer implementations:**

- **Markdown WYSIWYG:** Custom `SearchHighlight` ProseMirror decoration plugin with find + replace
- **Markdown source mode:** Delegates to CodeMirror's native search panel
- **PDF:** Uses pdfjs-dist text layer search with `highlightTextLayerMatches` utility
- **EPUB:** Uses foliate-js `view.search()` async generator for CFI collection, `view.select()` for native text selection highlighting
- **DOCX:** DOM-based search via shared `dom-search.ts` utility (walk text nodes, wrap matches in `<mark>` elements)
- **Plain text:** Same DOM-based search via `dom-search.ts` operating on `<pre>` element

**Architecture:**

- `FindBar.tsx`: Shared React component with search input, match counter, prev/next/replace/replace all controls
- `SearchHighlight` Tiptap extension (`search-highlight.ts`): ProseMirror decoration plugin for markdown WYSIWYG
- `dom-search.ts`: Shared DOM text search utility for DOCX and plain text viewers (TreeWalker-based text node walking, `<mark>` wrapping)
- EPUB: Patched vendored `view.js` to suppress red SVG overlay annotations from search; keyboard event forwarding from EPUB iframes to parent window
- No new stores or Tauri commands — fully frontend-side

### Inline Tag Badges & Search

Hashtag-based tagging system with visual badges, autocomplete, and cross-file search.

**Tag badges:**

- `#tagName` patterns render as styled inline badges (pill shape) in the editor
- Tags inside code blocks and inline code are excluded
- Clicking a tag badge opens the command palette with all occurrences of that tag across the workspace
- Each occurrence shows file name, line number, and a content snippet
- Selecting an occurrence opens the file and scrolls to the exact tag position

**Tag autocomplete:**

- Typing `#` triggers a suggestion popup listing known tags from the workspace
- Case-insensitive substring filtering as user types
- Keyboard navigation (arrow keys, Enter to select, Escape to dismiss)
- Suppressed inside code blocks and existing tag decorations

**Tag search (Cmd+3):**

- Opens the command palette in direct tag search mode
- Type a tag name → debounced backend search shows occurrences across all files
- Select an occurrence to jump directly to it

**Architecture:**

- `TagHighlight` Tiptap extension: ProseMirror decoration plugin scanning text nodes for `#tag` patterns
- `TagSuggestion` Tiptap extension: `@tiptap/suggestion`-based autocomplete with React popup
- `tag-store` (Zustand, non-persisted): workspace tag index rebuilt from periodic scans
- `find_tag_occurrences` Rust command: scans `.md` files for exact tag matches, returns per-line occurrences with snippets
- `scrollToTag` on editor-store Tab: ProseMirror text search finds the Nth tag occurrence and scrolls to it

### AI Collaboration

Multi-provider AI integration with chat and inline actions.

**Providers:**

- Anthropic Claude (Messages API with server-side web search via `web_search_20250305`)
- OpenAI (Responses API `/v1/responses` with `web_search_preview` tool)
- Ollama (local models, no web search, generic thinking/reasoning model support)

**Features:**

- Chat panel as collapsible right sidebar (Cmd+Shift+A) with streaming responses
- Inline AI actions via BubbleMenu: Improve, Summarize, Expand selected text
- Addressable agents: file-based agent system replacing legacy personas — discovered from `~/.notesage/agents/` (includes bundled agents), project `.notesage/agents/`, `.github/agents/`, and provider-specific directories
- Agent picker dropdown in chat footer; `@agent-name` addressing in chat input for per-message agent scoping
- 7 bundled agents (General Assistant, Creative Writer, Technical Editor, Fact Checker, Academic Writer, Copywriter, Proofreader) with YAML frontmatter and markdown body
- Agent-to-skill connection: `allowed-tools` frontmatter filters which skills an agent can access
- Agents section in Settings &gt; Skills & Agents for viewing, enabling/disabling discovered agents
- Skill & agent management (Settings &gt; Advanced toggle): delete and move custom skills/agents between global and project scope
- One-time migration: custom personas auto-converted to agent `.md` files on first launch
- Quick reply chips: AI responses can include `<quick-replies>` tags with suggested follow-up prompts, rendered as clickable chips below the message
- Custom prompts/templates for AI actions
- Project-scoped AI context (provider, agent, and context overrides per project)
- Provider logos with dark mode support
- All AI calls through Tauri backend (Rust) for security
- API keys stored in localStorage via Zustand persist
- Ollama thinking model support: collapsible reasoning display with generic runtime detection (no hardcoded model tags)

**Ollama thinking/reasoning model support:**

- Before streaming, queries `/api/show` to detect model capabilities at runtime
- Models with native `thinking` capability (e.g., DeepSeek-R1 with updated Ollama): uses `think: true` parameter, thinking returned in separate `message.thinking` JSON field
- Models without native support but with thinking tag patterns in template (e.g., `{{.Thinking}}`): extracts opening/closing tags from model template and parses them from the content stream
- Models with reasoning in name/family (e.g., `phi4-mini-reasoning`) but no template tags: falls back to `<think>...</think>` tag parsing
- Non-reasoning models: content passed through without any tag parsing
- Thinking content displayed in a collapsible section above the assistant response in the chat panel
- Throttled UI updates (50ms flush interval) prevent rendering storms from token-by-token thinking output

**Architecture:**

- Provider interface: `AIProvider` with `generateText()` and `chat()` methods
- Three implementations: AnthropicProvider, OpenAIProvider, OllamaProvider
- State stores: ai-store (config, legacy personas deprecated), chat-store (messages), skill-store (agents, skills, instructions)
- Tauri commands: ai_generate_text, ai_chat, ai_chat_stream, discover_agents, read_agent_content, extract_bundled_agents
- Agent discovery: `useSkillDiscovery` hook (mounted in `App.tsx`) orchestrates extraction, migration, and scanning at startup; auto-rescan triggered by filesystem watcher via `rescanCounter` in skill-store
- Quick replies: `QuickReplies.tsx` component parses `<quick-replies>` XML tags from AI responses + heuristic fallback for numbered lists of suggestions
- Ollama thinking detection: `detect_thinking_support()` in `ai_streaming.rs` — queries `/api/show` for capabilities, template, and model metadata

**Future enhancements (not yet built):**

- ProseMirror decorations for inline suggestions (green insert, red delete)
- Context-aware suggestions (understand document structure)
- Conversation branching/forking in chat

### Inline Completions (Copilot LSP)

Ghost text autocomplete powered by the GitHub Copilot Language Server.

**Connection & auth:**

- Connects via `copilot-language-server` binary (npm global install)
- OAuth device flow authentication — enter code on github.com/login/device
- Works with personal Copilot subscriptions and Copilot for Business (IDE-extension-only plans)
- Routed via `inline_completion` use case slot — can run alongside other providers for chat

**Ghost text behavior:**

- Inline suggestions appear as dimmed italic text ahead of the cursor
- Tab to accept, Escape to dismiss, any other keystroke auto-dismisses
- 150ms debounce after typing pause before requesting completions
- Does not interfere with slash commands, bubble menu, or inline diff review
- Completions suppressed when selection is active or editor is unfocused

**Per-document toggle:**

- Status bar shows official GitHub Copilot icon (Octicons) when Copilot LSP is connected
- Click icon → popover with toggle switch to disable completions for the current document
- Session-only — resets when the tab is closed (not persisted)
- Icon dims when disabled; green status dot in popover reflects state

**Architecture:**

- Rust backend: `commands/copilot_lsp.rs` — JSON-RPC 2.0 over stdio transport, LSP lifecycle, document sync, completion requests
- Frontend: `GhostText` Tiptap extension (ProseMirror widget decorations), `useCopilotCompletion` hook (LSP lifecycle + document sync + debounced requests)
- Tauri commands: `copilot_lsp_start`, `copilot_lsp_stop`, `copilot_lsp_sign_in`, `copilot_lsp_did_open`, `copilot_lsp_did_change`, `copilot_lsp_did_close`, `copilot_lsp_did_focus`, `copilot_lsp_request_completion`, `copilot_lsp_accept_completion`
- Tab-scoped `copilotDisabled` flag in editor-store (non-persisted)

**Future enhancements (not yet built):**

- Multi-line panel completions (`copilotPanelCompletion`)
- Inline edits / next edit suggestions (`copilotInlineEdit`)
- Partial acceptance (accept word-by-word)
- Free tier usage tracking indicator
- GitHub Enterprise configuration

### Project Workspace

Project management, goals, git integration, and web search.

**Project metadata:**

- `.notesage/` metadata directory auto-bootstrapped per project (name, description, AI overrides)
- New Project dialog (Cmd+Shift+N) with templates (Default, Research, Writing, Blank)
- New Note dialog (Cmd+N) with duplicate detection
- Project Settings tab in settings dialog

**Project goals:**

- YAML frontmatter support (parse, preserve, edit)
- Goal templates: OKR, Simple Checklist, SMART Goals, Milestone Tracker
- Goals discovery by scanning for `type: goal` frontmatter
- AI context injection — goals included in chat system prompt
- Multi-select project selector in chat footer

**Git integration:**

- File status indicators in sidebar (modified, staged, untracked, deleted, renamed, conflicted)
- Commit dialog with file selection, staging/unstaging, and message input
- Branch display and switching via dropdown
- Auto-detection of git repos, git availability check
- Git identity configuration UI when `user.name`/`user.email` missing
- Status refresh on save, commit, branch switch, and window focus

**AI web search (v0.7.0):**

- Anthropic server-side web search (`web_search_20250305`)
- OpenAI web search via Responses API (`web_search_preview`)
- Ollama search deferred (toggle disabled with toast)
- User-configurable search toggle in chat input footer
- Citation display in chat messages with clickable source URLs

### Document Generation (PDF Export)

Export notes to professionally typeset PDFs using the embedded Typst engine.

**Export triggers:**

- Cmd+Shift+E keyboard shortcut
- Export button in app toolbar (top right)
- Right-click sidebar context menu on .md files → "Export as PDF"

**Templates:**

- **Clean** — Sans-serif (Inter), generous whitespace, minimal headers/footers
- **Academic** — Serif (Source Serif 4), numbered headings, justified text, header with title and page number
- **Report** — Title page with document title and date, header/footer throughout, table of contents

**Export options:**

- Template selection (Clean, Academic, Report)
- Include table of contents (on/off)
- Include page numbers (on/off)
- Page size (A4, Letter, A5)
- Settings remembered between exports

**Architecture:**

- Typst 0.14 embedded compiler with custom `World` trait implementation (`NotesageWorld`)
- Markdown → Typst markup conversion via comrak GFM parser (`markdown_to_typst`)
- Bundled fonts: Inter (sans-serif), Source Serif 4 (serif), JetBrains Mono (code) — all OFL-licensed, \~2.7MB total
- Template `.typ` files loaded via `include_str!` with parameterized `#show` rules
- Tauri commands: `export_pdf` (compile), `save_binary_file` (write to disk)
- Native save dialog via `@tauri-apps/plugin-dialog`
- Export settings persisted in settings-store

**Future enhancements (not yet built):**

- DOCX export (preserve formatting, embedded images, Word styles mapping)
- PPTX export (headings → slides, lists → bullet points, images → slide images)
- Custom template editor
- Template marketplace

### EPUB Viewer

Read EPUB ebooks directly in Notesage with paginated or scrollable rendering.

**Rendering:**

- Powered by vendored foliate-js (MIT) — modern Web Component-based EPUB renderer
- Paginated mode: single-column layout with CSS multi-column, prev/next navigation
- Scroll mode: continuous vertical scrolling
- Dark/light mode: content theme follows app theme with comprehensive element coverage
- Arrow key navigation in paginated mode

**Reading features:**

- Running header (chapter title) and footer (page number) in paginated mode
- Book-wide page numbering accumulated from physical pages across sections
- TOC dropdown for chapter navigation
- Bookmark persistence and restoration on app restart (CFI-based, per file path)
- View mode preference (scroll/paginated) persisted globally
- In-document search (Cmd+F) with match count, prev/next navigation, native text selection highlighting via `view.select()`

**Architecture:**

- foliate-js vendored in `public/foliate-js/` (cannot be bundled by Vite — uses dynamic ES module imports internally)
- `<foliate-view>` Web Component loaded via dynamic `import('/foliate-js/view.js')`
- Vendored `view.js` patched to suppress red SVG overlay annotations from search (annotations removed from search generator, visual feedback handled by `view.select()` instead)
- EPUB binary data loaded via `getBinaryData()` from binary cache, opened as `Blob`
- Layout configured via renderer attributes (`flow`, `max-inline-size`, `max-column-count`, `gap`, margins)
- Content theming via `renderer.setStyles()` CSS injection into EPUB iframe
- Keyboard event forwarding from EPUB iframes to parent window (all keydown events with modifier keys) — enables Escape to close FindBar and app shortcuts (Cmd+T, etc.) when EPUB has focus
- `epub-store` (Zustand, persisted): view mode preference + per-file bookmarks (CFI + chapter label)
- `Editor.tsx` routes `.epub` files to `EpubViewer` component

### Comments, Agent Delegation & Change Detection

Document comments with AI agent delegation and external change tracking — foundational infrastructure for human-AI collaboration.

**Comments:**

- Inline comments attached to text ranges via Tiptap ProseMirror decorations
- Comment popover for creating, editing, and deleting comments
- Orange highlight with underline accent for commented text ranges
- Keyboard shortcut: Cmd+Shift+M to create comment on selection
- Comment button in bubble menu on text selection
- Two comment storage strategies:
  - **Project files:** Comments keyed by UUID (frontmatter `id` field, auto-generated when first comment is created). Survives file renames/moves. Stored in `.notesage/comments/{uuid}.json`
  - **Non-project files (Explorer):** Comments keyed by a hash of the file path. No frontmatter modification — external files are never altered. Stored in `~/Notesage/.notesage/comments/path-{hash}.json`. Comments lost if file is renamed while app is closed.
- Document index (`.notesage/doc-index.json`) mapping UUID → current file path for project files

**Agent comment delegation (v0.14.1):**

- Delegate any comment to an AI agent with one click — agent replies within the comment thread
- Comment lifecycle states: open → delegated (spinner) → done (reply received) → resolved (highlight removed)
- Delegation from three entry points:
  - **Create mode:** "Delegate" button next to "Add" — saves comment and sends to agent in one action
  - **View mode:** Bot icon button in comment popover action bar
  - **Comment list:** Bot icon button per comment, plus "Delegate all" bulk action in header
- Agent replies displayed as threaded responses with author attribution and relative timestamps
- Per-comment activity log: collapsible panel showing agent steps (tool calls, permissions, errors)
- Activity log with expandable long entries and stop button for cancelling active delegations
- Delegated comment highlights pulse subtly in the editor
- Resolved comments hidden from both decorations and comment list
- Uses existing `useAgentTaskOperations` infrastructure — routes through `agent_tasks` connection slot
- No agent configured: toast error with guidance to set up routing in Settings

**Agent activity strip & panel & progress streaming (v0.16.10):**

- Agent activity strip: narrow 40px rail always visible when agent tasks exist, showing per-task status icons with tooltips
- Agent activity panel: resizable right sidebar showing all background agent tasks with full details — toggled via title bar button or Cmd+Shift+A
- Visibility behavior: strip appears automatically when a task starts; if the user has manually opened the panel, it stays open; if hidden, activity is shown in the strip and the user can expand the panel at will
- Task persistence: historical tasks survive app restart via Zustand persist middleware; interrupted tasks marked as error on rehydration
- Per-task details: expandable thinking/reasoning output (ACP `agent_thought_chunk` events), streaming response with live markdown preview, collapsible activity log (tool calls, permissions)
- Agent response rendering: shared `MarkdownContent` component with remarkGfm for comment replies, activity panel, and chat messages
- Click-to-navigate: click completed comment tasks to jump to the source comment in the editor and scroll into view
- Individual task removal via X button on each task card
- Running task indicator dot on title bar toggle button

**Multi-turn threads & apply-to-document (v0.17.0):**

- Multi-turn comment threads: user can reply to the agent, agent responds again, repeat — full conversation history included in each prompt
- Explicit "Apply" button on each agent reply — shows the response as an inline diff on the anchor text via the existing `AISuggestion` decoration system
- Same review UX as Improve/Summarize/Expand: accept via `Cmd+Enter`, reject via `Cmd+Backspace`
- Preamble stripping: agent response text has introductory phrases ("Here's the improved version:", "Sure!") and trailing sign-offs ("Let me know if...") automatically removed before applying
- Anchor range resolution: primary strategy uses `CommentMarkPluginKey` decoration positions (remapped through ProseMirror mapping), with text search fallback
- Collision prevention: toast warning when another suggestion is already active, Apply blocked until resolved
- Anchor-not-found handling: toast error when anchor text was deleted, Apply button disabled
- Agent reply visible in thread after accept/reject — conversation thread preserved
- User vs agent reply distinction in comment popover: `User` icon for user messages, `BotMessageSquare` for agent messages
- Activity panel shows multi-turn conversations as a single task with chat-style message thread (user and agent messages individually attributed)
- Sticky expansion: once a conversation thread is expanded in comment popover or activity panel, it stays expanded across agent turns
- Multi-turn task reuse: `existingTaskId` on `TaskMeta` enables the activity store to reuse the same task entry across conversation turns via `resetTaskForContinuation`

**External change detection & review:**

- Tauri filesystem watcher (via `notify` crate with `notify_debouncer_full`) for watched directories
- Self-write filtering at the Rust backend level (`markSelfWrite` before writes, event suppression at source)
- `.git/` and `.DS_Store` paths filtered to prevent iCloud-synced repo event floods
- macOS FSEvents workaround: modify events for deleted paths reclassified as deletes
- Path normalization for macOS `/private/` prefix (FSEvents canonicalization)
- **Configurable behavior** (Settings toggle, default: auto-accept):
  - **Auto-accept (default):** Clean-tab external changes auto-reload silently with toast notification
  - **Diff review (beta):** Inline diff review with word-level `diff-match-patch` diffing, mapped to ProseMirror positions
    - Inline diff decorations: red strikethrough for deletions, green for insertions
    - Per-hunk accept/reject via inline click controls or keyboard shortcuts (`Cmd+Enter` / `Cmd+Backspace`)
    - Status bar change tracker (`RefreshCw` icon + count) with `ChangeListPopover`
    - Popover shows all pending changes across all open files: `[filename] : [change preview] [✓] [✗]`
    - Per-hunk accept/reject from popover (for the focused file), click-to-navigate for other files
    - Accept All / Reject All bulk actions in popover header
    - Toast auto-dismisses after 8 seconds; changes defer to status bar for later review
- Dirty tabs show reload/keep banner for user decision (no auto-accept)
- Sidebar tree auto-refreshes on external file creates and deletes
- Git status auto-refreshes on any external file change
- Git branch diff review takes priority — external changes auto-accept silently when active

**Git branch diff review:**

- Compare current branch against any other branch
- ProseMirror decorations showing additions (green) and deletions (red)
- Accept all / reject all controls in review banner

**Architecture:**

- `InlineDiff` ProseMirror plugin: singleton decoration layer shared by external change review and git branch diff review
- `external-change-store` (Zustand, non-persisted): tracks pending changes per file with hunks, status (`pending` → `deferred`), old/new content
- `diff-match-patch` for character-level diffing with semantic cleanup, mapped to PM positions via `buildTextWithPositions`
- Tiptap extension (`CommentMark`) with ProseMirror plugin state for comment decorations
- `comment-store` (Zustand) with sidecar JSON persistence — extended with `CommentReply`, `CommentStatus`, `DelegationActivity`, `addReply`, `setCommentStatus`, `setTaskId`, activity tracking methods
- `useCommentDelegation` hook: encapsulates delegation flow (status lifecycle, prompt building, `startTask` with callbacks for completion/activity/error)
- `notify`-based filesystem watcher with `notify_debouncer_full` (500ms debounce), backend self-write suppression, `.git/` + `.DS_Store` path filtering, macOS FSEvents modify-to-delete reclassification
- Comment key strategy: UUID for project files, deterministic path hash for non-project files

**Future enhancements (not yet built):**

- Per-hunk accept/reject from popover for non-focused files (currently navigates to file first)
- Cross-file Accept All / Reject All (currently per-file only)
- Comment assignment to specific agents (currently always uses `agent_tasks` routing slot)

### Skills & Agents Platform

Extensible AI capability system based on open standards — users can add new AI skills and agent behaviors by dropping folders, with no app rebuild required.

**Agent Skills & Script Execution:**

- Discover skills from connected providers' filesystem paths (`~/.claude/skills/`, `~/.codex/skills/`, `~/.gemini/skills/`, etc.)
- Notesage skill hierarchy: project `.notesage/skills/` overrides global `~/.notesage/skills/`, which overrides external provider skills
- Agent instruction files: `.notesage/agents.md` (project/global) injected into AI context, with discovery of existing AGENTS.md/CLAUDE.md/GEMINI.md
- Script execution runtime: Tauri command for running skill scripts (bash, python, node), available to all connection types (ACP and direct API)
- Built-in meta-skills: `create-skill` and `create-agent` ship with the app
- Skills browser in settings for viewing, enabling/disabling, and managing discovered skills
- Skill & agent management: delete and move (global ↔ project) for custom skills/agents, gated behind Settings &gt; Advanced toggle
- Auto-rescan: filesystem watcher triggers skill/agent re-discovery; manual rescan button with spinner feedback
- Permission model: per-execution, per-session, or always-allow for script execution

**MCP Client Integration:**

- MCP (Model Context Protocol) client in Rust backend using stdio transport with JSON-RPC 2.0
- Spawn and manage MCP servers as child processes with cleanup on app exit
- Tool discovery from connected servers, displayed in Tools popover alongside ACP agent tools
- Import existing MCP configs from Claude Desktop, Cursor, VS Code
- `.notesage/mcp.json` (project) and `~/.notesage/mcp.json` (global) for Notesage-specific servers
- Settings UI: MCP Servers section with server cards, Add Server dialog, Import dialog

**Addressable Agents:**

- File-based agents replacing legacy personas, aligned with industry standards (GitHub Copilot, Claude Code, VS Code Copilot)
- Discover agent files from `agents/` directories: `.notesage/agents/`, `~/.notesage/agents/`, `~/.claude/agents/`, `.github/agents/`, etc.
- Agent files: markdown with YAML frontmatter (`name`, `description`, `model`, `icon`, `allowed-tools`)
- Agent picker dropdown in chat footer; `@agent-name` addressing in chat input
- 7 bundled agents with one-time migration from legacy custom personas

**Architecture:**

- Adopts two open standards: Agent Skills (SKILL.md) for capabilities/workflows, MCP for callable tool servers
- Agent Skills adopted by Claude Code, Codex CLI, Gemini CLI, VS Code Copilot, Cursor, and 30+ tools
- MCP adopted by all major AI tools with 5,800+ servers and 300+ clients
- Script execution via `std::process::Command` with timeout, path traversal protection, and interpreter resolution
- PRDs: `docs/prds/2026-03-05-skills-and-agents-platform.md`, `docs/prds/2026-03-07-addressable-agents.md`

### AI-Assisted Research (Skill Pack)

AI-powered research workflow built entirely on the Skills & Agents Platform — collect, organize, search, synthesize, and cite from web sources.

**Skills:**

| Skill | Purpose | Type |
| --- | --- | --- |
| `download-webpage` | Fetch URL → clean markdown with metadata | Script-based (enhanced with research frontmatter) |
| `save-research` | Organize research files with tags and metadata | Script-based |
| `search-research` | Search research corpus by tag, keyword, or content | Script-based |
| `synthesize-sources` | Read multiple sources, generate cross-source synthesis | AI-only |
| `insert-citation` | Insert formatted citations into documents | AI-only |

**Research file format:**

- Standard markdown with YAML frontmatter (`source_url`, `title`, `author`, `date_saved`, `date_published`, `tags`, `word_count`)
- Stored in `.notesage/research/` (project) or `~/Notesage/.notesage/research/` (global)
- Images saved to `.notesage/research/images/`

**Collecting:**

- Save web pages via chat: "save this article: \[URL\]"
- Batch URL saving with sequential processing and summary
- Author and publication date extracted from page metadata (`<meta>` tags, JSON-LD, Open Graph)
- Duplicate URL detection with overwrite/keep-both/skip choices

**Searching:**

- `Cmd+4` opens command palette in research search mode
- Real-time filtering via native Rust command (fast enough for 500+ files)
- Results show title, tag pills, source URL domain, and word count
- Tag-only, keyword-only, or combined filtering
- Searches both project and global research directories

**Synthesizing:**

- AI reads multiple research files and generates structured synthesis
- Executive summary, per-source summaries, theme analysis, suggested further research
- Quick reply actions: save as file, insert into document, go deeper on themes

**Citing:**

- Three citation formats: inline links, footnotes, academic (APA/MLA/Chicago)
- Citation format preference persisted per-project in project metadata
- Footnote numbering respects existing footnotes in document
- Bibliography/references sections auto-created when needed

**Architecture:**

- No custom UI panels — uses chat, file tree, and command palette
- All capabilities as bundled skills using Agent Skills format
- `search_research` Tauri command for fast command palette filtering
- `citationFormat`/`citationStyle` fields on `ProjectMetadata`

### Notesage Library & iCloud Sync

Central library folder and selective iCloud sync for projects.

**Library:**

- `~/Notesage` as the default folder for new projects and Quick Notes
- New Project dialog defaults to `~/Notesage` with option to choose another folder
- Cross-platform home directory resolution (macOS, Windows, Linux)

**iCloud sync:**

- Selective iCloud sync per project (not all-or-nothing) via Settings &gt; Sync tab
- iCloud sync toggle in per-project settings (sidebar cog icon)
- When enabled, project folders move to `~/Library/Mobile Documents/com~apple~CloudDocs/Notesage/`
- Quick Notes sync to iCloud with file merge across local and cloud
- Disable sync: project is copied back to local `~/Notesage` and removed from iCloud
- Cloud badge icon on synced files and folders in sidebar
- "Configure then apply" pattern: toggles update pending state, Apply button triggers migration

**iCloud project auto-discovery:**

- On startup, scans the iCloud Notesage folder for projects synced from other machines (top-level directories with `.notesage/` metadata)
- Newly discovered projects are added to the workspace and registered as synced projects automatically
- At runtime, the filesystem watcher detects new projects appearing in the iCloud folder (1s debounce to account for gradual iCloud sync) and adds them to the sidebar
- Filesystem watchers are gated behind a `startupReady` flag to prevent errors from stale paths during startup validation

**Architecture:**

- `sync-store` with disk-based persistence (`sync-settings.json`)
- `scan-icloud-projects.ts`: shared helper for startup and runtime iCloud project discovery
- Tauri commands: `migrate_to_icloud`, `migrate_from_icloud`, `migrate_quick_notes`
- Atomic rename with copy fallback for project migration
- `formatDisplayPath()` utility for user-friendly path labels (iCloud Drive/Notesage, \~/Notesage)
- `startupReady` runtime-only flag in `settings-store` gates filesystem watchers until startup validation completes

**Future enhancements (not yet built):**

- Sync progress/status monitoring from iCloud
- Non-Apple cloud providers (Dropbox, Google Drive, OneDrive)

### Voice Transcription & Dictation

On-device speech-to-text powered by whisper-rs with Metal GPU acceleration — fully offline, no cloud API required.

**Dictation (live):**

- Real-time speech-to-text inserted at the cursor position in the editor
- Triggered via microphone button in chat input or editor status bar
- Web Speech API tried first (browsers); auto-falls back to whisper-rs in WKWebView
- Language selection from 99 supported languages (sorted alphabetically)
- Hallucination filtering removes Whisper artifacts (`[silence]`, `[BLANK_AUDIO]`, repeated phrases)
- RMS silence detection skips empty audio chunks before transcription
- Keyboard shortcut: Cmd+Shift+R to toggle recording

**Meeting recording & transcription:**

- Record audio from microphone with visual recording indicator in status bar
- Stop recording opens transcription dialog with model selection
- Full transcription with timestamped segments and progress tracking
- Transcription results inserted into the active document

**Whisper model management:**

- 5 model sizes: Tiny (39M), Base (74M), Small (244M), Medium (769M), Large v3 (1550M)
- Models downloaded from Hugging Face (`ggerganov/whisper.cpp`) in GGML format
- Concurrent downloads with per-model progress bars and cancel buttons
- Status bar download indicator with popover for detailed progress
- Model management in Settings &gt; Transcription tab (download, delete, set default)

**Architecture:**

- Rust backend: `commands/transcription.rs` — cpal audio capture, whisper-rs transcription, model management
- Audio captured at device-native sample rate/channels, resampled to 16kHz mono via linear interpolation
- Recording thread dedicated (cpal `Stream` is `!Send`), audio buffer shared via `Arc<Mutex<Vec<f32>>>`
- `TranscriptionState` managed state: recording handle, dictation cancel signal, audio buffer, model download cancels
- Frontend: `useRecording` (start/stop), `useTranscription` (model transcription), `useSpeechRecognition` (live dictation with Web Speech API fallback)
- `recording-store` (Zustand, mixed persistence): models, downloads, language, default model
- Tauri commands: `start_recording`, `stop_recording`, `transcribe`, `start_dictation`, `stop_dictation`, `list_whisper_models`, `download_whisper_model`, `cancel_model_download`, `delete_whisper_model`

### AI Provider Architecture v2

Multi-provider AI with subscription-based auth, agent mode, and per-use-case routing via ACP (Agent Client Protocol).

**Connections & routing:**

- Multi-provider connection system: users can connect multiple AI providers simultaneously
- Three auth methods: API key (Anthropic, OpenAI), agent-managed subscription (Claude Code, Codex, Copilot, Gemini CLI via ACP/LSP), local (Ollama)
- Per-use-case routing: separate provider assignment for interactive (chat + inline actions), agent tasks, and inline completion
- GitHub Copilot split into two connections: CLI (ACP — chat/agents only) and LSP (inline completions + chat/agents)
- Smart auto-assignment: first connection fills all compatible use case slots
- One-time migration from v1 ai-store preserves existing API key configurations
- Settings UI: Connections list with provider cards, Add Connection popover with capability guidance, Advanced Routing collapsible section

**ACP (Agent Client Protocol) integration:**

- Full ACP client implementation in Rust backend using `agent-client-protocol` crate
- Agent subprocess spawning, initialization, and authentication via Tauri commands
- ACP session management: create, prompt, cancel, load sessions
- Streaming responses via Tauri events (`acp-session-update`)
- Permission request handling: all tool calls require explicit user approval with tiered options (allow once / allow for session / allow always); no hard-coded auto-approval Tiered permission UI: PermissionCard with split Allow button + dropdown for session/always; session approvals non-persisted, always approvals persisted via Zustand persist Context-aware chat footer: "Tools" popover for ACP agents (pre-populated tool list with per-tool approval cycling), "Search" toggle for direct API connections
- Four supported ACP agents: Claude Code (`claude-agent-acp`), OpenAI Codex (`codex-acp`), GitHub Copilot CLI (`copilot --acp` — chat/agents only, no inline completions), Google Gemini CLI (`gemini --acp` — free with Google account)
- Copilot Language Server (`copilot-language-server`) for inline completions via LSP protocol (separate from ACP)

**Agent activity & tasks:**

- Agent activity strip: narrow 40px rail always visible when tasks exist, shows per-task status icons
- Agent activity panel: resizable expanded sidebar with full task details, toggled via Cmd+Shift+A or title bar button
- Background task agent hook (`useAgentTaskOperations`): separate ACP instance for delegated work
- Task lifecycle: start, cancel, track status and output
- Agent file changes flow through existing file watcher → external-change-store → inline diff review

**Architecture:**

- `connections-store` (Zustand, persisted): manages provider connections
- `routing-store` (Zustand, persisted): maps use cases to connections
- `permission-store` (Zustand, partially persisted): tracks ACP tool call approvals
- `AcpState` (Rust managed state): agent process handles, sessions, install lock; `stop_all_sync()` drains all agents on app exit
- Tauri commands: `acp_agent_spawn`, `acp_agent_authenticate`, `acp_agent_stop`, `acp_agent_check_availability`, `acp_session_new`, `acp_session_prompt`, `acp_session_cancel`, `acp_session_load`, `acp_permission_respond`

**Future enhancements (not yet built):**

- Agent binary auto-install wizard — automated npm install from within the app (PRD: `docs/prds/2026-02-21-agent-install-wizard.md`)
- ACP agent binary bundling as Tauri sidecar

### Local AI (Bundled Inference)

Privacy-focused offline AI with zero setup — no API keys, no external software, no accounts required.

**Inference engine:**

- Bundled `llama-server` (llama.cpp) as Tauri sidecar binary with Metal GPU acceleration
- Auto-starts on app launch when enabled and a model is downloaded
- Auto-restarts on crash (max 3 retries, then error state)
- Process cleanup: `RunEvent::Exit` hook (SIGTERM → SIGKILL), `pkill` at startup for crash recovery, `kill_on_drop(true)` on process handle, frontend `beforeunload` as tertiary defense
- Health checks every 30 seconds via `/health` endpoint

**Model management:**

- Curated model catalog embedded at compile time (`model-catalog.json`)
- Models downloaded from Hugging Face in GGUF format to `~/.notesage/models/llm/`
- Download progress via Tauri events, concurrent downloads with cancel support
- System RAM detection for model recommendations
- Settings → Local AI tab with model cards (download, delete, set active, FIM badge)
- Custom model support via `~/.notesage/models/llm/custom-models.json`

**Chat & inline actions:**

- Chat streaming via OpenAI-compatible `/v1/chat/completions` endpoint on localhost
- Bubble menu actions (Improve, Summarize, Expand) work with local models
- Thinking/reasoning model support via hardcoded tag parser (`<think>`, `<reasoning>`, `<reflection>`, etc.)
- First-run setup card in chat panel when no AI connections exist

**Inline completions:**

- FIM (Fill-in-the-Middle) via llama-server's `/infill` endpoint for code models (Qwen2.5 Coder, etc.)
- Chat-based fallback for non-FIM models using instructed `/v1/chat/completions` prompt
- Configurable context size (`fimContextChars` setting, adjustable via status bar slider)
- Error backoff (stops after 5 consecutive failures, resets on connection/model/tab change)
- Custom inline completion icon in status bar (italic T with sparkle trail)

**Architecture:**

- Rust backend: `commands/local_inference.rs` — `LocalInferenceState` managed state, sidecar lifecycle, model catalog, download management, FIM completions
- Binary resolution: bundled sidecar → `~/.notesage/bin/` → system PATH
- Frontend: `useLocalAI` hook (server lifecycle, health checks), `useLocalCompletion` hook (inline completions), `LocalProvider` (AIProvider implementation)
- `local-ai-store` (Zustand, mixed persistence): server status, active model, downloads, system memory

**Future enhancements (not yet built):**

- Embeddings and semantic search (foundation laid with model directory structure)
- Custom GGUF model import UI (users can use Ollama for arbitrary models)
- Windows/Linux support (llama-server binaries exist for all platforms)

## Roadmap

### Phase 10 — Agent Binary Management & Runtime Sandboxing

**Goal:** Zero-dependency agent installation, isolated runtime execution, and automatic updates — so non-developer users can set up AI agents without leaving the app.

**Features:**

- Managed agent binary installation to `~/.notesage/bin/` (download from GitHub Releases, no Node.js required for 4/5 agents)
- Portable Node.js runtime for Gemini CLI (the only agent that genuinely needs it)
- Prefer user-installed system binaries when available — only offer managed install when not found
- OS-level filesystem sandboxing for managed installs and skill script execution (Seatbelt on macOS, Bubblewrap/Landlock on Linux)
- Network sandboxing via proxy with per-agent domain allowlists
- Automatic update checking with one-click updates
- User-configurable sandbox policies per connection

**Architecture considerations:**

- New Rust modules: `agent_manager.rs` (install, update, resolve), `sandbox.rs` (Seatbelt profiles, bwrap args)
- GitHub Releases API for binary downloads, npm registry fallback for Gemini
- Defense in depth: installation isolation + runtime sandbox + ACP permissions + skill script sandboxing
- Phase 7's `execute_skill_script` is the primary target for sandboxing — scripts gain OS-level isolation with no changes to the skill format
- PRD: `docs/prds/2026-02-21-agent-install-wizard.md`

### Beyond — Ideas

Not committed, but potential future features:

- **Workflows & Automation:** User-defined YAML workflows for repetitive AI tasks — implementable as a `workflow-runner` skill using Phase 7 infrastructure
- **Collaboration:** Real-time collaborative editing (CRDT-based), share notes via link, version history with visual diff
- **Mobile apps:** iOS app (Swift + Tauri Mobile), Android, sync across devices
- **Plugins:** Plugin API (Rust or WASM), community marketplace, custom AI providers and export formats
- **Advanced editor:** Canvas mode, Mermaid diagrams, math equations (KaTeX/MathJax), Excalidraw integration
- **Knowledge base:** Backlinks, tag system, daily notes, graph view of note connections
- **Advanced AI:** Multi-file context, semantic search, AI-powered autocomplete, knowledge graph visualization

## Architectural Decisions

These choices from earlier work enable the roadmap ahead:

1. **ProseMirror over simpler editors** — Decoration system enables inline diffs and AI suggestion overlays. Plugin system allows comment marks without rewriting the editor. CRDT-friendly for future real-time collaboration.
2. **Tauri commands for all I/O** — Pattern established for file/git operations extends to filesystem watching, agent task management, skill script execution, and web page fetching. Security boundary for AI and agent operations.
3. **Zustand stores with clear boundaries** — Easy to add new stores (comment-store, skill-store). Persist middleware supports offline-first approach.
4. `.notesage/` **metadata directory** — Supports sidecar comments, skill directories, agent instructions, research storage, workflow definitions. Project-relative paths keep everything portable.
5. **YAML frontmatter with lazy document UUID** — Stable document identity enables comments that survive renames, cross-document references, and AI task assignments.
6. **Provider abstraction (**`AIProvider` **interface)** — Extends to local AI, new providers. Web search already implemented as provider-native tools.
7. **Component modularity** — Sidebar, editor, tabs, chat panel are separate — easy to add skills browser, research panel. shadcn/ui components are composable.
8. **Open standards adoption (Agent Skills + MCP)** — Skills and tools follow widely adopted cross-tool standards rather than a proprietary format. Users can leverage existing skills from Claude Code, Codex, Gemini CLI, and 30+ tools without migration. New capabilities are added by dropping folders, not rebuilding the app.

## Implementation Philosophy

1. **Don't break existing features** — completed work must continue to function
2. **Graceful degradation** — advanced features should be opt-in
3. **Performance first** — don't slow down the editor
4. **Privacy by default** — local-first, cloud-optional
5. **Stay focused** — each phase has a clear goal, don't scope-creep
6. **Ship iteratively** — release features when they're ready, don't wait for entire phase

## Quality Gates

Before any release, ALL of these must pass:

### Functional

- [ ] Can open a folder of .md files via native dialog

- [ ] File tree displays all files and folders correctly

- [ ] Clicking a .md file opens it in the rich text editor

- [ ] All markdown syntax renders correctly in rich text mode

- [ ] Saving serializes back to clean, valid markdown

- [ ] **Round-trip test passes**: Open -&gt; edit nothing -&gt; save -&gt; file is identical (whitespace-normalized)

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

### Design

- [ ] App looks like it belongs next to Linear, Bear, or Craft

- [ ] Sidebar has smooth hover transitions and clear active state

- [ ] Editor content area is max 720px wide and beautifully typeset

- [ ] All interactive elements have hover, active, and focus states

- [ ] Theme switching is smooth with color transitions

- [ ] No default browser UI elements visible (checkboxes, scrollbars, selects)

- [ ] Consistent border-radius, spacing, and color palette throughout

- [ ] Code blocks have syntax highlighting with a tasteful theme

- [ ] Bubble menu has backdrop blur and smooth animation

- [ ] Typography is polished: proper hierarchy, readable sizes, intentional weight usage

- [ ] Looks great in BOTH light and dark mode
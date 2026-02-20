---
id: ""
---

# Notesage — Product Description

Notesage is a WYSIWYG markdown editor with AI collaboration capabilities, packaged as a lightweight desktop application using Tauri v2.

**Current version:** 0.12.0

## Current Features

### Editor

Tiptap-powered WYSIWYG editor with full markdown round-tripping.

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

- Cmd+F quick-open with file search change 2 **File management:**

- Sidebar file tree with expand/collapse, file icons by extension, right-click context menu (new file, new folder, rename, delete)

- File operations via Tauri commands: open folder (native dialog), open/save/create/rename/delete files

- Hidden files/folders ignored by default

**Markdown round-tripping**:

- Open .md file -&gt; parse to ProseMirror -&gt; edit in WYSIWYG -&gt; serialize back to clean markdown
- Lossless: markdown in must equal markdown out (modulo whitespace normalization)
- Test fixtures in `tests/fixtures/*.md` covering all syntax

**Desktop packaging:**

- macOS primary (arm64 + x86_64), window 1200x800 default, min 800x600
- Native title bar, resizable
- Light/dark mode following system preference (Cmd+Shift+T to toggle)

### AI Collaboration

Multi-provider AI integration with chat and inline actions.

**Providers:**

- Anthropic Claude (Messages API with server-side web search via `web_search_20250305`)
- OpenAI (Responses API `/v1/responses` with `web_search_preview` tool)
- Ollama (local models, no web search)

**Features:**

- Chat panel as collapsible right sidebar (Cmd+Shift+A) with streaming responses
- Inline AI actions via BubbleMenu: Improve, Summarize, Expand selected text
- AI personas with configurable system messages
- Custom prompts/templates for AI actions
- Project-scoped AI context (provider, persona, and context overrides per project)
- Provider logos with dark mode support
- All AI calls through Tauri backend (Rust) for security
- API keys stored in localStorage via Zustand persist

**Architecture:**

- Provider interface: `AIProvider` with `generateText()` and `chat()` methods
- Three implementations: AnthropicProvider, OpenAIProvider, OllamaProvider
- State stores: ai-store (config), chat-store (messages)
- Tauri commands: ai_generate_text, ai_chat, ai_chat_stream

**Future enhancements (not yet built):**

- ProseMirror decorations for inline suggestions (green insert, red delete)
- Context-aware suggestions (understand document structure)
- Conversation branching/forking in chat
- AI-powered autocomplete while typing

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

### Comments & Change Detection

Document comments and external change tracking — foundational infrastructure for human-AI collaboration.

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

**External change detection & review:**

- Tauri filesystem watcher (via `notify` crate with `notify_debouncer_full`) for watched directories
- Self-write filtering at the Rust backend level (`markSelfWrite` before writes, event suppression at source)
- `.git/` and `.DS_Store` paths filtered to prevent iCloud-synced repo event floods
- macOS FSEvents workaround: modify events for deleted paths reclassified as deletes
- Path normalization for macOS `/private/` prefix (FSEvents canonicalization)
- Clean tabs: inline diff review with word-level `diff-match-patch` diffing, mapped to ProseMirror positions
  - Toast notification ("File changed externally") with Accept button and close X
  - Inline diff decorations: red strikethrough for deletions, green for insertions
  - Per-hunk accept/reject via inline click controls or keyboard shortcuts (`Cmd+Enter` / `Cmd+Backspace`)
  - Status bar change tracker (`RefreshCw` icon + count) with `ChangeListPopover`
  - Popover shows all pending changes across all open files: `[filename] : [change preview]  [✓] [✗]`
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
- `comment-store` (Zustand) with sidecar JSON persistence
- `notify`-based filesystem watcher with `notify_debouncer_full` (500ms debounce), backend self-write suppression, `.git/` + `.DS_Store` path filtering, macOS FSEvents modify-to-delete reclassification
- Comment key strategy: UUID for project files, deterministic path hash for non-project files

**Future enhancements (not yet built):**

- Per-hunk accept/reject from popover for non-focused files (currently navigates to file first)
- Cross-file Accept All / Reject All (currently per-file only)

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

**Architecture:**

- `sync-store` with disk-based persistence (`sync-settings.json`)
- Tauri commands: `migrate_to_icloud`, `migrate_from_icloud`, `migrate_quick_notes`
- Atomic rename with copy fallback for project migration
- `formatDisplayPath()` utility for user-friendly path labels (iCloud Drive/Notesage, \~/Notesage)

**Future enhancements (not yet built):**

- Sync progress/status monitoring from iCloud
- Non-Apple cloud providers (Dropbox, Google Drive, OneDrive)

## Roadmap

### Phase 6 — Agentic AI Collaboration

**Goal:** Integrate agentic AI that works alongside the user — making changes, receiving delegated tasks, and operating with the user's existing AI subscription.

**Features:**

- Anthropic Agent SDK integration
  - Reuse user's existing Claude subscription instead of requiring separate API keys
  - OAuth/subscription-based authentication flow
- Comment-to-task delegation
  - User marks comments as "delegate to AI"
  - AI agent reads delegated comments, makes changes to files on disk
  - App detects changes (Phase 5 infrastructure), shows diffs for review
  - User accepts/rejects/adds follow-up comments -&gt; iterative collaboration loop
- AI-driven git workflows
  - Smart commit messages generated from diffs
  - PR description drafting
  - Change summarization across multiple files

**Architecture considerations:**

- Anthropic Agent SDK client in Rust backend or as sidecar process
- Agent task queue in `.notesage/agent-tasks/`
- Requires Phase 5 (comments + change detection) as foundation
- Security: agent operates within project directory boundaries only

### Phase 7 — AI-Assisted Research

**Goal:** AI-powered research workflow — collect, store, synthesize, and draft from web sources.

**Features:**

- Research reference management
  - Save web URLs as references in `.notesage/research/`
  - Download and convert web pages to markdown files for offline access
  - Reference metadata (URL, title, date captured, tags)
- AI synthesis
  - Distill multiple research sources into concise summaries
  - Extract key findings, quotes, and data points
  - Cross-reference research with project goals
- Content drafting
  - Generate drafts from collected research
  - Summarize project content based on research corpus
  - Insert citations linking back to source material

**Architecture considerations:**

- New Tauri commands for web page fetching and HTML-to-markdown conversion
- Research store with search/filter capabilities
- Builds on web search and document identity infrastructure

### Phase 8 — Workflows & Automation

**Goal:** User-defined automation for repetitive AI-assisted tasks.

**Features:**

- YAML-defined custom workflows
  - Multi-step AI operations
  - Conditional logic and branching
  - File transformations and batch processing
- Workflow engine in Rust backend
- Workflow templates (e.g., "review all documents", "update summaries", "check goals progress")

**Architecture considerations:**

- Workflow engine in Rust backend
- New store: `workflow-store`
- Workflow definitions in `.notesage/workflows/`

### Phase 9 — Local AI

**Goal:** Privacy-focused offline AI with no external API dependency.

**Features:**

- Bundled llama-server for local inference
  - Ship with pre-configured model or guided download
  - No API keys required
  - GPU acceleration support
- Seamless provider switching — same chat/inline AI features work with local models

**Architecture considerations:**

- Ship llama.cpp binaries with app
- Model files (\~4GB) as optional download
- Extends existing provider abstraction (`AIProvider` interface)

### Beyond — Ideas

Not committed, but potential future features:

- **Collaboration:** Real-time collaborative editing (CRDT-based), share notes via link, version history with visual diff
- **Mobile apps:** iOS app (Swift + Tauri Mobile), Android, sync across devices
- **Plugins:** Plugin API (Rust or WASM), community marketplace, custom AI providers and export formats
- **Advanced editor:** Canvas mode, Mermaid diagrams, math equations (KaTeX/MathJax), Excalidraw integration
- **Knowledge base:** Backlinks, tag system, daily notes, graph view of note connections
- **Advanced AI:** Multi-file context, semantic search, AI-powered autocomplete, knowledge graph visualization

## Architectural Decisions

These choices from earlier work enable the roadmap ahead:

1. **ProseMirror over simpler editors** — Decoration system enables inline diffs and AI suggestion overlays. Plugin system allows comment marks without rewriting the editor. CRDT-friendly for future real-time collaboration.
2. **Tauri commands for all I/O** — Pattern established for file/git operations extends to filesystem watching, agent task management, and web page fetching. Security boundary for AI and agent operations.
3. **Zustand stores with clear boundaries** — Easy to add new stores (comment-store, workflow-store). Persist middleware supports offline-first approach.
4. `.notesage/` **metadata directory** — Supports sidecar comments, research storage, workflow definitions, agent task queues. Project-relative paths keep everything portable.
5. **YAML frontmatter with lazy document UUID** — Stable document identity enables comments that survive renames, cross-document references, and AI task assignments.
6. **Provider abstraction (**`AIProvider` **interface)** — Extends to Anthropic Agent SDK, local AI. Web search already implemented as provider-native tools.
7. **Component modularity** — Sidebar, editor, tabs, chat panel are separate — easy to add comment panel, research panel. shadcn/ui components are composable.

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

- [ ] Clicking a .md file opens it in the WYSIWYG editor

- [ ] All markdown syntax renders correctly in WYSIWYG mode

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
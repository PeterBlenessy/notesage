# Notesage — Product Description

Notesage is a WYSIWYG markdown editor with AI collaboration capabilities, packaged as a lightweight desktop application using Tauri v2.

**Current version:** 0.7.0

## Current Features

### Editor

Tiptap-powered WYSIWYG editor with full markdown round-tripping.

**Supported content:**

- Headings (H1-H6), paragraphs
- Bold, italic, underline, strikethrough, code (inline)
- Bullet lists, ordered lists, task lists (checkboxes)
- Blockquotes, horizontal rules
- Code blocks with syntax highlighting (lowlight)
- Links (with URL editing popup), images (local path, clipboard paste)
- Tables (insert, add/remove rows/columns)

**Editing features:**

- Floating toolbar on text selection (bold, italic, underline, strikethrough, code, link, heading selector, alignment) — toggleable in settings
- Slash commands (`/` at start of line) for inserting headings, lists, code blocks, blockquotes, tables, horizontal rules, images
- Multi-tab editing with dirty indicator, auto-save on blur/tab switch (debounced 1s)
- Cmd+F quick-open with fuzzy file search

**File management:**

- Sidebar file tree with expand/collapse, file icons by extension, right-click context menu (new file, new folder, rename, delete)
- File operations via Tauri commands: open folder (native dialog), open/save/create/rename/delete files
- Hidden files/folders ignored by default

**Markdown round-tripping:**

- Open .md file -> parse to ProseMirror -> edit in WYSIWYG -> serialize back to clean markdown
- Lossless: markdown in must equal markdown out (modulo whitespace normalization)
- Test fixtures in `tests/fixtures/*.md` covering all syntax

**Desktop packaging:**

- macOS primary (arm64 + x86_64), window 1200x800 default, min 800x600
- Native title bar, remembers window position/size between launches
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

## Roadmap

### Phase 4 — Document Generation

**Goal:** Export notes to professional document formats.

**Features:**

- PDF export
  - Professional typesetting
  - Custom themes/templates
  - Table of contents
  - Page numbers, headers/footers
- DOCX export
  - Preserve formatting (headings, lists, tables)
  - Embedded images
  - Styles mapping (markdown -> Word styles)
- PPTX export
  - Headings -> slides
  - Lists -> bullet points
  - Images -> slide images
  - Speaker notes from blockquotes
- Template system
  - Predefined templates (report, article, presentation)
  - Custom template editor
  - Template marketplace (future)

**Architecture considerations:**

- New Tauri commands: `export_pdf`, `export_docx`, `export_pptx`
- Rust libraries: `printpdf`, `docx-rs`, or similar
- Template files in `templates/` directory
- Export settings in project metadata

### Phase 5 — Comments & Change Detection

**Goal:** Document comments and external change tracking — foundational infrastructure for human-AI collaboration.

**Features:**

- Document comments and annotations
  - Inline comments attached to text ranges via Tiptap marks/decorations
  - Comment panel (sidebar or popover) for viewing and managing comments
  - Comments stored as sidecar JSON in `.notesage/comments/{uuid}.json`
  - Lazy document UUID — auto-generated in frontmatter (`id` field) only when first comment or cross-reference is created
  - Document index (`.notesage/doc-index.json`) mapping UUID -> current file path, rebuilt on project open by scanning frontmatter
  - Comments survive file renames/moves via UUID identity
- External file change detection
  - Tauri filesystem watcher for open files
  - Prompt to reload when file changes on disk (e.g., from external editor or AI agent)
  - Option to show inline diff instead of auto-reloading
- Inline diff display
  - ProseMirror decorations showing additions (green) and deletions (red) when file changes externally
  - Accept/reject per-change controls (Track Changes style)
  - Git-based diff for version-controlled projects

**Architecture considerations:**

- Tiptap extension for comment marks with metadata (author, timestamp, text)
- New store: `comment-store` with sidecar JSON persistence
- Tauri filesystem watcher via `tauri-plugin-fs` or `notify` crate
- UUID generation: `uuid` crate in Rust or `crypto.randomUUID()` in frontend
- Document index enables stable cross-document references for future features (backlinks, research references, AI task assignments)

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
  - User accepts/rejects/adds follow-up comments -> iterative collaboration loop
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
- Model files (~4GB) as optional download
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
4. **`.notesage/` metadata directory** — Supports sidecar comments, research storage, workflow definitions, agent task queues. Project-relative paths keep everything portable.
5. **YAML frontmatter with lazy document UUID** — Stable document identity enables comments that survive renames, cross-document references, and AI task assignments.
6. **Provider abstraction (`AIProvider` interface)** — Extends to Anthropic Agent SDK, local AI. Web search already implemented as provider-native tools.
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
- [ ] **Round-trip test passes**: Open -> edit nothing -> save -> file is identical (whitespace-normalized)
- [ ] Multi-tab editing works (switch tabs preserves state)
- [ ] Unsaved changes indicator works
- [ ] Auto-save on tab switch works
- [ ] Slash commands insert correct block types
- [ ] Floating toolbar appears on selection and applies formatting
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
- [ ] Floating toolbar has backdrop blur and smooth animation
- [ ] Typography is polished: proper hierarchy, readable sizes, intentional weight usage
- [ ] Looks great in BOTH light and dark mode

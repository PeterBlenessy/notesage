# Future Phases

These are documented here so architectural decisions don't accidentally block future work. **Do not build these yet.**

## Phase 2 — AI Collaboration ✅ COMPLETE

**Status:** Implemented

Inline AI suggestions, chat panel, and provider abstraction.

**Completed features:**

- AI provider abstraction (Anthropic Claude, OpenAI, Ollama)
- Settings UI for API key configuration
- Chat panel as collapsible right sidebar (Cmd+Shift+A)
- Inline AI actions via BubbleMenu (Improve, Summarize, Expand)
- AI personas with configurable system messages
- Custom prompts/templates for AI actions
- Streaming responses for real-time chat
- Project-scoped AI context (provider, persona, and context overrides per project)
- Provider logos with dark mode support
- Secure API key storage in localStorage
- All AI calls through Tauri backend for security

**Architecture:**

- Provider interface: `AIProvider` with `generateText()` and `chat()` methods
- Three implementations: AnthropicProvider, OpenAIProvider, OllamaProvider
- State stores: ai-store (config), chat-store (messages)
- Tauri commands: ai_generate_text, ai_chat, ai_chat_stream

**Future Phase 2 enhancements:**

- ProseMirror decorations for inline suggestions (green insert, red delete)
- Context-aware suggestions (understand document structure)
- Conversation branching/forking in chat
- AI-powered autocomplete while typing

## Phase 3 — Project Workspace (Partially Complete)

**Goal:** Enhanced project management and version control integration.

**Completed features:**

- `.note-sage/` metadata directory auto-bootstrapped per project
  - Project settings (name, description)
  - AI context (provider, persona, project context overrides)
- New Project dialog (Cmd+Shift+N) — creates folder + metadata
- New Note dialog (Cmd+N) — replaces browser prompts, duplicate detection
- Project Settings tab in settings dialog
- `project-metadata-store` for project-level state
- `useProjectMetadata` hook for auto-loading/saving metadata
- Git integration (core)
  - File status indicators in sidebar (modified, staged, untracked, deleted, renamed, conflicted)
  - Commit dialog with file selection, staging/unstaging, and message input
  - Branch display and switching via dropdown
  - Auto-detection of git repos, git availability check
  - Git identity configuration UI when `user.name`/`user.email` missing
  - Toast notifications for commit success and git errors
  - Status refresh on save, commit, branch switch, and window focus

**Remaining features:**

- `.note-sage/` extensions
  - Custom workflows
  - Search history
- Git enhancements
  - View diff in editor
  - Conflict resolution helpers
- Web search integration
  - Search web from within app
  - Insert search results as references
  - Auto-cite sources
- Project goals tracking
  - Define project objectives
  - AI suggestions based on goals
  - Progress tracking

**Architecture considerations:**

- Search results in dedicated panel

## Phase 4 — Document Generation

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
  - Styles mapping (markdown → Word styles)
- PPTX export
  - Headings → slides
  - Lists → bullet points
  - Images → slide images
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

## Phase 5 — Workflows & Advanced AI

**Goal:** Automation, advanced AI features, and local AI support.

**Features:**

- YAML-defined workflows
  - Multi-step AI operations
  - Conditional logic
  - File transformations
  - Batch processing
- Bundled llama-server for local AI
  - Ship with pre-configured Llama model
  - No API keys required
  - Privacy-focused offline AI
  - GPU acceleration support
- GitHub Copilot integration
  - Code completion in editor
  - Suggest next paragraph
  - Auto-complete lists
- Advanced AI features
  - Multi-file context (pass entire project to AI)
  - Semantic search across project
  - Auto-generate summaries
  - Link suggestions (auto-link related notes)
  - Knowledge graph visualization

**Architecture considerations:**

- Workflow engine in Rust backend
- Ship llama.cpp binaries with app
- Model files (\~4GB) optional download
- New store: `workflow-store`
- WebSocket or SSE for streaming responses

## Beyond Phase 5 — Ideas

Not committed, but potential future features:

- **Collaboration:**

  - Real-time collaborative editing (CRDT-based)
  - Comments and annotations
  - Version history with visual diff
  - Share notes via link

- **Mobile apps:**

  - iOS app (Swift + Tauri Mobile)
  - Android app
  - Sync across devices (self-hosted or cloud)

- **Plugins:**

  - Plugin API (Rust or WASM)
  - Community plugin marketplace
  - Custom AI providers
  - Custom export formats

- **Advanced editor:**

  - Canvas mode (infinite whiteboard)
  - Mermaid diagram support
  - Math equations (KaTeX/MathJax)
  - Excalidraw integration

- **Knowledge base:**

  - Backlinks (notes linking to this note)
  - Tag system
  - Daily notes
  - Templates
  - Graph view of note connections

## Key Future-Proofing Decisions Made in Phase 1

These architectural choices enable future phases:

1. **ProseMirror over simpler editors**

   - Decoration system critical for Phase 2 AI suggestions
   - Plugin system allows extensions without rewrite
   - Collaborative editing support (CRDT-friendly)

2. **Tauri commands for all file operations**

   - Pattern extends to Git operations (Phase 3)
   - Allows filesystem sandboxing
   - Security boundary for AI operations

3. **Zustand stores with clear boundaries**

   - Easy to add new stores (ai-store, project-store, project-metadata-store added; workflow-store planned)
   - Persist middleware supports offline-first approach
   - Redux DevTools support for debugging

4. **No hardcoded paths**

   - `.note-sage/` metadata directory now implemented and auto-bootstrapped
   - Project-relative paths support workspace features

5. **Component modularity**

   - Sidebar, editor, and tabs are separate
   - Easy to add new panels (chat panel, search panel, graph view)
   - shadcn/ui components are composable

6. **CSS variables for theming**

   - Easy to add custom themes
   - Template system can override colors
   - Export maintains theme styling

## Implementation Philosophy

When building future phases:

1. **Don't break existing features** - Phase 1 must continue to work
2. **Graceful degradation** - Advanced features should be opt-in
3. **Performance first** - Don't slow down the editor
4. **Privacy by default** - Local-first, cloud-optional
5. **Stay focused** - Each phase has a clear goal, don't scope-creep
6. **Ship iteratively** - Release features when they're ready, don't wait for entire phase
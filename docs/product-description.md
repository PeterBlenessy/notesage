---
id: ""
---

# Notesage — Product Description

Notesage is a rich text markdown editor with AI collaboration capabilities, packaged as a lightweight desktop application using Tauri v2.

**Current version:** 0.19.3

## Features

| Feature | Summary | Details |
| --- | --- | --- |
| Editor | Tiptap rich text editor with markdown round-tripping, find & replace, inline tag badges | features/editor.md |
| Document Index | SQLite-backed index with AST-parsed tags, mentions, tasks, goals, and FTS5 content search | prds/2026-03-14-sqlite-document-index.md |
| AI Providers | Multi-provider architecture (Anthropic, OpenAI, Ollama, Local AI, ACP agents, Copilot LSP) | features/ai-providers.md |
| AI Workflows | Chat, agents, skills, MCP, comment delegation, research, voice transcription | features/ai-workflows.md |
| Document Formats | EPUB viewer, PDF export, DOCX/PDF/plain text viewers | features/document-formats.md |
| Workspace | Projects, file tree, iCloud sync, git integration, external change detection | features/workspace.md |

For editor architecture internals (ProseMirror, decorations, extensions): features/editor-architecture.md

## Roadmap

### Phase 10 — Agent Binary Management & Runtime Sandboxing

**Goal:** Zero-dependency agent installation, isolated runtime execution, and automatic updates.

- Managed agent binary installation to `~/.notesage/bin/` (download from GitHub Releases)
- Portable Node.js runtime for Gemini CLI
- OS-level filesystem sandboxing (Seatbelt on macOS, Bubblewrap/Landlock on Linux)
- Network sandboxing via proxy with per-agent domain allowlists
- Automatic update checking with one-click updates
- PRD: `docs/prds/2026-02-21-agent-install-wizard.md`

### Beyond — Ideas

- **Workflows & Automation:** User-defined YAML workflows as skills
- **Collaboration:** Real-time collaborative editing (CRDT-based), share notes via link
- **Mobile apps:** iOS app (Swift + Tauri Mobile), Android, sync across devices
- **Plugins:** Plugin API (Rust or WASM), community marketplace
- **Advanced editor:** Canvas mode, Mermaid diagrams, math equations, Excalidraw
- **Knowledge base:** Backlinks, daily notes, graph view of note connections
- **Advanced AI:** Multi-file context, semantic search, knowledge graph visualization

## Architectural Decisions

1. **ProseMirror over simpler editors** — Decoration system enables inline diffs and AI suggestion overlays. Plugin system allows comment marks without rewriting the editor. CRDT-friendly for future collaboration.
2. **Tauri commands for all I/O** — Security boundary for all file, AI, and agent operations.
3. **Zustand stores with clear boundaries** — Persist middleware supports offline-first approach.
4. `.notesage/` **metadata directory** — Sidecar comments, skill directories, agent instructions, research storage. Project-relative paths keep everything portable.
5. **YAML frontmatter with lazy document UUID** — Stable document identity for comments that survive renames and cross-document references.
6. **Provider abstraction (**`AIProvider` **interface)** — Extends to local AI, new providers. Web search implemented as provider-native tools.
7. **Component modularity** — Sidebar, editor, tabs, chat panel are separate and composable.
8. **Open standards (Agent Skills + MCP)** — Skills and tools follow widely adopted cross-tool standards. No proprietary format.
9. **SQLite document index** — Persistent, structure-aware index built from comrak AST parsing. Replaces regex-based filesystem scanning with instant SQL queries for tags, mentions, tasks, goals, and FTS5 content search. Each device rebuilds its own index from files (iCloud safe).

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
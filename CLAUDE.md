# CLAUDE.md — Notesage Project Spec

## What is Notesage?

Notesage is a rich text markdown editor with AI collaboration capabilities, packaged as a lightweight desktop application using Tauri v2.

**Current version:** 0.23.0

## Tech Stack

| Layer | Technology | Version |
| --- | --- | --- |
| Desktop shell | Tauri | v2 (latest stable) |
| Frontend | React 19+ + TypeScript 5+ | Latest |
| Editor | Tiptap v2 (wraps ProseMirror) | Latest |
| UI Components | shadcn/ui (Radix + Tailwind v4) | Latest |
| State | Zustand with persist | Latest |
| Package manager | pnpm | Latest |

## Code Conventions

- **Language:** All code, comments, variables in English
- **Components:** Functional React with hooks. No classes.
- **Naming:** PascalCase (components), camelCase (functions/vars), UPPER_SNAKE (constants)
- **Files:** One component per file. Filename = component name.
- **Types:** Prefer interfaces. No `any` (use `unknown`).
- **Errors:** Tauri returns `Result<T, String>`. Show toast for user errors.

## Documentation

**Before building anything, read the relevant docs:**

| Need | Read |
| --- | --- |
| Core architecture, tech stack, project structure | @docs/architecture.md |
| UI/UX requirements, typography, colors, component specs | @docs/design-system.md |
| Overview, roadmap, quality gates | @docs/product-description.md |
| Tauri command signatures, IPC patterns | @docs/tauri-commands.md |
| All keyboard shortcuts | @docs/keyboard-shortcuts.md |
| Implementation history | @docs/history/ |
| Product requirements | @docs/prds/ |

**Feature-specific docs (read when working on that area):**

| Feature area | Read |
| --- | --- |
| Editor, find, tags, formatting | @docs/features/editor.md |
| Editor internals (ProseMirror, decorations, extensions) | @docs/features/editor-architecture.md |
| AI providers, connections, routing, local AI, completions | @docs/features/ai-providers.md |
| Chat, agents, skills, MCP, delegation, research, voice | @docs/features/ai-workflows.md |
| EPUB, PDF export, DOCX, viewers | @docs/features/document-formats.md |
| Projects, file tree, iCloud, git, external changes | @docs/features/workspace.md |

## Development Lifecycle

| Command | Purpose |
| --- | --- |
| `/prd <feature>` | Create a Product Requirements Document |
| `/plan-tasks <prd-or-feature>` | Break down into implementation tasks |
| `/impl <task>` | Implementation guidance with relevant context |
| `/verify <prd-or-feature>` | Verify against PRD and quality gates |
| `/release <patch\|minor\|major>` | Prepare a release with version bump |
| `/review-code` | Code review against conventions |
| `/review-ui` | Design review against design system |
| `/test` | Run full test suite |

## Quick Start

```bash
pnpm install        # Install dependencies
pnpm tauri dev      # Run dev server
pnpm tauri build    # Build for production
```

## Backend (Rust/Tauri)

When modifying Rust files in `src-tauri/`, the running `pnpm tauri dev` process hot-reloads Rust changes automatically. However, if hot-reload fails or you see stale behavior after changing Tauri commands (adding/removing/renaming commands, changing signatures), run a clean rebuild:

```bash
cd src-tauri && cargo clean && cd .. && pnpm tauri dev
```

**When to clean rebuild:**
- Added or removed a `#[tauri::command]` function
- Changed command signatures or the `generate_handler![]` list in `lib.rs`
- Changed Cargo dependencies
- Unexplained "command not found" errors from the frontend

## Versioning

The app version is defined in `package.json`. The Tauri config (`src-tauri/tauri.conf.json`) references it via `"version": "../package.json"` — only bump `package.json` when releasing.

`src-tauri/Cargo.toml` maintains its own independent crate version.

## Key Decisions

1. **ProseMirror:** Enables AI decorations, collaborative editing
2. **Tauri commands:** Security boundary for all I/O
3. **Zustand stores:** Persist middleware, clear boundaries
4. **shadcn/ui:** Compose, don't rebuild
5. **CSS variables:** Light/dark themes, future customization

## Resources

- Tauri v2 docs: https://v2.tauri.app
- Tiptap docs: https://tiptap.dev
- shadcn/ui: https://ui.shadcn.com
- Tailwind v4: https://tailwindcss.com
- ProseMirror: https://prosemirror.net

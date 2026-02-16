# CLAUDE.md — Notesage Project Spec

## What is Notesage?

Notesage is a WYSIWYG markdown editor with AI collaboration capabilities, packaged as a lightweight desktop application using Tauri v2.

**Current version:** 0.3.0
**Current phase:** Phase 1 complete, Phase 2 (AI Collaboration) complete.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Desktop shell | Tauri | v2 (latest stable) |
| Frontend | React 19+ + TypeScript 5+ | Latest |
| Editor | Tiptap v2 (wraps ProseMirror) | Latest |
| UI Components | shadcn/ui (Radix + Tailwind v4) | Latest |
| State | Zustand with persist | Latest |
| Package manager | pnpm | Latest |

## Design Quality Mandate

**Every component must look polished and production-ready. No "functional but ugly" code.**

### shadcn/ui First — MANDATORY

**NEVER build a custom component if shadcn/ui already has one.** Check shadcn/ui docs before creating anything.

Install as needed:
```bash
pnpm dlx shadcn@latest add button dropdown-menu dialog tabs tooltip input select switch
```

Only build custom for app-specific features (editor, AI decorations).

### Visual Standards

- **Reference apps:** Linear (polish), Bear (warmth), Craft (document feel), Things 3 (sidebar)
- **First impression:** "This looks premium"
- **Typography:** SF Pro for UI, serif/sans-serif for editor content, JetBrains Mono for code
- **Colors:** CSS variables only, no hardcoded hex. Strictly neutral greyscale (no blue/indigo/chromatic accents). No pure black or pure white.
- **Spacing:** Generous whitespace, consistent Tailwind scale
- **Transitions:** Everything interactive must transition (150ms default)
- **Dark mode:** All components must work in both themes

**See @docs/design-system.md for complete requirements.**

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
|------|------|
| Architecture, project structure, data flow | @docs/architecture.md |
| UI/UX requirements, typography, colors, component specs | @docs/design-system.md |
| Current phase scope, requirements, quality gates | @docs/phase-1-spec.md |
| Tauri command signatures, IPC patterns | @docs/tauri-commands.md |
| All keyboard shortcuts | @docs/keyboard-shortcuts.md |
| Future phases (context only, don't build) | @docs/future-phases.md |
| Implementation history | @docs/history/ |
| Product requirements | @docs/prds/ |

## Development Lifecycle

| Command | Purpose |
|---------|---------|
| `/prd <feature>` | Create a Product Requirements Document |
| `/plan-tasks <prd-or-feature>` | Break down into implementation tasks |
| `/impl <task>` | Implementation guidance with relevant context |
| `/verify <prd-or-feature>` | Verify against PRD and quality gates |
| `/release <patch\|minor\|major>` | Version bump, changelog, release prep |
| `/review-code` | Code review against conventions |
| `/review-ui` | Design review against design system |
| `/test` | Run full test suite |
| `/new-component <Name>` | Scaffold a new UI component |

## Quick Start

```bash
pnpm install        # Install dependencies
pnpm tauri dev      # Run dev server
pnpm tauri build    # Build for production
```

## Versioning

The app version is defined in `package.json`. The Tauri config (`src-tauri/tauri.conf.json`) references it via `"version": "../package.json"` — only bump `package.json` when releasing.

`src-tauri/Cargo.toml` maintains its own independent crate version.

## Key Decisions

1. **ProseMirror:** Enables AI decorations, collaborative editing
2. **Tauri commands:** Security boundary for all I/O
3. **Zustand stores:** Persist middleware, clear boundaries
4. **shadcn/ui:** Compose, don't rebuild
5. **CSS variables:** Light/dark themes, future customization

## Quality Gates

Phase 1 must pass ALL of these:

**Functional:**
- [ ] Open folder, display file tree
- [ ] Click file → opens in WYSIWYG editor
- [ ] All markdown syntax renders correctly
- [ ] Round-trip test: parse → serialize → identical markdown
- [ ] Multi-tab editing, unsaved changes indicator
- [ ] Save (Cmd+S), auto-save, create/rename/delete files
- [ ] Light/dark theme with smooth transitions

**Design (equally important):**
- [ ] Looks like Linear/Bear/Craft, not a hackathon project
- [ ] All interactive elements have hover/active/focus states
- [ ] Consistent spacing, colors, typography
- [ ] Works perfectly in both light and dark mode
- [ ] No default browser UI (checkboxes, scrollbars)

**See @docs/phase-1-spec.md for complete quality gates.**

## Phase 2 Status (AI Collaboration)

**Status:** ✅ Complete

Implemented:
- AI provider abstraction (Anthropic, OpenAI, Ollama)
- Settings dialog with provider configuration
- Chat panel (Cmd+Shift+A to toggle)
- Inline AI actions (Improve, Summarize, Expand)
- Provider logos with dark mode support
- Secure API calls through Tauri backend

**See @docs/future-phases.md for Phases 3-5.**

## Anti-Patterns — NEVER

- ❌ Custom components when shadcn/ui has one
- ❌ Hardcoded colors (use CSS variables)
- ❌ Any blue, indigo, or chromatic accent colors — palette is strictly neutral greyscale
- ❌ Pure black/white backgrounds
- ❌ No transitions on interactive elements
- ❌ Inconsistent spacing or border-radius
- ❌ Text wider than 80ch in editor
- ❌ Default browser UI elements
- ❌ "Functional but ugly" code

## Resources

- Tauri v2 docs: https://v2.tauri.app
- Tiptap docs: https://tiptap.dev
- shadcn/ui: https://ui.shadcn.com
- Tailwind v4: https://tailwindcss.com
- ProseMirror: https://prosemirror.net

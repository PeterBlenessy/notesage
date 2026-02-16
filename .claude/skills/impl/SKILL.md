---
name: impl
description: Implementation guidance with relevant context for a task
user-invocable: true
argument-hint: "<task>"
---

# Implementation Guidance

Load relevant context for a specific task and provide scaffolding to accelerate implementation.

## Process

1. **Understand the task** — parse the user's description to identify:
   - What layer: backend (Rust/Tauri), frontend (React/TS), or both
   - What domain: editor, sidebar, settings, AI, file operations, etc.
   - What type: new feature, bug fix, refactor, etc.

2. **Load relevant context** based on the task type:

   | Task involves | Read |
   |---------------|------|
   | Tauri commands / Rust backend | `docs/tauri-commands.md`, `src-tauri/src/commands/` |
   | UI components | `docs/design-system.md`, existing similar components |
   | Editor / Tiptap | Tiptap extension skill, `src/components/editor/` |
   | State management | `docs/architecture.md`, `src/stores/` |
   | Markdown handling | Markdown roundtrip skill, `src/lib/markdown.ts` |
   | Any task | `CLAUDE.md` for conventions |

3. **Find similar existing code** as a reference:
   - Search for analogous patterns already implemented in the codebase
   - Show the user the most relevant example with file path and line numbers

4. **Provide implementation scaffolding:**
   - Key types/interfaces needed
   - File locations (where to create or modify)
   - Function signatures or component structure
   - Import paths

5. **Remind about conventions** relevant to this task:
   - Code conventions from `CLAUDE.md`
   - Design system requirements if UI is involved
   - Anti-patterns to avoid

## Output Format

Structure your response as:

1. **Context** — Brief summary of what you found in the codebase
2. **Reference** — Existing code that follows the same pattern
3. **Scaffolding** — Suggested structure, types, and file locations
4. **Conventions** — Relevant rules and anti-patterns for this task

Keep it actionable — the goal is to get the developer started quickly with confidence, not to write the entire implementation.

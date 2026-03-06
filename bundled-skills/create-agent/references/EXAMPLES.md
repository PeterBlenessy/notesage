# Example Agent Instruction Files

## 1. Minimal — Single Rule

```markdown
Always respond in British English spelling (colour, organise, analyse).
```

## 2. Project-Specific Context

```markdown
# Project: Notesage

This is a Tauri v2 desktop app with React + TypeScript frontend.

## Rules

- Use shadcn/ui components — never build custom UI from scratch.
- All file operations go through Tauri IPC commands, never direct filesystem access.
- State management uses Zustand with persist middleware.
- Test all changes in both light and dark mode.

## Architecture

- `src/components/` — React components
- `src/stores/` — Zustand stores
- `src/hooks/` — React hooks
- `src-tauri/src/commands/` — Rust backend commands
```

## 3. Multi-Purpose with Sections

```markdown
# Agent Instructions

## Communication Style
- Be concise. Lead with the answer, then explain.
- Use bullet points for lists of 3+ items.
- Include code examples when explaining technical concepts.

## Code Preferences
- Prefer functional patterns over imperative.
- Use early returns to reduce nesting.
- Name variables for clarity, not brevity.

## What NOT to Do
- Don't add comments that restate the code.
- Don't refactor code I didn't ask about.
- Don't add error handling for impossible cases.
```

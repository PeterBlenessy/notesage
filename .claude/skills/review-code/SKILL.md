---
name: review-code
description: Run a code review of recently changed files
user-invocable: true
agent: code-reviewer
---

# Code Review

Runs the code-reviewer agent on recently changed files to ensure code quality and convention adherence.

## What It Does

1. Finds all `.ts` and `.tsx` files that have been modified:
   - If git history exists: uses `git diff` to find changed files
   - If no git: reviews all files in `src/`

2. Runs the `code-reviewer` agent on those files

3. Presents findings organized by severity:
   - **Critical**: Will break or severely degrade code
   - **Warning**: Violates conventions, should fix
   - **Suggestion**: Could be better

## What Gets Checked

### TypeScript
- **No `any` types**: Use proper types or `unknown` with narrowing
- **Interfaces preferred**: Over type aliases for objects
- **Complete types**: All parameters and returns properly typed

### React
- **Functional components**: No class components
- **Hooks rules**: Called at top level, complete dependencies
- **One component per file**: Single responsibility

### Naming Conventions
- **PascalCase**: Components (`UserProfile`, `SettingsDialog`)
- **camelCase**: Functions and variables (`getUserData`, `isLoading`)
- **UPPER_SNAKE**: Constants (`MAX_FILE_SIZE`, `API_ENDPOINT`)
- **File names**: Match component names

### Imports
- **Absolute paths**: Use `@/` not `../../`
- **Organized**: Group by external, internal, relative

### shadcn/ui Usage
- **Don't rebuild**: Use shadcn/ui when it exists
- **Compose**: Extend shadcn/ui, don't fork

### Tauri Patterns
- **Result types**: Commands return `Result<T, String>`
- **Typed wrappers**: Frontend uses typed invoke wrappers
- **Error handling**: User-facing errors show toasts

### Store Patterns
- **Clear boundaries**: Each store has single responsibility
- **Persist correctly**: Using Zustand persist middleware
- **No global state**: Use appropriate store

### Editor/ProseMirror
- **No mutation**: Never mutate editor state directly
- **Use transactions**: Always use `editor.chain()` or dispatch

## When to Use

- **Before creating a PR**: Catch issues early
- **After code changes**: Verify conventions followed
- **Learning**: Understand project patterns
- **Refactoring**: Ensure consistency maintained

## Reference

The code-reviewer agent reads:
- @CLAUDE.md — Code conventions
- @docs/architecture.md — Architecture patterns

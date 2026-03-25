---
name: audit-error-ux
description: Audit error handling UX — error boundaries, silent failures, loading states, empty states
user-invocable: true
---

# Audit: Error UX & Resilience

Audit how errors and edge cases surface to the user. This is a research-only audit — do not modify any code.

## What to Search For

### Error Boundaries

Find React error boundaries (`ErrorBoundary` components or `componentDidCatch`):
- Which sections of the app are wrapped in error boundaries? (editor, chat, sidebar)
- What happens when an error boundary catches? (fallback UI, reload button, error message)
- Are there sections that should have boundaries but don't?

### Silent Failures

Find operations that can fail without any user feedback:

- `catch {}` or `.catch(() => {})` — swallowed errors with no toast, log, or UI change
- `try/catch` blocks that only `console.error` — user sees nothing
- Async operations with no error handling at all
- Tauri `invoke` calls without `.catch()` or try/catch

**What to check:** Would the user know something went wrong? If not, flag it.

### Loading States

Find async operations and check if they show loading indicators:

- File tree loading — is there a skeleton or spinner while `list_directory` runs?
- AI chat responses — is there a typing indicator while waiting for the first token?
- Model downloads — is progress shown?
- Settings that require async validation — does the UI indicate "checking..."?

### Empty States

Check views for what they show when data is absent:

- File tree with no folders open — helpful message or blank?
- Chat panel with no messages — onboarding prompt or empty?
- Search results with no matches — "no results" message or blank?
- Settings with no connections configured — guidance or empty list?
- Activity panel with no tasks — message or blank?

### Graceful Degradation

Check what happens under failure conditions:

- AI provider is unreachable — does the chat show an error or hang?
- Ollama is not running — clear message or cryptic error?
- Network is offline — does the app still function for local editing?
- File on disk is deleted while open in editor — handled or crash?
- localStorage is full — does persist middleware handle the error?

### Crash Recovery

- What state is lost on app crash? (undo history, unsaved changes, chat messages)
- Can the app start with corrupt localStorage? (Does Zustand persist handle parse errors?)
- What happens if `index.db` is corrupt or locked?

## Output Format

For each finding:

```markdown
### <SEVERITY>: <Short title>

**File:** `<path>:<line>`

<What the user experiences and why it's bad.>

**Fix:** <How to improve the user experience.>
```

## Example Finding

### MEDIUM: AI provider error shows raw error string

**File:** `src/hooks/useAIOperations.ts:312`

When an AI API call fails, the raw error string from Rust is shown in a toast: "Failed to connect to api.anthropic.com: connection refused". This is confusing for non-technical users.

**Fix:** Map common errors to user-friendly messages:
- Connection refused → "Could not reach [provider]. Check your internet connection."
- 401 → "Invalid API key. Check your settings."
- 429 → "Rate limited. Please wait a moment and try again."

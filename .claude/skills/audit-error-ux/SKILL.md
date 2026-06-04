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
- **Grep for the current boundary inventory:**
  ```bash
  grep -rn "ErrorBoundary" src/ --include="*.tsx" | grep -v "import\|//"
  ```
- For each major surface — editor, chat/command bar, sidebar, agent activity panel, settings — verify it is individually wrapped. An exception in one surface must NOT unmount the others.
- **Minimum required boundaries** (from architecture.md + design-system.md):
  - `<Editor />` (typically already wrapped per `ErrorBoundary.tsx` usage)
  - `<FloatingCommandBar />` — primary AI interaction surface; a malformed ACP response or chat-store corruption crashes the entire app if unprotected
  - `<AgentOrb />` — ambient agent indicator; unprotected crashes during agent task rendering
  - Sidebar surface — if sidebar crashes, the user can no longer navigate files
- Flag any missing boundary for the above surfaces as **High** severity (e.g. a `QuietLayout` that wraps only `<Editor />` but leaves `<FloatingCommandBar />` and `<AgentOrb />` unwrapped — an exception in either unmounts the whole app and loses all unsaved content). Check the file/line where each surface is mounted so a regression is easy to re-verify.
- Check the fallback UI: does it show a "Reload section" button or just a blank space? A blank space is a **Medium** (confusing); a crash message with no recovery action is **High**.

### Silent Failures

Find operations that can fail without any user feedback:

- `catch {}` or `.catch(() => {})` — swallowed errors with no toast, log, or UI change (**High**)
- `try/catch` blocks that only `console.error` or `console.warn` — developer-visible only, user sees nothing (**Medium**)
- Async operations with no error handling at all — especially `invoke()` calls that are not awaited and not chained with `.catch()` (**Medium–High** depending on consequence)
- **Tauri `invoke` calls:** Every call to `invoke(commandName, args)` from `@tauri-apps/api/core` can reject with a `string` error from Rust. The correct pattern for user-visible operations is:
  ```ts
  try {
    await invoke('command_name', args);
  } catch (error) {
    toast.error(`Operation failed: ${error}`);
  }
  ```
  Fire-and-forget `invoke` without any catch is only acceptable for telemetry/logging commands where failure is truly inconsequential. Flag all others.
- The app uses `sonner` (via the `toast` import) as the designated notification surface. A `console.error`-only catch where the user triggered the operation is always a violation.
- **Tauri event-based error paths:** ACP agent responses and Copilot LSP streaming arrive via `listen()` event handlers, not `invoke()` rejections. Errors in these flows can be silently swallowed if the event handler has no error branch.
  1. Find all `listen(` or `appWindow.listen(` call sites in `src/hooks/`:
     ```bash
     grep -rn "listen(" src/hooks/ --include="*.ts" --include="*.tsx"
     ```
  2. For each event handler, check whether the handler function has an error branch or whether errors in the payload (e.g., `event.payload.error`) are surfaced to the user via toast.
  3. Specifically check `useAcpSessionListeners.ts`, `useDirectApiChat.ts`, and `useCopilotChat.ts` — these are the primary streaming consumers.
  4. Flag any handler that silently discards a `payload.error` field or catches exceptions with only `console.error` as **Medium** severity.

**What to check:** Would the user know something went wrong? If not, flag it.

### Error Message Quality

Beyond *whether* an error surfaces, audit *what* it says:

- **Generic messages that discard actual error:** Look for render paths that show a hardcoded string while an actual error string sits unused in state. Common pattern:
  ```tsx
  if (someStore.errorMessage) {
    return <p>Something went wrong.</p>;  // actual error not shown
  }
  ```
  Grep:
  ```bash
  grep -rn "File not found\|Something went wrong\|An error occurred" src/components/ --include="*.tsx"
  ```
  For each hit, check whether the actual error string from state is displayed (even in small `text-xs text-muted-foreground font-mono` text below the friendly message). If the error string is available and not shown at all, flag as **Low** (misleading diagnosis wastes user time). (e.g. an editor that stores the full Tauri error in `loadError` but always renders the hardcoded "File not found" regardless of the actual cause.)
- The correct pattern shows the friendly message + the raw error in subdued mono text:
  ```tsx
  <p>Could not open file</p>
  <p className="text-xs text-muted-foreground font-mono mt-1">{activeTab.loadError}</p>
  ```

### Loading States

Find async operations and check if they show loading indicators:

- File tree loading — is there a skeleton or spinner while `list_directory` runs?
- AI chat responses — is there a typing indicator while waiting for the first token?
- Model downloads — is progress shown?
- Settings that require async validation — does the UI indicate "checking..."?
- **Loading indicators must be announced:** A spinner or skeleton loader (`Loader2 animate-spin`) that has no `aria-live` region or `aria-label` is invisible to screen readers. When a load state starts, an `aria-live="polite"` region should announce "Loading..." and when complete should announce the result or clear. At minimum, the button or container that entered the loading state should expose `aria-busy="true"` while loading.

  Grep for unannounced loading:
  ```bash
  grep -rn "Loader2\|animate-spin\|isLoading\|loading" src/components/ --include="*.tsx" | grep -v "aria-label\|aria-live\|aria-busy"
  ```

  Flag any loading state on a user-triggered action (button click, form submit) that has no accessible loading announcement as **Low** severity.

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
- **App startup with corrupt persisted state:**
  - `localStorage` / Zustand persist: grep for `JSON.parse` calls in store hydration without try/catch. Zustand's built-in `onRehydrateStorage` error handler should be present in each persisted store.
  - SQLite `index.db`: check `src-tauri/src/index/db.rs` for error handling on `Connection::open`. A corrupt or locked `index.db` must log a warning and fall back to empty-index mode, not panic. Grep:
    ```bash
    grep -n "Connection::open\|rusqlite::Connection" src-tauri/src/index/db.rs
    ```
  - Flag any startup path that panics on storage-layer failure as **High** — it prevents the app from loading at all.

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

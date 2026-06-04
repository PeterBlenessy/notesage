# Skill Improvement Proposal: audit-error-ux

**Motivated by:** `audit-reports/07-a11y-error-ux.md` (2026-06-03)

---

## 1. Stale/Incorrect Guidance to Fix

### 1a. Error Boundaries section — does not name the primary AI surfaces as mandatory boundary sites

**Current text (lines 15-20 of SKILL.md):**
```
Find React error boundaries (`ErrorBoundary` components or `componentDidCatch`):
- Which sections of the app are wrapped in error boundaries? (editor, chat, sidebar)
- What happens when an error boundary catches? (fallback UI, reload button, error message)
- Are there sections that should have boundaries but don't?
```

**Problem:** The parenthetical "(editor, chat, sidebar)" implies these are already known to be wrapped. The audit found that `FloatingCommandBar` and `AgentOrb` — the two primary AI-interaction surfaces in the Quiet Composer shell — have **no** `ErrorBoundary` despite `Editor` being wrapped (finding H5, `QuietLayout.tsx:412-450`). The current guidance gives auditors no grep strategy and does not name the specific risk: an unhandled exception in the chat bar causes full application unmount and loss of all unsaved editor content.

**Replacement:**
```
Find React error boundaries (`ErrorBoundary` components or `componentDidCatch`):
- **Grep for the current boundary inventory:**
  ```bash
  grep -rn "ErrorBoundary" src/ --include="*.tsx" | grep -v "import\|//"
  ```
- For each major surface — editor, chat/command bar, sidebar, agent activity panel, settings — verify it is individually wrapped. An exception in one surface must NOT unmount the others.
- **Minimum required boundaries** (from architecture.md + design-system.md):
  - `<Editor />` (already wrapped per `ErrorBoundary.tsx` usage)
  - `<FloatingCommandBar />` — primary AI interaction surface; a malformed ACP response or chat-store corruption crashes the entire app if unprotected
  - `<AgentOrb />` — ambient agent indicator; unprotected crashes during agent task rendering
  - Sidebar surface — if sidebar crashes, the user can no longer navigate files
- Flag any missing boundary for the above surfaces as **High** severity.
- Check the fallback UI: does it show a "Reload section" button or just a blank space? A blank space is a **Medium** (confusing); a crash message with no recovery action is **High**.
```

---

### 1b. Silent Failures section — Tauri `invoke` pattern not mentioned

**Current text (lines 26-31 of SKILL.md):**
```
Find operations that can fail without any user feedback:

- `catch {}` or `.catch(() => {})` — swallowed errors with no toast, log, or UI change
- `try/catch` blocks that only `console.error` — user sees nothing
- Async operations with no error handling at all
- Tauri `invoke` calls without `.catch()` or try/catch
```

**Problem:** The last bullet mentions Tauri `invoke` but gives no guidance on the contract: every Tauri command returns `Result<T, String>` in Rust, meaning the rejection payload is always a plain string. The skill does not tell auditors what "correct handling" looks like — specifically that user-visible errors must surface as sonner toasts (the app's designated notification system), not `console.error`.

Additionally, the current skill does not distinguish between "truly silent" failures (user has no idea) and "logged-only" failures (developer can see, user cannot). Only the former is a user-experience defect; the latter should still be flagged but at lower severity.

**Replacement:**
```
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
```

---

### 1c. Crash Recovery section — `index.db` corruption only mentioned as a question, not a check

**Current text (lines 62-65 of SKILL.md):**
```
- What state is lost on app crash? (undo history, unsaved changes, chat messages)
- Can the app start with corrupt localStorage? (Does Zustand persist handle parse errors?)
- What happens if `index.db` is corrupt or locked?
```

**Problem:** These are posed as open questions with no grep strategy or severity guidance, meaning an auditor reads them, shrugs, and moves on. The architecture doc (`docs/architecture.md`) states that `index.db` is the source of truth for tags, mentions, tasks, and FTS search — corruption or lock contention on startup is a defined failure mode that should have explicit handling at the index-init layer.

**Replacement:**
```
- **App startup with corrupt persisted state:**
  - `localStorage` / Zustand persist: grep for `JSON.parse` calls in store hydration without try/catch. Zustand's built-in `onRehydrateStorage` error handler should be present in each persisted store.
  - SQLite `index.db`: check `src-tauri/src/index/db.rs` for error handling on `Connection::open`. A corrupt or locked `index.db` must log a warning and fall back to empty-index mode, not panic. Grep:
    ```bash
    grep -n "Connection::open\|rusqlite::Connection" src-tauri/src/index/db.rs
    ```
  - Flag any startup path that panics on storage-layer failure as **High** — it prevents the app from loading at all.
```

---

## 2. New Checks to Add

### 2a. NEW CHECK: Error messages that discard the actual error — generic "File not found"

**Motivation:** Finding L5 (`Editor.tsx:162-164, 571-582`). The editor stores an error string that includes the Rust/OS error detail (e.g., "Permission denied", "I/O error") but the render path always shows the hardcoded string "File not found" regardless of the actual cause. This is a silent failure variant: the error does surface, but the information content is destroyed.

**Add under "Silent Failures" or as a new "Error Message Quality" subsection:**

```markdown
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
  For each hit, check whether the actual error string from state is displayed (even in small `text-xs text-muted-foreground font-mono` text below the friendly message). If the error string is available and not shown at all, flag as **Low** (misleading diagnosis wastes user time).

- **`Editor.tsx` specific:** `src/components/editor/Editor.tsx` stores the full Tauri error in `loadError` but the render at ~line 571 always shows "File not found" regardless. Confirmed finding from 2026-06-03 audit.

- The correct pattern shows the friendly message + the raw error in subdued mono text:
  ```tsx
  <p>Could not open file</p>
  <p className="text-xs text-muted-foreground font-mono mt-1">{activeTab.loadError}</p>
  ```
```

---

### 2b. NEW CHECK: `FloatingCommandBar` and `AgentOrb` missing `ErrorBoundary` — full-app crash risk

**Motivation:** Finding H5 (`QuietLayout.tsx:412-450`). These two components are the primary AI interaction surfaces. An unhandled exception in either causes full React tree unmount. The current skill's error boundaries section does not name these components or describe the consequence of their absence.

**This is already incorporated into the fix for item 1a above** (rewrite of the Error Boundaries section). The finding-specific detail to preserve:

```markdown
**Confirmed gap (2026-06-03 audit):** `src/components/QuietLayout.tsx:412-450` — only `<Editor />` is wrapped; `<FloatingCommandBar />` (line ~443) and `<AgentOrb />` (line ~449) are unwrapped. An exception in either component unmounts the entire application and all unsaved content is lost.
```

This should appear as a concrete example inside the Error Boundaries check, so future auditors know the file and line to check for regression.

---

### 2c. NEW CHECK: `animate-pulse` on `Loader2` without `aria-live` — loading state inaccessible to AT

**Motivation:** Finding M4 (`ModelSelectionForm.tsx:369`) and related. The skill already covers "loading states" but only asks "is there a spinner?" — it does not ask whether screen readers are informed of the loading state. `Loader2 animate-spin` is purely visual; a screen reader user gets no feedback that the app is fetching data.

**Add under "Loading States":**

```markdown
- **Loading indicators must be announced:** A spinner or skeleton loader that has no `aria-live` region or `aria-label` is invisible to screen readers. When a load state starts, an `aria-live="polite"` region should announce "Loading..." and when complete should announce the result or clear. At minimum, the button or container that entered the loading state should expose `aria-busy="true"` while loading.
  
  Grep for unannounced loading:
  ```bash
  grep -rn "Loader2\|animate-spin\|isLoading\|loading" src/components/ --include="*.tsx" | grep -v "aria-label\|aria-live\|aria-busy"
  ```
  
  Flag any loading state on a user-triggered action (button click, form submit) that has no accessible loading announcement as **Low** severity.
```

---

### 2d. NEW CHECK: ACP and streaming error paths — errors that arrive as Tauri events, not `invoke` rejections

**Motivation:** The existing silent-failures section only covers `invoke()` call sites. The audit report's scope (and the architecture doc) make clear that ACP agents communicate via Tauri *events* (`acp-session-update`, `acp-agent-exited`, `copilot-chat-done`), not `invoke` return values. Errors in these paths cannot be caught by a try/catch around `invoke`. This is a blind spot in the current skill.

**Add under "Silent Failures":**

```markdown
- **Tauri event-based error paths:** ACP agent responses and Copilot LSP streaming arrive via `listen()` event handlers, not `invoke()` rejections. Errors in these flows can be silently swallowed if the event handler has no error branch.
  
  What to check:
  1. Find all `listen(` or `appWindow.listen(` call sites in `src/hooks/`:
     ```bash
     grep -rn "listen(" src/hooks/ --include="*.ts" --include="*.tsx"
     ```
  2. For each event handler, check whether the handler function has an error branch or whether errors in the payload (e.g., `event.payload.error`) are surfaced to the user via toast.
  3. Specifically check `useAcpSessionListeners.ts`, `useDirectApiChat.ts`, and `useCopilotChat.ts` — these are the primary streaming consumers.
  4. Flag any handler that silently discards a `payload.error` field or catches exceptions with only `console.error` as **Medium** severity.
```

---

## 3. Preserved Frontmatter + Structure

The SKILL.md frontmatter (`name`, `description`, `user-invocable`) is unchanged. All existing sections — Error Boundaries, Silent Failures, Loading States, Empty States, Graceful Degradation, Crash Recovery, Output Format, Example Finding — are preserved. The changes above are surgical rewrites of specific bullets and addition of new targeted checks within existing sections.

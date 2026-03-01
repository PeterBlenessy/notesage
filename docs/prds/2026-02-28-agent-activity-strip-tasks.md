# Agent Activity Strip & Progress Streaming — Implementation Tasks

**PRD:** `docs/prds/2026-02-28-agent-activity-strip.md`**Total: 9 tasks — 2S, 4M, 3LNo backend changes — purely frontend.Suggested order:** Store → Hook plumbing → Streaming UI → Activity strip UI → Layout → Shortcut → Polish

---

## #1 — Create activity-store

|  |  |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | none |
| **Files** | `src/stores/activity-store.ts` |

Create Zustand store (non-persisted) as the central registry for all background agent tasks.

**Implement:**

- `AgentTask` interface: `id`, `type` (`'comment' | 'chat' | 'workflow'`), `label`, `status` (`'running' | 'done' | 'error' | 'cancelled'`), `sourceFile?`, `commentId?`, `documentId?`, `startedAt`, `completedAt?`, `activities: DelegationActivity[]`, `partialOutput?`, `finalOutput?`
- Store state: `tasks: AgentTask[]`, `isStripVisible: boolean`, `isManuallyHidden: boolean`
- Actions: `addTask` (auto-sets `isStripVisible = true`, `isManuallyHidden = false`), `updateTaskStatus`, `appendActivity`, `completeLastActivity`, `completeAllActivities`, `appendPartialOutput`, `setFinalOutput`, `setStripVisible`, `setManuallyHidden`, `clearCompleted`
- Reuse `DelegationActivity` type from `comment-store.ts`

**Acceptance:**

- [ ] Store creates/updates/removes tasks correctly

- [ ] `addTask` auto-shows the strip

- [ ] `clearCompleted` only removes non-running tasks

---

## #2 — Add onChunk callback and activity-store integration to useAgentTaskOperations

|  |  |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #1 |
| **Files** | `src/hooks/useAgentTaskOperations.ts` |

Extend `startTask()` to support streaming chunks and register tasks in the activity store.

**Implement:**

- Refactor `startTask()` signature from 4 positional callbacks to a single `callbacks` object + a `taskMeta` object:

  ```typescript
  startTask(prompt: string, callbacks?: {
    onComplete?: (output: string) => void;
    onActivity?: (activity: ActivityEvent) => void;
    onError?: (error: string) => void;
    onChunk?: (chunk: string) => void;  // NEW
  }, taskMeta?: {
    type: 'comment' | 'chat' | 'workflow';
    label: string;
    sourceFile?: string;
    commentId?: string;
    documentId?: string;
  }): Promise<string>
  ```

- On `agent_message_chunk`: fire `onChunk(text)` + call `activityStore.appendPartialOutput(taskId, text)`

- On `startTask()`: call `activityStore.addTask()` with metadata

- On `tool_call`: call `activityStore.appendActivity()`

- On `tool_result`: call `activityStore.completeLastActivity()`

- On `agent_turn_complete` / invoke resolve: call `activityStore.updateTaskStatus('done')` + `setFinalOutput()`

- On error: `activityStore.updateTaskStatus('error')`

- On `cancelTask()`: `activityStore.updateTaskStatus('cancelled')` + `completeAllActivities()`

**Acceptance:**

- [ ] `onChunk` fires for each text chunk during streaming

- [ ] Activity store stays in sync with task lifecycle (running → done/error/cancelled)

- [ ] Existing callers (`useCommentDelegation`) still compile after signature change

---

## #3 — Update useCommentDelegation for new startTask API and add streaming partial reply

|  |  |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #2 |
| **Files** | `src/hooks/useCommentDelegation.ts`, `src/stores/comment-store.ts` |

Wire streaming chunks into the comment store and update delegation hook for the new `startTask` API.

**comment-store changes:**

- Add module-level `partialReplies: Record<string, string>` (keyed `documentId:commentId`, NOT in Zustand state — avoids re-rendering entire tree on each chunk)
- New exported functions: `appendPartialReply(docId, commentId, chunk)`, `getPartialReply(docId, commentId)`, `clearPartialReply(docId, commentId)`
- Add a Zustand state counter `partialReplyVersion: number` that increments on each append (allows selective subscription by the popover)

**useCommentDelegation changes:**

- Migrate from positional args to callbacks object for `startTask()`
- Pass `taskMeta`: `{ type: 'comment', label: comment.body.slice(0, 50), sourceFile, commentId, documentId }`
- Add `onChunk` callback: calls `appendPartialReply(documentId, comment.id, chunk)`
- On `onComplete`: call `clearPartialReply()` before adding finalized reply
- On `onError` / cancel: call `clearPartialReply()`

**Acceptance:**

- [ ] Partial reply accumulates chunk-by-chunk

- [ ] Cleared on completion, error, or cancellation

- [ ] NOT persisted to JSON sidecar

- [ ] `partialReplyVersion` increments allow efficient UI subscription

---

## #4 — Render streaming reply in CommentPopover

|  |  |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #3 |
| **Files** | `src/components/editor/CommentPopover.tsx`, `src/styles/editor.css` |

Show the agent's partial response as it streams in the comment popover.

**Implement:**

- Subscribe to `partialReplyVersion` from comment-store; read partial reply via `getPartialReply()`
- When `comment.status === 'delegated'` and partial reply is non-empty, render a streaming reply block **inside the scrollable content area** (between comment body and activity footer):
  - Author line: `BotMessageSquare` icon + "AI Agent" + "streaming..." label (muted)
  - Reply text: `text-sm text-muted-foreground` with blinking block cursor (`▊`) appended
  - Border-top separator matching finalized reply style
- Auto-scroll: `useEffect` + `scrollIntoView({ behavior: 'smooth' })` on ref at bottom of reply text when `partialReplyVersion` changes
- On completion (partial cleared, finalized reply appears): no flash — the reply section naturally re-renders with the finalized content

**CSS additions in** `editor.css`**:**

- `@keyframes blink-cursor` — 50% opacity toggle, 530ms period
- `.streaming-cursor` class applying the animation

**Acceptance:**

- [ ] Text appears incrementally during delegation

- [ ] Blinking cursor animates at end of streaming text

- [ ] Auto-scrolls to follow new text

- [ ] Smooth transition when reply finalizes

---

## #5 — Build ActivityStrip and ActivityTaskCard components

|  |  |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | #1 |
| **Files** | `src/components/activity/ActivityStrip.tsx`, `src/components/activity/ActivityTaskCard.tsx` |

Build the activity strip sidebar panel and individual task cards.

**ActivityStrip.tsx:**

- Header: "Agent Tasks" title + `X` close button (calls `setManuallyHidden(true)`)
- `ScrollArea` containing task cards from `activityStore.tasks`, newest first (reverse order)
- Footer: "Clear completed" button, only visible when `tasks.some(t => t.status !== 'running')`
- No empty state needed (strip hidden when no tasks)

**ActivityTaskCard.tsx:**

- Type icon: `MessageSquare` (comment), `MessageCircle` (chat)
- Label: truncated \~50 chars, `text-sm font-medium`
- Source file basename, `text-xs text-muted-foreground`
- Live elapsed time: `useEffect` with 1s interval, formatted as `12s`, `1m 23s`, `5m 0s`
- Status icon: `Loader2` spinning (running), `Check` (done), `X` (error), `Slash` (cancelled)
- Stop button for running tasks (calls `cancelTask()` via prop)
- Expandable activity log: reuse the icon/label/detail pattern from CommentPopover lines 388-410
- Click handler prop for navigation (comment tasks only, non-running)
- Compact design: \~3-4 lines per card collapsed, separator between cards

**Styling:**

- \~280px width, neutral palette
- Smooth hover transitions (150ms)
- Light/dark mode via CSS variables

**Acceptance:**

- [ ] Tasks render with correct icons and status

- [ ] Elapsed time updates every second

- [ ] Activity log expands/collapses

- [ ] Cancel button works

- [ ] Looks polished in both themes

---

## #6 — Implement click-to-navigate from ActivityTaskCard

|  |  |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | #5 |
| **Files** | `src/components/activity/ActivityTaskCard.tsx` |

Navigate to the source comment/file when clicking a completed task in the strip.

**Implement:**

- For comment tasks with `sourceFile`: use `useFileOperations.openFile()` to open/activate the tab
- After file opens: set `activeCommentId` in comment-store to trigger the comment popover
- If `sourceFile` is already the active tab, just set `activeCommentId`
- If comment no longer exists: show toast "Comment not found"
- Non-comment tasks: navigate to `sourceFile` only (no comment scroll)
- Click only enabled for done/error/cancelled tasks (not running)

**Acceptance:**

- [ ] Clicking a completed comment task opens the file and highlights the comment

- [ ] Works for files not currently open

- [ ] Graceful toast when comment is missing

---

## #7 — Integrate ActivityStrip into App layout with auto-show/hide

|  |  |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | #5, #6 |
| **Files** | `src/App.tsx`, `src/styles/globals.css` |

Add the activity strip to the app layout and implement auto-show/hide behavior.

**Layout integration:**

- Render `ActivityStrip` as a fixed-width panel between the editor `ResizablePanel` and the chat panel
- Conditionally render based on `isStripVisible && !isManuallyHidden`
- NOT a `ResizablePanel` — fixed 280px, no drag handle (keeps it simple)
- Hidden in focus mode (same as sidebar/chat)
- Separator line on left edge (1px border)

**Auto-show/hide logic (in App.tsx** `useEffect`**):**

- Subscribe to `activityStore.tasks`
- When all tasks become non-running (`!tasks.some(t => t.status === 'running')`), start 5s timeout
- On timeout: `setStripVisible(false)`
- If a new running task appears during timeout: cancel timeout
- `addTask` already auto-shows (handled in store)
- `isManuallyHidden` reset by `addTask` (handled in store)

**Slide animation:**

- CSS transition on the strip container: `transition: width 200ms ease, opacity 150ms ease`
- When hidden: `width: 0, opacity: 0, overflow: hidden`
- When visible: `width: 280px, opacity: 1`
- Use `will-change: width` for smooth GPU compositing

**Acceptance:**

- [ ] Strip slides in when first task starts

- [ ] Strip slides out 5s after all tasks finish

- [ ] Manual close persists until next new task

- [ ] No layout shift — editor content doesn't reflow

- [ ] Works with chat panel both open and closed

- [ ] Hidden in focus mode

---

## #8 — Add Cmd+Shift+T keyboard shortcut

|  |  |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | #7 |
| **Files** | `src/hooks/useKeyboardShortcuts.ts`, `src/App.tsx`, `docs/keyboard-shortcuts.md` |

Add keyboard shortcut to toggle the activity strip.

**Implement:**

- In `useKeyboardShortcuts`: add handler for `Cmd+Shift+T` (before the existing `Cmd+T` theme toggle check at line 106)
  - If showing: clear `isManuallyHidden`, set `isStripVisible(true)`
  - If hiding: set `isManuallyHidden(true)`
- Add `onToggleActivityStrip` to `KeyboardShortcutCallbacks`
- Wire in `App.tsx`
- Update `docs/keyboard-shortcuts.md` with new shortcut entry

**Acceptance:**

- [ ] Cmd+Shift+T toggles the strip

- [ ] Doesn't conflict with Cmd+T (theme toggle)

- [ ] Documented in keyboard shortcuts reference

---

## #9 — Visual polish and edge case testing

|  |  |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | #4, #7, #8 |
| **Files** | Various |

Final polish pass to meet all design quality gates.

**Verify:**

- [ ] Light and dark mode for all new components (strip, task cards, streaming cursor)

- [ ] Smooth transitions: strip slide-in/out, streaming cursor blink, task status changes

- [ ] Multiple sequential delegations (delegate-all with 3-5 comments) — strip populates correctly

- [ ] Cancel during streaming — partial reply clears, status reverts

- [ ] Error during delegation — strip shows error status, popover shows error

- [ ] Elapsed time formatting edge cases (0s, 59s → 1m 0s, 9m 59s → 10m 0s)

- [ ] Strip doesn't interfere with: find bar, bubble menu, slash commands, focus mode

- [ ] Auto-hide timer resets correctly when "delegate all" runs sequential tasks

- [ ] Clean up partial reply entries when comment is deleted or document is closed

- [ ] Run `/review-ui` for design system compliance

- [ ] All 16 functional quality gates from the PRD pass

- [ ] All 8 design quality gates from the PRD pass

- [ ] No regressions in existing comment delegation flow

---

## Dependency Graph

```
#1 activity-store ──┬──→ #2 useAgentTaskOperations ──→ #3 comment-store + delegation ──→ #4 streaming popover ─┐
                    │                                                                                         │
                    └──→ #5 ActivityStrip UI ──→ #6 click-to-navigate ──→ #7 App layout ──→ #8 shortcut ──→ #9 polish
```

Tasks #2→#3→#4 (streaming plumbing) and #5→#6 (strip UI) can run in parallel after #1.

## Risks & Open Questions

1. `Cmd+Shift+T` **is safe** — confirmed no conflict. `Cmd+T` (theme) is the only `T` shortcut, and the shift check comes first in the handler.
2. **Layout approach** — inserting a fixed-width div between ResizablePanels (not itself resizable) avoids complexity. The editor panel flexes to fill remaining space.
3. **Partial reply memory** — module-level `partialReplies` map needs cleanup. Clear entries when comments are deleted (`deleteComment`) and when documents are closed (`clearDocument`).
4. **Sequential delegation timing** — "delegate all" runs comments one-by-one. The 5s auto-hide timer must wait for the *last* task to complete, not restart after each one. The `tasks.some(t => t.status === 'running')` check handles this naturally.
5. `startTask` **API change** — switching from positional args to a callbacks object is a breaking change for `useCommentDelegation`. This is the only caller, so the blast radius is contained. Task #3 updates it in the same PR.
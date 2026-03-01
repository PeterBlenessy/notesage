# PRD: Agent Activity Strip & Progress Streaming

**Date:** 2026-02-28 **Status:** Draft **Depends on:** Agent comment delegation Part 1 (v0.14.1)

## Problem

When a user delegates comments to AI agents, the only visibility into agent progress is inside the individual comment popover. If the user closes the popover or navigates to a different file, they lose sight of active delegations. There's no app-level view of "what's the agent doing right now?" — and the agent's reply only appears after the entire task completes, leaving users staring at a spinner with no sense of progress.

This creates two gaps:

1. **No global visibility** — users can't see all active agent work at a glance
2. **No progress feedback** — agent responses appear all-at-once instead of streaming, making delegations feel slower than they are

## Goals

1. **Global activity visibility** — an agent activity strip (40px rail) always visible when tasks exist, plus an expandable agent activity panel (resizable sidebar) showing all active agent tasks with real-time status
2. **Live response streaming** — agent replies stream word-by-word into the comment popover as they generate, matching the chat panel's streaming behavior
3. **Cross-file awareness** — users can see delegations from other files and navigate to them
4. **Future-proof architecture** — the activity strip and panel support any background agent task, not just comment delegations

## Non-Goals

- Parallel comment delegation (still sequential via singleton agent — separate future work)
- Agent auto-apply (Part 3 — agent directly modifying document content)
- Drag-and-drop reordering of tasks in the strip

## User Stories

1. **As a user**, I want to see all active agent tasks in a narrow activity strip, so I can monitor progress at a glance without opening each comment individually.
2. **As a user**, I want to expand the activity strip into a full agent activity panel to see detailed task output and activity logs.
3. **As a user**, I want to watch the agent's reply stream in real-time inside the comment popover, so I know the agent is making progress and can read partial results early.
4. **As a user**, I want to click on a task in the activity panel to navigate to the relevant comment/file, so I can quickly review completed work.
5. **As a user**, I want to cancel an active task from the activity panel, so I can stop work without hunting for the comment popover.
6. **As a user**, I want the activity strip to appear automatically when agent work starts, and if I manually open the panel, it should stay open until I close it.

## Technical Approach

### Agent Activity Strip & Panel (Right Sidebar)

Two components on the right edge of the app, separate from the chat panel:

- **Agent activity strip** (`ActivityRail`): narrow 40px rail always visible when agent tasks exist, showing per-task status icons with tooltips
- **Agent activity panel** (`ActivityPanel`): resizable sidebar (default ~25%, min 240px, max 500px) with full task details, toggled via title bar button or Cmd+Shift+A

**Visibility behavior:**

- The strip appears automatically when the first task starts
- If the user manually opens the panel, it stays open until they explicitly close it
- If the panel is hidden, activity is shown in the narrow strip and the user can expand the panel at will
- The strip is always visible as long as there are tasks (no auto-hide)
- Manual toggle via keyboard shortcut (Cmd+Shift+A) or title bar button

**Task entries show:**

- Task type icon (comment bubble for delegations, message icon for chat tasks)
- Brief label (e.g., "Fix typo in paragraph 3" — derived from comment body, truncated)
- Source file name
- Status: spinner (active), check (done), X (error), slash (cancelled)
- Elapsed time for active tasks
- Expandable activity log (same data as comment popover activity log)
- Cancel button for active tasks
- Click to navigate: opens the file and scrolls to the comment

**Architecture:**

- New `activity-store` (Zustand, non-persisted) — central registry of all background agent tasks
- Tasks registered by `useAgentTaskOperations` when `startTask()` is called
- Activity events forwarded to both the task-specific callback AND the activity store
- Store shape:

```typescript
interface AgentTask {
  id: string;                    // unique task ID
  type: 'comment' | 'chat' | 'workflow';
  label: string;                 // human-readable description
  status: 'running' | 'done' | 'error' | 'cancelled';
  sourceFile?: string;           // file path for navigation
  commentId?: string;            // for comment delegations
  documentId?: string;           // document UUID for comment lookup
  startedAt: number;             // timestamp
  completedAt?: number;          // timestamp
  activities: DelegationActivity[];  // reuse existing type
  partialOutput?: string;        // streaming partial response
  finalOutput?: string;          // completed response
}

interface ActivityStore {
  tasks: AgentTask[];
  isStripVisible: boolean;

  addTask(task: AgentTask): void;
  updateTask(id: string, updates: Partial<AgentTask>): void;
  removeTask(id: string): void;
  appendActivity(id: string, activity: DelegationActivity): void;
  appendPartialOutput(id: string, chunk: string): void;
  setStripVisible(visible: boolean): void;
}
```

### Progress Streaming

Currently, `useAgentTaskOperations.startTask()` accumulates `agent_message_chunk` events into a local `output` variable and only fires `onComplete(output)` when the agent finishes. For streaming:

1. Add a new `onChunk?: (chunk: string) => void` callback to `startTask()`
2. Fire `onChunk` on each `agent_message_chunk` event (in addition to accumulating)
3. In `useCommentDelegation`, the `onChunk` callback:
   - Updates `comment-store` with a new `partialReply` field on the comment
   - The comment popover renders `partialReply` as streaming text (with typing cursor animation)
4. On `onComplete`, the `partialReply` is cleared and the finalized `CommentReply` is added as before

**Comment store changes:**

```typescript
interface Comment {
  // ... existing fields
  partialReply?: string;  // NEW: streaming partial response text
}

// New action
setPartialReply(documentId: string, commentId: string, text: string): void;
clearPartialReply(documentId: string, commentId: string): void;
```

**Comment popover changes:**

- When `comment.partialReply` is non-empty and `comment.status === 'delegated'`, render the partial reply text in the reply area with a blinking cursor
- Style matches finalized replies but with slightly muted text and a cursor animation
- Auto-scroll the reply area as new text streams in
- On completion, smooth transition from partial to finalized reply (no flash)

### Integration Points

`useAgentTaskOperations` **changes:**

- On `startTask()`: register task in `activity-store`
- On each `agent_message_chunk`: call `onChunk` callback + update `activity-store.partialOutput`
- On each `tool_call`/`tool_result`: update `activity-store.activities`
- On `agent_turn_complete`: update `activity-store` task status to `done`
- On error: update `activity-store` task status to `error`
- On cancel: update `activity-store` task status to `cancelled`

`useCommentDelegation` **changes:**

- Pass `onChunk` callback to `startTask()` that updates `comment-store.partialReply`
- On `onComplete`: clear `partialReply`, add finalized reply (existing behavior)
- Register task metadata (type, label, sourceFile, commentId) for the activity strip/panel

**Activity strip & panel visibility:**

- Strip (40px rail) always visible when tasks exist — no auto-hide
- Panel manually toggled via Cmd+Shift+A or title bar button
- If user manually opens the panel, it stays open until they explicitly close it
- `addTask` auto-shows the strip (but does NOT force-open the panel)
- `isManuallyHidden` only applies to the panel, not the strip

## UI/UX

### Agent Activity Strip (40px Rail)

```
┌──┐
│ ◉│  (running — spinner)
│ ✓│  (done — check)
│ ✗│  (error — X)
│ ⊘│  (cancelled — slash)
└──┘
```

- Always visible when tasks exist
- Per-task status icons with tooltips showing task label
- Scrollable when many tasks

### Agent Activity Panel (Resizable Sidebar)

```
┌──────────────────────────────────────────┐
│  Agent Tasks                             │
│─────────────────────────────────────────│
│  ◉ Fix typo in paragraph 3    12s  [×] │
│    notes.md                             │
│    ▸ 3 steps                            │
│                                  [Stop] │
│─────────────────────────────────────────│
│  ✓ Clarify intro section      34s  [×] │
│    chapter-1.md                         │
│    ▸ 5 steps completed                  │
│─────────────────────────────────────────│
│  ✗ Review conclusion         1m2s  [×] │
│    chapter-3.md                         │
│    Error: Agent disconnected            │
└──────────────────────────────────────────┘
```

- Header with "Agent Tasks" title
- Each task card: icon, label (truncated), elapsed time, file name, expandable activity log, action button, remove (X) button
- Active tasks: spinner icon, "Stop" button
- Completed tasks: check icon, click-to-navigate to source comment
- Error tasks: X icon, error message shown
- Individual task removal via X button on each card

### Streaming Reply in Comment Popover

```
┌─────────────────────────────────────┐
│  "Fix the typo here"                │
│─────────────────────────────────────│
│  ⟳ AI Agent · streaming...         │
│  I've identified the typo in this   │
│  paragraph. The word "teh" should   │
│  be changed to "the". Additionally, │
│  I notice▊                          │
│─────────────────────────────────────│
│  ▸ 2 steps · AI is working...      │
│                              [Stop] │
└─────────────────────────────────────┘
```

- Streaming reply shows with author ("AI Agent") and "streaming..." label
- Text appears word-by-word with a blinking block cursor at the end
- Reply area auto-scrolls to follow new text
- Activity log remains at the bottom as before
- On completion: "streaming..." label changes to relative timestamp, cursor disappears

### States

| State | Activity Strip | Comment Popover |
| --- | --- | --- |
| Idle (no tasks) | Hidden | Normal comment view |
| Task running | Visible, spinner on task | Spinner + streaming partial reply |
| Task done | Visible, check on task | Full reply with timestamp |
| Task error | Visible, X on task | Error message, status reverted to open |
| Task cancelled | Visible, slash on task | No reply, status reverted to open |
| All tasks complete | Strip remains visible; panel stays in user's chosen state | Normal comment view with replies |

## Data Model

### New Store: `activity-store.ts`

```typescript
// Zustand store, NON-PERSISTED (runtime only)
interface ActivityStore {
  tasks: AgentTask[];
  isStripVisible: boolean;
  isManuallyHidden: boolean;  // user explicitly closed the strip

  addTask(task: Omit<AgentTask, 'activities' | 'startedAt'>): void;
  updateTaskStatus(id: string, status: AgentTask['status']): void;
  appendActivity(id: string, activity: DelegationActivity): void;
  completeLastActivity(id: string): void;
  completeAllActivities(id: string): void;
  appendPartialOutput(id: string, chunk: string): void;
  setFinalOutput(id: string, output: string): void;
  setStripVisible(visible: boolean): void;
  setManuallyHidden(hidden: boolean): void;
}
```

### Comment Store Extensions

```typescript
interface Comment {
  // ... existing fields
  partialReply?: string;  // streaming partial response (non-persisted)
}

// New actions
setPartialReply(documentId: string, commentId: string, text: string): void;
clearPartialReply(documentId: string, commentId: string): void;
appendPartialReply(documentId: string, commentId: string, chunk: string): void;
```

Note: `partialReply` should be excluded from JSON serialization (runtime-only, like `activitiesByComment`).

### `useAgentTaskOperations` API Change

```typescript
interface TaskCallbacks {
  onComplete?: (output: string) => void;
  onActivity?: (activity: ActivityEvent) => void;
  onError?: (error: string) => void;
  onChunk?: (chunk: string) => void;  // NEW
}

function startTask(
  prompt: string,
  callbacks?: TaskCallbacks
): Promise<string>;
```

### New Tauri Commands

None required — all streaming data already flows through existing `acp-session-update` events. The changes are purely frontend.

## Dependencies

No new libraries. Uses existing:

- Zustand (new store)
- lucide-react (icons for task types and statuses)
- shadcn/ui ScrollArea, Collapsible, Button
- Existing ACP event infrastructure

## Quality Gates

### Functional

- [x] Agent activity strip (40px rail) appears automatically when a comment is delegated

- [x] Activity strip shows correct status icons (running/done/error/cancelled) for each task

- [x] Clicking a task in the agent activity panel navigates to the comment in the correct file and scrolls into view

- [x] Cancel button in panel stops the active delegation

- [x] Agent activity strip stays visible as long as tasks exist (no auto-hide)

- [x] If user manually opens the panel, it stays open until explicitly closed

- [x] Cmd+Shift+A toggles agent activity panel visibility

- [x] Agent reply streams word-by-word in the comment popover

- [x] Streaming reply auto-scrolls to follow new text

- [x] On completion, streaming reply transitions smoothly to finalized reply

- [x] Activity log in panel matches the one in the comment popover

- [x] Panel shows tasks from multiple files correctly

- [x] Individual task removal via X button on each task card

- [x] Elapsed time updates in real-time for active tasks

- [x] Multiple sequential delegations all appear in the strip and panel

- [x] Error states display correctly in both panel and popover

### Design

- [x] Agent activity strip and panel match app design system (neutral palette, smooth transitions)

- [x] Panel task card hover/active states are polished

- [x] Streaming cursor animation is subtle and professional

- [x] Panel is resizable and doesn't crowd the editor

- [x] Strip and panel work in both light and dark mode

- [ ] Transitions for panel show/hide are smooth (slide in/out)

- [x] Task status icons are clear and distinguishable

- [x] No layout shift when strip appears/disappears (strip is fixed-width)

## Out of Scope

- **Parallel delegation** — comments are still delegated sequentially via the singleton agent
- **Agent auto-apply (Part 3)** — agent directly modifying document content from a comment
- **Activity persistence** — task history is lost on app restart (acceptable for v1)
- **Task prioritization or reordering** — tasks run in order submitted
- **Chat background tasks** — the store supports them, but only comment delegations register tasks in this iteration
- **Notification sounds** — no audio feedback for task completion
# PRD: Open Actions & Task Tracking Dashboard

**Date:** 2026-03-11 **Updated:** 2026-03-13 **Phase:** 12 **Status:** ✅ Complete

---

## Problem

Notesage users create tasks, delegate comments to AI agents, and track work across multiple projects. But there's no unified view of what's open, what's in progress, and what's done. The information exists in scattered locations:

- **Task lists** (`- [x]` / `- [x]`) spread across dozens of markdown files
- **Open comments** in `.notesage/comments/` JSON sidecar files
- **Delegated agent tasks** in the activity store (may have pending replies)
- **Research items** with follow-up actions in `.notesage/research/`
- **Project goals** in frontmatter (`type: goal`)

A user with 5 projects and 200 notes has no way to answer "what do I need to do today?" without opening each file individually. This is a fundamental gap in a productivity-focused note-taking app.

---

## Goals

1. **Unified action view** — Single dashboard showing all open items across all projects
2. **Source diversity** — Aggregate task lists, open comments, agent delegations, and goal items
3. **Project grouping** — Actions grouped by project with visual separation and counts
4. **Quick navigation** — Click any item to jump directly to the source document and position
5. **Status tracking** — Items show status (open, in-progress, done, delegated) with filtering
6. **Background scanning** — Incremental scanning that doesn't block the editor
7. **Lightweight persistence** — Scan results cached to avoid rescanning on every app launch

## Non-Goals

- **Task creation from dashboard** — create tasks in documents, not in the dashboard
- **Drag-and-drop reordering** — items maintain document order
- **Due dates or scheduling** — no calendar integration (deferred)
- **Cross-project task dependencies** — items are independent
- **Kanban or board view** — list view only
- **Task assignment to other people** — single-user app
- **Notifications or reminders** — deferred to System Tray PRD
- **Syncing task state back to documents** — checking off in dashboard checks off in document (this IS in scope)

---

## User Stories

**Busy researcher:**

> As a user with 5 active research projects, I want to see all my open tasks and pending agent delegations in one place, so I know what needs my attention without switching between projects.

**Meeting follow-up:**

> As someone who takes meeting notes with action items, I want to see all unchecked tasks from today's meetings grouped together, so I don't miss any follow-ups.

**Goal tracker:**

> As a user with project goals defined in frontmatter, I want to see goal progress alongside task items, so I have a complete picture of where each project stands.

**Agent collaborator:**

> As a user who delegates research comments to AI agents, I want to see which delegations are still pending and which have replies I haven't reviewed, so I can follow up on agent work.

---

## Technical Approach

### Action Sources

| Source | Detection Method | Status States |
| --- | --- | --- |
| Task lists | Parse `- [x]` / `- [x]` from markdown files | open, done |
| Comments | Read `.notesage/comments/*.json` sidecar files | open, delegated, done, resolved |
| Agent tasks | Read activity-store (persisted) | pending, running, completed, error |
| Goals | Scan frontmatter `type: goal` with checklist items | open, done |

### Scanning Architecture

**Incremental scanning** — avoid full rescan on every open:

```
Initial scan (app startup or first dashboard open):
  1. For each project + explorer folder:
     a. Walk .md files, parse task lists (Rust, parallel)
     b. Read .notesage/comments/*.json
     c. Read activity-store for project agent tasks
     d. Scan frontmatter for goal documents
  2. Cache results in action-store with per-file timestamps
  3. Total scan time target: < 2 seconds for 500 files

Incremental updates:
  - File watcher triggers rescan of changed files only
  - Comment store changes trigger comment action refresh
  - Activity store changes trigger agent task refresh
  - Manual rescan button for full refresh
```

**Rust backend — new command:**

```rust
#[tauri::command]
pub async fn scan_actions(
    paths: Vec<String>,        // Project roots and explorer folders
    since: Option<u64>,        // Unix timestamp — only scan files modified after this
) -> Result<Vec<ActionItem>, String>

#[derive(Serialize, Deserialize, Clone)]
pub struct ActionItem {
    pub id: String,                    // Unique ID (file:line or comment:id)
    pub source_type: String,           // "task" | "comment" | "agent" | "goal"
    pub status: String,                // "open" | "done" | "delegated" | "pending" | "error"
    pub text: String,                  // Task text or comment content (truncated)
    pub file_path: String,             // Absolute path to source file
    pub line_number: Option<u32>,      // Line in source file (for tasks/goals)
    pub project_name: Option<String>,  // Project name (from project.json)
    pub project_root: Option<String>,  // Project root path
    pub created_at: Option<String>,    // ISO 8601 timestamp
    pub updated_at: Option<String>,    // Last modification time
    pub metadata: Option<serde_json::Value>, // Source-specific metadata
}
```

**Task list parsing** — done in Rust for speed:

```rust
// Regex-based parser for markdown task lists
// Matches: "- [x] Task text" and "- [x] Done task"
// Also matches: "* [ ]", "1. [ ]", nested tasks
// Returns line number and nesting level
fn parse_task_items(content: &str) -> Vec<TaskItem> { ... }
```

### Frontend Architecture

**New store:** `src/stores/action-store.ts`

```typescript
interface ActionStore {
  // State
  actions: ActionItem[];
  lastFullScan: number;           // timestamp
  isScanning: boolean;
  filter: ActionFilter;

  // Computed
  getActionsByProject(): Map<string, ActionItem[]>;
  getOpenCount(): number;
  getOpenCountByProject(projectRoot: string): number;

  // Actions
  fullScan(): Promise<void>;
  incrementalUpdate(filePath: string): Promise<void>;
  toggleTaskDone(actionId: string): Promise<void>;  // Check/uncheck in source file
  setFilter(filter: Partial<ActionFilter>): void;
}

interface ActionFilter {
  status: ('open' | 'done' | 'delegated' | 'pending' | 'error')[];
  sourceType: ('task' | 'comment' | 'agent' | 'goal')[];
  project: string | null;  // null = all projects
  search: string;
}
```

**New hook:** `src/hooks/useActionScanner.ts`

Orchestrates scanning, listens for file watcher events, and triggers incremental updates.

### Check-off Integration

When a user checks off a task in the dashboard, it modifies the source markdown file:

```typescript
async function toggleTaskDone(action: ActionItem) {
  if (action.source_type !== 'task') return;

  const content = await tauriApi.readFile(action.file_path);
  const lines = content.split('\n');
  const line = lines[action.line_number - 1];

  // Toggle [ ] ↔ [x]
  if (line.includes('- [x]')) {
    lines[action.line_number - 1] = line.replace('- [x]', '- [x]');
  } else if (line.includes('- [x]')) {
    lines[action.line_number - 1] = line.replace('- [x]', '- [x]');
  }

  await tauriApi.markSelfWrite(action.file_path);
  await tauriApi.writeFile(action.file_path, lines.join('\n'));

  // If file is open in editor, refresh tab content
  refreshOpenTab(action.file_path);
}
```

---

## UI/UX

### Architecture: Dialog + Landing Page + Status Bar

The dashboard uses a **three-tier progressive disclosure** pattern, informed by research into how Cursor, VS Code, GitHub Copilot, Linear, and Things 3 handle similar views (see `docs/research/actions-dashboard-ui-patterns.md`):

1. **Status bar indicator** (glance) — open action count in the editor status bar
2. **Landing page** (discovery) — shown when no tabs are open
3. **Full-screen dialog** (detail) — rich overlay accessible anytime via Cmd+5

**Why a dialog, not an editor tab?** The dashboard is non-editable interactive UI (filters, checkboxes, navigation), not a document. A dialog avoids touching the editor-store tab system entirely — zero regression risk, fully decoupled. The `ActionsDashboard` component can be promoted to a virtual tab later if needed, since the component itself is the same either way.

**Why not a panel?** The right sidebar panel is too narrow for a dashboard with project grouping, filters, and action detail. It also competes with the chat panel for the same slot.

**Why not a separate window?** Adds multi-window state sync complexity. The system tray (future PRD) will be able to open the dialog without needing a separate window.

### Status Bar Indicator

Open action count displayed in the status bar left zone, alongside existing indicators (git branch, Local AI, downloads):

```
┌──────────────────────────────────────────────────────────────────┐
│ ☐ 12 actions  ⑃ main  ⬡ Running (Phi-4)  │  Rich text  1,234 words │
└──────────────────────────────────────────────────────────────────┘
```

- `CheckSquare` icon (lucide) + count + "actions" label
- Muted text by default, foreground on hover
- **Click** → opens the Actions dialog
- Count updates in real-time as actions are scanned
- Hidden when count is 0 (clean status bar when nothing needs attention)

### Landing Page

When no editor tabs are open, the content area displays the actions dashboard instead of the empty welcome screen. This provides a natural "here's what needs your attention" on app launch.

- Same `ActionsDashboard` component rendered inline in the empty-state slot
- If no actions exist, falls back to the existing welcome screen (New Note, New Project, etc.)
- Clicking an action item opens the source file (which replaces the landing page naturally)

### Actions Dialog

Accessible via:

- **Keyboard shortcut:** `Cmd+5`
- **Command palette:** "Open Actions"
- **Status bar click:** Click the actions count

The dialog is a full-screen overlay using shadcn/ui `Dialog` with rich content:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                    [✕]  │
│                                                                         │
│  Actions                                                   [⟳] [Filter]│
│                                                                         │
│  [All ▾] [Open ▾] [Search...                                        ]  │
│                                                                         │
│  ── Research Project (8 open) ────────────────────────────────────────  │
│                                                                         │
│  □ Review battery technology paper                              task    │
│    notes/research-plan.md:14                                            │
│  □ Download arxiv source on solid-state                         task    │
│    notes/research-plan.md:15                                            │
│  ◉ Agent: summarize lithium findings                       delegated    │
│    notes/literature-review.md — 2 replies                               │
│  □ Update project goals                                         goal    │
│    project-goals.md:8                                                   │
│                                                                         │
│  ── Meeting Notes (3 open) ───────────────────────────────────────────  │
│                                                                         │
│  □ Send follow-up email to Sarah                                task    │
│    meetings/2026-03-10.md:22                                            │
│  □ Schedule design review                                       task    │
│    meetings/2026-03-10.md:23                                            │
│  💬 Comment: needs clarification                                open    │
│    meetings/2026-03-10.md                                               │
│                                                                         │
│  ── Quick Notes (1 open) ─────────────────────────────────────────────  │
│                                                                         │
│  □ Buy groceries                                                task    │
│    todo.md:3                                                            │
│                                                                         │
│  ── Completed (12) ──────────────────────────────── [Show/Hide] ─────  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

- Centered content with max-width for readability
- Backdrop blur overlay (consistent with existing dialogs)
- Escape or click outside to dismiss
- Clicking an action item navigates to the source file and **closes the dialog**
- Checking a checkbox toggles the task without closing the dialog

### Action Item Interactions

- **Click** → Navigate to source file and scroll to line (opens in new tab if not already open)
- **Checkbox** → Toggle task completion (in source file)
- **Right-click** → Context menu: Open file, Copy text, Mark done
- **Hover** → Shows full text and file path

### Filter Bar

- **Source type dropdown**: All, Tasks only, Comments only, Agent tasks only, Goals only
- **Status dropdown**: Open, Delegated, Done, All
- **Search**: Full-text search across action text
- **Project filter**: All projects or specific project

### Empty State

When no actions found:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│              No open actions                                            │
│                                                                         │
│    Create tasks with "- [x] Task text" in any                           │
│    markdown file, or delegate comments to agents.                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### ActionItem (shared Rust ↔ Frontend)

```typescript
interface ActionItem {
  id: string;
  sourceType: 'task' | 'comment' | 'agent' | 'goal';
  status: 'open' | 'done' | 'delegated' | 'pending' | 'running' | 'completed' | 'error';
  text: string;
  filePath: string;
  lineNumber?: number;
  projectName?: string;
  projectRoot?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: {
    // For comments
    commentId?: string;
    replyCount?: number;
    // For agent tasks
    taskId?: string;
    agentName?: string;
    // For goals
    goalType?: string;
    progress?: string;  // "3/5 complete"
  };
}
```

### Action Store Persistence

Cache scan results in localStorage via Zustand persist:

```typescript
// Persisted
actionCache: Record<string, {       // file path → cached items
  items: ActionItem[];
  scannedAt: number;                 // file modification time at scan
}>;

// Non-persisted (rebuilt)
actions: ActionItem[];               // flattened from cache
```

Cache invalidated when file modification time changes (detected by incremental scan or file watcher).

---

## Quality Gates

### Functional

- [x] Task lists (`- [x]` / `- [x]`) are correctly parsed from all markdown files

- [x] Nested task lists maintain correct hierarchy

- [x] Open comments from `.notesage/comments/` appear as actions

- [x] Delegated comments show correct status (delegated, done with reply count)

- [x] Agent tasks from activity-store appear with correct status

- [x] Goal items from frontmatter appear as actions

- [x] Clicking an action navigates to the source file and line

- [x] Checking off a task in the dashboard updates the source markdown file

- [x] If the task's file is open in editor, the editor content refreshes

- [x] Project grouping is correct (items under correct project)

- [x] Non-project files (explorer folders, Quick Notes) grouped separately

- [x] Filter by source type works

- [x] Filter by status works

- [x] Text search across actions works

- [x] Project filter works

- [x] Full scan completes in &lt; 2 seconds for 500 files

- [x] Incremental update on file change works

- [x] File watcher triggers action refresh for modified files

- [x] Status bar count updates in real-time

- [x] Completed section is collapsible

- [x] Dashboard renders as landing page when no tabs are open

- [x] Falls back to welcome screen when no tabs and no actions

- [x] Cmd+5 opens the actions dialog

- [x] Status bar click opens the actions dialog

- [x] Command palette "Open Actions" opens the actions dialog

- [x] Clicking an action in the dialog navigates to source and closes dialog

- [x] Checking a checkbox in the dialog does not close it

### Performance

- [x] Initial scan does not block editor rendering

- [x] Incremental updates complete in &lt; 200ms per file

- [x] Dashboard dialog opens instantly (cached results)

- [x] Scrolling through 200+ actions is smooth

### Design

- [x] Dashboard matches design system (neutral palette, proper spacing)

- [x] Action items have clear visual distinction by source type

- [x] Project sections have proper visual separation

- [x] Status bar indicator fits existing status bar aesthetic

- [x] Dialog has backdrop blur consistent with existing dialogs

- [x] Empty state is helpful and polished

- [x] All UI works in light and dark mode

- [x] Checkboxes follow custom styling (not browser defaults)

- [x] Dashboard content is centered with max-width for readability

- [x] Landing page and dialog use the same ActionsDashboard component

---

## Dependencies

### Rust

- No new crate dependencies — uses existing `regex`, `serde_json`, `serde`

### Frontend

- No new npm dependencies — uses existing shadcn/ui components

---

## Files Created/Modified

### New Files

- `src-tauri/src/commands/actions.rs` — action scanning Tauri command
- `src/stores/action-store.ts` — action registry and cache
- `src/hooks/useActionScanner.ts` — scan orchestration
- `src/components/actions/ActionsDashboard.tsx` — main dashboard (shared by landing page + dialog)
- `src/components/actions/ActionsDialog.tsx` — dialog wrapper (shadcn/ui Dialog)
- `src/components/actions/ActionItem.tsx` — individual action row
- `src/components/actions/ActionFilter.tsx` — filter bar

### Modified Files

- `src/components/editor/StatusBar.tsx` — add open actions count indicator
- `src/components/editor/Editor.tsx` — render dashboard as landing page when no tabs open
- `src/App.tsx` — mount useActionScanner, manage dialog open state
- `src/hooks/useFileWatcher.ts` — trigger action rescan on file changes
- `src-tauri/src/commands/mod.rs` — register new commands
- `src-tauri/src/lib.rs` — add to `generate_handler![]`

---

## Out of Scope

- **Due dates and reminders** — no time-based features
- **Task creation from dashboard** — create in documents
- **Kanban/board view** — list view only
- **Subtask relationships** — flat list with nesting indication
- **Task priority or labels** — extracted from document context only
- **Multi-user assignment** — single-user app
- **Calendar integration** — deferred
- **Push notifications** — deferred to System Tray PRD
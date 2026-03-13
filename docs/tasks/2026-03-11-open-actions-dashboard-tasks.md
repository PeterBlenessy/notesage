# Tasks: Open Actions & Task Tracking Dashboard

**PRD:** `docs/prds/2026-03-11-open-actions-dashboard.md`**Created:** 2026-03-13

## Summary

**12 tasks: 3S, 6M, 3L**

The feature has three layers: Rust backend scanning, Zustand state management, and the UI (dashboard component + dialog + status bar + landing page). No editor-store changes needed — the dashboard is rendered as a dialog overlay and in the landing page empty state, completely decoupled from the tab system.

**Implementation order:**

1. Backend first (#1-#2) — Rust command and registration
2. State layer (#3-#4) — action store and scanner hook
3. UI components (#5-#8) — dashboard, action items, filter bar, dialog wrapper
4. Integration points (#9-#12) — status bar, landing page, keyboard shortcut, command palette, file watcher, check-off

**Risks:**

- Comment/activity store reads happen on the frontend, not in Rust — the scanner hook (#4) must merge Rust results with frontend-only sources.
- Check-off line number drift when source file has changed since scan (#12).

---

## Tasks

### #1 — Add `scan_actions` Tauri command (Rust)

**Description:** Create `src-tauri/src/commands/actions.rs` with the `scan_actions` command. Parses markdown files for task lists (`- [ ]` / `- [x]`, `* [ ]`, `1. [ ]`), reads `.notesage/comments/*.json` for open/delegated comments, and scans frontmatter for `type: goal` documents with checklist items. Supports incremental scanning via `since` timestamp (only process files modified after that time). Returns `Vec<ActionItem>` with all fields from the PRD data model.

**Acceptance criteria:**

- Regex parser handles `- [ ]`, `- [x]`, `* [ ]`, `1. [ ]`, nested tasks with correct line numbers
- Comments parsed from `.notesage/comments/*.json` with status mapping
- Goal documents detected via frontmatter `type: goal`, checklist items extracted
- `since` parameter filters by file mtime
- `project_name` populated from `.notesage/project.json` when present
- Scans 500 files in &lt; 2 seconds

**Complexity:** L **Category:** backend **Dependencies:** None **Files:**

- Create `src-tauri/src/commands/actions.rs`
- Follow pattern from `search_research` in `file.rs`

---

### #2 — Register `scan_actions` command

**Description:** Add the new `actions` module to `commands/mod.rs` and register `scan_actions` in `generate_handler![]` in `lib.rs`.

**Acceptance criteria:**

- `scan_actions` callable from frontend via `invoke`
- Compiles without warnings

**Complexity:** S **Category:** backend **Dependencies:** Depends on #1 **Files:**

- Modify `src-tauri/src/commands/mod.rs`
- Modify `src-tauri/src/lib.rs`

---

### #3 — Create action-store (Zustand)

**Description:** Create `src/stores/action-store.ts` with the `ActionStore` interface from the PRD. Includes `ActionItem` and `ActionFilter` TypeScript interfaces, persisted `actionCache` (file path → items + timestamp), non-persisted `actions` array (flattened from cache), computed helpers (`getActionsByProject`, `getOpenCount`, `getOpenCountByProject`), and mutation methods (`fullScan`, `incrementalUpdate`, `setFilter`). The `fullScan` method calls `scan_actions` via Tauri invoke, then merges with agent tasks from `activity-store` (frontend-only source). The `toggleTaskDone` method is stubbed here and implemented in #12.

**Acceptance criteria:**

- Store persists `actionCache` and `filter` to localStorage
- `fullScan()` calls Rust `scan_actions` and merges activity-store agent tasks
- `incrementalUpdate(filePath)` rescans a single file's actions
- `getActionsByProject()` returns `Map<string, ActionItem[]>` grouped by `projectRoot`
- `getOpenCount()` returns count of non-done/non-resolved items
- Filter state updates immediately (no async)

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #2 **Files:**

- Create `src/stores/action-store.ts`

---

### #4 — Create useActionScanner hook

**Description:** Create `src/hooks/useActionScanner.ts` that orchestrates action scanning. Triggers `fullScan()` on startup (after `startupReady`), listens to file watcher events for incremental updates, subscribes to comment-store and activity-store changes to refresh those action sources. Mount in `App.tsx` alongside existing lifecycle hooks.

**Acceptance criteria:**

- Full scan runs once after `startupReady` becomes true
- File change events (from `file-changed` Tauri event) trigger `incrementalUpdate` with 500ms debounce
- Comment store subscription triggers comment action refresh
- Activity store subscription triggers agent task refresh
- Hook mounted in `App.tsx`

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #3 **Files:**

- Create `src/hooks/useActionScanner.ts`
- Modify `src/App.tsx` — mount `useActionScanner()`

---

### #5 — Build ActionItem component

**Description:** Create `src/components/actions/ActionItem.tsx` — individual action row. Shows custom checkbox (for tasks/goals), icon by source type, action text (truncated), source type badge, and file location (relative path + line number). Click navigates to source file and line. Checkbox toggles task completion. Right-click context menu with Open file, Copy text, Mark done.

**Acceptance criteria:**

- Custom checkbox (not browser default) for task and goal items
- Icon varies by source type: CheckSquare (task), MessageSquare (comment), Bot (agent), Target (goal)
- Text truncated with ellipsis, full text on hover tooltip
- File location shown as relative path from project root + line number
- Source type badge (muted, small pill)
- Click handler prop for navigation (caller decides whether to close dialog)
- Right-click context menu using shadcn/ui ContextMenu
- Smooth hover transition
- Delegated comments show reply count
- Completed items shown with strikethrough and muted text

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- Create `src/components/actions/ActionItem.tsx`

---

### #6 — Build ActionFilter component

**Description:** Create `src/components/actions/ActionFilter.tsx` — filter bar for the dashboard. Source type dropdown (All, Tasks, Comments, Agent tasks, Goals), status dropdown (Open, Delegated, Done, All), project dropdown (All projects + list of projects), and text search input. Reads and writes to `action-store.filter`.

**Acceptance criteria:**

- Source type dropdown with predefined options
- Status dropdown with predefined options
- Project dropdown populated from `workspace-store` projects
- Search input with debounced filtering (150ms)
- Filter state persisted via action-store
- Dropdowns use shadcn/ui Select or DropdownMenu
- Compact layout that doesn't consume too much vertical space

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #3 **Files:**

- Create `src/components/actions/ActionFilter.tsx`

---

### #7 — Build ActionsDashboard component

**Description:** Create `src/components/actions/ActionsDashboard.tsx` — the main dashboard view shared by both the landing page and the dialog. Centered content with max-width matching editor content area. Renders project-grouped action lists with section headers showing project name and open count. Includes the filter bar (#6) at the top. Collapsible "Completed" section at the bottom. Empty state when no actions match filters.

**Acceptance criteria:**

- Content centered with max-width for readability
- Actions grouped by project with section headers (project name + open count)
- Non-project items grouped under "Quick Notes" or folder name
- Collapsible "Completed" section (collapsed by default)
- Empty state with helpful message when no actions
- Refresh button triggers `fullScan()`
- `onActionClick` prop for caller to handle navigation (dialog closes, landing page opens file)
- Renders correctly with 0, 1, 50, and 200+ actions
- Works in light and dark mode

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #3, #5, #6 **Files:**

- Create `src/components/actions/ActionsDashboard.tsx`

---

### #8 — Build ActionsDialog component

**Description:** Create `src/components/actions/ActionsDialog.tsx` — a full-screen dialog wrapper using shadcn/ui `Dialog`. Renders `ActionsDashboard` inside. Clicking an action item navigates to the source file and closes the dialog. Checking a checkbox does not close the dialog. Escape or backdrop click dismisses.

**Acceptance criteria:**

- Uses shadcn/ui Dialog with backdrop blur
- Full-width content area (max-w-3xl centered)
- `open` and `onOpenChange` props for controlled state
- Action click → navigate to file + close dialog
- Checkbox click → toggle task, dialog stays open
- Escape and backdrop click dismiss
- ScrollArea for long action lists

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #7 **Files:**

- Create `src/components/actions/ActionsDialog.tsx`

---

### #9 — Add status bar actions indicator

**Description:** Add an open actions count to the StatusBar left zone. Shows `CheckSquare` icon + count + "actions" label. Hidden when count is 0. Clicking opens the actions dialog. Positioned before the git branch indicator.

**Acceptance criteria:**

- Shows `CheckSquare` icon + count when open actions &gt; 0
- Hidden when count is 0
- Muted text by default, foreground on hover
- Click calls `onOpenActions` callback prop
- Appears in both the editor status bar and the no-editor status bar
- Tooltip: "Open actions dashboard (⌘5)"

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #3 **Files:**

- Modify `src/components/editor/StatusBar.tsx`

---

### #10 — Add landing page dashboard + dialog wiring in App.tsx

**Description:** Two integration points: (1) When no tabs are open in Editor.tsx, show `ActionsDashboard` if there are open actions, otherwise show the existing welcome screen. (2) In App.tsx, manage the `actionsDialogOpen` state, pass it to `ActionsDialog`, and wire status bar clicks and keyboard shortcut to open it.

**Acceptance criteria:**

- No tabs + actions exist → show ActionsDashboard inline in Editor.tsx empty state
- No tabs + no actions → show existing welcome screen
- Clicking an action in the landing page opens the source file normally
- ActionsDialog mounted in App.tsx with open/close state
- Status bar `onOpenActions` prop wired to open the dialog

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #7, #8, #9 **Files:**

- Modify `src/components/editor/Editor.tsx` — landing page branch
- Modify `src/App.tsx` — dialog state and wiring

---

### #11 — Add Cmd+5 shortcut and command palette entry

**Description:** Register `Cmd+5` keyboard shortcut to open the actions dialog. Add "Open Actions" to the command palette actions list (shown in `>` commands mode and default mode).

**Acceptance criteria:**

- `Cmd+5` opens the actions dialog from anywhere
- "Open Actions" appears in command palette with `⌘5` shortcut display
- Shortcut documented in `docs/keyboard-shortcuts.md`

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #10 **Files:**

- Modify `src/hooks/useKeyboardShortcuts.ts`
- Modify `src/components/CommandPalette.tsx` — add "Open Actions" action
- Modify `docs/keyboard-shortcuts.md`

---

### #12 — Implement check-off integration

**Description:** Implement `toggleTaskDone` in action-store. When a user checks/unchecks a task in the dashboard, read the source file, toggle `[ ]` ↔ `[x]` at the correct line, write the file back (with `markSelfWrite`), and refresh the open editor tab if the file is currently open. Handle edge cases: file may have changed since scan (line number drift), file may be deleted, task may no longer be at expected line.

**Acceptance criteria:**

- Clicking checkbox toggles `- [ ]` ↔ `- [x]` in source file
- Also handles `* [ ]` and `1. [ ]` variants
- `markSelfWrite` called before write to prevent false external change detection
- If file is open in editor, `editor.commands.setContent()` refreshes the view
- If line number has drifted (content changed), fall back to text-matching search
- Action item status updates immediately in the dashboard (optimistic update)
- Toast notification on success ("Task completed" / "Task reopened")

**Complexity:** L **Category:** both **Dependencies:** Depends on #3, #7 **Files:**

- Modify `src/stores/action-store.ts` — implement `toggleTaskDone`
- May need utility in `src/lib/` for line-number-safe task toggling
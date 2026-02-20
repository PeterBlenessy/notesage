# PRD: External Change Review

**Status:** Implemented

## Problem

When Notesage detects external file changes (from another editor, AI agent, terminal, or iCloud sync), it auto-reloads clean tabs and shows a brief toast: "File updated from disk." The user has no visibility into *what* changed — the content silently replaces what was in the editor. This creates uncertainty:

- Did the AI agent change one word or rewrite the whole document?
- Did iCloud sync bring in a small fix or a major restructure?
- Was it my own terminal edit or someone/something else?

Users need a way to see exactly what changed and decide whether to accept or reject those changes — immediately or at their own pace.

## Goals

1. **Show what changed** — inline diff decorations (green inserts, red deletes) for every external file change
2. **Two response tiers** — Accept (frictionless via toast) or Review Later (deferred to status bar)
3. **Non-disruptive** — toast auto-dismisses after ~8 seconds, deferring to the status bar change tracker
4. **Status bar change tracker** — persistent cross-file visibility of pending changes with per-hunk controls
5. **Reuse existing infrastructure** — build on the `InlineDiff` ProseMirror extension, `diff-match-patch` library, and `CommentListPopover` pattern

## Non-Goals

- **Real-time collaborative cursors** — this is single-user change review, not multiplayer
- **Three-way merge** — no conflict resolution UI; if the file changed while the tab is dirty, the existing reload/keep banner remains
- **Undo after accept** — standard editor undo (Cmd+Z) covers this; no custom undo stack
- **Git-level diffing** — this uses text-level diffing (`diff-match-patch`), not git hunks

## User Stories

### Frictionless accept

- As a user, I want to accept external changes instantly by clicking "Accept" on the toast, so trivial changes don't slow me down.

### Deferred review

- As a user, I want the toast to auto-dismiss and defer changes to a status bar tracker, so I can finish my current thought and review later at my own pace.
- As a user, I want to see a change count in the status bar and click it to open a list of pending changes I can browse, jump to, and accept/reject individually.

### Multi-file awareness

- As a user editing multiple files, I want each file's external changes tracked independently and visible in a single popover, so I can jump between files to review changes.

### Per-hunk control

- As a user, I want to accept or reject individual changes (not just all-or-nothing), so I can cherry-pick which external edits to keep.

### Dirty tab handling

- As a user with unsaved changes, I want the existing reload/keep banner to remain (no auto-accept), so my work isn't overwritten.

## Technical Approach

### Diff computation

Uses `diff-match-patch` to compute character-level diffs between the old editor content and the new disk content. Applies semantic cleanup for human-readable word-level hunks, then maps character offsets to ProseMirror positions via `buildTextWithPositions`.

```
old content (editor PM doc) ←→ new content (parsed to PM doc)
         ↓ buildTextWithPositions (both sides)
    plain text extraction with PM position mapping
         ↓ diff-match-patch + semantic cleanup
    ExternalDiffHunk[] (charFrom/charTo/deleteText/insertText)
         ↓ mapSingleHunk (char offsets → PM positions)
    InlineDiffHunk[] (from/to/deleteText/insertText)
         ↓ showInlineDiff()
    ProseMirror decorations (green/red)
```

### Flow for clean tabs

1. **Watcher detects change** → `useFileWatcher` reads new content from disk, strips frontmatter
2. If content matches `tab.content`, skip entirely
3. Store the diff hunks and new content in `external-change-store` via `addChange()`
4. When tab becomes active (or is already active), show inline diff decorations:
   - Compute PM-level diff via `mapExternalChangeToPM()` (uses `requestAnimationFrame` to ensure editor content is loaded after tab switch)
   - Load decorations via `showInlineDiff()`
   - Update store hunks with PM-mapped hunks via `setHunks()`
   - Set status to `deferred`
5. Show toast with Accept button (8s duration, auto-dismiss)
6. On Accept: resolve change, apply diff, save to disk
7. On auto-dismiss: decorations remain visible, change tracked in status bar

### Flow for dirty tabs

No change — the existing `ExternalChangeBanner` (reload/keep) remains. Dirty tabs cannot auto-accept because the user has unsaved edits that would be lost.

### Self-write suppression

Handled entirely at the Rust backend level. `saveFile()` calls `tauriApi.markSelfWrite(filePath)` before writing; the backend file watcher skips events for recently self-written files. No frontend self-write guard needed.

### State management

`external-change-store` (Zustand, non-persisted):

```typescript
interface ExternalChangeEntry {
  filePath: string;
  fileName: string;
  oldContent: string;
  newContent: string;
  hunks: ExternalDiffHunk[];
  timestamp: number;
  status: 'pending' | 'deferred';
}

interface ExternalChangeStore {
  changes: Record<string, ExternalChangeEntry>;
  addChange: (filePath: string, fileName: string, oldContent: string, newContent: string) => void;
  resolveChange: (filePath: string) => void;
  setStatus: (filePath: string, status: 'deferred') => void;
  setHunks: (filePath: string, hunks: ExternalDiffHunk[]) => void;
  getChange: (filePath: string) => ExternalChangeEntry | undefined;
  pendingCount: () => number;
  allChanges: () => ExternalChangeEntry[];
}
```

### Diff decoration reuse

The `InlineDiff` ProseMirror extension handles:

- Green insert text with accept/reject click controls per hunk
- Red strikethrough for deleted text
- `Cmd+Enter` to accept next hunk, `Cmd+Backspace` to reject next hunk
- `acceptAllDiffHunks()` and `rejectAllDiffHunks()` bulk operations
- Per-hunk `acceptDiffHunk(hunkId)` and `rejectDiffHunk(hunkId)` from popover

This extension is shared with git branch diff review. Only one diff review source can be active at a time — git branch review takes priority (external changes auto-accept during git review).

### Sync effect

A transaction listener in Editor.tsx keeps the store's hunks in sync with the InlineDiff plugin state. When individual hunks are accepted/rejected via inline controls, the sync effect:
- Updates store hunks when hunk count changes (keeps ChangeListPopover accurate)
- Resolves the change entry and saves when all hunks are resolved
- Guards against race conditions via `lastExternalDecoratedFile` ref

### Tab switching

- Decorations are cleared when leaving a tab and reloaded when entering a tab with pending changes
- Uses `requestAnimationFrame` to ensure editor content is loaded before computing diffs (prevents comparing wrong tab's content)

## UI/UX

### Toast (transient, 8s)

```
┌──────────────────────────────────────┐
│ File changed externally            ✕ │
│ document.md                          │
│                             [Accept] │
└──────────────────────────────────────┘
```

- Neutral palette, no chromatic colors
- "Accept" as cancel-style ghost button
- Close X in top-right corner (flat, borderless, window-style)
- Stable `id` per file path to prevent duplicate stacking
- Auto-dismisses after 8 seconds → decorations remain, tracked in status bar

### Inline diff decorations

- **Deleted text:** red background with strikethrough (`inline-diff-delete`)
- **Inserted text:** green background (`inline-diff-insert`)
- **Per-hunk controls:** click to toggle accept/reject on each hunk
- **Keyboard shortcuts:** `Cmd+Enter` accept next, `Cmd+Backspace` reject next

### Status bar change tracker (ChangeListPopover)

```
... │ 💬 2 │ ⟳ 3 │ 1,245 words │ 7 min read │
```

- `RefreshCw` icon + hunk count in status bar right zone
- Click opens `ChangeListPopover` (w-96 / 384px):

```
┌────────────────────────────────────────────────┐
│ Pending Changes (3)          Reject All Accept All │
├────────────────────────────────────────────────┤
│ Kap 14.md : what?VIKT… VIKTIGA (7…     ✓  ✗  │
│ Kap 14.md : Stärk sum… Förbättrin…     ✓  ✗  │
│ Förord.md : skarpare ö… Lägg till…            │
└────────────────────────────────────────────────┘
```

Each row: `[filename] : [change preview]  [✓] [✗]`

- **Filename** truncated to 80px, full path shown on hover (tooltip)
- **Change preview** shows red strikethrough (deleted) + green (inserted) text
- **Per-hunk ✓/✗** for the focused file's hunks (green/red on hover, muted grey background)
- **Non-focused file hunks**: click navigates to that file and scrolls to the hunk
- **Accept All / Reject All** in popover header for bulk operations on the focused file
- Popover stays open while browsing changes (does not close on click)
- Counter hidden when no changes pending

### States

- **No pending changes:** change tracker hidden from status bar
- **Changes pending, tab not active:** status bar shows count; decorations applied when tab is switched to
- **Changes pending, tab active:** decorations visible in editor, status bar shows count, per-hunk ✓/✗ in popover
- **All hunks resolved for a file:** decorations cleared, entry removed from store, auto-saves
- **Git branch review active:** external changes auto-accept silently (no competing decorations)

## Data Model

### ExternalDiffHunk (character-level)

```typescript
interface ExternalDiffHunk {
  id: string;
  charFrom: number;  // start offset in old text
  charTo: number;    // end offset in old text
  deleteText: string;
  insertText: string;
}
```

### InlineDiffHunk (PM-level)

```typescript
interface InlineDiffHunk {
  id: string;
  from: number;  // PM position
  to: number;    // PM position
  deleteText: string;
  insertText: string;
}
```

## Dependencies

- `diff-match-patch` — character-level diffing with semantic cleanup
- `InlineDiff` extension — ProseMirror plugin for diff decorations (shared with git diff review)
- `CommentListPopover` — design pattern followed by `ChangeListPopover`
- `Sonner` toast — `cancel` prop for Accept, `closeButton` for dismiss

No new libraries required.

## Quality Gates

### Functional

- [x] External file change shows toast with Accept button and close X
- [x] Accept button applies new content immediately and saves to disk
- [x] Inline diff decorations (green/red) appear in the editor for pending changes
- [x] Toast auto-dismisses after ~8 seconds, deferring to status bar tracker
- [x] Deferred changes show decorations when tab is active
- [x] Per-hunk accept/reject via inline click controls
- [x] Per-hunk accept/reject via popover ✓/✗ buttons (focused file)
- [x] `Cmd+Enter` accepts next hunk, `Cmd+Backspace` rejects next hunk
- [x] Accept All / Reject All work from the popover header
- [x] Status bar shows change count when changes are pending
- [x] Status bar popover lists all changes across all files with filename and preview
- [x] Clicking a change in the popover navigates to the file and scrolls to the hunk
- [x] Counter disappears when all changes are resolved
- [x] Dirty tabs still show the reload/keep banner (no change to dirty tab behavior)
- [x] Multiple files can have independent pending changes
- [x] Switching tabs shows/hides decorations for the active file
- [x] Git branch diff review takes priority (external changes auto-accept during git review)
- [x] Self-write filtering works via backend suppression (no false notifications)
- [x] No duplicate toasts for the same file
- [x] Tab-switch race condition handled (rAF ensures editor content loaded before diffing)

### Design

- [x] Toast follows neutral color palette (no chromatic accents)
- [x] Toast close X is flat, top-right, window-style (not bubble)
- [x] Diff decorations match existing git branch review styling
- [x] Status bar change tracker matches comment counter styling
- [x] ChangeListPopover: w-96, filename + change preview + per-hunk ✓/✗
- [x] Per-hunk buttons: green check / red X on hover, muted grey background
- [x] All interactive elements have hover/focus states
- [x] Works correctly in both light and dark mode

## Implementation Decisions

Decisions made during implementation that differ from the original proposal:

1. **Two tiers instead of three:** Removed the "Review Now" button and `ExternalReviewBanner`. The toast has only Accept + auto-dismiss. Decorations are always loaded immediately — no separate "reviewing" vs "deferred" distinction in UX. Simpler mental model.

2. **No ExternalReviewBanner:** The banner caused confusion (dual toast + banner UI) and race conditions. Removed entirely. Accept All / Reject All moved to the ChangeListPopover header.

3. **Backend-only self-write suppression:** The frontend `self-write-guard.ts` was redundant and caused false suppression of legitimate external changes. Removed entirely — the Rust backend's `markSelfWrite` handles it at the event source.

4. **rAF for tab-switch race condition:** The pending-change effect could fire before the tab-switch effect loaded correct content into the editor, causing `mapExternalChangeToPM` to diff the wrong tab's content. Fixed by deferring to `requestAnimationFrame`.

5. **Per-hunk popover controls only for focused file:** Per-hunk accept/reject from the popover dispatches to the ProseMirror plugin, which only works for the currently loaded document. Non-focused file hunks navigate to the file on click.

6. **Status `reviewing` removed:** Only `pending` and `deferred` statuses used. `pending` = just detected, not yet processed. `deferred` = decorations loaded, tracked in status bar.

## Files

| File | Role |
|------|------|
| `src/lib/external-diff.ts` | `computeExternalDiff()` and `mapExternalChangeToPM()` |
| `src/stores/external-change-store.ts` | Zustand store for pending changes |
| `src/components/editor/ChangeListPopover.tsx` | Status bar popover with per-hunk controls |
| `src/components/editor/StatusBar.tsx` | Change tracker integration |
| `src/components/editor/Editor.tsx` | Toast, decoration lifecycle, accept/reject handlers, sync effect |
| `src/hooks/useFileWatcher.ts` | Watcher → store integration |
| `src/components/editor/extensions/inline-diff.ts` | ProseMirror diff decoration plugin |
| `src/styles/globals.css` | Toast close button styling |

## Out of Scope

- **Per-hunk popover controls for non-focused files** — currently navigates to file first
- **Cross-file Accept All / Reject All** — each file resolved independently
- **Per-word granularity toggle** — always show word-level diffs
- **Diff preview in toast** — toast only shows filename
- **Change history / undo stack** — resolved changes forgotten; use `Cmd+Z`
- **Notification sound or badge** — visual-only via toast and status bar
- **Settings toggle** — always enabled; may add "auto-accept all" setting later

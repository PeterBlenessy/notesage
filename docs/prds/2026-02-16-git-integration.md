# PRD: Git Integration (Core)

**Date:** 2026-02-16 **Phase:** 3 (Project Workspace) **Status:** ✅ Complete

---

## Problem

Notesage users working in git repositories have no visibility into file status (modified, staged, untracked) and must switch to a terminal or another app to commit changes. This breaks flow and makes Notesage feel disconnected from the developer's actual workflow. For a note-taking app aimed at technical users, git awareness is table stakes.

## Goals / Non-Goals

### Goals

1. **File status visibility** — Show git status (modified, staged, untracked, ignored) as visual indicators in the sidebar file tree
2. **Commit from within app** — Users can stage files and create commits without leaving Notesage
3. **Branch awareness** — Display the current branch name; allow switching between existing branches
4. **Auto-detection** — Automatically detect if the open project is a git repository and enable git features
5. **Non-intrusive** — Git features are invisible when the project is not a git repo

### Non-Goals

- Diff viewer in the editor (future enhancement)
- Conflict resolution UI (future enhancement)
- Remote operations (push, pull, fetch) — users handle this in terminal
- Git history / log viewer
- `.gitignore` editor
- Git init from within the app

## User Stories

1. **As a user**, I want to see which files I've modified since my last commit, so that I know what's changed at a glance.
2. **As a user**, I want to stage specific files and create a commit with a message, so that I can version my work without leaving the app.
3. **As a user**, I want to see the current branch name in the UI, so that I know which branch I'm working on.
4. **As a user**, I want to switch branches, so that I can work on different streams without using the terminal.
5. **As a user**, I want git status to update automatically when I save files, so that the sidebar always reflects reality.

## Technical Approach

### Backend — Rust with git CLI

All git operations go through Tauri IPC commands in a new `src-tauri/src/commands/git.rs` module. This follows the established pattern in `commands/file.rs` and `commands/ai.rs`.

Uses the system `git` CLI via `std::process::Command` for all git operations. The PRD originally specified the `git2` crate (libgit2 bindings), but the CLI approach was chosen instead to avoid the build complexity of linking libgit2 (C library cross-compilation, OpenSSL/libssh2 dependencies). The trade-off is a runtime dependency on git being installed — the implementation includes a `git_check_available()` command that detects this and surfaces a warning in settings if git is missing.

**New Tauri commands:**

| Command | Signature | Purpose |
| --- | --- | --- |
| `git_is_repo` | `(path: String) -> Result<bool, String>` | Check if a directory is inside a git repo |
| `git_status` | `(path: String) -> Result<Vec<GitFileStatus>, String>` | Get status of all files in the repo |
| `git_branch_current` | `(path: String) -> Result<String, String>` | Get current branch name |
| `git_branch_list` | `(path: String) -> Result<Vec<String>, String>` | List local branches |
| `git_branch_switch` | `(path: String, branch: String) -> Result<(), String>` | Switch to an existing branch |
| `git_stage` | `(path: String, files: Vec<String>) -> Result<(), String>` | Stage files (add to index) |
| `git_unstage` | `(path: String, files: Vec<String>) -> Result<(), String>` | Unstage files (remove from index) |
| `git_commit` | `(path: String, message: String) -> Result<String, String>` | Create a commit, return commit hash |

### Frontend — State & UI

**New store:** `src/stores/git-store.ts` (Zustand, no persist — git state is always fresh from disk)

```
git-store:
  isGitRepo: boolean
  currentBranch: string
  fileStatuses: Map<string, GitStatus>  // path -> status
  isLoading: boolean
  refresh(): void
```

**New hook:** `src/hooks/useGitOperations.ts` — wraps Tauri commands, triggers refresh after mutations (stage, unstage, commit, branch switch).

**Refresh strategy:**

- On project open: check `git_is_repo`, if true fetch status + branch
- After every file save (`write_file`): refresh git status
- After stage/unstage/commit/branch switch: refresh git status
- Debounce rapid saves (300ms) to keep status responsive

### Sidebar Integration

Extend `FileTreeItem` to display git status indicators next to file names:

| Status | Indicator | Color |
| --- | --- | --- |
| Modified (unstaged) | `M` | `text-muted-foreground/50` |
| Staged | `S` | `text-muted-foreground/50` |
| Untracked | `U` | `text-muted-foreground/50` |
| Conflicted | `C` | `text-muted-foreground/50` |
| Deleted | `D` | `text-muted-foreground/50` |
| Renamed | `R` | `text-muted-foreground/50` |

Indicators are small monospace badges (`font-mono text-[10px]`) right-aligned in the file tree row. Directories show a summary `●` dot indicator if any child has changes.

All status indicators use the same muted greyscale color, consistent with the design system's strictly neutral palette. The letter itself (M, S, U, C, D, R) conveys the status rather than color differentiation. This keeps the sidebar visually calm and avoids introducing chromatic accent colors.

### Branch Indicator

A small branch display in the sidebar footer or header:

- Shows `branch-icon current-branch-name`
- Clicking opens a dropdown (shadcn/ui `dropdown-menu`) listing local branches
- Selecting a branch calls `git_branch_switch`
- Only visible when `isGitRepo` is true

### Commit UI

A minimal commit interface accessible from:

- Sidebar context menu: "Commit..." option when right-clicking on the project root
- Keyboard shortcut: not assigned initially (avoid shortcut bloat)

The commit flow:

1. Opens a dialog (shadcn/ui `dialog`) showing:
   - List of changed files with checkboxes (stage/unstage)
   - Commit message input (shadcn/ui `input` or `textarea`)
   - Commit button
2. User checks files to stage, writes message, clicks commit
3. Calls `git_stage` for checked files, then `git_commit`
4. Dialog closes, git status refreshes

**Toast notifications:** The commit dialog handles feedback inline — errors are shown within the dialog itself, and success is implicit (the dialog closes and the status indicators update). A toast with the short commit hash after successful commit would be a nice polish addition but is not currently implemented. Similarly, git errors outside the commit dialog (e.g., branch switch failures, status fetch failures) are logged to console rather than surfaced as toasts. Adding `sonner` toasts for these cases would improve discoverability of errors.

## UI/UX

### Sidebar file tree

- Status badges appear right-aligned, only when the project is a git repo
- Badges use `font-mono text-[10px]` for compact display
- Subtle — should not dominate the file name
- Folders with changed children show a dim dot indicator
- `transition-opacity duration-150` on badges appearing/disappearing

### Branch indicator

- Position: bottom of sidebar, above any footer controls
- Style: `text-xs text-muted-foreground` with `GitBranch` icon from lucide-react
- Hover: `hover:text-foreground transition-colors duration-150`
- Click: opens branch dropdown
- Truncate long branch names with ellipsis

### Commit dialog

- Max-width 520px
- Changed files list with checkboxes (scrollable, max-height 300px)
- Each file shows its status badge and relative path
- "Select all" / "Deselect all" toggle
- Commit message: single-line input for summary (required), optional multiline for body
- Commit button disabled until message is non-empty and at least one file is staged
- Loading state on commit button while committing

### Empty/error states

- Not a git repo: git features completely hidden, no empty state needed
- No changes: commit dialog shows "No changes to commit" with muted text
- Git error: errors shown inline in commit dialog; other git errors logged to console
- Git identity missing: commit dialog shows inline form to configure `user.name` and `user.email`

## Data Model

### Rust types

```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct GitFileStatus {
    pub path: String,           // Relative to repo root
    pub status: String,         // "modified" | "staged" | "untracked" | "deleted" | "renamed" | "conflicted"
    pub staged: bool,           // Whether the file is in the index
}
```

### TypeScript types

```typescript
type GitStatus = 'modified' | 'staged' | 'untracked' | 'deleted' | 'renamed' | 'conflicted';

interface GitFileStatus {
  path: string;
  status: GitStatus;
  staged: boolean;
}

// git-store state
interface GitState {
  isGitRepo: boolean;
  currentBranch: string;
  fileStatuses: GitFileStatus[];
  isLoading: boolean;
}
```

### Tauri API additions in `src/lib/tauri.ts`

```typescript
// Add to tauriApi object:
async gitIsRepo(path: string): Promise<boolean>;
async gitStatus(path: string): Promise<GitFileStatus[]>;
async gitBranchCurrent(path: string): Promise<string>;
async gitBranchList(path: string): Promise<string[]>;
async gitBranchSwitch(path: string, branch: string): Promise<void>;
async gitStage(path: string, files: string[]): Promise<void>;
async gitUnstage(path: string, files: string[]): Promise<void>;
async gitCommit(path: string, message: string): Promise<string>;
```

## Dependencies

### Rust

No additional crate dependencies. Git operations use the system `git` CLI via `std::process::Command`.

No new frontend dependencies. Uses existing shadcn/ui components (`dialog`, `dropdown-menu`, `checkbox`, `input`, `button`).

### Prerequisites

- Existing Tauri command pattern (`commands/mod.rs` registration)
- Existing `FileTreeItem` component (will be extended)
- Existing sidebar layout (will add branch indicator)

## Quality Gates

### Functional

- [x] `git_is_repo` correctly detects git repos (and non-repos)

- [x] `git_status` returns accurate file statuses matching `git status` output

- [x] Status indicators appear next to modified/staged/untracked files in sidebar

- [x] Status indicators update after saving a file

- [x] Current branch name displays correctly

- [x] Branch switching works and refreshes file tree + status

- [x] Staging/unstaging files works from commit dialog

- [x] Committing creates a valid git commit with correct message

- [x] Git features are completely hidden for non-git projects

- [x] No performance regression for large repos (status fetch &lt; 500ms for 1000 files)

### Design

- [x] Status badges are subtle and don't crowd the file name

- [x] Branch indicator follows design system (muted, transitions, lucide icon)

- [x] Commit dialog looks polished (proper spacing, states, loading)

- [x] All new interactive elements have hover/active/focus states

- [x] Works in both light and dark mode

- [x] No chromatic accent colors — all status indicators use greyscale

## Out of Scope

- **Diff viewer** — Viewing file diffs inline in the editor. Future enhancement.
- **Conflict resolution** — Merge conflict UI. Future enhancement.
- **Remote operations** — Push, pull, fetch. Users use terminal for this.
- **Git log / history** — Viewing commit history. Future enhancement.
- **~~Git init~~** ~~— Creating new repos from within the app.~~ *(Implemented:* `git_init` *command added as a bonus.)*
- **Stashing** — Git stash operations.
- **Staging hunks** — Partial file staging (only whole-file staging).
- **Commit amend** — Only new commits supported initially.
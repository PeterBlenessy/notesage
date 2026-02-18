# PRD: Comments & Change Detection (Phase 5)

## Problem

Notesage users have no way to annotate their documents with comments — personal notes, reminders, or AI feedback attached to specific text ranges. When AI agents (working in git worktrees) or external editors modify files, the app has no mechanism to detect, visualize, or selectively merge those changes. This creates two gaps:

1. **No annotation layer**: Users can't leave notes on their own writing, and there's no mechanism for AI to attach feedback to specific passages — a prerequisite for Phase 6 (Agentic AI Collaboration).
2. **No change review**: AI agents work in git worktrees on separate branches. When they're done, users need to review what changed per-file with inline diffs and accept/reject individual hunks — the core human-AI collaboration loop.

Both capabilities are foundational for Phase 6, where AI agents make changes and users review them through inline diffs and comment threads.

## Goals

1. Users can add, view, edit, and delete comments anchored to text ranges in any document
2. Documents acquire a stable UUID identity (in YAML frontmatter) that survives renames and moves
3. Users can review changes from another git branch (e.g., an agent's worktree branch) as inline diffs in the editor
4. Inline diffs show insertions (green) and deletions (red) with per-hunk accept/reject controls
5. A lightweight filesystem watcher detects external file changes and prompts to reload

## Non-Goals

- Multi-user collaboration or real-time sync (future)
- Comment threading or nested replies (future — keep it flat for now)
- Resolve/unresolve workflow (future — Phase 6 adds "delegate to AI" which needs this)
- Side-by-side diff view — always inline, always in the editor
- Three-way merge or conflict resolution for simultaneous edits
- Watching files outside the project directory
- Comment search or filtering (future)
- Inline diff for filesystem watcher changes (watcher is Tier 1: detect + reload/keep)

## User Stories

1. **As a writer**, I want to add a comment to a paragraph I'm unsure about, so that I can revisit it later.
2. **As a user working with AI**, I want to see AI-authored comments on my text, so that I can review AI feedback in context.
3. **As a user**, I want my comments to survive when I rename or move a file, so that I don't lose annotations.
4. **As a user**, I want to review changes an AI agent made on a branch, so that I can accept or reject each change in context.
5. **As a user**, I want to see exactly what changed (insertions in green, deletions in red) inline in the editor, so that I can make informed decisions.
6. **As a user**, I want to accept or reject individual changes from a branch diff, so that I maintain control over my document.
7. **As a user**, I want to know when a file I have open was modified by an external editor, so that I don't accidentally overwrite those changes.

## Technical Approach

### 1. Document Identity (Lazy UUID)

Documents receive a UUID in their YAML frontmatter, generated lazily — only when the first comment is added or a cross-reference is needed. This avoids polluting every file with metadata.

**Frontmatter format:**

```yaml
---
id: 550e8400-e29b-41d4-a716-446655440000
title: My Document
---
```

**Generation strategy:**

- Frontend calls `crypto.randomUUID()` when first comment is created on a document
- UUID written to frontmatter via existing `updateFrontmatter()` in editor-store
- If frontmatter doesn't exist yet, create it with just the `id` field

**Document index** (`.notesage/doc-index.json`):

```json
{
  "550e8400-e29b-41d4-a716-446655440000": "/absolute/path/to/file.md",
  "...": "..."
}
```

- Rebuilt on project open by scanning all `.md` files for `id` in frontmatter
- Updated when files are renamed/moved (hook into existing rename operation)
- Used to resolve comment sidecar files back to their documents

### 2. Comment System

**Storage model:** Sidecar JSON files in `.notesage/comments/{document-uuid}.json`. Comments are NOT embedded in the markdown — they exist alongside it.

**Why sidecar, not marks in markdown:**

- Comments don't pollute the markdown source
- Files remain clean for git, export, and external editors
- Comment data can be richer (author, timestamps, metadata) without markdown syntax constraints
- Enables AI to add comments without modifying the document content

**Comment anchoring:** Comments reference text positions using a combination of:

- Character offset range (`from`, `to`) in the ProseMirror document
- Anchor text snippet (the commented text at time of creation) for fuzzy re-anchoring after edits

**Tiptap integration:** A custom Tiptap extension (`comment-mark`) that:

- Creates `Decoration.inline()` highlights for commented text ranges
- Updates decoration positions as the document is edited (ProseMirror mapping)
- Re-anchors comments on file load using stored text snippets if positions have shifted

### 3. Git Branch Diff Review (Primary Diff Mechanism)

**Why git-based:** AI agents work in git worktrees on separate branches. Their changes are well-structured git diffs — clean, line-based, on-demand. This is far more reliable than trying to diff arbitrary filesystem changes.

**Architecture:**

```
user's branch (main)     vs     agent's branch (agent-work)
        ↓                               ↓
   git diff main..agent-branch -- file.md
        ↓
   unified diff (line-based hunks)
        ↓
   parse hunks → map line numbers to ProseMirror positions
        ↓
   inline decorations (red strikethrough / green highlight)
        ↓
   per-hunk accept/reject
```

**Line-to-ProseMirror position mapping:**

Git diffs are line-based, and markdown lines map naturally to ProseMirror block nodes:

- Each paragraph, heading, list item, code block line corresponds to a line in the markdown
- Build a `lineNumber → pmPosition` map by walking the editor's PM doc, tracking which block node corresponds to which line of the serialized markdown
- This is simpler than character-level mapping because block nodes are the natural unit in both markdown and ProseMirror

**New Tauri commands** (extend existing `git.rs`):

- `git_diff_file(repo_path, base_branch, compare_branch, file_path)` → returns structured diff hunks
- `git_worktree_list(repo_path)` → list active worktrees and their branches
- `git_apply_hunk(repo_path, file_path, hunk)` → apply a single hunk from a diff

**Accept/reject per-hunk:**

- Accept: apply the hunk's changes to the editor content (insert new text, delete old text)
- Reject: remove the decoration, keep current content
- Accept All: apply all remaining hunks
- Reject All: clear all diff decorations

### 4. Inline Diff Extension (Shared)

Both git branch diffs and any future diff sources feed into the same Tiptap extension for rendering:

- Generalize the AI suggestion decoration pattern to handle multiple hunks
- Each hunk: `{ from, to, deletedText, insertedText }`
- Red strikethrough for deleted text via `Decoration.inline()`
- Green highlight for inserted text via `Decoration.widget()`
- Per-hunk accept/reject buttons (same as AI suggestion's Accept/Reject)
- Keyboard shortcuts: `Cmd+Enter` (accept next), `Cmd+Backspace` (reject next)

**Coexistence with AI suggestions:** AI suggestion has priority for keyboard shortcuts. Diff shortcuts only fire when `!hasActiveSuggestion(editor)`.

### 5. Filesystem Watcher (Simplified — Tier 1)

Detects external file modifications (from other editors, git operations) and prompts the user. **No inline diff** for watcher events — just detect and offer reload/keep.

**Backend:** Use the `notify` crate (v7) for cross-platform filesystem watching.

**Architecture:**

- Tauri command `watch_directory(path)` watches the project directory recursively
- Emits `file-changed` events via Tauri event system
- Debounce rapid changes (500ms)
- Self-write filtering: track in-flight writes from Notesage to avoid false positives

**Frontend behavior:**

- If changed file is open and tab is **clean**: auto-reload silently
- If changed file is open and tab is **dirty**: show banner with "Reload" / "Keep"
- If file is created/deleted: refresh sidebar file tree
- Sidebar indicator for externally modified files

## UI/UX

### Comment Creation

**Trigger:** Select text → click comment icon in bubble menu, or use keyboard shortcut `Cmd+Shift+M`.

**Flow:**

1. User selects text in the editor
2. Bubble menu appears with existing AI actions + new "Comment" button (message-square icon)
3. Clicking "Comment" opens a small inline popover anchored to the selection
4. User types comment text and presses Enter (or clicks "Add")
5. Selected text gets a subtle highlight decoration (light amber in light mode, muted amber in dark mode)
6. Comment is saved to sidecar JSON

### Comment Display

**Inline highlights:** Commented text ranges shown with a subtle background color. Clicking a highlight opens the comment popover.

**Comment popover** (shadcn/ui `popover`):

```
┌─────────────────────────────────┐
│ "The commented text..."         │
│                                 │
│ Your comment text here.         │
│                                 │
│ You · just now          [✏️] [🗑] │
└─────────────────────────────────┘
```

- Shows the anchor text (truncated if long)
- Comment body
- Author label + relative timestamp
- Edit and delete actions (icon buttons, visible on hover)
- Neutral styling per design system — no chromatic colors

### Comment Panel (Optional Sidebar)

Not a primary requirement for this phase, but a lightweight comment list in the right sidebar (below or replacing chat panel when toggled) would let users see all comments at a glance.

**Defer to Phase 5.1 if scope is too large.** The popover-on-click approach is sufficient for v1.

### Branch Diff Review

**Trigger:** User selects a branch to compare against (e.g., from a dropdown in the toolbar or a "Review Changes" action).

**Review flow:**

1. User selects agent branch to review (dropdown shows branches from `git_branch_list` + worktrees from `git_worktree_list`)
2. Changed files listed in a panel or sidebar indicator
3. User opens a changed file → inline diff shown automatically
4. Deletions: red background with strikethrough
5. Insertions: green background
6. Per-change accept/reject buttons next to each hunk
7. "Accept All" / "Reject All" in a banner above the editor
8. `Cmd+Enter` accepts next change, `Cmd+Backspace` rejects next change
9. When all hunks for a file are resolved, the diff decorations clear

### External Change Banner (Filesystem Watcher)

When an open file is modified externally (dirty tab):

```
┌──────────────────────────────────────────────────────┐
│ ⚠ This file was modified externally.  [Reload] [Keep]│
└──────────────────────────────────────────────────────┘
```

- **Reload**: Replace editor content with disk version
- **Keep**: Dismiss banner, keep current editor content (marks tab dirty)
- No "Show Changes" button — watcher is Tier 1 only
- Clean tabs auto-reload silently (no banner)

### Sidebar Indicators

- Files modified externally (watcher): small dot indicator, tooltip "Modified externally"
- Files changed on agent branch (git diff): badge showing number of changed lines or a diff icon
- Both distinct from existing git status letters (M/A/S/U/D/R/C)

## Data Model

### TypeScript

```typescript
// Comment stored in sidecar JSON
interface Comment {
  id: string;                  // crypto.randomUUID()
  documentId: string;          // Document UUID from frontmatter
  anchorFrom: number;          // ProseMirror position (start)
  anchorTo: number;            // ProseMirror position (end)
  anchorText: string;          // Quoted text at creation (for re-anchoring)
  body: string;                // Comment text
  author: 'user' | 'ai';      // Who created the comment
  authorName?: string;         // Display name (e.g., "Claude", user name)
  createdAt: string;           // ISO 8601 timestamp
  updatedAt: string;           // ISO 8601 timestamp
}

// Sidecar file: .notesage/comments/{documentId}.json
interface CommentFile {
  documentId: string;
  comments: Comment[];
}

// Document index: .notesage/doc-index.json
interface DocumentIndex {
  [uuid: string]: string;      // UUID -> absolute file path
}

// Git diff hunk from Tauri backend
interface DiffHunk {
  oldStart: number;            // Line number in base version
  oldLines: number;            // Number of lines removed
  newStart: number;            // Line number in new version
  newLines: number;            // Number of lines added
  deletedText: string;         // Text that was removed
  insertedText: string;        // Text that was added
}

// Git diff for a single file
interface FileDiff {
  filePath: string;
  hunks: DiffHunk[];
}

// Inline diff hunk mapped to ProseMirror positions
interface InlineDiffHunk {
  id: string;                  // Unique ID for per-hunk operations
  from: number;                // PM position start
  to: number;                  // PM position end
  deletedText: string;
  insertedText: string;
}

// File change event from watcher
interface FileChangedPayload {
  path: string;
  kind: 'modify' | 'create' | 'delete' | 'rename';
}
```

### Zustand Stores

**comment-store.ts** (new):

```typescript
interface CommentStore {
  commentsByDocument: Record<string, Comment[]>;
  activeCommentId: string | null;

  loadComments(documentId: string, projectRoot: string): Promise<void>;
  addComment(comment: Omit<Comment, 'id' | 'createdAt' | 'updatedAt'>): Comment;
  updateComment(documentId: string, commentId: string, body: string): void;
  deleteComment(documentId: string, commentId: string): void;
  setActiveComment(id: string | null): void;
  saveComments(documentId: string, projectRoot: string): Promise<void>;
  clearDocument(documentId: string): void;
}
```

**diff-review-store.ts** (new):

```typescript
interface DiffReviewStore {
  compareBranch: string | null;          // Branch being reviewed
  changedFiles: FileDiff[];              // Files with changes
  activeFileDiff: FileDiff | null;       // Currently viewing
  reviewActive: boolean;

  startReview(branch: string): Promise<void>;
  endReview(): void;
  setActiveFile(filePath: string): void;
  resolveHunk(filePath: string, hunkId: string, action: 'accept' | 'reject'): void;
}
```

**editor-store.ts** (extend):

- Add `externalChanges: Record<string, { diskContent: string; detectedAt: number }>` (ephemeral, not persisted)
- Actions: `setExternalChange(filePath, diskContent)`, `clearExternalChange(filePath)`

### Tauri Commands

```rust
// src-tauri/src/commands/git.rs (extend existing)

/// Get structured diff between two branches for a specific file
#[tauri::command]
pub async fn git_diff_file(
    repo_path: String,
    base_branch: String,
    compare_branch: String,
    file_path: String,
) -> Result<Vec<DiffHunk>, String>

/// List changed files between two branches
#[tauri::command]
pub async fn git_diff_files(
    repo_path: String,
    base_branch: String,
    compare_branch: String,
) -> Result<Vec<String>, String>

/// List active git worktrees
#[tauri::command]
pub async fn git_worktree_list(
    repo_path: String,
) -> Result<Vec<WorktreeInfo>, String>

// src-tauri/src/commands/watcher.rs (new)

#[tauri::command]
pub async fn watch_directory(
    app: tauri::AppHandle,
    path: String,
) -> Result<(), String>

#[tauri::command]
pub async fn unwatch_directory(path: String) -> Result<(), String>

#[tauri::command]
pub async fn mark_self_write(path: String) -> Result<(), String>

#[tauri::command]
pub async fn clear_self_write(path: String) -> Result<(), String>
```

### Rust Structs

```rust
#[derive(Serialize, Deserialize)]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub deleted_text: String,
    pub inserted_text: String,
}

#[derive(Serialize, Deserialize)]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: String,
    pub is_main: bool,
}
```

### Frontend Files

```
src/
├── components/
│   ├── editor/
│   │   ├── extensions/
│   │   │   ├── comment-mark.ts         # Comment decoration extension (new)
│   │   │   └── inline-diff.ts          # Inline diff decoration extension (new)
│   │   ├── CommentPopover.tsx          # Comment view/edit popover (new)
│   │   ├── ExternalChangeBanner.tsx    # "File changed externally" banner (new)
│   │   └── DiffReviewBanner.tsx        # "Reviewing branch X" banner (new)
├── hooks/
│   ├── useCommentOperations.ts         # Comment CRUD hook (new)
│   ├── useDiffReview.ts               # Git branch diff review hook (new)
│   └── useFileWatcher.ts              # File watcher event hook (new)
├── stores/
│   ├── comment-store.ts               # Comment state (new)
│   └── diff-review-store.ts           # Diff review state (new)
├── lib/
│   └── pm-line-map.ts                 # Line number ↔ PM position mapping (new)
```

## Dependencies

### Rust (Cargo.toml)

- `notify = "7"` — Cross-platform filesystem watcher (for Tier 1 watcher)

### Frontend (package.json)

- No new npm dependencies needed
- Uses existing shadcn/ui components (popover, button, tooltip, separator, select)

### Bundled Assets

- None — comments stored as JSON in `.notesage/` directory

## Quality Gates

### Functional — Comments

- [ ] Can select text and add a comment via bubble menu or Cmd+Shift+M

- [ ] Comment highlight appears on the commented text range

- [ ] Clicking a highlight opens the comment popover with body, author, timestamp

- [ ] Can edit a comment's body text

- [ ] Can delete a comment (with confirmation)

- [ ] Comments persist across app restarts (sidecar JSON in `.notesage/comments/`)

- [ ] Comments survive document edits (positions remap correctly)

- [ ] Comments re-anchor correctly after closing and reopening a file

- [ ] Document UUID is lazily generated in frontmatter on first comment

- [ ] Document index (`.notesage/doc-index.json`) rebuilds on project open

- [ ] Comments survive file rename (UUID-based identity)

- [ ] Multiple comments on different text ranges in the same document work

### Functional — Git Branch Diff Review

- [ ] Can select a branch to compare against

- [ ] Changed files between branches are listed

- [ ] Opening a changed file shows inline diff decorations

- [ ] Insertions displayed with green background

- [ ] Deletions displayed with red strikethrough

- [ ] Per-hunk accept/reject buttons work correctly

- [ ] "Accept All" applies all changes from the branch diff

- [ ] "Reject All" clears all diff decorations

- [ ] Cmd+Enter / Cmd+Backspace accept/reject next change

- [ ] Accepting a hunk modifies editor content correctly

- [ ] Line-to-ProseMirror position mapping is accurate for headings, paragraphs, lists, code blocks

- [ ] Review state clears when switching to a non-diffed file

### Functional — Filesystem Watcher

- [ ] Watcher starts when a project folder is opened

- [ ] Editing a file in an external editor triggers detection

- [ ] Clean tabs auto-reload silently

- [ ] Dirty tabs show banner with "Reload" / "Keep"

- [ ] "Reload" replaces editor content with disk version

- [ ] "Keep" dismisses banner and marks tab dirty

- [ ] Notesage's own saves do NOT trigger false detection

- [ ] File tree updates when files are created/deleted externally

- [ ] Watcher is debounced — rapid changes don't cause event storms

- [ ] Sidebar shows external modification indicator

### Functional — Integration

- [ ] Comments and diff review work independently

- [ ] Existing AI suggestion decorations still work alongside comments and diffs

- [ ] Markdown round-trip test still passes (comments don't affect markdown content)

- [ ] Git status indicators still work alongside new indicators

- [ ] Export (PDF) still works — comments are not included in export

- [ ] Performance: watcher adds no perceptible latency to normal editing

- [ ] App starts in under 1 second with watcher enabled

### Design

- [ ] Comment highlight is subtle — does not compete with text readability

- [ ] Comment popover follows design system (neutral palette, rounded corners, proper spacing)

- [ ] External change banner is noticeable but not alarming

- [ ] Inline diff colors are consistent with AI suggestion extension

- [ ] All new UI works in both light and dark mode

- [ ] Transitions are smooth (popover open/close, banner appear/dismiss, diff show/hide)

- [ ] Sidebar indicators are visually distinct from git status letters

## Out of Scope

- Comment threading / nested replies — defer to Phase 6 when AI delegation needs it
- Resolve/unresolve workflow — defer to Phase 6
- Comment search, filtering, or global comment panel — future enhancement
- Side-by-side diff view — always inline in the editor
- Inline diff for filesystem watcher events (watcher is Tier 1: detect + reload/keep only)
- Three-way merge or automatic conflict resolution
- Git worktree creation/management from within Notesage (agents create their own)
- Comment export in PDF — comments are a workspace tool, not part of the document output
- Mobile or cross-device comment sync
- Raw markdown view (future feature — would reuse same inline diff rendering with different styling)
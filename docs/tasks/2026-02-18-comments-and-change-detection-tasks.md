# Task Breakdown: Comments & Change Detection (Phase 5)

**Status:** ✅ Complete

**PRD:** `docs/prds/2026-02-18-comments-and-change-detection.md`

## Summary

**17 tasks: 4S, 8M, 5L — All complete**

Three independent work streams:

- **Stream A — Comments** (Tasks 1–9): Document identity → store → extension → UI
- **Stream B — Git Branch Diff Review** (Tasks 10–15): Git commands → position mapping → extension → UI
- **Stream C — Filesystem Watcher** (Tasks 16–17): Rust backend → frontend hook

Streams are independent. Within each stream, tasks are sequential.

### Key Architecture Change (vs. original plan)

The primary diff mechanism is now **git branch diff**, not filesystem watching. AI agents work in git worktrees on separate branches — their changes are clean, structured `git diff` output. This is more reliable, line-based (maps naturally to ProseMirror blocks), and on-demand (no real-time event handling).

The filesystem watcher is simplified to **Tier 1 only**: detect external changes → prompt reload/keep. No inline diff for watcher events.

### Risks & Open Questions

- **Line-to-PM position mapping (Task 12)**: The core technical challenge. Markdown lines must map to ProseMirror block positions. Most cases are straightforward (paragraph = line), but multi-line constructs (code blocks, tables, blockquotes) need careful handling.
- **Hunk application order**: When accepting hunks out of order, positions shift. Must recalculate positions after each accept, or apply from bottom-to-top.
- **Comment re-anchoring**: Anchor text snippet provides fuzzy recovery for shifted positions. Edge cases exist (duplicated text, large rewrites). Start with simple substring search.
- **Decoration coexistence**: AI suggestions, comments, and branch diffs all use ProseMirror decorations. Must handle overlapping sets without conflicts.

---

## Tasks

### Stream A: Comments

#### Task 1 ✅ DONE — Add document UUID to frontmatter types

|  |  |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/lib/frontmatter.ts` |

**Description:** Extend the `Frontmatter` type with an optional `id: string` field. Add a helper `ensureDocumentId(frontmatter: Frontmatter | null): { frontmatter: Frontmatter; id: string }` that returns existing UUID or generates one via `crypto.randomUUID()`. This is "lazy generation" — only called when the first comment is created.

**Acceptance criteria:**

- `ensureDocumentId(null)` returns a new frontmatter object with just `{ id: '<uuid>' }`
- `ensureDocumentId({ title: 'foo' })` returns `{ title: 'foo', id: '<uuid>' }`
- `ensureDocumentId({ id: 'existing' })` returns the same ID unchanged
- UUID format is valid v4

---

#### Task 2 ✅ DONE — Create comment-store

|  |  |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | Task 1 |
| **Files** | `src/stores/comment-store.ts` (new) |

**Description:** Create a Zustand store for comment state. NOT persisted via Zustand middleware — comments are persisted to sidecar JSON files via Tauri commands.

**Store interface:**

```typescript
interface CommentStore {
  commentsByDocument: Record<string, Comment[]>;  // documentId → comments
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

**Comment I/O:** Read/write `.notesage/comments/{documentId}.json` using existing `read_file` / `write_file` Tauri commands. Create the `.notesage/comments/` directory if it doesn't exist (use `create_directory`).

**Acceptance criteria:**

- Can add, update, delete comments in memory
- `loadComments` reads from sidecar JSON (returns empty array if file doesn't exist)
- `saveComments` writes to sidecar JSON (creates directory if needed)
- `activeCommentId` tracks which comment popover is open

---

#### Task 3 ✅ DONE — Build document index utility

|  |  |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | Task 1 |
| **Files** | `src/lib/document-index.ts` (new) |

**Description:** Create utility functions to manage the document index (`.notesage/doc-index.json`), which maps document UUIDs to file paths.

**Functions:**

- `buildDocumentIndex(projectRoot: string): Promise<DocumentIndex>` — Scan all `.md` files in project, parse frontmatter, extract `id` fields, build map. Write to `.notesage/doc-index.json`.
- `updateDocumentIndex(projectRoot: string, uuid: string, filePath: string): Promise<void>` — Update a single entry.
- `loadDocumentIndex(projectRoot: string): Promise<DocumentIndex>` — Read existing index from disk.

**Implementation:** Use existing `list_directory` to find `.md` files, `read_file` to read them, `parseFrontmatter` to extract UUIDs.

**Acceptance criteria:**

- Index correctly maps UUIDs to absolute file paths
- Missing `.notesage/` directory is created automatically
- Files without `id` in frontmatter are skipped
- Index rebuilds on project open

---

#### Task 4 ✅ DONE — Trigger document index build on project open

|  |  |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | Task 3 |
| **Files** | `src/hooks/useProjectMetadata.ts`, `src/stores/project-store.ts` |

**Description:** When a project folder is opened, call `buildDocumentIndex()` in the background. Store the index in memory so comment operations can resolve UUIDs. Hook into existing `rename_path` operations to call `updateDocumentIndex` when a file is renamed.

**Acceptance criteria:**

- Document index builds silently on project open (no blocking UI)
- Index is available for comment operations
- File renames update the index entry

---

#### Task 5 ✅ DONE — Create comment-mark Tiptap extension

|  |  |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | Task 2 |
| **Files** | `src/components/editor/extensions/comment-mark.ts` (new), `src/components/editor/extensions/index.ts`, `src/hooks/useEditor.ts` |

**Description:** Create a Tiptap extension that renders comment highlights as ProseMirror decorations. Follow the `ai-suggestion.ts` pattern: PluginKey, plugin state, `Decoration.inline()`.

**Key design decisions:**

- Use `Decoration.inline()` (not a Mark node type) — avoids affecting markdown serialization
- Plugin state holds `Record<string, { from: number, to: number }>` keyed by comment ID
- Decorations use CSS class `comment-highlight` (not inline styles)
- Clicking a decoration dispatches a transaction with meta to open the comment popover
- Positions remap through document changes via `tr.mapping`

**Extension API (exported helpers):**

- `setCommentDecorations(editor, comments: Comment[])` — Rebuild all decorations from comment list
- `clearCommentDecorations(editor)` — Remove all
- `getCommentAtPos(editor, pos: number): Comment | null` — Find comment at cursor position

**Keyboard shortcut:** `Cmd+Shift+M` — Add comment on current selection

**Acceptance criteria:**

- Commented text ranges have a subtle highlight decoration
- Decorations survive document edits (positions remap)
- Multiple comments on different ranges display correctly
- Decorations don't interfere with AI suggestion decorations
- Clicking a highlighted range signals which comment was clicked
- Cmd+Shift+M triggers comment creation flow

---

#### Task 6 ✅ DONE — Create CommentPopover component

|  |  |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | Task 5 |
| **Files** | `src/components/editor/CommentPopover.tsx` (new) |

**Description:** A shadcn/ui `Popover` that appears when a user clicks on a comment highlight or creates a new comment. Anchored to the commented text position in the editor.

**States:** Create mode (empty textarea + "Add" button), View mode (body + author + timestamp + edit/delete), Edit mode (textarea pre-filled + "Save" / "Cancel").

**Styling:** Follow design system — neutral palette, rounded corners (8px), subtle shadow, proper padding. No chromatic colors. Transition on open/close.

**Acceptance criteria:**

- Popover opens anchored to the comment highlight position
- Can create a new comment with text
- Can view existing comment with body, author, relative timestamp
- Can edit comment body (inline, no dialog)
- Can delete comment (with confirmation via `alert-dialog`)
- Popover closes on click outside or Escape
- Works in both light and dark mode

---

#### Task 7 ✅ DONE — Add "Comment" button to BubbleMenu

|  |  |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | Task 5, Task 6 |
| **Files** | `src/components/editor/BubbleMenu.tsx` |

**Description:** Add a "Comment" button to the existing bubble menu, after the AI action buttons. Uses `MessageSquare` icon from lucide-react. Hidden when AI suggestion is active. Clicking opens CommentPopover in create mode.

**Acceptance criteria:**

- Comment button visible in bubble menu on text selection
- Button style matches existing AI action buttons
- Creates comment with correct anchor range and text
- Does not appear when AI suggestion is active

---

#### Task 8 ✅ DONE — Wire comment lifecycle (load, save, create, delete)

|  |  |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | Task 1, Task 2, Task 5, Task 6 |
| **Files** | `src/hooks/useCommentOperations.ts` (new), `src/components/editor/Editor.tsx` |

**Description:** Create a hook that orchestrates the full comment lifecycle:

1. **On file open**: Check if document has a UUID in frontmatter → if yes, load comments from sidecar JSON → set comment decorations in editor
2. **On comment create**: Ensure document has UUID (lazy generation) → update frontmatter → add to store → update decorations → save sidecar JSON
3. **On comment edit/delete**: Update store → update decorations → save sidecar JSON
4. **On file close**: Clear comment decorations for that document

**Critical detail — lazy UUID flow:** When creating the first comment on a document without an `id` frontmatter field, generate UUID → update frontmatter → mark tab dirty → update document index → then save comment.

**Acceptance criteria:**

- Comments load automatically when opening a file with existing comments
- First comment on a document generates UUID in frontmatter
- Comments persist across app restarts (sidecar JSON)
- Deleting all comments leaves the UUID in frontmatter
- Comment decorations update in real-time

---

#### Task 9 ✅ DONE — Add comment styles to editor.css

|  |  |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | Task 5 |
| **Files** | `src/styles/editor.css` |

**Description:** Add CSS classes for comment decorations. Must work in both light and dark modes.

**Classes:** `.comment-highlight` (subtle background), `.comment-highlight-active` (stronger when popover open).

**Constraints:** Readable, distinct from AI suggestion colors (red/green), works in both themes, subtle. Use neutral warm tones per design system.

**Acceptance criteria:**

- Comment highlights visible but subtle in both themes
- Active highlight is slightly more prominent
- Doesn't clash with AI suggestion decorations

---

### Stream B: Git Branch Diff Review

#### Task 10 ✅ DONE — Add git diff Tauri commands

|  |  |
| --- | --- |
| **Complexity** | L |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/src/commands/git.rs`, `src-tauri/src/lib.rs` |

**Description:** Add three new commands to the existing `git.rs`, using the established `git()` helper function pattern.

**Commands:**

```rust
/// List files changed between two branches
#[tauri::command]
pub async fn git_diff_files(
    repo_path: String,
    base_branch: String,
    compare_branch: String,
) -> Result<Vec<String>, String>
// Implementation: git diff --name-only base..compare

/// Get structured diff hunks for a single file between two branches
#[tauri::command]
pub async fn git_diff_file(
    repo_path: String,
    base_branch: String,
    compare_branch: String,
    file_path: String,
) -> Result<Vec<DiffHunk>, String>
// Implementation: git diff base..compare -- file_path
// Parse unified diff output into DiffHunk structs

/// List active worktrees and their branches
#[tauri::command]
pub async fn git_worktree_list(
    repo_path: String,
) -> Result<Vec<WorktreeInfo>, String>
// Implementation: git worktree list --porcelain
```

**Diff parsing:** Parse unified diff format (`@@ -oldStart,oldLines +newStart,newLines @@`) into `DiffHunk` structs. Extract the actual deleted/inserted text from the diff body (lines starting with `-` and `+`).

**Acceptance criteria:**

- `git_diff_files` returns correct list of changed files between branches
- `git_diff_file` returns structured hunks with correct line numbers and text
- `git_worktree_list` returns worktree paths and branch names
- Handles edge cases: no changes, binary files (skip), new files, deleted files
- Follows existing `git()` helper pattern in `git.rs`

---

#### Task 11 ✅ DONE — Create diff-review-store

|  |  |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | Task 10 |
| **Files** | `src/stores/diff-review-store.ts` (new) |

**Description:** Zustand store for git branch diff review state. Not persisted.

```typescript
interface DiffReviewStore {
  compareBranch: string | null;
  changedFiles: FileDiff[];
  reviewActive: boolean;

  startReview(repoPath: string, baseBranch: string, compareBranch: string): Promise<void>;
  endReview(): void;
  resolveHunk(filePath: string, hunkIndex: number, action: 'accept' | 'reject'): void;
  getFileDiff(filePath: string): FileDiff | null;
  hasUnresolvedHunks(filePath: string): boolean;
}
```

`startReview` calls `git_diff_files` to get changed file list, then `git_diff_file` for each file to get hunks.

**Acceptance criteria:**

- Can start a review against a branch (loads all diffs)
- Can end a review (clears state)
- Tracks which hunks have been resolved
- `getFileDiff` returns the diff for the currently open file

---

#### Task 12 ✅ DONE — Build line-to-ProseMirror position mapping

|  |  |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/lib/pm-line-map.ts` (new) |

**Description:** The core technical piece. Build a mapping from markdown line numbers to ProseMirror document positions.

**Approach:**

1. Serialize the editor content to markdown (via `getMarkdownFromEditor`)
2. Split markdown into lines
3. Walk the ProseMirror doc, tracking which block node corresponds to which markdown line
4. Build `lineNumber → { pmFrom, pmTo }` map

**Key insight:** Markdown lines map to PM block nodes:

- Paragraph line → paragraph node position
- `# Heading` → heading node position
- `- list item` → listItem node position
- Code block lines → positions within the codeBlock node
- Table rows → positions within table cells
- Empty lines → gaps between blocks (no PM position)

**Function signature:**

```typescript
interface LineMapping {
  pmFrom: number;  // Start of the block node
  pmTo: number;    // End of the block node
}

function buildLineMap(editor: Editor): Map<number, LineMapping>
```

**Implementation strategy:** Walk PM doc with `doc.descendants()`, serialize each block node to markdown, count how many lines it produces, and record the PM position range.

**Acceptance criteria:**

- Correct mapping for paragraphs, headings (H1-H6)
- Correct mapping for list items (bullet, ordered, task)
- Correct mapping for code blocks (multi-line → single PM node)
- Correct mapping for blockquotes
- Correct mapping for table rows
- Empty lines between blocks handled gracefully (skipped)
- Tested with a representative document covering all block types

---

#### Task 13 ✅ DONE — Create inline-diff Tiptap extension

|  |  |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | Task 12 |
| **Files** | `src/components/editor/extensions/inline-diff.ts` (new), `src/components/editor/extensions/index.ts`, `src/hooks/useEditor.ts` |

**Description:** A Tiptap extension that displays inline diffs as ProseMirror decorations. Generalizes the AI suggestion pattern to handle multiple hunks.

**Plugin state:**

```typescript
interface InlineDiffState {
  hunks: InlineDiffHunk[];
  decorations: DecorationSet;
  active: boolean;
}
```

**Decorations:**

- Deleted text: `Decoration.inline()` with red strikethrough (reuse AI suggestion CSS)
- Inserted text: `Decoration.widget()` with green background (reuse AI suggestion CSS)
- Per-hunk accept/reject buttons via `Decoration.widget()`

**Extension API:**

- `showInlineDiff(editor, hunks: InlineDiffHunk[])` — Apply diff decorations
- `clearInlineDiff(editor)` — Remove all diff decorations
- `acceptDiffHunk(editor, hunkId: string)` — Apply one hunk and remove its decoration
- `rejectDiffHunk(editor, hunkId: string)` — Remove decoration, keep current text
- `acceptAllDiffHunks(editor)` — Apply all remaining hunks
- `rejectAllDiffHunks(editor)` — Clear all decorations
- `hasActiveInlineDiff(editor): boolean`

**Keyboard shortcuts:** `Cmd+Enter` (accept next), `Cmd+Backspace` (reject next). Only fire when `!hasActiveSuggestion(editor)`.

**Critical: Hunk application.** When accepting a hunk, the editor content changes and subsequent hunk positions shift. Strategy: apply hunks from bottom-to-top (highest position first) so earlier positions aren't affected. Or recalculate positions after each accept via PM mapping.

**Acceptance criteria:**

- Diff decorations display correctly for insertions, deletions, and replacements
- Per-hunk accept/reject buttons work
- Accept modifies editor content correctly
- Accepting hunks out of order doesn't corrupt positions
- All decorations clear after all hunks are resolved
- Does not conflict with AI suggestion or comment decorations
- Keyboard shortcuts respect priority (AI suggestion &gt; inline diff)

---

#### Task 14 ✅ DONE — Create DiffReviewBanner component

|  |  |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | Task 13 |
| **Files** | `src/components/editor/DiffReviewBanner.tsx` (new), `src/components/editor/Editor.tsx` |

**Description:** Banner above the editor when reviewing a branch diff.

**Layout:**

```
┌──────────────────────────────────────────────────────┐
│ Reviewing changes from branch "agent-work" (4 hunks) │
│                          [Accept All]  [Reject All]  │
└──────────────────────────────────────────────────────┘
```

**Button behaviors:**

- **Accept All**: `acceptAllDiffHunks(editor)` → update diff-review-store
- **Reject All**: `rejectAllDiffHunks(editor)` → update diff-review-store

**Styling:** Neutral background (muted), no chromatic colors. Smooth slide-down animation. Shows branch name and hunk count.

**Acceptance criteria:**

- Banner appears when a file with diffs is active during review
- Accept All / Reject All work correctly
- Banner disappears when all hunks are resolved or review ends
- Shows branch name and remaining hunk count
- Smooth animation, works in both themes

---

#### Task 15 ✅ DONE — Create useDiffReview hook and branch selector UI

|  |  |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | Task 11, Task 12, Task 13, Task 14 |
| **Files** | `src/hooks/useDiffReview.ts` (new), `src/components/editor/Editor.tsx` |

**Description:** Hook that orchestrates the full diff review flow:

1. User picks a branch to compare (from branch list + worktree list)
2. Hook calls `startReview(branch)` → loads diffs for all changed files
3. When user opens a changed file, hook:
   - Gets the file's diff hunks from the store
   - Calls `buildLineMap(editor)` to get PM positions
   - Maps `DiffHunk` line numbers → `InlineDiffHunk` PM positions
   - Calls `showInlineDiff(editor, mappedHunks)`
4. On accept/reject, hook updates store and saves file if content changed
5. `endReview()` clears all state

**Branch selector UI:** A dropdown (shadcn `select`) in the toolbar or a button that opens a dialog. Shows branches with worktree indicators. Could be integrated with existing branch dropdown in git UI.

**Acceptance criteria:**

- Can start a review by selecting a branch
- Changed files are detected and listed
- Opening a changed file shows inline diff with correct positions
- Accepting a hunk saves the updated file content
- Review can be ended cleanly
- Branch selector shows worktree branches prominently

---

### Stream C: Filesystem Watcher

#### Task 16 ✅ DONE — Create filesystem watcher Tauri commands

|  |  |
| --- | --- |
| **Complexity** | M |
| **Category** | backend |
| **Dependencies** | None |
| **Files** | `src-tauri/Cargo.toml`, `src-tauri/src/commands/watcher.rs` (new), `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs` |

**Description:** Add `notify` crate and implement filesystem watching. Simplified scope — just detect changes and emit events.

**Commands:**

- `watch_directory(app, path)` — Watch project directory recursively, emit `file-changed` events
- `unwatch_directory(path)` — Stop watching
- `mark_self_write(path)` / `clear_self_write(path)` — Self-write filtering

**Implementation details:**

- Add `notify = { version = "7", features = ["macos_fsevent"] }` to Cargo.toml
- Debounce 500ms to coalesce rapid changes
- Self-write filter: `HashSet<PathBuf>` checked before emitting events
- Watcher handle stored in Tauri managed state
- Event payload: `{ path: String, kind: String }` where kind is `"modify"`, `"create"`, `"delete"`, `"rename"`

**Acceptance criteria:**

- External file edits trigger `file-changed` events
- Notesage's own saves do NOT trigger events
- Rapid changes are debounced
- Watcher cleans up on project close / app quit
- `cargo check` passes with new dependency

---

#### Task 17 ✅ DONE — Create useFileWatcher hook, banner, and sidebar indicators

|  |  |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | Task 16 |
| **Files** | `src/hooks/useFileWatcher.ts` (new), `src/components/editor/ExternalChangeBanner.tsx` (new), `src/components/sidebar/FileTreeItem.tsx`, `src/stores/editor-store.ts`, `src/hooks/useFileOperations.ts` |

**Description:** Frontend integration for filesystem watcher. Tier 1 behavior only.

**Hook (**`useFileWatcher`**):**

1. Listen for `file-changed` Tauri events
2. For open tabs with clean state: auto-reload silently
3. For open tabs with dirty state: call `setExternalChange(path, diskContent)` in editor-store
4. For create/delete events: trigger file tree refresh

**Banner (**`ExternalChangeBanner`**):**

```
┌──────────────────────────────────────────────────────┐
│ ⚠ This file was modified externally.  [Reload] [Keep]│
└──────────────────────────────────────────────────────┘
```

- Reload: replace editor content with disk version
- Keep: dismiss banner, mark tab dirty

**Save wrapping:** Modify `useFileOperations` to call `mark_self_write(path)` before save and `clear_self_write(path)` after.

**Editor-store extension:** Add ephemeral `externalChanges` state (not persisted).

**Sidebar indicator:** Small dot on `FileTreeItem` for externally modified files. Tooltip: "Modified externally". Clears when file is opened/reloaded.

**Acceptance criteria:**

- Clean tabs auto-reload silently on external change
- Dirty tabs show banner with Reload/Keep
- Saves don't trigger false positives
- Sidebar shows external modification indicator
- File tree refreshes on create/delete
- Banner animates smoothly, works in both themes

---

## Implementation Order

**Recommended sequence (streams are independent, can run in parallel):**

```
Stream A (Comments)           Stream B (Git Diff Review)      Stream C (Watcher)
─────────────────            ────────────────────────        ──────────────────
1. Frontmatter UUID (S)       10. Git diff commands (L)       16. Watcher backend (M)
2. Comment store (M)          11. Diff review store (M)       17. Watcher frontend (M)
3. Doc index utility (M)      12. Line-to-PM mapping (L)
4. Index on project open (S)  13. Inline diff extension (L)
5. Comment mark ext (L)       14. DiffReviewBanner (M)
9. Comment CSS (S)            15. useDiffReview hook (L)
6. CommentPopover (M)
7. Bubble menu button (S)
8. Comment lifecycle hook (L)
```

**Suggested start order:**

- Tasks 1, 10, 16 can all start simultaneously (no dependencies between streams)
- Stream B Task 12 (line mapping) has no dependencies and is the hardest technical piece — start early
- Stream C is the smallest scope and can ship independently
# External Change Review — Task Breakdown

**PRD:** [2026-02-20-external-change-review.md](2026-02-20-external-change-review.md)
**Status:** Complete
**Total: 10 tasks (3S, 5M, 2L) — all implemented**

All frontend — no Rust/Tauri backend work required.

## Tasks

### #1 — Create diff computation utility ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | None |
| **Files** | `src/lib/external-diff.ts` |

Built `computeExternalDiff(oldText, newText): ExternalDiffHunk[]` using `diff-match-patch` with semantic cleanup. Returns hunks with character offsets (`charFrom`, `charTo`, `deleteText`, `insertText`). Handles all edge cases: empty strings, pure insertions, pure deletions, full replacement.

---

### #2 — Create external-change-store ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #1 |
| **Files** | `src/stores/external-change-store.ts` |

Zustand store (non-persisted) with `addChange()`, `resolveChange()`, `setStatus()`, `setHunks()`, `getChange()`, `pendingCount()`, `allChanges()`. Statuses: `pending` → `deferred` (removed `reviewing` status during implementation — simpler model).

---

### #3 — Add PM position mapping for external diffs ✅

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | #1 |
| **Files** | `src/lib/external-diff.ts` |

Built `mapExternalChangeToPM(editor, newContent): InlineDiffHunk[]`. Extracts plain text with PM position mapping from both old (editor doc) and new (parsed markdown → PM doc) documents via `buildTextWithPositions()`. Diffs the plain texts and maps character offsets back to PM positions. Handles block separators, pure insertions at document end, and separator-spanning hunks.

---

### #4 — Refactor useFileWatcher to use external-change-store ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #2 |
| **Files** | `src/hooks/useFileWatcher.ts` |

Clean tabs call `addChange()` instead of old `setExternalChange()`. Dirty tabs unchanged (reload/keep banner). Git branch review active → auto-accept. Removed frontend `isSelfWrite` check — backend handles self-write suppression at the event source.

---

### #5 — Update Editor.tsx toast and review flow ✅

| Field | Value |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | #2, #3, #4 |
| **Files** | `src/components/editor/Editor.tsx` |

Implemented:
- Toast with Accept button (ghost style), close X, 8s auto-dismiss
- Inline diff decorations loaded immediately via `mapExternalChangeToPM()` + `showInlineDiff()`
- Tab-switch decoration load/unload with `requestAnimationFrame` (fixes race condition where pending-change effect fires before tab content is loaded)
- Accept All / Reject All handlers with race-condition guards (nullify ref → resolve store → dispatch transaction)
- Per-hunk accept/reject callbacks (`acceptDiffHunk`, `rejectDiffHunk`)
- Sync effect: transaction listener keeps store hunks in sync with PM plugin state, auto-resolves when all hunks cleared

**Implementation decisions:**
- Removed "Review" button — decorations always loaded immediately, simpler two-tier model
- Removed `ExternalReviewBanner` — caused confusion (dual toast + banner) and race conditions
- Removed frontend `markSelfWrite` calls — backend handles it, frontend guard caused false suppression
- Added `requestAnimationFrame` wrapper to pending-change effect — prevents diffing wrong tab content on tab switch

---

### #6 — Create ExternalReviewBanner ❌ Removed

Originally planned as a banner for "Review Now" mode. **Removed during implementation** — caused confusion (dual toast + banner UI) and race conditions. Accept All / Reject All moved to ChangeListPopover header instead.

---

### #7 — Create ChangeListPopover ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #2 |
| **Files** | `src/components/editor/ChangeListPopover.tsx` |

Wider popover (`w-96` / 384px) with cross-file layout:
- Header: "Pending Changes (N)" + Reject All / Accept All buttons
- Each row: `[filename] : [change preview]  [✓] [✗]`
- Filename truncated to 80px with full-path tooltip
- Change preview: red strikethrough (deleted) + green (inserted) text
- Per-hunk ✓/✗ buttons for focused file hunks (green/red on hover, muted grey background)
- Non-focused file hunks: click navigates to file + scrolls to hunk
- Popover stays open while browsing changes

---

### #8 — Add change tracker to StatusBar ✅

| Field | Value |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #7 |
| **Files** | `src/components/editor/StatusBar.tsx`, `src/components/editor/Editor.tsx` |

`RefreshCw` icon + hunk count in status bar right zone. Passes `activeFilePath`, `onAcceptHunk`, `onRejectHunk` through to ChangeListPopover for per-hunk controls. Hidden when no changes pending.

---

### #9 — Clean up old externalChanges ✅ (Partial)

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | #4, #5 |
| **Files** | `src/stores/editor-store.ts`, `src/components/editor/Editor.tsx`, `src/hooks/useFileWatcher.ts` |

Old `externalChanges` field in editor-store still used for dirty tab reload/keep banner flow. Frontend `self-write-guard.ts` is dead code (no longer imported). `ExternalReviewBanner.tsx` is dead code (no longer imported).

**Remaining cleanup (low priority):**
- Delete `src/lib/self-write-guard.ts`
- Delete `src/components/editor/ExternalReviewBanner.tsx`
- Consider migrating dirty-tab flow to external-change-store

---

### #10 — Write tests for diff computation ✅

| Field | Value |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | #1 |
| **Files** | `src/lib/__tests__/external-diff.test.ts` |

Unit tests for `computeExternalDiff` covering: identical strings, single word change, pure insertion, pure deletion, multiple scattered changes, whitespace changes.

---

## Risks — Resolved

1. **PM position mapping accuracy (#3):** Solved by extracting plain text from PM documents on both sides (old and new) and diffing those, rather than mapping markdown character offsets. `buildTextWithPositions` builds a reliable char-to-PM-position map.

2. **Decoration layer conflict:** Git branch review takes priority — external changes auto-accept when git review is active. Tested and working.

3. **Toast API:** Sonner's `cancel` prop works for the Accept button. `closeButton: true` adds an X. `onDismiss` fires on both manual dismiss and auto-close. Custom CSS positions close button top-right as flat window-style X.

4. **Tab-switch race condition:** Fixed with `requestAnimationFrame` — ensures editor content is loaded before computing diffs.

5. **Self-write false suppression:** Fixed by removing redundant frontend guard — backend suppression is the single source of truth.

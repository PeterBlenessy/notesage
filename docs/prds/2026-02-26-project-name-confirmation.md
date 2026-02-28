# Project Name Rename Confirmation

**Date:** 2026-02-26 **Status:** Done **Parent:** Phase 6.5 — Chat UX & Agent Polish

## Problem

In Project Settings, renaming the project name immediately updates the Zustand store on every keystroke and triggers a filesystem rename on blur. This has several issues:

1. **Accidental renames**: Clicking away from the input triggers the rename — users may not intend to commit a half-typed name.
2. **No cancel path**: Once the user starts typing, the only way to undo is to manually retype the original name.
3. **No visual feedback**: There's no indication that a rename is pending or that the user needs to confirm.

## Goals

- Decouple the name input from the store — edits stay local until explicitly confirmed
- Show inline confirm (check) and cancel (X) icons when the name differs from the current folder name
- Support keyboard shortcuts: Enter to confirm, Escape to cancel
- Show a loading spinner during the rename operation
- Clicking outside without confirming preserves the edited text (no accidental rename)

## Non-Goals

- Renaming projects from the sidebar (separate feature)
- Undo/redo for rename operations
- Rename validation beyond duplicate folder detection

## User Stories

- As a user, I want to see confirm/cancel buttons when I edit the project name, so I know the rename hasn't happened yet.
- As a user, I want to press Enter to confirm or Escape to cancel, so I can rename quickly via keyboard.
- As a user, I want clicking outside the input to NOT trigger a rename, so I don't accidentally rename my project.
- As a user, I want to see a spinner while the rename is in progress, so I know the operation is happening.

## Technical Approach

### Local State

Add `localName` state initialized from `metadata.name`. A `useEffect` syncs `localName` when `metadata.name` changes externally (e.g., after a successful rename updates the store).

### Input Decoupling

- `onChange` updates `localName` only — not the store
- Remove `onBlur` handler that triggers rename
- Store is only updated after a successful rename operation

### Inline Confirm/Cancel Icons

When `localName !== metadata.name`:

- **Check icon** (confirm): triggers the rename flow (existing `handleNameBlur` logic)
- **X icon** (cancel): resets `localName` to `metadata.name`
- Icons placed in a flex row to the right of the input

### Keyboard Support

- **Enter**: confirms rename (same as clicking check)
- **Escape**: cancels edit (same as clicking X)

### Loading State

- While `renaming` is true: show `Loader2` spinner on check icon, disable input and cancel button

### Icons

`Check`, `X`, `Loader2` from lucide-react (already available in the project).

### Styling

- Muted icon buttons with hover states
- No chromatic colors — consistent with the strictly neutral design system
- Smooth transitions on icon appear/disappear

## Files Changed

- `src/components/settings/ProjectSettings.tsx` — all changes contained here

## Verification

- Type a new name → check/X icons appear
- Click X or Escape → reverts to original name
- Click check or Enter → renames folder, icons disappear
- Click outside without confirming → name stays edited, no rename
- Rename to existing folder name → shows error toast, reverts
- Works in both light and dark mode
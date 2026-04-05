# UI/UX Polish Tasks

|  |  |
| --- | --- |
| **Date** | 2026-04-05 |
| **Status** | Complete |
| **PRD** | [ui-ux-polish](../prds/2026-04-05-ui-ux-polish.md) |
| **Total** | 20 tasks: 12S, 7M, 1L |
| **Suggested order** | Confirmations (#1-#4) → Accessibility (#5-#7) → Empty states (#8-#12) → Discoverability (#13-#14) → Visual polish (#15-#18) → Error handling (#19-#20) |

**Risks:**

- Dirty tab close (#1-#2) changes synchronous `window.confirm()` to async `AlertDialog` — the close handler in TabBar must become async with pending state, which changes control flow
- File tree ARIA (#5) touches `FileTreeItem` which renders hundreds of times — test with large trees
- Chat empty state (#11) may need design iteration for prompt chip layout

---

## Tier 1: Replace `window.confirm()` with AlertDialog

### #1 — Replace dirty tab close confirm in TabBar ✅

**Description:** Replace `window.confirm("This file has unsaved changes. Close anyway?")` at `TabBar.tsx:44` with a shadcn `AlertDialog` offering three actions: **Save & Close** (primary), **Discard** (destructive), **Cancel**. Add `pendingCloseTabId` local state. When close is clicked on a dirty tab, set pending state and show dialog. On Save & Close: call `saveFile()` then close. On Discard: close without saving. On Cancel: clear pending state.

Follow the existing `AlertDialog` pattern in `FileTreeItem.tsx:632-651`.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/tabs/TabBar.tsx`

---

### #2 — Replace dirty tab close confirm in useKeyboardShortcuts ✅

**Description:** The Cmd+W handler at `useKeyboardShortcuts.ts:46` duplicates the same `window.confirm()` pattern. Since TabBar now owns the AlertDialog, extract the close-with-confirmation logic into a shared callback (e.g., `requestCloseTab(tabId)` exposed from TabBar or a shared hook) that both TabBar click and Cmd+W can call.

Alternatively, have Cmd+W dispatch the same pending-close state that TabBar's dialog reads.

**Complexity:** M | **Category:** frontend | **Dependencies:** #1

**Files:** `src/hooks/useKeyboardShortcuts.ts`, `src/components/tabs/TabBar.tsx`

---

### #3 — Add confirmation dialog for prompt delete ✅

**Description:** Replace `confirm('Are you sure you want to delete this prompt?')` at `PromptsSettings.tsx:55` with a shadcn `AlertDialog`. Show the prompt name in the dialog: "Delete '{name}'?" with Cancel and **Delete** (destructive variant) buttons.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/settings/PromptsSettings.tsx`

---

### #4 — Add confirmation dialog for template delete ✅

**Description:** `handleDeleteTemplate` at `ExportDialog.tsx:156` deletes immediately with no confirmation. Wrap in an `AlertDialog`: "Remove template '{name}'? This cannot be undone." with Cancel and **Remove** (destructive variant) buttons. Add `pendingDeleteTemplate` local state to track which template is being confirmed.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/ExportDialog.tsx`

---

## Tier 2: Accessibility

### #5 — Add ARIA tree view roles to FileTree ✅

**Description:** Implement W3C APG tree view pattern:

- `FileTree.tsx`: Add `role="tree"` and `aria-label="File explorer"` to the container div
- `FileTreeItem.tsx`: Add `role="treeitem"` to the interactive div (line \~376)
- Folder items: Add `aria-expanded={isExpanded}` (omit for files)
- All items: Add `aria-label` with name and type (e.g., `"docs, folder"` or `"readme.md"`)
- Children wrapper: Add `role="group"` on the nested children container
- Decorative icons (chevron, file type): Add `aria-hidden="true"`

Test with VoiceOver: navigate tree, verify folder expand/collapse announced.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/sidebar/FileTree.tsx`, `src/components/sidebar/FileTreeItem.tsx`

---

### #6 — Make chat message action buttons keyboard-accessible ✅

**Description:** Four locations in `ChatMessage.tsx` (lines 225, 267, 312, 692) use `opacity-0 group-hover:opacity-100` making action buttons invisible to keyboard users. Add `group-focus-within:opacity-100` so Tab navigation reveals them:

```
opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity
```

Verify each button already has proper `focus-visible` ring styling.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/chat/ChatMessage.tsx`

---

### #7 — Add ARIA attributes to decorative icons across sidebar ✅

**Description:** Audit sidebar components for decorative icons (chevrons, file type icons, git status icons) that lack `aria-hidden="true"`. Add the attribute to prevent screen readers from announcing decorative SVGs.

Check: `FileTreeItem.tsx`, `ExplorerFolderItem.tsx`, `ProjectItem.tsx`, `QuickNotesSection.tsx`.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/sidebar/FileTreeItem.tsx`, `src/components/sidebar/ExplorerFolderItem.tsx`, `src/components/sidebar/ProjectItem.tsx`

---

## Tier 3: Empty States

### #8 — Improve QuickNotesSection empty state ✅

**Description:** Replace "Notes in \~/Notesage" (line \~58) with: "No notes yet" + an underlined "Create a note" action link that triggers the same new note handler as the section's add button. Use `text-xs text-muted-foreground` for the text and `text-xs underline cursor-pointer` for the link.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/sidebar/QuickNotesSection.tsx`

---

### #9 — Improve ProjectsSection empty state ✅

**Description:** Replace "No projects open" (line \~89) with: "No projects yet" + an underlined "New Project" action link that opens the New Project dialog. Same styling pattern as #8.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/sidebar/ProjectsSection.tsx`

---

### #10 — Improve FoldersSection empty state ✅

**Description:** Keep existing "Open a folder to browse files" text but add an underlined "Open Folder" action link below it that triggers the folder open dialog. Same styling pattern as #8.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/sidebar/FoldersSection.tsx`

---

### #11 — Redesign chat empty state with onboarding ✅

**Description:** Replace the generic "Start a conversation with AI" text at `ChatMessageList.tsx:155-165` with a structured onboarding card:

- Brief heading: "Start a conversation"
- 2-3 clickable prompt chips (e.g., "Summarize my current note", "Help me brainstorm ideas", "Review this document") that pre-fill the chat input when clicked
- Muted hint: "Type / for skills, @ for agents"
- Keep the existing `LocalAISetupCard` below when applicable

Prompt chips should use `outline` button variant at `text-xs` size.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/chat/ChatMessageList.tsx`, `src/components/chat/ChatInput.tsx` (for pre-fill integration)

---

### #12 — Add mode-specific empty states to CommandPalette ✅

**Description:** Replace generic empty text with mode-specific guidance:

| Mode | Current | New |
| --- | --- | --- |
| Tags | "No matching tags." | "Tags are created by typing #tagName in your notes" |
| Mentions | "No matching mentions." | "Mentions are created by typing @name in your notes" |
| Research | "No research files found." | "Create research files with the download-webpage skill" |
| Default | "No results found." | "No results — try a different search term" |

Update the `emptyText` logic at `CommandPalette.tsx:412-422`.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/CommandPalette.tsx`

---

## Tier 4: Feature Discoverability

### #13 — Add syntax hints below ChatInput ✅

**Description:** Add muted hint text below the chat textarea: "Type `/` for skills, `@` for agents". Auto-hide after the user sends their first message via a persisted flag `chatHintsShown` in `settings-store`. Use `text-[10px] text-muted-foreground` styling.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/chat/ChatInput.tsx`, `src/stores/settings-store.ts`

---

### #14 — Keep Command Palette prefix mode hints visible ✅

**Description:** Currently, the prefix mode hints (`#tags`, `@mentions`, `>commands`, `?research`) in the Command Palette footer disappear when a prefix mode is active. Keep them visible in all modes. When in a prefix mode, replace the current mode's hint with "← Backspace to return".

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/CommandPalette.tsx`

---

## Tier 5: Visual Polish

### #15 — Add zero-match styling to FindBar ✅

**Description:** When `matchCount === 0 && query.length > 0`, add `border-destructive/50` class to the search input and change "No results" text to `text-destructive`. Add `transition-colors duration-150` for smooth feedback.

Pattern: VS Code, Sublime, Safari all use red/warning border for no matches.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/editor/FindBar.tsx`

---

### #16 — Add transition to table toolbar appearance ✅

**Description:** Add `animate-in fade-in duration-150` to the `TableToolsPopover` appearance in the Toolbar so it doesn't appear/disappear abruptly when the cursor enters/leaves a table. Match the existing FindBar animation timing.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/editor/Toolbar.tsx`

---

### #17 — Normalize disabled opacity across components ✅

**Description:** Audit and standardize disabled states to `disabled:opacity-50` everywhere. Currently inconsistent: some use `opacity-30`, others `opacity-50`, others custom values.

Check: Toolbar buttons, ChatInput send button, settings toggles, tab close buttons.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/editor/Toolbar.tsx`, `src/components/chat/ChatInput.tsx`, various button components

---

### #18 — Add drag-expand pulse feedback to FileTreeItem ✅

**Description:** When the 600ms drag-expand timer is active on a folder (line \~278 in `FileTreeItem.tsx`), add an `animate-pulse` class to the folder's container div. Remove on timer clear. This gives visual feedback that the folder is about to auto-expand.

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/sidebar/FileTreeItem.tsx`

---

## Tier 6: Error Handling

### #19 — Improve error messages in FileTreeItem ✅

**Description:** Four changes:

1. **Delete dialog** (line \~635): Show child count for folders — "Delete 'docs' and its 47 files?" Use `list_directory` to count before showing the dialog.
2. **Rename failure** (line \~148): Show error toast instead of silent `console.error()`.
3. **Delete failure** (line \~163): Parse common filesystem errors into friendly messages ("Permission denied", "File not found", "Disk full") instead of raw `${error}`.
4. **Move failure** (line \~214): Same error parsing.

Create a small `parseFileError(error: unknown): string` utility for consistent error messages.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/sidebar/FileTreeItem.tsx`, `src/lib/file-errors.ts` (new utility)

---

### #20 — Add recovery actions to AI error toasts ✅

**Description:** In `BubbleMenu.tsx` (line \~91), when AI actions fail, add a Sonner `action` button pointing to Settings &gt; Connections: `toast.error("AI action failed", { action: { label: "Check settings", onClick: openSettings } })`. Use Sonner's existing `action` parameter — no new dependencies.

Also audit other AI error toasts in `useDirectApiChat.ts` and `useAIOperations.ts` for similar improvements.

**Complexity:** M | **Category:** frontend | **Dependencies:** None

**Files:** `src/components/editor/BubbleMenu.tsx`, `src/hooks/useDirectApiChat.ts`, `src/hooks/useAIOperations.ts`
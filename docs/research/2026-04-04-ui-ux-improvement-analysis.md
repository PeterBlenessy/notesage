# Notesage UI/UX Improvement Analysis

**Date:** 2026-04-04
**Scope:** 30+ components across sidebar, editor, chat, settings, and dialog layers
**Findings:** 42 improvement opportunities in 9 categories

## Executive Summary

Notesage has a sophisticated, well-structured UI, but it **prioritizes power users over new users**, has **accessibility gaps that break screen reader workflows**, and **misses onboarding moments** where empty states and discoverability hints could guide users. The biggest wins are low-effort, high-return changes to empty states, confirmation dialogs, and ARIA attributes.

---

## 1. Empty States: Passive Text vs. Actionable Guidance

**The Problem:** Sidebar, chat, and command palette empty states display passive text that doesn't guide users toward action. This creates what Figma's design team calls the "blank slate anti-pattern" — a screen indistinguishable from a loading failure.

### Current State

| Component | File:Line | Current Text | Issue |
|-----------|-----------|-------------|-------|
| Quick Notes | `QuickNotesSection.tsx:58` | "Notes in ~/Notesage" | Just shows a path — no call to action |
| Projects | `ProjectsSection.tsx:89` | "No projects open" | Minimal, no guidance |
| Folders | `FoldersSection.tsx:83` | "Open a folder to browse files" | Better, but still just text |
| Chat | `ChatMessageList.tsx:156-165` | "Start a conversation with AI." | Generic, unexplained `LocalAISetupCard` |
| Command Palette | `CommandPalette.tsx:403-410` | "No results found." / "No matching tags." | No suggestions for what to try next |

### UX Pattern Research

**Apple HIG:** Empty states should briefly explain what will appear and how to get started, using the content area itself rather than alerts.

**VS Code:** Sidebar shows "You have not yet opened a folder" with an **"Open Folder" button directly inline**. The empty state IS the creation affordance.

**Notion:** Pre-populates with a "Getting Started" template page — the workspace is never truly empty on first launch.

**ChatGPT:** Center-screen greeting with **suggested prompt chips**. The empty state teaches by example.

**Craft:** Shows "Create a new document" as a tappable card in the document list. Emptiness becomes an invitation.

**Linear's principle:** Empty states are onboarding moments, not dead ends. Every empty screen should answer two questions: "What is this?" and "What do I do next?"

**Figma's rule:** If removing the empty state text would make the screen indistinguishable from a loading failure, the empty state is insufficient.

### Recommendations

| Component | Recommendation |
|-----------|---------------|
| Sidebar sections | Replace passive `<p>` text with "No [items] yet." + underlined action link that triggers the same handler as the section's add button (pattern: VS Code sidebar) |
| Chat empty state | Add structured onboarding with 2-3 suggested prompt chips and a hint about `/` and `@` syntax (pattern: ChatGPT, Cursor) |
| Command Palette | Mode-specific empty text: "Tags are created by typing #tagName in your notes", "Try a different search term", "Create research files with the download-webpage skill" |

---

## 2. Destructive Actions Without Proper Confirmation

**The Problem:** Three locations use browser-native `window.confirm()` or skip confirmation entirely for destructive actions. This breaks the premium app feel and violates platform conventions.

### Current State

| Location | File:Line | Issue |
|----------|-----------|-------|
| Template delete | `ExportDialog.tsx:156,312` | `handleDeleteTemplate` deletes immediately on click — zero confirmation |
| Tab close (dirty) | `TabBar.tsx:44` | `window.confirm("This file has unsaved changes. Close anyway?")` |
| Prompt delete | `PromptsSettings.tsx:55` | `confirm('Are you sure you want to delete this prompt?')` |

### UX Pattern Research

**Why `confirm()` is wrong for desktop apps:**
- Looks foreign — unstyled system chrome breaks visual consistency
- Blocks the entire JS thread (synchronous)
- Cannot be customized (no red destructive button, no icons, no rich content)
- Has generic "OK/Cancel" labels instead of verb-specific actions
- Cannot show contextual information (what exactly is being deleted)

**Apple HIG:** Use confirmation only when the action is irreversible and has significant consequences. Prefer undo for reversible actions — it's faster and less disruptive. macOS uses "Move to Trash" (undoable) instead of permanent delete by default.

**Material Design:** Same principle — "Allow undo" is preferred over "Ask for confirmation." Snackbar with undo action for deletions, confirmations reserved for truly irreversible operations (account deletion, publishing).

**Linear:** Deletes issues immediately with an **undo toast** (bottom-left, ~5s). No confirmation dialog. "Delete permanently" from Trash uses a minimal dialog with a red "Delete" button.

**VS Code:** Closing unsaved files shows a **three-button dialog**: Save / Don't Save / Cancel. File delete from Explorer shows confirmation with the filename visible.

**Notion:** Page delete moves to Trash instantly with an undo toast. "Delete permanently" from Trash shows a confirmation dialog. Bulk operations show count ("Delete 12 pages?").

**The unsaved changes pattern:** Every premium app (VS Code, Sublime, Bear, Xcode) uses a three-option dialog: **Save** (primary) / **Don't Save** (secondary, sometimes red) / **Cancel** (tertiary). Showing the filename is standard.

### Recommendations

| Location | Fix |
|----------|-----|
| `ExportDialog.tsx` | Add `AlertDialog` confirmation before `handleDeleteTemplate`: "Remove template '{name}'? This cannot be undone." with Cancel / Remove buttons |
| `TabBar.tsx` | Replace `window.confirm` with an `AlertDialog` using three actions: **Save & Close** / **Discard** (destructive) / **Cancel** |
| `PromptsSettings.tsx` | Replace `confirm()` with `AlertDialog`: "Delete '{promptName}'?" with Cancel / **Delete** (destructive styling) |

All three should use the existing shadcn `AlertDialog` already imported in `FileTreeItem.tsx` for visual consistency.

---

## 3. Accessibility: Tree View & Interactive Elements

**The Problem:** The file tree lacks ARIA roles required by the W3C APG tree view pattern, making it invisible to screen readers. Chat action buttons are hover-only, excluding keyboard users entirely.

### Current State

| Component | File:Line | Gap |
|-----------|-----------|-----|
| FileTreeItem | `:307-308` | Has `tabIndex={0}` and `aria-current` but missing `role="treeitem"`, `aria-expanded`, `aria-label` |
| Chevron icons | `:322-332` | Decorative icons lack `aria-hidden="true"` |
| ChatMessage actions | `ChatMessage.tsx` | Edit/resend/copy/branch buttons use `opacity-0 group-hover:opacity-100` — invisible to keyboard and screen reader users |
| BubbleMenu | `BubbleMenu.tsx` | AI suggestion acceptance hotkeys shown without context about what "AI suggestion" means |
| Toolbar | `Toolbar.tsx` | No keyboard-only navigation through toolbar buttons |

### UX Pattern Research

**W3C APG Tree View Pattern (the standard):**
- Container: `role="tree"`
- Each node: `role="treeitem"`
- Nested groups: `role="group"` on wrapper
- Required states: `aria-expanded="true/false"` on expandable nodes, `aria-selected` for selection
- Keyboard: Arrow Up/Down moves focus, Arrow Right expands/enters children, Arrow Left collapses/moves to parent, Home/End jump to first/last node, Enter activates, type-ahead character search

**VS Code:** Full ARIA tree implementation matching the APG spec exactly, multi-select via Shift/Cmd+click with `aria-multiselectable`. Focus is visually indicated with a highlight band. This is the gold standard for web-based file trees.

**macOS Finder:** Uses NSOutlineView which maps to AX roles automatically. VoiceOver announces "N items, expanded/collapsed" per folder.

**Common gap the spec warns against:** Many web-based file trees (GitHub, GitLab) use clickable divs without tree roles, breaking screen reader navigation entirely. Notesage currently falls into this category.

### Recommendations

| Fix | Details |
|-----|---------|
| Add `role="treeitem"` | On each `FileTreeItem`'s interactive div |
| Add `aria-expanded` | `aria-expanded={expanded}` on folder items, omit for files |
| Add `aria-label` | `"${entry.name}, folder"` for directories, `entry.name` for files |
| Add `aria-hidden="true"` | On decorative chevron icons and file type icons |
| Make chat actions focusable | Change from hover-only visibility to `focus-within:opacity-100` so keyboard Tab reveals them |
| Add `role="tree"` | On the FileTree container div |

---

## 4. Feature Discoverability: Hidden Power Features

**The Problem:** The `/` (skills) and `@` (agents) prefix menus in ChatInput are powerful but completely hidden. Users must discover them by accident or read documentation. The same applies to Command Palette prefix modes (`#`, `@`, `>`, `?`).

### Current State

| Feature | File:Line | Discovery Method |
|---------|-----------|-----------------|
| Skill menu | `ChatInput.tsx:87-94` | Type `/` as first character — no hint |
| Agent menu | `ChatInput.tsx:97-103` | Type `@` as first character — no hint |
| Palette tag mode | `CommandPalette.tsx:667-703` | Footer hint only visible in default mode |
| Palette prefix modes | `CommandPalette.tsx` | `#`, `@`, `>`, `?` shortcuts shown in footer then hidden when active |
| Inline completions | `StatusBar.tsx` | Toggle buried 3 levels deep in a popover |

### UX Pattern Research

**Notion:** The empty page shows **"Type / for commands"** as grey placeholder text directly in the content area. This single line teaches the core interaction pattern.

**Cursor:** Shows a thin contextual hint bar above the input — "Use @ to add context" — that **fades after first use**. Elegant progressive disclosure.

**Slack:** Typing `/` shows a scrollable command list with descriptions grouped by app. A first-launch tooltip points to the `/` affordance. Input placeholder says "Message #channel" but a lightning bolt icon hints at shortcuts.

**Discord:** New users see a **one-time popover**: "Try typing / to see commands." This disappears permanently after dismissal.

**ChatGPT:** Uses a **placeholder text rotation** ("Ask anything...") plus visible icons for attachments and search in the input bar.

**Linear:** `@` shows team members, `#` shows projects. Both appear as filtered popovers with avatar/icon, description, and keyboard navigation. The input has subtle icon affordances.

### Recommendations

| Fix | Pattern Source |
|-----|---------------|
| Add hint text below ChatInput textarea: "Type `/` for skills, `@` for agents" in muted text, auto-hide after first use | Cursor's fade-after-first-use hint |
| Rotate placeholder text: "Ask anything...", "Type / for skills...", "Type @ to address an agent..." | ChatGPT placeholder rotation |
| Keep Command Palette mode hints visible in all modes, showing "Backspace to return" when in a prefix mode | Notion's persistent affordances |

---

## 5. Loading & Feedback Gaps

**The Problem:** Several async operations lack visual feedback, creating moments where users aren't sure if their action registered.

### Current State

| Location | File | Gap |
|----------|------|-----|
| Tab switching | `Editor.tsx` | No visual indicator when restoring EditorState from cache |
| BubbleMenu AI actions | `BubbleMenu.tsx` | `disabled={loadingAction !== null}` blocks ALL actions when any single one is loading |
| Slash command `/image` | `SlashCommand.tsx` | Triggers async dialog — user sees nothing for a moment |
| File tree drag-expand | `FileTreeItem.tsx:278` | 600ms timeout to auto-expand with no visual feedback |
| Chat skill loading | `ChatInput.tsx:106-110` | Send button has no loading state during skill resolution |

### UX Pattern Research

**Nielsen Norman Group:** Users perceive waits >100ms as a delay and >1000ms as requiring explicit feedback. The 600ms drag-expand timeout sits right in the "needs feedback" zone.

**VS Code:** Tab switching shows a brief loading indicator in the editor area. File tree drag-over shows a highlighted drop target with an expand timer visualized as a subtle pulse.

**Linear:** All async operations show immediate optimistic UI updates with graceful error recovery.

### Recommendations

- Disable only the specific loading action in BubbleMenu, not all actions
- Add a subtle pulse or highlight animation during the drag-expand 600ms timer
- Show a brief loading state on the send button while skill content is being resolved

---

## 6. Visual Hierarchy: Dense Status Bar & Abrupt UI Changes

**The Problem:** The status bar can display up to 11 different indicators simultaneously. Table toolbar appears/disappears without transition. FindBar shows no visual emphasis when search finds zero matches.

### Current State

| Component | File | Issue |
|-----------|------|-------|
| StatusBar | `StatusBar.tsx` | 11 indicator types possible — overwhelming density |
| Table toolbar | `Toolbar.tsx` | `TableToolsPopover` appears/disappears abruptly when cursor enters/leaves a table |
| FindBar | `FindBar.tsx:132-133` | Zero matches shows "No results" text but no visual styling change |

### UX Pattern Research

**VS Code Find:** Match count badge right-aligned inside the input. Input border turns **red** with "No results" text when zero matches. Regex/case/whole-word toggles are inline icon buttons.

**Sublime Text:** No-match state highlights the input background in a soft red tint.

**Safari:** Match count as pill inside search field. Zero matches shows "Not Found" in the pill with distinct styling.

**Common pattern across all premium search UIs:** Red or warning-colored input border/background for zero results, neutral badge for match count. The visual change is immediate and unmissable.

### Recommendations

| Fix | Details |
|-----|---------|
| FindBar zero-match styling | Add `border-destructive/50` class to search input when `matchCount === 0 && query.length > 0` |
| Table toolbar transition | Add `animate-in fade-in` to table tools popover, matching the existing FindBar animation |
| StatusBar density | Consider grouping secondary indicators (reading time, word count) behind a hover/click expansion |

---

## 7. Error Handling: Raw Errors & Missing Recovery

**The Problem:** Error messages surface raw error objects and provide no recovery path.

### Current State

| Location | File:Line | Issue |
|----------|-----------|-------|
| File delete | `FileTreeItem.tsx:164` | `` toast.error(`Failed to delete: ${error}`) `` — raw error object |
| AI actions | `BubbleMenu.tsx` | Failure toast with no guidance to check Settings > Connections |
| Rename | `FileTreeItem.tsx:148` | Silently closes input + console.error only |
| Delete dialog | `FileTreeItem.tsx:604` | No indication of how many files a folder contains |
| All error toasts | Everywhere | No retry button on any error toast |

### UX Pattern Research

**Linear:** Error toasts include an action button ("Try again" or "Go to settings"). Never shows raw error strings.

**Notion:** "Something went wrong" with a "Retry" button. Details available in a collapsible section for power users.

**Sonner (already in use):** Supports `action` parameter for adding buttons to toasts — Notesage already has the library, just isn't using this feature.

### Recommendations

- Parse common filesystem errors into user-friendly messages ("Permission denied", "File not found", "Disk full")
- Add retry actions to error toasts using Sonner's `action` parameter
- Show folder child count in delete confirmation: "This will permanently delete 'docs' and its 47 files"
- AI action failures should suggest: "Check your AI connection in Settings"

---

## 8. Consistency Gaps

| Pattern | Inconsistency | Where |
|---------|--------------|-------|
| Disabled opacity | `opacity-30` vs `opacity-50` vs `disabled:opacity-50` | Toolbar, ChatInput, various |
| Confirm dialogs | `window.confirm()` vs `AlertDialog` vs no-confirmation | TabBar, PromptsSettings, ExportDialog |
| Button sizing | `h-6 w-6` vs `size="sm"` vs custom className | ChatInput, Settings, Toolbar |
| Tooltip delay | 300ms in Toolbar, default elsewhere | Toolbar vs all other components |
| Empty state styling | `<p>` text vs centered cards with icons | Sidebar vs EditorEmptyState |

### Recommendation

Establish a component usage guide in the design system doc:
- Disabled state: always `disabled:opacity-50`
- Confirm dialogs: always shadcn `AlertDialog`, never `window.confirm()`
- Icon button sizing: `h-7 w-7 p-0` for toolbar-density, `h-8 w-8 p-0` for settings-density
- Tooltip delay: 300ms globally (add to TooltipProvider defaults)

---

## 9. Performance Considerations

| Location | Issue | Severity |
|----------|-------|----------|
| Sidebar FileTree | No virtual scrolling — all items in DOM | Low (only impacts 1000+ file projects) |
| Sidebar overlay | DOM sniffing via `document.querySelector('[data-state="open"]')` for menu detection — fragile, relies on Radix internals | Low (stability risk) |
| `FileTreeItem.tsx` memo | Custom equality check is thorough but parent re-renders cascade | Low |

These can be deferred. Virtual scrolling only matters for unusually large projects.

---

## Implementation Priority Matrix

| # | Change | Impact | Effort | Pattern Source |
|---|--------|--------|--------|---------------|
| 1 | Replace `window.confirm()` with `AlertDialog` in TabBar + PromptsSettings | High | Low | VS Code, Apple HIG |
| 2 | Add confirmation dialog for PPTX template delete in ExportDialog | High | Low | Figma, Linear |
| 3 | Add `aria-expanded`, `aria-label`, `role="treeitem"` to FileTreeItem | High | Low | W3C APG, VS Code |
| 4 | Improve sidebar empty states with action links | High | Low | VS Code, Craft |
| 5 | Add `/` and `@` syntax hints to ChatInput | High | Low | Notion, Cursor, Slack |
| 6 | Make ChatMessage action buttons keyboard-accessible | High | Medium | WCAG 2.1 AA |
| 7 | Add red border styling to FindBar on zero matches | Medium | Low | VS Code, Sublime, Safari |
| 8 | Improve CommandPalette empty states per mode | Medium | Low | Linear, Figma |
| 9 | Enhance ChatMessageList empty state with onboarding | Medium | Medium | ChatGPT, Cursor |
| 10 | Add hover/focus states to EditorEmptyState cards | Medium | Low | Craft, Linear |

Items 1-5, 7-8, and 10 are all **low-effort, high-return** changes that could ship in a single PR. Items 6 and 9 require slightly more design consideration. The accessibility fixes (items 3 and 6) are particularly important as they're not just polish — they're functional requirements for users with disabilities.

# PRD: UI/UX Polish — Empty States, Confirmations, Accessibility, Discoverability

|  |  |
| --- | --- |
| **Date** | 2026-04-05 |
| **Status** | Draft |
| **Priority** | High |
| **Impact** | Elevate Notesage from "power-user tool" to "polished premium app" across 30+ components |
| **Research** | [UI/UX Improvement Analysis](../research/2026-04-04-ui-ux-improvement-analysis.md) |

## Problem

Notesage's core functionality is strong, but the UI has accumulated polish gaps that undermine the premium desktop app feel:

1. **Empty states are dead ends** — sidebar, chat, and command palette show passive text with no call to action, indistinguishable from loading failures
2. **Destructive actions use** `window.confirm()` — browser-native dialogs break visual consistency and block the JS thread
3. **File tree is invisible to screen readers** — missing ARIA tree roles, no `aria-expanded`, no keyboard arrow navigation
4. **Power features are hidden** — `/` skills, `@` agents, and palette prefix modes have zero discoverability hints
5. **Loading gaps** — async operations like drag-expand have no visual feedback
6. **Find bar zero-match** — no visual emphasis when search yields nothing
7. **Error messages are raw** — `${error}` strings with no recovery guidance
8. **Consistency gaps** — disabled opacity, button sizing, tooltip delays vary across components
9. **Performance** — no virtual scrolling for large file trees (deferred, low priority)

These individually seem minor but collectively prevent the "this looks premium" first impression the design system mandates.

## Goals

- Replace all `window.confirm()` calls with shadcn `AlertDialog`
- Achieve W3C APG tree view compliance for the file tree (roles, states, keyboard nav)
- Every empty state answers "What is this?" and "What do I do next?"
- Chat input discoverability: new users learn `/` and `@` syntax without reading docs
- Zero-match find bar has clear visual feedback
- Error toasts include actionable recovery (retry button or settings link)
- Consistent disabled states, button sizing, and tooltip timing across all components

## Non-Goals

- Virtual scrolling for file tree (deferred — only impacts 1000+ file projects)
- Redesigning the sidebar layout or information architecture
- New features or functionality — this is pure polish
- Changing the editor content area styling

## User Stories

- As a **new user**, I want sidebar empty states to guide me toward creating my first project, so I'm not staring at a blank screen
- As a **screen reader user**, I want the file tree to announce folder expand/collapse and file selection, so I can navigate my project
- As a **keyboard-only user**, I want chat message action buttons (edit, copy, branch) to be focusable, so I'm not locked out of features
- As a **user closing a dirty tab**, I want a proper Save/Discard/Cancel dialog instead of a browser confirm box, so my app feels native
- As a **chat user**, I want to discover `/` skills and `@` agents through hints, so I don't miss powerful features
- As a **user searching**, I want the find bar to turn red when there are no matches, so I know instantly instead of reading small text

## Technical Approach

All changes are frontend-only — no Rust backend changes, no new Tauri commands, no new dependencies. Everything uses existing shadcn/ui components and Tailwind utilities.

### Category 1: Empty States (5 components)

Replace passive `<p>` text with structured empty states containing:

- Brief explanation of what will appear
- Action link/button triggering the same handler as the section's add button
- Muted icon for visual anchoring

| Component | File | Current | New |
| --- | --- | --- | --- |
| Quick Notes | `QuickNotesSection.tsx` | "Notes in \~/Notesage" | "No notes yet" + "Create a note" link |
| Projects | `ProjectsSection.tsx` | "No projects open" | "No projects yet" + "New Project" link |
| Folders | `FoldersSection.tsx` | "Open a folder to browse files" | Keep text + add "Open Folder" link |
| Chat | `ChatMessageList.tsx` | "Start a conversation with AI." | Structured card with 2-3 suggested prompt chips + `/` and `@` hint |
| Command Palette | `CommandPalette.tsx` | "No results found." | Mode-specific guidance (e.g., "Tags are created by typing #tagName in your notes") |

### Category 2: Destructive Action Confirmations (3 locations)

Replace all `window.confirm()` and missing confirmations with shadcn `AlertDialog`:

| Location | File | Fix |
| --- | --- | --- |
| Tab close (dirty) | `TabBar.tsx:44` | Three-action AlertDialog: **Save & Close** / **Discard** (destructive) / **Cancel** |
| Tab close (keyboard) | `useKeyboardShortcuts.ts:46` | Same AlertDialog, triggered from Cmd+W handler |
| Prompt delete | `PromptsSettings.tsx:55` | AlertDialog: "Delete '{name}'?" with Cancel / **Delete** (destructive) |
| Template delete | `ExportDialog.tsx:156,312` | AlertDialog: "Remove template '{name}'?" with Cancel / **Remove** (destructive) |

The dirty-tab dialog requires making `TabBar`'s close handler async, since `AlertDialog` is non-blocking unlike `window.confirm()`. Pattern: set pending-close state → show dialog → resolve on user choice.

### Category 3: Accessibility — File Tree ARIA (6 changes)

Implement W3C APG tree view pattern:

| Element | Change |
| --- | --- |
| `FileTree.tsx` container | Add `role="tree"` and `aria-label="File explorer"` |
| `FileTreeItem.tsx` interactive div | Add `role="treeitem"` |
| Folder items | Add `aria-expanded={isExpanded}` |
| All items | Add `aria-label` with name and type (e.g., "docs, folder" or "readme.md") |
| Nested children wrapper | Add `role="group"` |
| Decorative icons (chevron, file type) | Add `aria-hidden="true"` |

### Category 4: Accessibility — Keyboard-Accessible Chat Actions

Change chat message action buttons from hover-only to keyboard-accessible:

```css
/* Before: */
opacity-0 group-hover:opacity-100

/* After: */
opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100
```

This ensures Tab navigation reveals action buttons without changing the hover-to-reveal visual design.

### Category 5: Feature Discoverability (2 changes)

**ChatInput hints:**

- Add muted hint text below the textarea: `Type / for skills, @ for agents`
- Auto-hide after first use via a persisted flag in `settings-store` (e.g., `chatHintsShown`)
- Pattern: Cursor's fade-after-first-use hint

**Command Palette mode hints:**

- Keep prefix mode hints (`#tags`, `@mentions`, `>commands`, `?research`) visible in all modes
- When in a prefix mode, add "← Backspace to return" hint
- Currently hints disappear when a prefix is active

### Category 6: Loading & Feedback (1 change)

**Drag-expand feedback:**

- Add a subtle pulse animation on the folder item during the 600ms drag-expand timer in `FileTreeItem.tsx`
- CSS: `animate-pulse` class added when `dragExpandTimer` is active, removed on clear

### Category 7: Visual Hierarchy (3 changes)

**FindBar zero-match styling:**

- Add `border-destructive/50` to the search input when `matchCount === 0 && query.length > 0`
- Pattern: VS Code, Sublime, Safari all use red/warning border for no matches

**Table toolbar transition:**

- Add `animate-in fade-in duration-150` to `TableToolsPopover` appearance
- Match existing FindBar animation timing

**StatusBar density:**

- Group secondary indicators (reading time, word count) behind a single hover-expandable area
- Primary indicators (file type, line count, index status) always visible

### Category 8: Error Handling (4 changes)

| Location | Fix |
| --- | --- |
| `FileTreeItem.tsx:164` | Parse common errors: "Permission denied", "File not found", "Disk full" |
| `BubbleMenu.tsx` | AI failure toast: add `action` button linking to Settings &gt; Connections |
| `FileTreeItem.tsx:148` | Rename failure: show error toast instead of silent console.error |
| `FileTreeItem.tsx:604` | Folder delete: show child count in confirmation ("Delete 'docs' and its 47 files?") |

Use Sonner's `action` parameter for retry buttons on error toasts — the library is already installed.

### Category 9: Consistency Normalization (4 patterns)

| Pattern | Standard | Files to Update |
| --- | --- | --- |
| Disabled opacity | `disabled:opacity-50` everywhere | Toolbar, ChatInput, various buttons |
| Confirm dialogs | Always shadcn `AlertDialog`, never `window.confirm()` | Covered in Category 2 |
| Icon button sizing | `h-7 w-7 p-0` toolbar-density, `h-8 w-8 p-0` settings-density | ChatInput, Settings, Toolbar |
| Tooltip delay | 300ms globally via `TooltipProvider delayDuration={300}` | Verify all TooltipProvider instances |

## UI/UX

### Dirty Tab Close Dialog

```
┌──────────────────────────────────────┐
│  Unsaved Changes                     │
│                                      │
│  "document.md" has unsaved changes.  │
│  What would you like to do?          │
│                                      │
│  [Cancel]  [Discard]  [Save & Close] │
└──────────────────────────────────────┘
```

- "Save & Close" = primary button (default)
- "Discard" = destructive variant
- "Cancel" = outline/ghost

### Chat Empty State

```
┌──────────────────────────────────────┐
│                                      │
│        💬  Start a conversation      │
│                                      │
│   ┌──────────────────────────────┐   │
│   │ Summarize my current note    │   │
│   └──────────────────────────────┘   │
│   ┌──────────────────────────────┐   │
│   │ Help me brainstorm ideas     │   │
│   └──────────────────────────────┘   │
│   ┌──────────────────────────────┐   │
│   │ Review this document         │   │
│   └──────────────────────────────┘   │
│                                      │
│   Type / for skills, @ for agents    │
│                                      │
└──────────────────────────────────────┘
```

Prompt chips are clickable — they pre-fill the chat input.

### FindBar Zero-Match State

- Input border transitions to `border-destructive/50` (soft red)
- "No results" text color changes to `text-destructive`
- Transition: 150ms ease for smooth visual feedback

## Data Model

No new stores or Tauri commands. Minor additions:

```typescript
// settings-store.ts — new persisted field
chatHintsShown: boolean; // default false, set true after first chat message

// editor-store.ts or local state — for async tab close
pendingCloseTabId: string | null; // tab awaiting save/discard decision
```

## Dependencies

None — all changes use existing libraries (shadcn/ui AlertDialog, Sonner toast actions, Tailwind utilities, Radix ARIA primitives).

## Quality Gates

### Functional

- [x] No `window.confirm()` calls remain in the codebase

- [x] Dirty tab close shows Save & Close / Discard / Cancel dialog

- [x] Template and prompt delete show confirmation dialogs

- [x] File tree passes W3C APG tree view pattern (role, aria-expanded, aria-label, role=group)

- [ ] Screen reader (VoiceOver) can navigate file tree: announce folder names, expand/collapse state

- [x] Chat message actions reachable via Tab key

- [ ] Chat empty state shows prompt chips and syntax hints

- [ ] Command palette shows mode-specific empty state guidance

- [ ] Sidebar empty states have action links that work

- [ ] FindBar input turns red-bordered on zero matches

- [ ] Error toasts show parsed messages, not raw error objects

- [ ] Folder delete dialog shows child file count

### Design

- [ ] All changes look correct in both light and dark mode

- [ ] All changes look correct with soft contrast enabled

- [ ] Disabled states use consistent `opacity-50` across all components

- [ ] AlertDialogs match existing dialog styling (see FileTreeItem delete dialog)

- [ ] Chat prompt chips follow button/badge styling from design system

- [ ] Transitions are smooth (150ms ease) on all new interactive states

### Testing

- [ ] All existing tests pass (`pnpm test`)

- [ ] TypeScript type check passes (`pnpm typecheck`)

- [ ] New AlertDialog flows have unit tests (render, user choice, callback)

- [ ] ARIA attributes verified in component tests

## Out of Scope

- File tree virtual scrolling (only impacts 1000+ file projects)
- File tree keyboard arrow navigation (Up/Down/Left/Right) — the APG spec recommends it but it's a larger effort; ARIA roles alone are a significant improvement
- Chat input placeholder text rotation (nice-to-have, can add later)
- StatusBar complete redesign (grouping indicators is sufficient)
- Replacing the sidebar DOM-sniffing menu detection (`document.querySelector('[data-state="open"]')`) — works reliably, low risk
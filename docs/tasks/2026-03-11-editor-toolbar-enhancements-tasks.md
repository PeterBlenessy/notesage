# Tasks: Editor & Toolbar Enhancements

**PRD:** `docs/prds/2026-03-11-editor-toolbar-enhancements.md`**Total:** 16 tasks — 5S, 7M, 4L **Suggested order:** Quick wins first (#1–#3), then medium features (#4–#9), then complex features (#10–#16)

**Risks & open questions:**

- Markdown round-trip for colors requires enabling `html: true` in tiptap-markdown — need to verify this doesn't break existing round-trip tests
- Item annotation `{emoji}` serialization convention is non-standard — need to confirm prosemirror-markdown can be extended to parse/serialize it
- Block drag handles interact with the same left-margin space as item annotations — implement annotations first so drag handles can account for them
- File association on macOS may require Tauri v2's `deep-link` plugin or the `cli` plugin — research exact API before starting

---

## Task 1: Add heading level picker to toolbar

**Complexity:** S **Category:** frontend **Dependencies:** None

Add a `DropdownMenu` (or `Select`) at the start of the toolbar that shows the current block type (Paragraph, H1–H6) and allows switching.

**Acceptance criteria:**

- Dropdown placed before Undo/Redo in toolbar
- Shows "Paragraph" when cursor is in a paragraph, "Heading 1"–"Heading 6" when in a heading
- Each heading option styled with representative size/weight
- Selecting an option calls `toggleHeading({ level })` or `setParagraph()`
- Active option reflects current block type reactively
- Dropdown disabled in source mode

**Files:**

- `src/components/editor/Toolbar.tsx` — add `HeadingPicker` component

---

## Task 2: Add text alignment buttons to toolbar

**Complexity:** S **Category:** frontend **Dependencies:** None

Expose the already-loaded `TextAlign` extension via toolbar buttons.

**Acceptance criteria:**

- Three buttons (AlignLeft, AlignCenter, AlignRight) or a single dropdown showing current alignment
- Active state highlights the matching alignment button
- Only enabled for heading and paragraph nodes (matching TextAlign config `types: ["heading", "paragraph"]`)
- Position: after block element group (Quote, Code Block, HR)
- Disabled in source mode

**Files:**

- `src/components/editor/Toolbar.tsx` — add alignment buttons/dropdown

---

## Task 3: Add indent/outdent buttons to toolbar

**Complexity:** S **Category:** frontend **Dependencies:** None

Add two buttons for list indentation after the list type buttons.

**Acceptance criteria:**

- Indent button calls `sinkListItem('listItem')` (falls back to `sinkListItem('taskItem')`)
- Outdent button calls `liftListItem('listItem')` (falls back to `liftListItem('taskItem')`)
- Buttons disabled when cursor is not inside any list
- Icons: `IndentIncrease` and `IndentDecrease` from lucide-react
- Position: immediately after Task List button
- Disabled in source mode

**Files:**

- `src/components/editor/Toolbar.tsx` — add indent/outdent buttons

---

## Task 4: Floating table toolbar — component

**Complexity:** M **Category:** frontend **Dependencies:** None

Create a floating toolbar that appears when the cursor is inside a table.

**Acceptance criteria:**

- New `TableToolbar.tsx` component rendered inside the editor area
- Uses Tiptap's `BubbleMenu` (with `shouldShow` checking `editor.isActive('table')`) or a custom floating element positioned relative to the table DOM node
- Frosted glass style matching existing BubbleMenu (border, bg-popover, backdrop-blur-sm, shadow-lg)
- Smooth appear/disappear animation (fade-in, zoom-in-95, 150ms)
- Disappears when cursor leaves the table
- Not shown in source mode

**Files:**

- `src/components/editor/TableToolbar.tsx` — new component
- `src/components/editor/EditorContent.tsx` — render TableToolbar alongside BubbleMenu

---

## Task 5: Floating table toolbar — wire up all table commands

**Complexity:** M **Category:** frontend **Dependencies:** #4

Add all table manipulation buttons to the floating toolbar with proper icons, tooltips, and disabled states.

**Acceptance criteria:**

- Buttons: Add Row Above, Add Row Below, Add Column Left, Add Column Right, Delete Row, Delete Column, Toggle Header Row, Merge Cells, Split Cell, Delete Table
- Each button calls the corresponding Tiptap table command
- Merge Cells disabled when selection doesn't span multiple cells
- Split Cell disabled when current cell isn't merged
- Delete Table has visual distinction (destructive styling or separation)
- All buttons have tooltips
- Compact layout with separator groups: row/column add | row/column delete | merge/split | header | delete table

**Files:**

- `src/components/editor/TableToolbar.tsx` — add button group
- `src/styles/editor.css` — any table toolbar-specific styles

---

## Task 6: Install color & highlight extensions

**Complexity:** S **Category:** frontend **Dependencies:** None

Install and register `@tiptap/extension-color`, `@tiptap/extension-text-style`, and `@tiptap/extension-highlight`.

**Acceptance criteria:**

- `pnpm add @tiptap/extension-color @tiptap/extension-text-style @tiptap/extension-highlight`
- Extensions added to `useEditor.ts` with `Highlight.configure({ multicolor: true })`
- `TextStyle` extension registered (required by Color)
- Editor can programmatically set text color and highlight via commands: `editor.chain().setColor('#ef4444').run()` and `editor.chain().toggleHighlight({ color: '#fef08a' }).run()`
- Existing round-trip tests still pass

**Files:**

- `package.json` — new dependencies
- `src/hooks/useEditor.ts` — add extensions

---

## Task 7: Color & highlight toolbar UI

**Complexity:** M **Category:** frontend **Dependencies:** #6

Add text color and highlight toolbar buttons with color palette popovers.

**Acceptance criteria:**

- Two toolbar buttons after the Code (inline) button: Text Color (`Baseline` icon with colored underline) and Highlight (`Highlighter` icon)
- Each button opens a shadcn/ui `Popover` with a grid of curated color swatches
- Text colors: Default (reset), Red, Orange, Yellow, Green, Blue, Purple, Grey — each with a specific oklch value that works in both light and dark mode
- Highlight colors: None (remove), Yellow, Green, Blue, Pink, Orange, Grey
- Clicking a swatch applies the color to the selection and closes the popover
- Button icon shows the currently active color (colored underline for text, colored background for highlight)
- "Reset" / "Remove" option to clear color/highlight from selection
- Popovers compact: \~200px wide, swatch grid with labels

**Files:**

- `src/components/editor/Toolbar.tsx` — add `TextColorPopover` and `HighlightPopover` components
- `src/styles/editor.css` — any highlight/color-specific editor styles

---

## Task 8: Color & highlight markdown round-trip

**Complexity:** M **Category:** frontend **Dependencies:** #6

Ensure text colors and highlights survive markdown save/reload.

**Acceptance criteria:**

- Text color serializes as `<span style="color: #hex">text</span>` in markdown
- Highlight serializes as `<mark style="background-color: #hex">text</mark>` in markdown
- Both parse back correctly when the file is reopened
- Verify `tiptap-markdown` config allows HTML passthrough for these elements (may need `html: true` or custom serializer rules)
- Add test fixture file `tests/fixtures/colors.md` covering text color and highlight markup
- Round-trip test passes with new fixture

**Files:**

- `src/hooks/useEditor.ts` — adjust Markdown extension config if needed
- `src/lib/markdown.ts` — custom serialization rules if tiptap-markdown doesn't handle it natively
- `tests/fixtures/colors.md` — new test fixture

---

## Task 9: .md file association — Tauri config & event handling

**Complexity:** M **Category:** both **Dependencies:** None

Register Notesage as a handler for `.md` files on macOS and handle the file-open event in the frontend.

**Acceptance criteria:**

- `fileAssociations` added to `bundle` in `tauri.conf.json` for extensions `md`, `markdown`, `mdown`, `mkd`
- Info.plist updated with `CFBundleDocumentTypes` if Tauri doesn't auto-generate it
- Tauri `deep-link` or `cli` plugin installed and configured to receive file paths
- Frontend listens for the file-open event (on launch and while running)
- Received file path opens in a new tab via existing `useFileOperations.openFile()`
- If file's parent directory isn't in the workspace, it's added as an explorer folder
- Works both when app is freshly launched and when app is already running

**Files:**

- `src-tauri/tauri.conf.json` — fileAssociations config
- `src-tauri/Info.plist` — CFBundleDocumentTypes (if needed)
- `src-tauri/Cargo.toml` — deep-link plugin dependency (if needed)
- `src-tauri/src/lib.rs` — plugin registration
- `src/App.tsx` or `src/hooks/useFileWatcher.ts` — listen for file-open event
- `src/hooks/useFileOperations.ts` — ensure `openFile` handles absolute paths from outside workspace

---

## Task 10: Item annotation — custom Tiptap extension

**Status: DEFERRED** — Initial implementation revealed fundamental UX issues: the annotation badge and drag handle compete for the same left-margin space, vertical alignment is inconsistent across block types, and the hover/hide timing is fragile (elements disappear before the user can interact with them). Both features (tasks #10–#14) have been disconnected from the editor and need a unified left-gutter design before reintroduction. Extension source files remain in place for future work. (2026-03-12)

**Complexity:** L **Category:** frontend **Dependencies:** None

Create a `ItemAnnotation` Tiptap extension that adds an `annotation` attribute to list item and task item nodes.

**Acceptance criteria:**

- New extension file `src/components/editor/extensions/item-annotation.ts`
- Extends `ListItem` and `TaskItem` nodes to include `annotation` attribute (JSON string: `{ icon, color }`)
- ProseMirror plugin renders annotation as a widget decoration or `::before` pseudo-element in the left margin
- Annotation icon (emoji) visible in the gutter area of the list item
- Clicking the annotation area dispatches a transaction meta to open the picker (consumed by React component)
- Empty margin area is clickable to add a new annotation (subtle "+" indicator on hover)
- Extension registered in `useEditor.ts`

**Files:**

- `src/components/editor/extensions/item-annotation.ts` — new extension
- `src/components/editor/extensions/index.ts` — export
- `src/hooks/useEditor.ts` — register extension
- `src/styles/editor.css` — annotation margin styles

---

## Task 11: Item annotation — picker popover UI

**Status: DEFERRED** — See Task #10 note.

**Complexity:** M **Category:** frontend **Dependencies:** #10

Create the annotation picker popover that appears when clicking the margin area.

**Acceptance criteria:**

- React component `AnnotationPicker.tsx` rendered inside the editor area
- Positioned at the clicked annotation margin position (use ProseMirror coordinate mapping)
- Grid layout: row of colored dots (red, orange, yellow, green, blue, purple, grey), row of category emojis (phone, email, calendar, chat, brain, lightbulb, question)
- "Remove" button/option to clear annotation
- Clicking an option sets the `annotation` attribute on the list item node via editor transaction
- Popover closes on selection or outside click
- Matches existing popover styling (shadcn/ui Popover or custom positioned div)

**Files:**

- `src/components/editor/AnnotationPicker.tsx` — new component
- `src/components/editor/EditorContent.tsx` — render AnnotationPicker

---

## Task 12: Item annotation — markdown serialization

**Status: DEFERRED** — See Task #10 note.

**Complexity:** M **Category:** frontend **Dependencies:** #10

Implement `{emoji}` prefix serialization for item annotations in markdown.

**Acceptance criteria:**

- On serialize: list items with annotation attribute emit `{emoji} `prefix before content text
- On parse: list items starting with `{emoji} `pattern extract the emoji and set the annotation attribute
- Pattern: single emoji character wrapped in `{}` at the very start of the list item content
- Task items: `- [ ] {📞} Call team` → annotation + unchecked task
- Works for both bullet lists, ordered lists, and task lists
- Round-trip test: annotated list item → save → reopen → annotation preserved
- Add test fixture `tests/fixtures/annotations.md`

**Files:**

- `src/lib/markdown.ts` — custom parse/serialize rules for annotation prefix
- `src/hooks/useEditor.ts` — Markdown extension config adjustments if needed
- `tests/fixtures/annotations.md` — new test fixture

---

## Task 13: Block drag handle — ProseMirror plugin

**Status: DEFERRED** — See Task #10 note.

**Complexity:** L **Category:** frontend **Dependencies:** None

Create a ProseMirror plugin that shows a drag handle in the left margin on block hover.

**Acceptance criteria:**

- New extension file `src/components/editor/extensions/drag-handle.ts`
- On mousemove over the editor, detect the nearest top-level node (depth 1 in the document)
- Render a grip icon (GripVertical from lucide or ⠿ character) as a widget decoration or absolutely positioned DOM element
- Handle positioned in the left gutter, vertically centered with the block's first line
- Opacity 0.3 by default, 1.0 on hover, with 150ms transition
- Not shown for empty paragraphs (placeholder text) or when in source mode
- Extension registered in `useEditor.ts`

**Files:**

- `src/components/editor/extensions/drag-handle.ts` — new extension
- `src/components/editor/extensions/index.ts` — export
- `src/hooks/useEditor.ts` — register extension
- `src/styles/editor.css` — drag handle styles

---

## Task 14: Block drag handle — drag-and-drop behavior

**Status: DEFERRED** — See Task #10 note.

**Complexity:** L **Category:** frontend **Dependencies:** #13

Implement the actual drag-and-drop reordering of blocks via the drag handle.

**Acceptance criteria:**

- Dragging the handle initiates a ProseMirror drag (or HTML5 drag-and-drop with node serialization)
- During drag: source block gets subtle highlight (0.5 opacity or outline), a 2px horizontal drop indicator line shows between blocks at the drop target
- On drop: block moves to the new position via ProseMirror transaction (delete from old pos + insert at new pos)
- Works for all top-level block types: paragraph, heading, list (entire list, not individual items), blockquote, code block, table, horizontal rule
- Undo (Cmd+Z) reverts the move
- Performance: no jank during drag — use requestAnimationFrame for position updates
- Does not interfere with text selection or other editor interactions

**Files:**

- `src/components/editor/extensions/drag-handle.ts` — add drag behavior
- `src/styles/editor.css` — drag indicator and highlight styles

---

## Task 15: Update keyboard shortcuts documentation

**Complexity:** S **Category:** frontend **Dependencies:** #1, #2, #3

Update `docs/keyboard-shortcuts.md` with any new shortcuts and toolbar actions.

**Acceptance criteria:**

- Document new toolbar controls in the keyboard shortcuts table (even if they're mouse-only, note that they exist)
- Update the "Editor Formatting" section with color/highlight if keyboard shortcuts are added
- Update the "Slash Commands" section if any new slash commands are added
- Keep format consistent with existing documentation

**Files:**

- `docs/keyboard-shortcuts.md`
- `docs/features/editor.md` — update feature description with new toolbar capabilities

---

## Task 16: Update editor feature docs

**Complexity:** S **Category:** frontend **Dependencies:** All previous tasks

Update feature documentation to reflect all new editor capabilities.

**Acceptance criteria:**

- `docs/features/editor.md` updated with: heading picker, alignment controls, indent/outdent, table controls, text color & highlight, item annotations, block drag handles
- `docs/features/editor-architecture.md` updated with new extensions: ItemAnnotation, DragHandle
- `docs/architecture.md` project structure updated if new files added to extensions/
- PRD status updated from "Draft" to "Complete" (or appropriate partial status)

**Files:**

- `docs/features/editor.md`
- `docs/features/editor-architecture.md`
- `docs/architecture.md`
- `docs/prds/2026-03-11-editor-toolbar-enhancements.md` — update status

---

## Dependency Graph

```
Independent (can start in parallel):
  #1 Heading picker
  #2 Alignment buttons
  #3 Indent/outdent
  #4 Table toolbar component
  #6 Install color extensions
  #9 .md file association
  #10 Item annotation extension
  #13 Drag handle plugin

Sequential chains:
  #4 → #5 (table toolbar → wire commands)
  #6 → #7 (install extensions → toolbar UI)
  #6 → #8 (install extensions → markdown round-trip)
  #10 → #11 (annotation extension → picker UI)
  #10 → #12 (annotation extension → serialization)
  #13 → #14 (drag handle plugin → drag-and-drop)
  All → #15, #16 (docs update last)
```

## Suggested Implementation Waves

**Wave 1 — Quick wins (tasks #1, #2, #3):** Three toolbar additions, purely UI, no new dependencies. Can be done in a single session.

**Wave 2 — Table controls (#4, #5):** Floating toolbar with all table commands. Self-contained, medium effort.

**Wave 3 — Colors (#6, #7, #8):** Install extensions, build toolbar UI, verify markdown round-trip. The round-trip verification (#8) is the riskiest part — start early.

**Wave 4 — File association (#9):** Standalone Tauri config + event handling. Requires research into Tauri v2's file-open event API.

**Wave 5 — Item annotations (#10, #11, #12):** Custom extension + picker + serialization. Most novel feature, highest complexity.

**Wave 6 — Drag handles (#13, #14):** ProseMirror drag-and-drop. Complex interaction, can be deferred.

**Wave 7 — Docs (#15, #16):** Update documentation after all features land.
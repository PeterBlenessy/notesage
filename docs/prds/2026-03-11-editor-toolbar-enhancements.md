# PRD: Editor & Toolbar Enhancements

**Date:** 2026-03-11 **Status:** Partially complete **Parent:** Editor

> **Note (2026-03-12):** Features 3 (Item Annotations) and 8 (Block Drag Handles) have been **deferred**. Initial implementation revealed UX issues: the annotation badge and drag handle compete for the same left-margin space with inconsistent vertical alignment, fragile hover/hide timing (elements disappear before the user can reach them), and drag handles only operating on top-level blocks rather than individual list items. Both features need a unified left-gutter design (a single rail managing handles, badges, and spacing) before reintroduction. Extension source files remain in the codebase for future work.

## Problem

Notesage's editor toolbar currently exposes only basic formatting operations. Several capabilities that are either already loaded (TextAlign, table manipulation commands) or commonly expected in premium editors are missing from the UI. Specifically:

1. **No .md file association** — Double-clicking a markdown file in Finder doesn't open Notesage. Users must manually open files through the app's dialogs.
2. **No table editing controls** — Tables can be inserted (3x3 default) but there's no UI for adding/removing rows and columns, merging/splitting cells, or toggling headers. The Tiptap Table extension already supports all of these commands.
3. **No item annotations** — Bullet and checklist items have no way to visually categorize entries (priority, type of work, ideas). Users resort to text prefixes like "URGENT:" which don't stand out.
4. **No text/background color** — No way to highlight important passages or color-code text. The only non-grey colors in the editor are structural (diffs, comments, tags).
5. **No text alignment UI** — The `TextAlign` extension is loaded but has zero toolbar controls.
6. **No heading level picker** — Heading levels are only accessible via slash commands or markdown shortcuts (`# `, `## `, etc.), not from the toolbar.
7. **No indent/outdent buttons** — List nesting relies on Tab/Shift+Tab with no toolbar discoverability.
8. **No block drag handles** — Reordering blocks (paragraphs, headings, list items) requires cut-and-paste.

## Goals

1. Notesage is the default application for opening `.md` files on macOS — double-click opens in Notesage
2. Users can fully edit table structure (add/remove rows and columns, merge/split cells) without leaving the mouse
3. Bullet and checklist items can be annotated with visual icons in the left margin for categorization
4. Selected text can be highlighted with a background color or have its text color changed, with a curated palette
5. All loaded editor capabilities (alignment, heading levels, indentation) are discoverable from the toolbar
6. Blocks can be reordered via drag-and-drop handles in the left margin

## Non-Goals

- Windows/Linux file association (macOS only for now)
- Custom/arbitrary color picker (curated palette only — keeps things on-brand and prevents garish documents)
- Collaborative annotation sharing (item icons are local document state)
- Table formulas or spreadsheet-like features
- Keyboard shortcuts for every new toolbar action (can be added incrementally)

## User Stories

- As a user, I want to double-click a `.md` file in Finder and have it open in Notesage, so that Notesage feels like a native part of my workflow.
- As a user editing a table, I want to right-click (or use toolbar buttons) to add a row below or a column to the right, so I can grow my table without rebuilding it.
- As a user creating a to-do list, I want to add a colored dot or icon (phone, email, meeting, idea) to the left margin of each item, so I can visually scan and categorize my tasks at a glance.
- As a user writing a document, I want to highlight a passage with a yellow background or change text color to red for emphasis, so important content stands out.
- As a user, I want to click an alignment button in the toolbar to center a heading, so I don't have to remember markdown alignment syntax.
- As a user, I want to pick a heading level from a dropdown in the toolbar, so I can change heading levels without retyping `#` characters.
- As a user with nested lists, I want indent/outdent buttons visible in the toolbar, so I can restructure list hierarchy without remembering Tab/Shift+Tab.
- As a user rearranging a document, I want to grab a block by its drag handle and move it up or down, so I can restructure content without cut-and-paste.

## Technical Approach

### Feature 1: .md File Association

**Tauri configuration:**

Add `fileAssociations` to `bundle` in `tauri.conf.json`:

```json
"bundle": {
  "fileAssociations": [
    {
      "ext": ["md", "markdown", "mdown", "mkd"],
      "mimeType": "text/markdown",
      "description": "Markdown Document",
      "role": "Editor"
    }
  ]
}
```

**Info.plist additions:**

Tauri v2 should auto-generate `CFBundleDocumentTypes` from the config above. If not, manually add to `Info.plist`:

```xml
<key>CFBundleDocumentTypes</key>
<array>
  <dict>
    <key>CFBundleTypeName</key>
    <string>Markdown Document</string>
    <key>CFBundleTypeExtensions</key>
    <array>
      <string>md</string>
      <string>markdown</string>
      <string>mdown</string>
      <string>mkd</string>
    </array>
    <key>CFBundleTypeRole</key>
    <string>Editor</string>
    <key>LSHandlerRank</key>
    <string>Default</string>
  </dict>
</array>
```

**Frontend handling:**

Listen for Tauri's file-open event when the app is launched with a file argument:

- On macOS, `tauri::api::cli::Matches` or the `single-instance` plugin provides the opened file path
- Frontend receives the path → opens the file in a new tab (reusing existing `useFileOperations.openFile()`)
- If the app is already running, handle the `open-file` event to open in the existing window

### Feature 2: Table Controls

**Approach: Floating table toolbar (context-sensitive)**

When the cursor is inside a table, show a compact floating toolbar anchored above the table (similar to how Notion handles it). This avoids cluttering the main toolbar with table-specific controls that are only relevant when editing tables.

**Controls to expose:**

| Control | Tiptap Command | Icon |
| --- | --- | --- |
| Add row above | `addRowBefore()` | `Plus` + row icon |
| Add row below | `addRowAfter()` | `Plus` + row icon |
| Add column left | `addColumnBefore()` | `Plus` + column icon |
| Add column right | `addColumnAfter()` | `Plus` + column icon |
| Delete row | `deleteRow()` | `Trash2` |
| Delete column | `deleteColumn()` | `Trash2` |
| Toggle header row | `toggleHeaderRow()` | `TableProperties` |
| Merge cells | `mergeCells()` | `Merge` |
| Split cell | `splitCell()` | `Split` |
| Delete table | `deleteTable()` | `Trash2` |

**Implementation:**

- New `TableToolbar.tsx` component using Tiptap's `BubbleMenu` or a custom floating element positioned relative to the active table node
- Use `editor.isActive('table')` to conditionally render
- Position above the table with `tippy.js` or ProseMirror's `nodeDOM` positioning
- Compact design: icon buttons with tooltips, grouped by function, matching existing toolbar aesthetic
- The main toolbar's "Insert Table" button remains unchanged

**Alternative considered:** Right-click context menu using shadcn/ui `ContextMenu`. This could supplement the floating toolbar for discoverability (users who right-click inside a table see the options). Could implement both.

### Feature 3: Item Annotations (Margin Icons)

**Concept:** Each bullet list item and task list item can have an optional icon displayed in the left margin. Icons categorize the item visually (e.g., red dot = urgent, phone icon = call, lightbulb = idea, envelope = email, calendar = meeting, chat bubble = discussion, brain = reflection).

**Data model:**

Extend the `listItem` and `taskItem` ProseMirror node schema with an `annotation` attribute:

```typescript
// Annotation stored as a string identifier
type ItemAnnotation = {
  icon: string;     // Lucide icon name or emoji character
  color?: string;   // Optional color from curated palette
};
```

The attribute is stored on the node: `<li data-annotation='{"icon":"phone","color":"blue"}'>`

**Markdown serialization:**

Since markdown has no standard for list item annotations, use an inline convention that survives round-tripping:

```markdown
- Call the team about the deadline
- URGENT: Fix the production bug
- Consider using a different approach
- [ ] Reply to client email
```

The `{emoji}` prefix at the start of a list item is parsed on load and rendered as a margin icon. On serialize, it's written back as `{emoji}` prefix. This keeps files readable in other editors while being lossless.

**Custom Tiptap extension:** `ItemAnnotation`

- ProseMirror plugin that reads `annotation` node attributes
- Renders as CSS `::before` pseudo-element or a widget decoration in the left margin (negative margin-left or absolute positioning)
- Click the margin area (or the rendered icon) to open an annotation picker popover

**Annotation picker:**

- Small popover triggered by clicking the left margin of a list item
- Grid of curated icons: colored dots (red, orange, yellow, green, blue, grey), category icons (phone, email, meeting, calendar, idea, discussion, reflection, important, question)
- Click to set, click again to remove
- Use shadcn/ui `Popover` + icon grid layout

**CSS positioning:**

```css
.ProseMirror li[data-annotation] {
  position: relative;
}
.ProseMirror li[data-annotation]::before {
  content: attr(data-annotation-icon);
  position: absolute;
  left: -2em;
  width: 1.5em;
  text-align: center;
  font-size: 0.9em;
  cursor: pointer;
}
```

### Feature 4: Text Color & Background Highlight

**Tiptap extensions:**

- `@tiptap/extension-color` — sets text color via `<span style="color: ...">` marks
- `@tiptap/extension-highlight` — sets background color via `<mark>` elements (already supports multicolor)

Install both and add to `useEditor.ts` extensions array.

**Curated palette (document content, not UI chrome):**

The design system forbids chromatic UI accents, but document content colors are user's creative choice. Offer a tasteful, limited palette:

| Purpose | Colors |
| --- | --- |
| Text colors | Default (inherit), Red, Orange, Yellow, Green, Blue, Purple, Grey |
| Background highlights | None (remove), Yellow, Green, Blue, Pink, Orange, Grey |

Each color defined as a CSS variable or specific oklch value for consistency in light/dark mode.

**UI: Color picker in toolbar + bubble menu**

- **Toolbar:** Two new dropdown buttons after the existing formatting group:
  - Text color button (A with colored underline) — dropdown shows palette swatches
  - Highlight button (marker icon) — dropdown shows background color swatches
- **Bubble menu:** Add a highlight button (quick access to background highlight on selected text)
- Use shadcn/ui `Popover` with a grid of color swatches (small circles or squares)
- Active color shown on the button icon (the underline or marker icon changes color)

**Markdown serialization:**

Standard markdown doesn't support text colors. Options:

- **HTML passthrough:** Serialize as `<span style="color: red">text</span>` and `<mark style="background: yellow">text</mark>` — works if `html: true` in tiptap-markdown config
- **Convention-based:** `==highlighted text==` for default highlight (some markdown flavors support this)
- Recommendation: Use HTML spans. They're valid markdown, survive round-tripping in most editors, and preserve the exact color. Gate behind `html: true` in the Markdown extension config for color-marked content only.

### Feature 5: Text Alignment Buttons

**Quick win — expose existing** `TextAlign` **extension:**

Add three buttons to the toolbar (after formatting group or in a "paragraph" section):

| Button | Command | Icon |
| --- | --- | --- |
| Align left | `setTextAlign('left')` | `AlignLeft` |
| Align center | `setTextAlign('center')` | `AlignCenter` |
| Align right | `setTextAlign('right')` | `AlignRight` |

Active state: highlight the button matching current alignment.

Optionally group these in a single dropdown button showing the current alignment icon, expanding to all options on click (saves toolbar space).

### Feature 6: Heading Level Picker

**Toolbar dropdown for heading levels:**

Replace or supplement the current toolbar with a heading level dropdown. When the cursor is in a heading, show the current level (H1, H2, etc.). When in a paragraph, show "Paragraph" or "Normal".

**Implementation:**

- Use shadcn/ui `Select` or `DropdownMenu` in the toolbar
- Options: Paragraph, Heading 1–6
- Each option shows the level with representative styling (larger/bolder text for H1, decreasing for H2–H6)
- Clicking an option calls `editor.chain().focus().toggleHeading({ level: n }).run()` or `setParagraph()`
- Active option reflects current block type via `editor.isActive('heading', { level: n })`
- Position: at the start of the toolbar (before undo/redo) for prominence, as in Google Docs, Notion, Word

### Feature 7: Indent/Outdent Buttons

**Two buttons in the list controls area:**

| Button | Action | Icon |
| --- | --- | --- |
| Indent | `sinkListItem('listItem')` or `sinkListItem('taskItem')` | `IndentIncrease` |
| Outdent | `liftListItem('listItem')` or `liftListItem('taskItem')` | `IndentDecrease` |

- Only enabled when cursor is inside a list
- Use Tiptap's built-in list manipulation commands
- Position after the list type buttons (bullet, ordered, task)
- Keyboard shortcuts remain: Tab (indent), Shift+Tab (outdent)

### Feature 8: Block Drag Handles

**Concept:** A grip handle appears in the left margin when hovering over any top-level block (paragraph, heading, list, blockquote, code block, table, horizontal rule). Dragging the handle reorders the block.

**Implementation approach:**

Use `@tiptap/extension-drag-handle` or build a custom solution:

1. **Custom ProseMirror plugin:** On `mousemove`, detect which top-level node the cursor is near. Render a drag handle widget (6-dot grip icon) positioned in the left margin using absolute CSS positioning.
2. **Drag behavior:** On drag start, store the node's position. On drop, use ProseMirror's `ReplaceStep` to move the node to the drop target position. Show a blue drop indicator line during drag.
3. **CSS positioning:** The handle lives in the editor's gutter area (left of the content column). Use the editor's max-width (720px) centered layout — handles appear in the space between the window edge and the content column.

**Visual design:**

- 6-dot grip icon (⠿), `text-muted-foreground` at 30% opacity, full opacity on hover
- 16x16px, vertically centered with the block's first line
- Smooth fade in/out (150ms transition)
- During drag: block gets a subtle highlight, drop target shows a 2px horizontal line

**Considerations:**

- Must not interfere with existing left-margin features (item annotations, task checkboxes)
- Performance: throttle mousemove handler (requestAnimationFrame)
- Nested blocks (list items inside lists): handle at the top-level list, not individual items
- Mobile/trackpad: ensure drag works with trackpad; not required on touch

## UI/UX

### Toolbar Layout (Updated)

```
[Heading Picker ▼] | [Undo] [Redo] | [B] [I] [U] [S] [Code] | [Text Color ▼] [Highlight ▼] |
[Bullet] [Ordered] [Task] [Indent] [Outdent] | [Quote] [Code Block] [HR] |
[Align ▼] | [Table] [Image] | [Typography ▼] | [Mic]     ... [Source Toggle]
```

The toolbar remains a single row. New controls are inserted in logical groups:

- **Heading picker** at the far left (prominent placement)
- **Color controls** after text formatting
- **Indent/outdent** after list controls
- **Alignment** as a grouped dropdown after block elements

If horizontal space is constrained, controls overflow with horizontal scroll (existing behavior).

### Floating Table Toolbar

```
┌──────────────────────────────────────────┐
│ [+Row↑] [+Row↓] [+Col←] [+Col→] │ [Merge] [Split] │ [Header] │ [🗑 Row] [🗑 Col] [🗑 Table] │
└──────────────────────────────────────────┘
```

Appears above the active table with the same frosted glass style as the bubble menu. Compact icon buttons with tooltips.

### Item Annotation Picker

```
┌─────────────────┐
│ ● ● ● ● ● ● ●  │  ← colored dots (red, orange, yellow, green, blue, purple, grey)
│ 📞 📧 📅 💬 🧠 💡 ❓ │  ← category icons
│ ❌ Remove        │
└─────────────────┘
```

Appears as a popover when clicking the left margin area of a list item. 7-column grid of icons.

### Color Picker Popover

```
┌─────────────────┐
│ Text Color       │
│ ⬤ ⬤ ⬤ ⬤ ⬤ ⬤ ⬤  │  ← colored circles
│ [↩ Reset]        │
├─────────────────┤
│ Highlight        │
│ ■ ■ ■ ■ ■ ■ ■  │  ← background swatches
│ [↩ Remove]       │
└─────────────────┘
```

Compact popover from toolbar button. Could be a single combined popover or two separate buttons.

## Data Model

### Item Annotation (Node Attribute)

```typescript
// Extended listItem/taskItem node attributes
interface AnnotatedListItem {
  annotation?: {
    icon: string;     // emoji character or lucide icon name
    color?: string;   // from curated palette: "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "grey"
  };
}
```

### Text Color & Highlight (Mark Attributes)

These are handled by the official Tiptap extensions — no custom data model needed:

- `@tiptap/extension-color` stores `color` attribute on `textStyle` mark
- `@tiptap/extension-highlight` stores `color` attribute on `highlight` mark

### File Association (No Data Model)

Configuration only — no runtime data model changes.

## Dependencies

### New npm packages

| Package | Purpose | Size |
| --- | --- | --- |
| `@tiptap/extension-color` | Text color mark | \~5KB |
| `@tiptap/extension-text-style` | Required by color extension | \~3KB |
| `@tiptap/extension-highlight` | Background highlight mark | \~5KB |

### Existing packages (no new installs)

- `@tiptap/extension-table` — already loaded, has all manipulation commands
- `@tiptap/extension-text-align` — already loaded, needs toolbar UI only
- `lucide-react` — already installed, provides all needed icons

### No Rust/backend changes required

Except for Feature 1 (file association config in `tauri.conf.json` and `Info.plist`, plus handling the file-open event).

## Implementation Order

Suggested priority based on impact and complexity:

| Priority | Feature | Complexity | Impact |
| --- | --- | --- | --- |
| 1 | Heading level picker | Low | High — most-used formatting action |
| 2 | Text alignment buttons | Low | Medium — already loaded, just needs UI |
| 3 | Indent/outdent buttons | Low | Medium — discoverability improvement |
| 4 | Table controls | Medium | High — tables are currently very limited |
| 5 | Text color & highlight | Medium | High — frequently requested editor feature |
| 6 | .md file association | Medium | High — native app feel |
| 7 | Block drag handles | High | Medium — nice-to-have, complex interaction |
| 8 | Item annotations | High | Medium — novel feature, custom extension + serialization |

Features 1–3 are quick wins (a few hours each). Features 4–6 are medium effort (half day each). Features 7–8 are more involved (1+ day each) and can be deferred.

## Quality Gates

### Functional

- [x] Double-clicking a `.md` file in Finder opens it in Notesage (after setting as default)

- [x] Heading level picker shows current block type and allows changing heading level or converting to paragraph

- [x] Alignment buttons reflect current alignment and toggle correctly for headings and paragraphs

- [x] Indent/outdent buttons work for all list types (bullet, ordered, task) and are disabled outside lists

- [x] Floating table toolbar appears when cursor is inside a table, disappears when leaving

- [x] All table operations work: add/remove rows and columns, merge/split cells, toggle header, delete table

- [x] Text color can be set from a curated palette and persists through save/reload

- [x] Background highlight can be applied and removed, persists through save/reload

- [x] Colors round-trip correctly through markdown serialization (HTML spans/marks)

- [ ] ~~Item annotations display in the left margin with correct icon/color~~ (DEFERRED — needs unified gutter design)

- [ ] ~~Annotations survive save/reload (markdown round-trip via~~ `{emoji}` ~~prefix)~~ (DEFERRED — needs unified gutter design)

- [ ] ~~Block drag handles appear on hover and allow reordering blocks~~ (DEFERRED — needs unified gutter design)

- [x] No console errors during normal operation with new features

- [x] All new controls disabled appropriately in source mode

### Design

- [x] New toolbar controls match existing button style (size, spacing, active state, muted-foreground color)

- [x] Floating table toolbar has frosted glass effect matching bubble menu

- [x] Color picker popover is compact and tasteful — no garish color grid

- [ ] ~~Annotation picker is cleanly laid out with clear iconography~~ (DEFERRED)

- [ ] ~~Drag handle is subtle (low opacity) and doesn't clutter the reading experience~~ (DEFERRED)

- [x] All new controls have tooltips with descriptions

- [x] All new features work correctly in both light and dark mode

- [x] New toolbar items don't cause toolbar overflow on 800px minimum window width

## Out of Scope

- Custom color input (hex/RGB) — curated palette only
- Drag handles for inline elements or within nested lists
- Table cell background colors (could be added later using highlight extension inside cells)
- Keyboard shortcuts for color/highlight (Cmd+Shift+H could conflict)
- Export of colors to PDF (Typst converter would need color support — separate effort)
- Windows/Linux file association
- Syncing annotation definitions across devices
- Column resizing via drag in the floating table toolbar (already supported by the Table extension's built-in resize handles)
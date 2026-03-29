# Callout Blocks — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-03-29 |
| **Status** | Complete |
| **PRD** | [callout-blocks](../prds/2026-03-29-callout-blocks.md) |
| **Research** | [rich-content-editor-features](../research/2026-03-29-rich-content-editor-features.md) |
| **Total** | 10 tasks: 4S, 4M, 2L |
| **Suggested order** | CSS (#1) → Extension (#2) → Markdown (#3-#4) → Slash/Toolbar (#5-#6) → Typst (#7) → Tests (#8-#9) → Polish (#10) |

### Risks & Open Questions

- **tiptap-markdown integration:** The project uses `tiptap-markdown` (not raw `prosemirror-markdown`). The callout node needs `addStorage() → markdown.serialize / markdown.parse` to hook into the serialization pipeline. The `Table.extend()` pattern in `useEditor.ts:82-91` is the reference for custom markdown handling on a node.
- **Blockquote interception:** The callout parser must intercept `> [!type]` lines *before* tiptap-markdown converts them to plain blockquotes. This may require a markdown preprocessor in `markdown.ts` that converts callout syntax to HTML `<div class="callout">` before tiptap-markdown parses it, or a `parseHTML` rule on the node that matches blockquotes with the callout pattern. The preprocessor approach is more reliable.
- **Content model:** `content: 'block+'` means callouts can hold paragraphs, lists, code blocks. Need to verify that Enter inside a callout creates a new paragraph within the callout (not outside it), and that Backspace at the start lifts content out.

---

### #1 — Add callout CSS variables and editor styles ✅

**Description:** Define the four callout color variables (accent + background) in `globals.css` for all four theme variants (light, soft light, dark, dark soft). Add callout block styles in `editor.css` — left border, tinted background, rounded corners, icon+label header area, smooth transitions.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/styles/globals.css` — add `--color-callout-{type}` and `--color-callout-{type}-bg` variables in all four theme blocks (after the existing editor content color section \~line 30)
- `src/styles/editor.css` — add `.callout`, `.callout-note`, `.callout-tip`, `.callout-warning`, `.callout-important` styles after the blockquote section (\~line 268)

---

### #2 — Create Callout Tiptap node extension ✅

**Description:** Create a new `Callout` node extension with `type` and `title` attrs. Implement `parseHTML` to match `<div class="callout callout-{type}">`, and `renderHTML` to output the callout container with the icon and label in a non-editable header div, and an editable content area below. Register the extension in `useEditor.ts`.

The node should:

- Use `content: 'block+'` to support paragraphs, lists, code inside
- Use `defining: true` so Enter at the end creates content inside, not outside
- Add a `setCallout` command to insert a callout of a given type
- Add a `toggleCallout` command to wrap/unwrap selection
- Handle Backspace at start of empty callout → lift to paragraph

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #1 **Files:**

- `src/components/editor/extensions/callout.ts` — new file
- `src/components/editor/extensions/index.ts` — export `Callout`
- `src/hooks/useEditor.ts` — register extension in the extensions array

---

### #3 — Add callout markdown parsing (preprocessor) ✅

**Description:** Add a markdown preprocessor in `markdown.ts` that converts Obsidian callout syntax to HTML before tiptap-markdown parses it. The preprocessor scans for blockquote lines matching `> [!type]` (case-insensitive) where type is one of `note`, `tip`, `warning`, `important`, extracts the optional title, and converts the entire blockquote block to `<div class="callout callout-{type}" data-title="{title}">...</div>`.

This approach is more reliable than trying to intercept tiptap-markdown's blockquote parsing, and follows the same pattern as other preprocessing in `markdown.ts` (e.g., `stripGhostTaskItems`, `encodeImagePathSpaces`).

Regular blockquotes starting with `[!` but with invalid types must remain as plain blockquotes.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #2 **Files:**

- `src/lib/markdown.ts` — add `convertCalloutsToHtml()` preprocessor, call it in `loadRawMarkdownIntoEditor()` and `setMarkdownInEditor()`

---

### #4 — Add callout markdown serialization ✅

**Description:** Add markdown serialization for the callout node via the `addStorage() → markdown.serialize` pattern (same as `Table.extend()` in `useEditor.ts:82-91`). The serializer outputs:

- First line: `> [!{type}]` or `> [!{type}] {title}` if custom title
- Body lines: `> {content}` with each paragraph/block prefixed with `>`
- Blank `>` line between paragraphs inside the callout

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #2 **Files:**

- `src/components/editor/extensions/callout.ts` — add `addStorage()` with `markdown.serialize` and `markdown.parse`

---

### #5 — Add callout slash command ✅

**Description:** Add a `/callout` entry to the slash command list that opens a submenu with the four callout types (Note, Tip, Warning, Important), each with its Lucide icon. Selecting a type inserts an empty callout block of that type at the cursor position.

Follow the existing `CommandItem` pattern in `slash-command.tsx`. The callout item should use the `info` icon and show the four types as sub-items (or insert a note callout directly and let the user change type via the header — depends on how sub-menus work in the current implementation).

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #2 **Files:**

- `src/components/editor/extensions/slash-command.tsx` — add callout command items to the `commands` array (after the blockquote entry \~line 104)

---

### #6 — Add callout toolbar button with type dropdown ✅

**Description:** Add a callout button to the top toolbar (after the blockquote button), using the `info` Lucide icon. Clicking shows a dropdown with the four types, each with icon and label. Selecting a type inserts a callout or changes the type if cursor is inside one. Active state detection via `editor.isActive('callout')`.

Also implement the type switcher: clicking the icon/label area inside an existing callout opens the same dropdown to switch types.

Follow the `HeadingPicker.tsx` pattern for the dropdown.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #2 **Files:**

- `src/components/editor/toolbar/CalloutPicker.tsx` — new file, dropdown component
- `src/components/editor/Toolbar.tsx` — add `CalloutPicker` after the blockquote button

---

### #7 — Add callout rendering in Typst/PDF export ✅

**Description:** Extend `markdown_to_typst.rs` to handle callout blocks. Since the Typst converter works on a comrak AST (which doesn't know about callouts), the converter needs to detect blockquotes whose first text starts with `[!type]` and render them as styled Typst blocks instead of plain `#quote`.

Render as a Typst `#block()` with:

- Colored left border (3-4px, using the callout type's color)
- Light tinted background fill
- Bold icon name + type label on the first line (icon as Unicode character or just the label)
- Body text below

**Complexity:** M **Category:** backend **Dependencies:** None (can be done in parallel with frontend tasks) **Files:**

- `src-tauri/src/export/markdown_to_typst.rs` — modify `BlockQuote` handler to detect callout syntax and render accordingly

---

### #8 — Add callout round-trip test fixtures ✅

**Description:** Create a markdown test fixture covering all callout variants and add it to the round-trip test suite. The fixture should cover:

- All four types (`note`, `tip`, `warning`, `important`)
- With and without custom titles
- Multi-paragraph callouts
- Callouts with inline formatting (bold, italic, code, links)
- Callout followed by regular blockquote (no false positive)
- Regular blockquote starting with `[!invalid]` (must remain blockquote)

Verify all existing round-trip tests still pass.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #3, #4 **Files:**

- `tests/fixtures/callouts.md` — new fixture file
- Existing round-trip test runner picks up new fixtures automatically (verify this)

---

### #9 — Add unit tests for callout parsing, serialization, and extension ✅

**Description:** Write vitest unit tests covering:

- Callout markdown preprocessor: all four types, case insensitivity, custom titles, invalid types preserved as blockquotes, multi-paragraph
- Callout serializer: all four types with/without titles, multi-paragraph output
- Callout node: `setCallout` command, `toggleCallout`, type switching, Backspace-to-lift behavior
- Typst export: callout blocks rendered correctly (Rust test in `markdown_to_typst.rs`)

**Complexity:** L **Category:** both **Dependencies:** Depends on #3, #4, #7 **Files:**

- `src/lib/__tests__/callout-markdown.test.ts` — new test file for preprocessor + serializer
- `src/components/editor/extensions/__tests__/callout.test.ts` — new test file for extension behavior
- `src-tauri/src/export/markdown_to_typst.rs` — add `#[test]` for callout rendering

---

### #10 — Polish and visual QA ✅

**Description:** Final polish pass across both themes:

- Verify all four callout types look correct in light and dark mode (and soft contrast variants)
- Smooth transitions on hover and type switch
- Consistent spacing and border-radius with the rest of the editor
- Cursor navigation into/out of callouts works naturally
- Verify callouts in PDF export look professional with correct colors

No new files — adjustments to CSS variables, editor styles, and extension rendering as needed.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #1-#9 **Files:**

- `src/styles/globals.css` — tune color values if needed
- `src/styles/editor.css` — tune spacing, transitions
- `src/components/editor/extensions/callout.ts` — rendering adjustments
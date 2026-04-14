# Tiptap Feature Audit — Implementation Tasks

|  |  |
| --- | --- |
| **Date** | 2026-04-14 |
| **Status** | Partial — 8 tasks done, 3 skipped, 5 N/A |
| **Source** | [Tiptap Feature Audit](../audit/2026-04-12-tiptap-feature-audit.md) |
| **Total** | 16 tasks: 5S, 7M, 4L |
| **Suggested order** | Quick wins (#1-#2) → Formatting (#3-#5) → Rich blocks (#6-#8) → Foundational (#9) → Refactoring (#10-#11) → Tests (#12-#16) |

**Risks & open questions:**

- Mathematics (KaTeX) adds ~300KB to the bundle — measure impact on startup
- UniqueID needs a strategy for surviving markdown round-trips (IDs in frontmatter? HTML comments? YAML metadata?)
- Details/collapsible blocks have no standard markdown syntax — we'll use `<details><summary>` HTML which GFM renders natively
- Subscript/superscript markdown syntax (`~sub~` / `^sup^`) is not GFM-standard — needs custom input rules and serializer entries

---

## Phase 1 — Quick Wins (< 30 min combined)

### #1 — Add Trailing Node extension ✅

**Description:** Install and configure `@tiptap/extension-trailing-node` so users can always click below the last block to add content. Zero markdown impact — this only ensures an empty paragraph exists at the end of the document in the editor, never serialized.

**Complexity:** S  
**Category:** frontend  
**Dependencies:** None  
**Files:**
- `package.json` (add dependency)
- `src/hooks/useEditor.ts` (add to extensions array)

**Acceptance criteria:**
- After the last block in a document (e.g., a code block, table, or image), a trailing empty paragraph is automatically added
- The trailing node is not serialized to markdown (verify round-trip test still passes)

---

### #2 — Add List Keymap extension ✅

**Description:** Install and configure `@tiptap/extension-list-keymap` for better list editing behavior: Backspace at the start of a list item lifts it out of the list, Enter on an empty list item exits the list.

**Complexity:** S  
**Category:** frontend  
**Dependencies:** None  
**Files:**
- `package.json` (add dependency)
- `src/hooks/useEditor.ts` (add to extensions array)

**Acceptance criteria:**
- Pressing Backspace at the start of a list item (bullet, ordered, or task) removes the bullet and turns it into a paragraph
- Pressing Enter on an empty list item exits the list and creates a normal paragraph
- Existing list behavior (Tab/Shift+Tab indent/outdent) still works
- Round-trip tests still pass

---

## Phase 2 — Formatting Palette Completion

### #3 — Add Subscript mark ✅

**Description:** Install `@tiptap/extension-subscript`, add markdown round-tripping for `~sub~` syntax, add toolbar button, add keyboard shortcut.

**Complexity:** M  
**Category:** frontend  
**Dependencies:** None  
**Files:**
- `package.json` (add dependency)
- `src/hooks/useEditor.ts` (add to extensions array)
- `src/lib/markdown.ts` (add subscript mark parse/serialize rules — `~` delimiter)
- `src/components/editor/Toolbar.tsx` (add Subscript button after Strikethrough)
- `src/components/editor/BubbleMenu.tsx` (add Subscript option if appropriate)
- `src/styles/editor.css` (subscript styling if needed)

**Acceptance criteria:**
- `~text~` in markdown renders as subscript in the editor
- Subscript text serializes back to `~text~` in markdown
- Toolbar button toggles subscript on selected text
- Round-trip test with subscript content passes
- Does not conflict with strikethrough (`~~text~~`)

---

### #4 — Add Superscript mark ✅

**Description:** Install `@tiptap/extension-superscript`, add markdown round-tripping for `^sup^` syntax, add toolbar button, add keyboard shortcut.

**Complexity:** M  
**Category:** frontend  
**Dependencies:** None  
**Files:**
- `package.json` (add dependency)
- `src/hooks/useEditor.ts` (add to extensions array)
- `src/lib/markdown.ts` (add superscript mark parse/serialize rules — `^` delimiter)
- `src/components/editor/Toolbar.tsx` (add Superscript button after Subscript)
- `src/styles/editor.css` (superscript styling if needed)

**Acceptance criteria:**
- `^text^` in markdown renders as superscript in the editor
- Superscript text serializes back to `^text^` in markdown
- Toolbar button toggles superscript on selected text
- Round-trip test with superscript content passes

---

### #5 — Add Focus extension for enhanced focus mode ✅

**Description:** Install `@tiptap/extension-focus` and use it to dim non-focused paragraphs when focus mode (Cmd+.) is active. The extension adds a `has-focus` CSS class to the currently focused node.

**Complexity:** S  
**Category:** frontend  
**Dependencies:** None  
**Files:**
- `package.json` (add dependency)
- `src/hooks/useEditor.ts` (add to extensions array with `className: 'has-focus'`, `mode: 'deepest'`)
- `src/styles/editor.css` (add focus mode dimming styles: `.focus-mode .ProseMirror > *:not(.has-focus) { opacity: 0.3; transition: opacity 200ms; }`)

**Acceptance criteria:**
- In focus mode, the paragraph/block containing the cursor is fully visible; all other blocks are dimmed
- Dimming transitions smoothly (200ms)
- Outside focus mode, no visual effect
- No impact on markdown serialization

---

## Phase 3 — Rich Content Blocks

### #6 — Add Mathematics / LaTeX support — SKIPPED

**Description:** Install `@tiptap/extension-mathematics` with KaTeX for rendering LaTeX equations. Support both inline (`$...$`) and display (`$$...$$`) math in markdown. Add to export pipelines (Typst, HTML, DOCX).

**Complexity:** L  
**Category:** both  
**Dependencies:** None  
**Files:**
- `package.json` (add `@tiptap/extension-mathematics`, `katex`)
- `src/hooks/useEditor.ts` (add Mathematics extension)
- `src/lib/markdown.ts` (add math node/mark parse and serialize rules)
- `src/styles/editor.css` (KaTeX styling overrides for theme integration)
- `src/components/editor/SlashCommand.tsx` (add `/math` slash command for display math)
- `src-tauri/src/export/markdown_to_typst.rs` (convert `$...$` to Typst `$ ... $` math)
- `src-tauri/src/export/markdown_to_html.rs` (render math with KaTeX server-side or pass through)
- `src-tauri/src/export/markdown_to_docx.rs` (degrade math to monospace code or OMML if feasible)
- `tests/fixtures/` (add math round-trip test fixture)

**Acceptance criteria:**
- `$E=mc^2$` renders inline as a KaTeX-rendered equation
- `$$\int_0^1 f(x)\,dx$$` renders as a centered display equation
- Math round-trips through markdown without loss
- PDF export renders math correctly via Typst's native math support
- HTML preview renders math via KaTeX CSS
- DOCX export degrades gracefully (monospace or equation field)
- Bundle size impact documented

---

### #7 — Add Collapsible Details blocks — SKIPPED

**Description:** Install `@tiptap/extension-details` (details, details-summary, details-content — 3 packages) for collapsible sections. Use `<details><summary>` HTML syntax in markdown (GFM-native). Add to export pipelines.

**Complexity:** L  
**Category:** both  
**Dependencies:** None  
**Files:**
- `package.json` (add `@tiptap/extension-details`, `@tiptap/extension-details-summary`, `@tiptap/extension-details-content`)
- `src/hooks/useEditor.ts` (add all three extensions)
- `src/lib/markdown.ts` (parse `<details><summary>...</summary>...</details>` HTML → details node; serialize back)
- `src/components/editor/SlashCommand.tsx` (add `/details` or `/collapsible` slash command)
- `src/styles/editor.css` (collapsible styling — chevron animation, border, padding)
- `src-tauri/src/export/markdown_to_typst.rs` (render as boxed content with title, or Typst `block` with label)
- `src-tauri/src/export/markdown_to_html.rs` (native `<details>` passthrough)
- `src-tauri/src/export/markdown_to_docx.rs` (render as boxed content block)
- `tests/fixtures/` (add details round-trip test fixture)

**Acceptance criteria:**
- `<details><summary>Click me</summary>Hidden content</details>` in markdown renders as a collapsible block
- Clicking the summary toggles content visibility with smooth animation
- Content inside details supports all block types (paragraphs, lists, code blocks, etc.)
- Round-trip test passes (HTML `<details>` preserved)
- Slash command inserts a details block with placeholder summary
- Export to PDF, HTML, and DOCX renders appropriately

---

### #8 — Add Table of Contents extension (persistent outline panel) — SKIPPED

**Description:** Install `@tiptap/extension-table-of-contents` and use it to power a persistent outline sidebar panel (in addition to the existing Cmd+Shift+O command palette outline). The extension provides a reactive list of headings that updates as the document changes.

**Complexity:** M  
**Category:** frontend  
**Dependencies:** None  
**Files:**
- `package.json` (add dependency)
- `src/hooks/useEditor.ts` (add extension, configure `onUpdate` callback)
- `src/components/editor/OutlinePanel.tsx` (new — persistent heading outline panel)
- `src/components/Layout.tsx` (add outline panel toggle)
- `src/stores/settings-store.ts` (add `showOutlinePanel` preference)

**Acceptance criteria:**
- A toggleable outline panel shows all headings (H1-H6) with indentation
- Clicking a heading scrolls to it in the editor
- Outline updates live as headings are added/removed/edited
- Panel can be shown/hidden via settings or keyboard shortcut
- Active heading highlighted based on scroll position

---

## Phase 4 — Foundational Infrastructure

### #9 — Add UniqueID extension for stable node identity ✅

**Description:** Install `@tiptap/extension-unique-id` to assign stable UUIDs to block-level nodes. This improves comment anchoring (currently position-based, breaks on edits) and prepares for deep linking and collaboration. **Key challenge:** IDs must survive markdown round-trips. Strategy: store as HTML comments (`<!-- id:uuid -->`) before each block, or in a sidecar map file.

**Complexity:** L  
**Category:** both  
**Dependencies:** None  
**Files:**
- `package.json` (add dependency)
- `src/hooks/useEditor.ts` (add extension, configure `types` and `attributeName`)
- `src/lib/markdown.ts` (add serialization/parsing for node IDs — HTML comment strategy)
- `src/components/editor/extensions/comment-mark.ts` (refactor to use node IDs for comment anchoring instead of raw positions)
- `src/stores/comment-store.ts` (update comment model to reference node IDs)
- `tests/fixtures/` (add round-trip fixture with node IDs)

**Acceptance criteria:**
- Every block-level node (paragraph, heading, list item, code block, etc.) gets a stable UUID
- IDs persist through save/reload (markdown round-trip)
- IDs survive document edits (inserting/deleting content above doesn't change existing IDs)
- Comment anchoring uses node ID + offset instead of raw document position
- Existing comments migrated (fallback to position-based if no ID found)

**Open questions:**
- HTML comment approach (`<!-- id:uuid -->`) — will this survive all markdown parsers? Need to test with comrak
- Performance impact of UUID generation on large documents
- Should IDs be visible in source mode?

---

## Phase 5 — Refactoring Opportunities

### #10 — Create shared decoration plugin factory ✅

**Description:** Extract the common boilerplate from our 14 decoration-based extensions into a `createDecorationPlugin()` helper. Each extension follows the same pattern: `PluginKey` → `Plugin` with `DecorationSet` state → update on `docChanged` or `setMeta` → return `DecorationSet` in `props.decorations()`. A shared factory would reduce ~50% boilerplate.

**Complexity:** M  
**Category:** frontend  
**Dependencies:** None  
**Files:**
- `src/components/editor/extensions/decoration-factory.ts` (new — shared plugin factory)
- `src/components/editor/extensions/tag-highlight.ts` (refactor to use factory)
- `src/components/editor/extensions/mention-highlight.ts` (refactor to use factory)
- `src/components/editor/extensions/date-highlight.ts` (refactor to use factory)
- `src/components/editor/extensions/table-sparkline.ts` (refactor to use factory)
- Additional extensions as appropriate

**Acceptance criteria:**
- `createDecorationPlugin({ key, buildDecorations, onMeta? })` encapsulates the common pattern
- At least 4 simpler decoration extensions migrated to the factory
- Complex extensions (search-highlight, comment-mark, ghost-text) left as-is — they have unique state management
- All existing tests still pass
- No behavioral changes

---

### #11 — Migrate direct `view.dispatch(tr)` calls to Tiptap chain API ✅

**Description:** Gradually migrate direct ProseMirror `view.dispatch(tr)` calls to Tiptap's `editor.chain().command(({ tr }) => { ... }).run()` pattern where the transaction logic is simple enough. This improves consistency and error handling without touching the complex cases.

**Complexity:** M  
**Category:** frontend  
**Dependencies:** None  
**Files:**
- `src/lib/markdown.ts` (evaluate — `view.updateState()` must stay, but some `view.dispatch()` calls may be migratable)
- `src/components/editor/editor-utils.ts` (migrate scroll-to-position dispatch)
- Other utility files as identified

**Acceptance criteria:**
- Simple `view.dispatch(tr)` calls converted to `editor.chain()` where equivalent
- Complex cases (multi-step transactions, EditorState cache management) left as-is with comments explaining why
- No behavioral changes
- All tests pass

---

## Phase 6 — Tests

### #12 — Add round-trip test fixtures for new extensions ✅

**Description:** Create markdown test fixtures that cover trailing node, list keymap edge cases, subscript, superscript, math, and details blocks. Add to the existing round-trip test suite.

**Complexity:** S  
**Category:** frontend  
**Dependencies:** #1, #2, #3, #4, #6, #7  
**Files:**
- `tests/fixtures/subscript-superscript.md` (new)
- `tests/fixtures/mathematics.md` (new)
- `tests/fixtures/details-collapsible.md` (new)
- Existing round-trip test runner picks them up automatically

**Acceptance criteria:**
- Each fixture covers the new syntax in various contexts (inline, nested, in lists, in tables)
- All fixtures pass the parse → serialize → compare round-trip test

---

### #13 — Add unit tests for subscript/superscript markdown rules ✅

**Description:** Test the custom markdown parse/serialize rules for `~sub~` and `^sup^` syntax, including edge cases: nested marks, adjacent delimiters, inside code blocks (should not parse), interaction with strikethrough (`~~`).

**Complexity:** S  
**Category:** frontend  
**Dependencies:** #3, #4  
**Files:**
- `src/lib/__tests__/markdown-sub-sup.test.ts` (new)

**Acceptance criteria:**
- `~sub~` parses to subscript, `~~strike~~` still parses to strikethrough
- `^sup^` parses to superscript
- Neither parses inside backtick code
- Nested: `~sub **bold**~` works correctly
- Serialize round-trips match

---

### #14 — Add unit tests for mathematics markdown rules — N/A (skipped #6)

**Description:** Test inline math (`$...$`), display math (`$$...$$`), edge cases with dollar signs in normal text, math inside code blocks.

**Complexity:** S  
**Category:** frontend  
**Dependencies:** #6  
**Files:**
- `src/lib/__tests__/markdown-math.test.ts` (new)

**Acceptance criteria:**
- `$x^2$` parses as inline math
- `$$\sum_{i=0}^n$$` parses as display math block
- `$5.00` (single dollar) does NOT parse as math
- Math inside code blocks is not parsed
- Round-trip preserves math delimiters

---

### #15 — Add export pipeline tests for new content types ✅

**Description:** Add Rust tests for math, details, subscript/superscript in the Typst, HTML, and DOCX export pipelines.

**Complexity:** M  
**Category:** backend  
**Dependencies:** #3, #4, #6, #7  
**Files:**
- `src-tauri/src/export/markdown_to_typst.rs` (add test cases)
- `src-tauri/src/export/markdown_to_html.rs` (add test cases)
- `src-tauri/src/export/markdown_to_docx.rs` (add test cases)

**Acceptance criteria:**
- Typst export converts `$...$` to Typst math syntax
- HTML export renders math, details, sub/sup correctly
- DOCX export degrades math gracefully
- All existing export tests still pass

---

### #16 — Performance benchmark for new extensions ✅

**Description:** Run `pnpm test:perf` after all new extensions are added. Measure impact on parse/serialize benchmarks (the new markdown rules add processing) and decoration rebuilds (Focus extension adds per-keystroke work). Record results in `docs/performance-baseline.md`.

**Complexity:** M  
**Category:** frontend  
**Dependencies:** #1-#9  
**Files:**
- `docs/performance-baseline.md` (append measurements)
- `src/perf/markdown.perf.test.ts` (update fixtures if needed to include new syntax)

**Acceptance criteria:**
- All perf benchmarks pass within budget (1x dev, 1.5x CI)
- New extensions don't regress parse/serialize by more than 10%
- Measurements recorded with commit hash and date

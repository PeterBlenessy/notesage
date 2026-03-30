# Dynamic Table Enhancements — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-03-29 |
| **Status** | Complete |
| **PRD** | [dynamic-table-enhancements](../prds/2026-03-29-dynamic-table-enhancements.md) |
| **Research** | [rich-content-editor-features](../research/2026-03-29-rich-content-editor-features.md) |
| **Total** | 14 tasks: 5S, 5M, 4L |
| **Suggested order** | Column metadata (#1-#2) → Formatting (#3) → Aggregation (#4-#5) → Sorting (#6-#7) → Filtering (#8) → Sparklines (#9-#10) → Context menu (#11) → PDF (#12) → Tests (#13) → Polish (#14) |

### Risks & Open Questions

- **Existing table infrastructure:** The table already uses `@tiptap/extension-table` with a custom `serializeTable` in `table-markdown.ts`. All changes extend this — `TableHeader.extend()` adds attrs, and the serializer needs to emit/parse HTML comments. The `serializeTable` function is a key touchpoint; changes here affect all table round-tripping.
- **Decoration vs document node for footer:** The PRD specifies the footer as a ProseMirror decoration (computed view layer, not in the document). This is the right call — it avoids corrupting the table structure in markdown. But decorations on `table` nodes require careful position mapping, and the decoration must be recalculated on every edit within the table.
- **Number parsing fragility:** Parsing numeric values from free-text cells (stripping `$`, `,`, `%`, currency symbols) is inherently fragile. Need a robust parser that handles locale variations (`42.000,50` vs `42,000.50`) and doesn't crash on non-numeric content.
- **Sort as document mutation:** Sorting physically reorders table rows in ProseMirror, creating undo-able transactions. This is intentional (row order persists to markdown) but means sort is NOT a view-only operation — it modifies the document.
- **Sparkline decoration pattern:** The `{{spark:...}}` syntax uses the same inline decoration approach as `#tag` badges (`tag-highlight.ts`). The decoration replaces text content with an SVG widget. Need to ensure the decoration doesn't interfere with cell editing — the raw text must remain editable when the cell is focused.

---

### #1 — Extend TableHeader with column metadata attributes ✅

**Description:** Extend the `TableHeader` node (already configured in `useEditor.ts`) with new attributes: `colType`, `colCurrency`, `colAggregation`, and `colSortDirection`. Use the `TableHeader.extend({ addAttributes() {...} })` pattern.

Attributes:

- `colType`: `'text' | 'number' | 'currency' | 'percentage' | 'date'`, default `'text'`
- `colCurrency`: `string | null` (ISO 4217 code), default `null`
- `colAggregation`: `'sum' | 'avg' | 'count' | 'min' | 'max' | null`, default `null`
- `colSortDirection`: `'asc' | 'desc' | null`, default `null` (transient — not serialized to markdown)

Ensure attrs are preserved across header cell operations (merge/split, add/remove column).

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/hooks/useEditor.ts` — extend `TableHeader.configure()` with `addAttributes()`
- `src/components/editor/extensions/table-column-types.ts` — new file with type constants and interfaces

---

### #2 — Add HTML comment metadata parsing and serialization to table markdown ✅

**Description:** Extend the existing `serializeTable` in `table-markdown.ts` to:

**Serialize:** Append `<!-- type:number,currency:USD,summary:sum -->` HTML comments after header cell text when column metadata exists. Only emit comments for non-default values.

**Parse:** Detect `<!-- key:value,key:value -->` patterns in header cells during markdown→ProseMirror parsing. Extract metadata and set corresponding `TableHeader` attributes. Strip the comment from the visible cell text.

Must not break existing tables without metadata. All current table round-trip tests must continue to pass.

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #1 **Files:**

- `src/components/editor/extensions/table-markdown.ts` — extend `serializeTable`, add parse logic
- `src/lib/markdown.ts` — may need a preprocessor if tiptap-markdown strips HTML comments before reaching the table parser

---

### #3 — Implement number formatting decoration layer ✅

**Description:** Create a ProseMirror plugin that decorates typed table cells with formatted display values. The document stores raw values; the decoration layer shows formatted text:

- `number`: `42000` → `42,000` (via `Intl.NumberFormat`)
- `currency` (USD): `42000` → `$42,000`
- `currency` (EUR): `42000` → `€42,000` / `42 000 €`
- `percentage`: `0.85` → `85%`
- `date`: `2026-03-29` → `Mar 29, 2026` (via `Intl.DateTimeFormat`)

The decoration replaces the cell content's text visually but preserves the raw value in the document. When the user focuses a cell to edit, the decoration is removed (raw value shown).

Include a `parseNumericValue(text: string, colType: string)` utility that strips currency symbols, commas, percentage signs, and returns a clean number (or NaN for non-numeric content).

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #1 **Files:**

- `src/components/editor/extensions/table-formatting.ts` — new ProseMirror plugin
- `src/lib/number-format.ts` — new file with formatting and parsing utilities

---

### #4 — Implement aggregation computation engine ✅

**Description:** Create a pure function that computes column aggregations:

```typescript
computeAggregations(table: ProseMirrorNode): AggregationResult[]
```

For each column with `colAggregation` set on its header:

1. Iterate data rows (skip header row)
2. Parse numeric values from cells using `parseNumericValue` from #3
3. Compute the requested aggregation (sum, avg, count, min, max)
4. Format the result according to the column type
5. Return `{ columnIndex, type, value, formatted }`

Skip non-numeric cells (count them for COUNT, ignore for SUM/AVG/MIN/MAX). Handle empty tables gracefully.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #3 **Files:**

- `src/components/editor/extensions/table-aggregation.ts` — new file with computation logic

---

### #5 — Render aggregation footer row as decoration ✅

**Description:** Create a ProseMirror plugin that renders a footer `<tr>` below the table via a node decoration when any column has an aggregation configured. The footer:

- Displays computed values from #4
- Uses label prefixes: "Sum:", "Avg:", "Count:", "Min:", "Max:"
- Styled distinctly: `bg-muted`, `text-xs`, `text-muted-foreground`
- Non-editable, non-selectable
- Updates on every document change (debounced \~100ms for typing performance)
- Disappears when no columns have aggregations

The decoration attaches to the `table` node. Column widths must match the data rows.

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #4 **Files:**

- `src/components/editor/extensions/table-aggregation.ts` — add ProseMirror plugin with footer decoration
- `src/styles/editor.css` — add footer row styles

---

### #6 — Implement column sorting logic ✅

**Description:** Create a ProseMirror command that sorts table rows by a given column:

```typescript
sortTableByColumn(columnIndex: number, direction: 'asc' | 'desc' | null): Command
```

The command:

1. Reads all data rows (skip header)
2. Extracts the sort key from the specified column (use `parseNumericValue` for typed columns, string comparison for text)
3. Sorts rows according to direction
4. Creates a transaction that replaces table rows in the new order
5. Updates the `colSortDirection` attr on the header cell

Sorting is a document mutation (undo-able). `colSortDirection` is transient — used for the UI indicator but not persisted.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #1 **Files:**

- `src/components/editor/extensions/table-sort.ts` — new file with sort command

---

### #7 — Add sort indicators to column headers ✅

**Description:** Add visual sort indicators (▲/▼) to header cells that have `colSortDirection` set. Implement as a ProseMirror decoration on `TableHeader` nodes:

- Small arrow icon right-aligned within the header cell
- Muted color (`--color-muted-foreground`)
- ▲ for ascending, ▼ for descending
- Click handler on header cells: cycle through asc → desc → null
- Hover on any header shows a subtle sort affordance (muted arrow outline)

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #6 **Files:**

- `src/components/editor/extensions/table-sort.ts` — add decoration plugin and click handler
- `src/styles/editor.css` — add sort indicator styles

---

### #8 — Implement row filtering ✅

**Description:** Add a filter row that appears below the table header when activated. The filter:

- Toggled via a filter icon in the table toolbar
- Shows a single text input spanning the table width (or per-column inputs)
- Case-insensitive substring matching across all columns (or the focused column)
- Non-matching rows hidden via CSS `display: none` decoration (rows remain in document)
- Filter state is transient (not persisted)
- Clearing the filter or closing the filter row restores all rows

Follow the `FindBar` pattern for the floating filter input.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #1 **Files:**

- `src/components/editor/extensions/table-filter.ts` — new file with filter plugin and decoration
- `src/components/editor/TableToolbar.tsx` — add filter toggle button
- `src/styles/editor.css` — add filter row styles

---

### #9 — Implement sparkline SVG renderer ✅

**Description:** Create a pure function that generates an inline SVG `<polyline>` from a comma-separated list of numbers:

```typescript
renderSparkline(data: number[], width: number, height: number): SVGElement
```

Output: \~60px × 20px SVG with:

- Polyline stroke in `--color-muted-foreground` at \~50% opacity
- Optional subtle fill gradient below the line
- No axes, no labels — just the shape
- Graceful handling of 0-1 data points (show a dot or flat line)

Hand-rolled SVG — no library needed.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/sparkline.ts` — new file with SVG generation

---

### #10 — Implement sparkline decoration in table cells ✅

**Description:** Create a ProseMirror plugin that detects `{{spark:12,15,9,22,18}}` patterns in table cell content and renders them as inline SVG widgets via `Decoration.widget()`.

Follow the same pattern as `tag-highlight.ts`:

- Scan document for `{{spark:...}}` regex matches
- Replace matched text range with an inline widget decoration
- Widget renders the SVG from #9
- When the cell is focused for editing, the decoration shows raw text
- The raw `{{spark:...}}` syntax survives markdown round-tripping as plain text

Also add a "Insert sparkline" option to the table cell context menu with a simple prompt for comma-separated values.

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #9 **Files:**

- `src/components/editor/extensions/table-sparkline.ts` — new ProseMirror plugin
- `src/styles/editor.css` — add sparkline styles

---

### #11 — Build column configuration context menu ✅

**Description:** Extend the existing table header right-click context menu with:

- **Column type** submenu: Text, Number, Currency, Percentage, Date
- **Currency** submenu (visible when type is Currency): USD, EUR, GBP, SEK, JPY, CNY, etc.
- **Summarize** submenu: None, Sum, Average, Count, Min, Max
- Separator before existing options

Use shadcn/ui `ContextMenu` with `ContextMenuSub` for submenus. The menu items dispatch ProseMirror transactions to update `TableHeader` attributes.

Also add a subtle type badge in header cells (small icon/symbol: `#` for number, `$` for currency, `%` for percentage, `📅` for date).

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #1, #3, #4, #6 **Files:**

- `src/components/editor/TableToolbar.tsx` — extend header context menu (or create separate `TableHeaderMenu.tsx`)
- `src/styles/editor.css` — add type badge styles

---

### #12 — Add table enhancements to Typst/PDF export ✅

**Description:** Extend the Typst converter to handle enhanced tables:

- **Aggregation footer:** Parse `<!-- summary:sum -->` from markdown header comments, compute aggregation from table data, render as a styled footer row in Typst
- **Number formatting:** Apply `Intl`-style formatting in the Rust converter (or format in the `markdown_to_typst` pass using hardcoded patterns)
- **Sparklines:** Detect `{{spark:...}}` in cells, either render as tiny SVG embedded in Typst or degrade to the comma-separated numbers as text

The column metadata HTML comments are already in the markdown by #2 — the Typst converter reads them to determine formatting.

**Complexity:** S **Category:** backend **Dependencies:** Depends on #2 **Files:**

- `src-tauri/src/export/markdown_to_typst.rs` — extend table rendering with footer, formatting, sparkline handling

---

### #13 — Add unit and round-trip tests ✅

**Description:** Write tests covering:

- **Number parsing:** Strip currency, commas, percentages; handle locale variations; NaN for non-numeric
- **Aggregation computation:** Sum, avg, count, min, max with edge cases (empty column, non-numeric cells, single value)
- **HTML comment metadata:** Parse and serialize round-trip; multiple attributes; empty/default values
- **Sort command:** Ascending, descending, unsorted; numeric vs text sort; preserves non-sorted columns
- **Sparkline SVG:** Valid data, edge cases (empty, single point, negative values)
- **Sparkline decoration:** `{{spark:...}}` regex matching, non-matching text unaffected
- **Round-trip fixture:** `tests/fixtures/dynamic-tables.md` with typed columns, metadata comments, sparkline syntax

All existing table round-trip tests must continue to pass.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #2, #3, #4, #6, #9 **Files:**

- `tests/fixtures/dynamic-tables.md` — new round-trip fixture
- `src/lib/__tests__/number-format.test.ts` — parsing and formatting tests
- `src/lib/__tests__/sparkline.test.ts` — SVG generation tests
- `src/components/editor/extensions/__tests__/table-aggregation.test.ts` — computation tests
- `src/components/editor/extensions/__tests__/table-sort.test.ts` — sort command tests

---

### #14 — Polish and visual QA ✅

**Description:** Final polish:

- Footer row alignment with data columns across various table widths
- Sort indicators visible but unobtrusive in both themes
- Number formatting for various locales
- Sparkline rendering at different cell widths
- Column type badges readable but not distracting
- Filter row appearance and dismiss behavior
- All features work in both light and dark mode (and soft contrast)
- No performance regression on large tables (10+ columns, 50+ rows)
- Tab/arrow key navigation through table cells still works with decorations

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #1-#13 **Files:**

- `src/styles/editor.css` — tune styles
- Various extension files — visual adjustments
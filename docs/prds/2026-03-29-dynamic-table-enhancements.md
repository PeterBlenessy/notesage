# PRD: Dynamic Table Enhancements

|  |  |
| --- | --- |
| **Date** | 2026-03-29 |
| **Status** | Draft |
| **Priority** | Medium |
| **Impact** | Tables become actionable with column summaries, typed data, sorting, and inline sparklines |
| **Research** | [rich-content-editor-features](../research/2026-03-29-rich-content-editor-features.md) |
| **Tasks** | [dynamic-table-enhancements-tasks](../tasks/2026-03-29-dynamic-table-enhancements-tasks.md) |

## Problem

Notesage tables are static grids of text. Users writing reports with numerical data — budgets, metrics, scores, timelines — must manually calculate totals, format numbers, and sort rows. There is no way to sum a column, distinguish between text and numbers, or visualize trends inline. This makes tables less useful than a spreadsheet export pasted as an image.

Coda's insight applies here: users don't need cell-level spreadsheet formulas. They need column-level aggregations (SUM, AVERAGE, COUNT) and basic typed formatting (currency, percentage) — the 20% of spreadsheet features that cover 80% of report table needs.

## Goals

1. **Column aggregation footer** — SUM, AVERAGE, COUNT, MIN, MAX computed and displayed in a summary row below the table
2. **Column types** — text, number, currency, percentage, date — with locale-aware formatting
3. **Column sorting** — click header to sort ascending/descending
4. **Row filtering** — temporary view filter to find rows matching a condition
5. **Sparklines** — tiny inline SVG charts in table cells showing trends at a glance

## Non-Goals

- Cell-level formulas (`=SUM(A1:A5)`) — requires expression parser, dependency graph, recalculation engine; enormous complexity for marginal benefit
- Cross-table references or relations — requires a document-level database; not appropriate for a note editor
- Column resize via drag — already supported by Tiptap's resizable table extension
- Conditional formatting (color cells based on value) — adds visual complexity; deferred
- Data import from CSV/Excel into tables

## User Stories

- As a report author, I want to see the sum of a numeric column in a footer row so I don't have to calculate totals manually
- As a user, I want to mark a column as "currency" so numbers display with currency symbols and proper formatting
- As a user reviewing a data table, I want to sort by any column so I can quickly find the highest or lowest values
- As a user, I want tiny sparkline charts in table cells so I can see trends at a glance alongside numbers
- As a user, I want table enhancements to round-trip through markdown so my data survives save/reload without losing types or summaries

## Technical Approach

### Extending the Existing Table

Notesage already uses `@tiptap/extension-table` with `TableRow`, `TableCell`, and `TableHeader` nodes, plus a custom `serializeTable` markdown serializer. All enhancements build on this existing infrastructure — no replacement or parallel table system.

### Column Metadata via Node Attributes

Add attributes to `TableHeader` cells to store column configuration:

```typescript
TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      colType: { default: 'text' },           // 'text' | 'number' | 'currency' | 'percentage' | 'date'
      colCurrency: { default: null },          // 'USD' | 'EUR' | 'SEK' | etc. (ISO 4217)
      colAggregation: { default: null },       // 'sum' | 'avg' | 'count' | 'min' | 'max' | null
      colSortDirection: { default: null },     // 'asc' | 'desc' | null (transient, not persisted to markdown)
    };
  },
});
```

Storing metadata on header cells is natural — each header cell governs its column. This avoids a separate metadata store or sidecar file.

### Aggregation Footer Row

The footer row is rendered as a **ProseMirror decoration**, not a document node. This keeps the document model clean — the footer is a computed view layer that updates automatically when cell values change.

**Computation:**

1. On every document change (debounced), scan tables for columns with `colAggregation` set
2. Parse numeric values from cells in that column (strip currency symbols, commas, percentages)
3. Compute the aggregation (sum, average, count, min, max)
4. Update the decoration with formatted results

**Rendering:**

- A `<tr>` appended below the last table row via a node decoration on the `table` node
- Distinct styling: muted background (`bg-muted`), smaller text (`text-xs`), label prefix ("Sum: 1,234")
- Non-editable — clicking the footer does nothing; it's purely display

### Number Formatting

When a column has a type set, cell values are formatted on render (the document stores raw values, the DOM shows formatted):

| Type | Raw Value | Displayed |
| --- | --- | --- |
| `number` | `42000` | `42,000` |
| `currency` (USD) | `42000` | `$42,000` |
| `currency` (EUR) | `42000` | `42 000 €` |
| `percentage` | `0.85` | `85%` |
| `date` | `2026-03-29` | `Mar 29, 2026` |

Formatting uses `Intl.NumberFormat` and `Intl.DateTimeFormat` for locale awareness. The raw value stays in the document; formatting is a display-only decoration layer.

### Column Sorting

**UX:** Click a column header → sort ascending. Click again → descending. Click again → unsorted.

**Implementation:** Sorting reorders the ProseMirror table rows via a transaction. This is a document-level change (the row order physically changes). A small sort indicator arrow appears in the header cell.

`colSortDirection` is transient — it's used to render the indicator but not persisted to markdown. The physical row order in markdown reflects the last sort applied.

### Row Filtering

**UX:** A filter icon in the table toolbar opens a filter row below the header. Type a search term → rows that don't match are hidden (via CSS `display: none` decoration, not removed from the document).

**Implementation:** Filter state is transient (not persisted). The filter input is a floating element anchored to the table, similar to the existing FindBar pattern. Filtering uses simple case-insensitive substring matching across all columns.

### Sparklines

Tiny inline SVG charts (\~60px × 20px) rendered inside table cells.

**UX:** Right-click a cell → "Insert sparkline" → enter comma-separated values (e.g., `12,15,9,22,18`) → a tiny line chart renders inline.

**Implementation:** A custom ProseMirror decoration that detects sparkline data patterns in cell content. The cell stores data as `{{spark:12,15,9,22,18}}` — a custom inline syntax that the decoration renders as SVG. The raw syntax survives markdown round-tripping; other renderers show it as plain text.

**Rendering:** Hand-rolled SVG `<polyline>` — sparklines are simple enough that no library is needed. Stroke color matches `--color-muted-foreground`. Optional: fill area below the line with a subtle gradient.

### Markdown Serialization

Column metadata is stored as HTML comments inside header cells:

```markdown
| Item | Price | Qty |
| --- | --- | --- |
| Widget | 25.00 | 100 |
| Gadget | 42.50 | 75 |
```

**Why HTML comments:**

- Round-trips cleanly — other markdown renderers ignore comments
- No sidecar files to manage
- Metadata stays co-located with the column it describes
- Follows the research recommendation

**Parse rules:** The markdown parser detects `<!-- key:value,key:value -->` in header cells and sets the corresponding `TableHeader` attributes.

**Serialize rules:** The serializer appends the comment after the header text if any column metadata exists.

**Sparkline syntax:** `{{spark:12,15,9,22,18}}` in cell content. The parser leaves this as plain text in the document; the decoration layer renders it as SVG. This is intentionally not a ProseMirror node — it's an inline decoration pattern like `#tag` badges.

### Column Configuration UI

Right-click a column header → context menu with:

- **Column type** submenu: Text, Number, Currency, Percentage, Date
- **Currency** submenu (visible when type is Currency): USD, EUR, GBP, SEK, JPY, etc.
- **Summarize** submenu: None, Sum, Average, Count, Min, Max
- Separator
- Existing options (add column, delete column, etc.)

This extends the existing table context menu pattern. No new dialog or panel needed.

## UI/UX

### Footer Row

```
| Item    | Price      | Qty   |
|---------|------------|-------|
| Widget  | $25.00     | 100   |
| Gadget  | $42.50     | 75    |
| Doohick | $18.75     | 200   |
├─────────┼────────────┼───────┤
│         │ Sum: $86.25│ 375   │  ← muted bg, smaller text
└─────────┴────────────┴───────┘
```

- Visually distinct from data rows: `bg-muted`, `text-xs`, `text-muted-foreground`
- Label prefix: "Sum:", "Avg:", "Count:", "Min:", "Max:"
- Formatted according to column type (e.g., `$86.25` for currency)
- Non-editable, non-selectable

### Sort Indicators

```
| Item ▲  | Price     | Qty   |
```

- Small arrow (▲/▼) in the header cell, right-aligned
- Muted color, doesn't shift the header text
- Hover on any header shows a subtle sort affordance

### Sparklines in Cells

```
| Region | Q1    | Q2    | Q3    | Trend          |
|--------|-------|-------|-------|----------------|
| North  | 42K   | 45K   | 51K   | ╱╲╱───╱  📈   |
| South  | 35K   | 32K   | 28K   | ╲___╱╲        |
```

- Tiny SVG, \~60px × 20px
- Stroke: `--color-muted-foreground` at \~50% opacity
- No axes, no labels — just the shape of the trend
- Renders inline alongside any text in the cell

### Column Type Indicators

When a column has a type set, a subtle type badge appears in the header cell:

```
| Item | Price $  | Qty # | Date 📅 |
```

Small icon or symbol after the header text, muted color. Indicates the column is typed without being intrusive.

## Data Model

### Extended TableHeader Attributes

```typescript
interface ColumnMetadata {
  colType: 'text' | 'number' | 'currency' | 'percentage' | 'date';
  colCurrency: string | null;     // ISO 4217 code
  colAggregation: 'sum' | 'avg' | 'count' | 'min' | 'max' | null;
  colSortDirection: 'asc' | 'desc' | null;  // transient
}
```

### Aggregation Computation

```typescript
// src/components/editor/extensions/table-aggregation.ts
interface AggregationResult {
  columnIndex: number;
  type: 'sum' | 'avg' | 'count' | 'min' | 'max';
  value: number;
  formatted: string;  // locale-aware formatted string
}
```

### Sparkline Data

Stored as inline text in cells: `{{spark:12,15,9,22,18}}`

Rendered via a ProseMirror decoration that matches the `{{spark:...}}` pattern and replaces it with an inline SVG widget.

## Dependencies

No new libraries required.

- Column types use `Intl.NumberFormat` / `Intl.DateTimeFormat` (built-in)
- Sparklines use hand-rolled SVG `<polyline>` (\~20 lines of code)
- Sorting uses ProseMirror transactions to reorder table rows
- Extends existing `@tiptap/extension-table`, `TableRow`, `TableCell`, `TableHeader`

## Quality Gates

### Functional

- [ ] Right-click column header shows type/aggregation options

- [ ] Setting column type formats cell values on display

- [ ] Currency formatting with correct locale and symbol

- [ ] Percentage formatting (0.85 → 85%)

- [ ] Footer row shows computed aggregation for configured columns

- [ ] Footer updates live when cell values change

- [ ] Click header to sort ascending, again for descending, again for unsorted

- [ ] Sort reorders rows in the document

- [ ] Filter row hides non-matching rows without removing them

- [ ] Sparkline renders as inline SVG from `{{spark:...}}` syntax

- [ ] Sparkline data editable by editing the cell text

### Markdown Round-Trip

- [ ] Column metadata serializes as HTML comments in header cells

- [ ] `<!-- type:currency,currency:USD,summary:sum -->` parses correctly

- [ ] Tables without metadata remain unchanged

- [ ] Sparkline syntax `{{spark:...}}` round-trips as plain text

- [ ] Sorting does not corrupt table structure

- [ ] All existing table round-trip tests continue to pass

### PDF Export

- [ ] Footer row renders in PDF with aggregation values

- [ ] Number formatting preserved in PDF

- [ ] Sparklines render as inline SVG in PDF (or gracefully degrade to text)

### Design

- [ ] Footer row is visually distinct but not distracting

- [ ] Sort indicators are subtle and consistent

- [ ] Column type badges are unobtrusive

- [ ] Sparklines match the neutral aesthetic (muted stroke, no fill by default)

- [ ] All enhancements work in both light and dark mode

### Testing

- [ ] Unit tests for aggregation computation (sum, avg, count, min, max)

- [ ] Unit tests for number parsing (strip currency, commas, percentages)

- [ ] Unit tests for HTML comment metadata parsing and serialization

- [ ] Unit tests for sparkline SVG generation

- [ ] Unit tests for sort transaction correctness

- [ ] All existing markdown round-trip tests continue to pass

## Out of Scope

- **Cell-level formulas** — requires expression parser and dependency graph; enormous complexity for marginal benefit over column aggregations
- **Cross-table references** — requires document-level database; not appropriate for a note editor
- **Conditional formatting** — coloring cells based on values adds visual complexity; deferred
- **Data import (CSV/Excel)** — paste from spreadsheet already works for basic data; structured import is a separate feature
- **Column-to-chart binding** — connecting a table column to an inline chart's data source is planned for after both features ship independently
- **Formula bar** — no visible formula editing UI; aggregation is configured via the context menu
- **Custom number formats** — locale defaults are sufficient; custom patterns add complexity
# Chart Feature Expansion — Tasks

|  |  |
| --- | --- |
| **Date** | 2026-04-09 |
| **Status** | Complete |
| **PRD** | [chart-feature-expansion](../prds/2026-04-08-chart-feature-expansion.md) |
| **Audit** | [chart-library-feature-audit](../audit/chart-library-feature-audit.md) |
| **Total** | 22 tasks: 7S, 10M, 5L |
| **Suggested order** | Types (#1-#3) → Data model (#4) → Multi-series (#5) → New renderers (#6-#9) → Stacked (#10) → Annotations (#11-#13) → Settings (#14-#16) → Editor UX (#17-#20) → Skill schema (#21) → PPTX export (#22) |

### Risks & Open Questions

- **Composed chart UX complexity** — each series has a `renderAs` selector; risk of overwhelming the data table. Keep it simple: a small dropdown per series column header.
- **Drag-to-resize in ProseMirror** — must work with Tiptap NodeView. Drawing extension has a precedent but uses a different pattern. Check if CSS `resize: vertical` works inside NodeViewWrapper or if a manual drag handle is needed.
- **PPTX export for radar/scatter** — ppt-rs may not support these natively. SVG fallback path needs to be tested.
- **CSV paste edge cases** — mixed delimiters, quoted fields, locale-specific number formats (comma as decimal separator).

---

## Types & Data Model

### #1 — Extend ChartType union and type metadata ✅

**Description:** Add `"radar"`, `"scatter"`, `"radial_bar"`, and `"composed"` to the `ChartType` union in `chart-types.ts`. Add corresponding entries to `CHART_TYPES` metadata array with icons (`Radar` from lucide-react, `ScatterChart`, `CircleDot`, `Layers`), descriptions, and `dataShape` classification (`"polar"` for radar, `"xy"` for scatter, `"radial"` for radial_bar, `"cartesian"` for composed).

**Acceptance criteria:**
- `ChartType` includes all 10 types
- `CHART_TYPES` has metadata for each
- `isCartesian()` / `isRadial()` helpers updated
- TypeScript compiles cleanly

**Complexity:** S
**Category:** frontend
**Dependencies:** None
**Files:** `src/lib/chart-types.ts`

---

### #2 — Extend ChartConfig with new optional fields ✅

**Description:** Add all new config fields to `ChartConfig` interface: `showDataLabels`, `pieLabels`, `stacked`, `curveType`, `legendPosition`, `xTickFormat`, `yTickFormat`, `referenceLines`. Add the `ReferenceLine` interface. All fields optional with sensible defaults for backward compatibility.

**Acceptance criteria:**
- All fields from the PRD's data model section present
- Existing code compiles without changes (all fields optional)
- Default values documented in JSDoc comments

**Complexity:** S
**Category:** frontend
**Dependencies:** None
**Files:** `src/lib/chart-types.ts`

---

### #3 — Extend ChartDataPoint and ChartSeries ✅

**Description:** Add `x?: number` and `y?: number` to `ChartDataPoint` for scatter charts. Add `renderAs?: "bar" | "line" | "area"` to `ChartSeries` for composed charts.

**Acceptance criteria:**
- Types updated, existing code unaffected
- TypeScript compiles cleanly

**Complexity:** S
**Category:** frontend
**Dependencies:** None
**Files:** `src/lib/chart-types.ts`

---

### #4 — Update ChartTypeSelector for 10 types ✅

**Description:** Expand the type selector grid from 6 to 10 types. Use a 2-row layout: first row with the 6 existing types, second row with the 4 new types. Each button shows the Lucide icon and short label. Consider a "More types" expansion or just show all 10 in a responsive grid.

**Acceptance criteria:**
- All 10 chart types selectable
- Grid doesn't feel cramped — icons and labels readable
- Works in both light and dark mode
- Active state clearly distinguishable

**Complexity:** S
**Category:** frontend
**Dependencies:** #1
**Files:** `src/components/editor/charts/ChartTypeSelector.tsx`

---

## Multi-Series Data Editing

### #5 — Rewrite ChartDataTable for multi-series columns ✅

**Description:** The current `ChartDataTable` renders a fixed 2-column grid (category + value). Rewrite it to support dynamic series columns:

1. **Add Series button** (`[+]`) at the right of the header row — adds a new column with editable header
2. **Remove Series** — X button on each series column header (minimum 1 series, button disabled at 1)
3. **Rename Series** — click column header text to edit inline
4. **Data flow** — when series are added, populate `chartData.series` array and add the series key to each `ChartDataPoint`
5. **Type-aware visibility** — show multi-series controls for cartesian and polar types; hide the add-series button for radial types (pie/donut/radial_bar) which are inherently single-series
6. **Scatter mode** — when chart type is `"scatter"`, show X and Y columns instead of category + value

**Acceptance criteria:**
- Can add, remove, rename series columns
- Data model (`series[]` and `ChartDataPoint` keys) stays in sync
- Single-series charts still work with the simple category/value model
- Scatter charts show X/Y numeric columns
- Minimum 1 series enforced

**Complexity:** L
**Category:** frontend
**Dependencies:** #1, #2, #3
**Files:** `src/components/editor/charts/ChartDataTable.tsx`, `src/components/editor/charts/__tests__/ChartDataTable.test.tsx`

---

## New Chart Renderers

### #6 — RadarChartRenderer ✅

**Description:** New renderer component using recharts `RadarChart`, `Radar`, `PolarGrid`, `PolarAngleAxis`, `PolarRadiusAxis`. Supports multi-series (multiple `Radar` polygons overlaid). Uses the same color config pattern as other renderers.

**Acceptance criteria:**
- Radar chart renders with polar grid and angle axis labels from categories
- Multi-series support with distinct fill colors per series
- Legend displays when enabled
- Works with the existing color palette system

**Complexity:** M
**Category:** frontend
**Dependencies:** #1, #2
**Files:** `src/components/editor/charts/RadarChartRenderer.tsx`

---

### #7 — ScatterChartRenderer ✅

**Description:** New renderer using recharts `ScatterChart`, `Scatter`, `XAxis` (type="number"), `YAxis`, `ZAxis`. Data uses `x` and `y` fields from `ChartDataPoint`. Supports optional multi-series (multiple `Scatter` groups).

**Acceptance criteria:**
- Scatter plot renders with numeric X and Y axes
- Dots use palette colors
- Axis labels from config
- Grid optional via config
- Tooltip shows x, y values on hover

**Complexity:** M
**Category:** frontend
**Dependencies:** #1, #3
**Files:** `src/components/editor/charts/ScatterChartRenderer.tsx`

---

### #8 — RadialBarChartRenderer ✅

**Description:** New renderer using recharts `RadialBarChart`, `RadialBar`. Data shape is same as pie (label + value), rendered as concentric arcs. Useful for progress/gauge visualizations.

**Acceptance criteria:**
- Radial bar chart renders with concentric arcs
- Each data point is a different arc with palette color
- Legend displays category labels when enabled
- Tooltip shows value on hover

**Complexity:** M
**Category:** frontend
**Dependencies:** #1
**Files:** `src/components/editor/charts/RadialBarChartRenderer.tsx`

---

### #9 — ComposedChartRenderer ✅

**Description:** New renderer using recharts `ComposedChart` with mixed `Bar`, `Line`, `Area` children. Each series specifies its render type via `series[].renderAs`. Falls back to `"bar"` if `renderAs` is not set.

**Acceptance criteria:**
- Composed chart renders with mixed element types per series
- Each series respects its `renderAs` value (bar, line, or area)
- Shared X/Y axes, grid, tooltip, legend
- Works with the standard color palette system

**Complexity:** M
**Category:** frontend
**Dependencies:** #1, #2, #3
**Files:** `src/components/editor/charts/ComposedChartRenderer.tsx`

---

### #10 — Wire new renderers into ChartRenderer switch ✅

**Description:** Update the switch statement in `ChartRenderer.tsx` to dispatch to the 4 new renderer components. Import all new renderers.

**Acceptance criteria:**
- All 10 chart types render via ChartRenderer
- No default/fallback case reached for valid types
- Live preview in ChartEditorPanel works for all types

**Complexity:** S
**Category:** frontend
**Dependencies:** #6, #7, #8, #9
**Files:** `src/components/editor/charts/ChartRenderer.tsx`

---

## Stacked Mode

### #11 — Add stacked mode to bar and area charts ✅

**Description:** When `config.stacked` is `true`, pass `stackId="stack"` to all `Bar` or `Area` elements in `BarChartRenderer` and `LineChartRenderer`. Only applies to multi-series data.

**Acceptance criteria:**
- Stacked bar chart renders with bars stacked vertically
- Stacked area chart renders with areas stacked
- Single-series charts ignore the stacked flag
- Existing non-stacked charts unaffected

**Complexity:** S
**Category:** frontend
**Dependencies:** #2
**Files:** `src/components/editor/charts/BarChartRenderer.tsx`, `src/components/editor/charts/LineChartRenderer.tsx`

---

## Data Annotations

### #12 — Reference lines ✅

**Description:** Render `ReferenceLine` components from recharts when `config.referenceLines` is populated. Add a collapsible "Reference Lines" section to `ChartSettings` with add/remove rows (axis dropdown, value input, optional label input). Only visible for cartesian chart types.

**Acceptance criteria:**
- Reference lines render on cartesian charts at correct axis position
- Dashed stroke by default, customizable
- Label displays near the line
- Editor UI: add/remove reference line rows
- Collapsed by default in settings

**Complexity:** M
**Category:** frontend
**Dependencies:** #2
**Files:** `src/components/editor/charts/ChartSettings.tsx`, `src/components/editor/charts/BarChartRenderer.tsx`, `src/components/editor/charts/LineChartRenderer.tsx`, `src/components/editor/charts/ComposedChartRenderer.tsx`

---

### #13 — Data labels ✅

**Description:** When `config.showDataLabels` is `true`, render `LabelList` on bar and line charts, and `Pie.label` on pie/donut charts. Add `pieLabels` dropdown (none/value/percent/name) for pie/donut-specific label format. Add a "Labels" toggle to `ChartSettings` alongside Grid and Legend.

**Acceptance criteria:**
- Bar charts show value labels above bars
- Line charts show value labels above dots
- Pie/donut charts show slice labels in the selected format
- Toggle in settings enables/disables
- Pie label format dropdown only visible for pie/donut types

**Complexity:** M
**Category:** frontend
**Dependencies:** #2
**Files:** `src/components/editor/charts/ChartSettings.tsx`, `src/components/editor/charts/BarChartRenderer.tsx`, `src/components/editor/charts/LineChartRenderer.tsx`, `src/components/editor/charts/PieChartRenderer.tsx`

---

### #14 — Axis tick formatting ✅

**Description:** Add `xTickFormat` and `yTickFormat` dropdowns to `ChartSettings` (plain/thousands/percent/currency). Implement `tickFormatter` functions that format numbers accordingly. Only visible for cartesian chart types.

**Acceptance criteria:**
- Thousands: `1500` → `1.5K`
- Percent: `0.75` → `75%`
- Currency: `1500` → `$1,500`
- Formatting applied to axis ticks
- Settings dropdowns only visible for cartesian types

**Complexity:** M
**Category:** frontend
**Dependencies:** #2
**Files:** `src/components/editor/charts/ChartSettings.tsx`, `src/components/editor/charts/BarChartRenderer.tsx`, `src/components/editor/charts/LineChartRenderer.tsx`, `src/components/editor/charts/ComposedChartRenderer.tsx`, `src/components/editor/charts/ScatterChartRenderer.tsx`

---

## Settings Expansion

### #15 — Curve type and legend position controls ✅

**Description:** Add `curveType` dropdown (monotone/linear/step/natural/basis) to settings, visible only for line and area chart types. Add `legendPosition` dropdown (bottom/top/left/right), visible only when `showLegend` is true. Wire both into the respective renderers.

**Acceptance criteria:**
- Curve type changes line interpolation in line and area charts
- Legend position moves the legend in all chart types
- Controls context-aware (hidden when irrelevant)

**Complexity:** M
**Category:** frontend
**Dependencies:** #2
**Files:** `src/components/editor/charts/ChartSettings.tsx`, `src/components/editor/charts/LineChartRenderer.tsx`, `src/components/editor/charts/BarChartRenderer.tsx`, `src/components/editor/charts/PieChartRenderer.tsx`, `src/components/editor/charts/RadarChartRenderer.tsx`

---

### #16 — Stacked mode toggle in settings ✅

**Description:** Add a "Stacked" checkbox to `ChartSettings`, visible only for bar and area chart types with multi-series data. When toggled, sets `config.stacked`.

**Acceptance criteria:**
- Toggle visible only for bar/area with 2+ series
- Hidden for single-series, pie/donut, radar, scatter, radial_bar
- State persists in chart config

**Complexity:** S
**Category:** frontend
**Dependencies:** #2, #11
**Files:** `src/components/editor/charts/ChartSettings.tsx`

---

## Editor UX Upgrades

### #17 — Drag-to-resize chart height ✅

**Description:** Add a resize handle at the bottom edge of the chart in `ChartNodeView`. On drag, update the `height` node attribute via ProseMirror transaction. Constrain between 150–600px. Also add a height input/slider to `ChartSettings` for precise control.

**Acceptance criteria:**
- Drag handle visible at bottom edge (cursor: `ns-resize`)
- Height updates in real-time during drag
- Constrained to 150–600px range
- Height persists in node attributes and sidecar
- Height input in settings as alternative

**Complexity:** L
**Category:** frontend
**Dependencies:** None
**Files:** `src/components/editor/charts/ChartNodeView.tsx`, `src/components/editor/charts/ChartSettings.tsx`

---

### #18 — CSV/TSV paste into data table ✅

**Description:** Intercept `paste` events on the `ChartDataTable`. Parse clipboard text as TSV or CSV. If the first row contains non-numeric values, treat as headers (category + series names). Fill the data table from parsed data. Show a toast confirming "Pasted N rows".

**Acceptance criteria:**
- Tab-separated paste works (from Excel/Sheets)
- Comma-separated paste works (from CSV files)
- First row used as headers when non-numeric
- Existing data replaced by pasted data
- Toast confirmation shown
- Handles edge cases: empty rows, mixed delimiters, quoted fields

**Complexity:** M
**Category:** frontend
**Dependencies:** #5
**Files:** `src/components/editor/charts/ChartDataTable.tsx`

---

### #19 — Chart duplication ✅

**Description:** Add a "Duplicate" action to the chart node view (in the hover overlay or context menu). Generates a new UUID, copies the sidecar JSON, and inserts a new chart node after the current one.

**Acceptance criteria:**
- Duplicate creates an independent copy with new chartId
- Sidecar JSON copied to new file
- New chart inserted after the original in the document
- Editing the duplicate doesn't affect the original

**Complexity:** M
**Category:** frontend
**Dependencies:** None
**Files:** `src/components/editor/charts/ChartNodeView.tsx`

---

### #20 — Image download (SVG/PNG) ✅

**Description:** Add a "Download" button to the chart hover overlay. On click, show a dropdown with "Save as SVG" and "Save as PNG". SVG: serialize the recharts SVG element. PNG: rasterize via Canvas API. Trigger a native save dialog via Tauri.

**Acceptance criteria:**
- SVG download produces a valid standalone SVG file
- PNG download produces a rasterized image at 2x resolution
- Native save dialog with correct file extension
- Button appears alongside "Edit" in the hover overlay

**Complexity:** L
**Category:** frontend
**Dependencies:** None
**Files:** `src/components/editor/charts/ChartNodeView.tsx`

---

## Skill Schema & Export

### #21 — Update insert-chart skill schema and examples ✅

**Description:** Update `CHART-SCHEMA.md` and `EXAMPLES.md` in `bundled-skills/insert-chart/references/`:

1. Add new chart types to `ChartType` enum
2. Document all new `ChartConfig` fields
3. Document scatter data shape (`x`/`y`)
4. Document composed series `renderAs`
5. Add examples for radar, scatter, stacked bar, composed, radial bar, reference lines, data labels

**Acceptance criteria:**
- Schema covers all 10 types and all config fields
- Examples are realistic and copy-pasteable
- AI agents can create charts with all new features

**Complexity:** L
**Category:** frontend
**Dependencies:** #1, #2, #3
**Files:** `bundled-skills/insert-chart/references/CHART-SCHEMA.md`, `bundled-skills/insert-chart/references/EXAMPLES.md`, `bundled-skills/insert-chart/SKILL.md`

---

### #22 — PPTX export for new chart types ✅

**Description:** Update `markdown_to_pptx.rs` to handle new chart types. Map `"radar"` and `"scatter"` to native ppt-rs chart types if supported. For `"radial_bar"` and `"composed"`, use SVG fallback (embed cached SVG as image). Also handle `stacked` mode, reference lines, and data labels in PPTX export where feasible.

**Acceptance criteria:**
- Radar → native PPTX chart or SVG fallback
- Scatter → native PPTX chart or SVG fallback
- Radial bar → SVG fallback image
- Composed → SVG fallback image
- Stacked bar/area export correctly
- No regression on existing 6 types

**Complexity:** L
**Category:** backend
**Dependencies:** #1, #6, #7, #8, #9
**Files:** `src-tauri/src/export/markdown_to_pptx.rs`

---

## Test Tasks

Tests are embedded within the tasks above (particularly #5 for data table tests). Additional test coverage should be added as part of each renderer task (#6-#9) and the CSV paste task (#18). The existing `ChartDataTable.test.tsx` should be expanded alongside #5.

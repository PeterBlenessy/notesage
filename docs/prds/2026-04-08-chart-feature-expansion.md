# PRD: Chart Feature Expansion

|  |  |
| --- | --- |
| **Date** | 2026-04-08 |
| **Status** | Complete |
| **Priority** | High |
| **Impact** | Users can create richer, more expressive charts — radar, scatter, stacked, composed — with multi-series editing, data labels, reference lines, and better editor UX |
| **Audit** | [chart-library-feature-audit](../audit/chart-library-feature-audit.md) |
| **Predecessor** | [inline-charts](2026-03-29-inline-charts.md) |

## Problem

Notesage shipped inline charts (v0.28) with 6 chart types and a visual editor. The feature audit reveals we use only **6 of 15 chart types** and roughly **30% of recharts' feature surface**. Three gaps hurt users daily:

1. **Missing chart types.** Radar, scatter, composed (bar+line), and stacked charts are standard in business and academic reports. Users who need them must fall back to external tools, export an image, and paste it — the exact workflow inline charts were built to eliminate.

2. **Multi-series editing is agent-only.** The visual chart editor supports a single `category + value` column. Creating a multi-series chart (e.g., Revenue vs Expenses) requires an AI agent writing raw JSON. This makes multi-series charts invisible to manual users.

3. **No data annotations.** Reference lines (targets, averages), data labels on bars/dots/slices, and axis tick formatting are table-stakes for professional charts. Their absence forces users to annotate charts manually in presentation tools after export.

A secondary cluster of UX gaps — no drag-to-resize, no CSV paste, no chart-from-table, no image download — adds friction to what should be a fast authoring flow.

## Goals

1. **11 chart types** — add radar, scatter, radial bar, composed, and stacked mode to the existing 6, covering 95%+ of report needs
2. **Multi-series data editing** in the visual chart editor — users can add, remove, and rename series columns without touching JSON
3. **Data annotations** — reference lines, data labels, and pie slice labels configurable from the editor panel
4. **Editor UX upgrades** — drag-to-resize, CSV paste, chart height control, chart duplication, image download
5. **Skill schema parity** — every new feature available to agents via the `insert-chart` skill schema
6. **Zero regression** — all existing charts continue to render and round-trip correctly

## Non-Goals

- **Treemap, Sankey, Sunburst, Funnel** — niche chart types with complex data models; defer until user demand materializes
- **Real-time / live-data charts** — requires a data binding layer that doesn't exist yet
- **Chart templates / presets** — the type selector + color schemes provide enough starting points
- **Animation control** — recharts defaults are fine; user-configurable animation adds complexity without clear value
- **Dual Y axes** — useful but complex UX (which series maps to which axis?); defer to a follow-up
- **Gradient / pattern fills** — visual nice-to-have but not blocking any workflows
- **Custom per-series colors** — palette-based coloring is sufficient for now
- **Chart-from-table** — requires tight coupling between the table extension and chart extension; better as a separate PRD

## User Stories

- As a **report author**, I want to create a radar chart comparing product features so I can show multi-dimensional comparisons at a glance
- As a **data analyst**, I want to create a scatter plot from X/Y data so I can visualize correlations
- As a **project manager**, I want a stacked bar chart showing resource allocation by team so I can show composition within categories
- As a **user editing charts manually**, I want to add and name multiple data series in the visual editor so I don't need an AI agent for multi-series charts
- As a **report author**, I want to add a reference line showing the target/average so readers can compare actual values against a benchmark
- As a **user**, I want data labels on my bar chart so the exact values are visible without hovering
- As a **user**, I want to paste CSV data from a spreadsheet into the chart editor so I don't have to retype rows manually
- As a **user**, I want to drag the bottom edge of a chart to resize it so I can control how much vertical space it takes
- As a **user**, I want to download a chart as PNG or SVG so I can use it in a presentation or email
- As an **AI agent**, I want to create radar and scatter charts via the insert-chart skill so I can generate richer visualizations for users

## Technical Approach

### New Chart Types

All new types use existing recharts components already imported in the PPTX viewer (`PptxChartRenderer.tsx`). The pattern is proven — add a renderer component, register the type, wire it into the editor panel.

#### Radar Chart

- Uses `RadarChart`, `Radar`, `PolarGrid`, `PolarAngleAxis`, `PolarRadiusAxis` from recharts
- Data shape: `polar` — categories become angle axis labels, values become radii
- Inherently multi-series (multiple `Radar` polygons overlaid)
- New renderer: `RadarChartRenderer.tsx`

#### Scatter Chart

- Uses `ScatterChart`, `Scatter`, `XAxis` (type="number"), `YAxis` from recharts
- Data shape: `xy` — each point has numeric X and Y (not categorical X)
- Data model extension: `ChartDataPoint` needs `x: number` and `y: number` fields
- New renderer: `ScatterChartRenderer.tsx`

#### Radial Bar Chart

- Uses `RadialBarChart`, `RadialBar` from recharts
- Data shape: `radial` — same as pie (label + value), rendered as concentric arcs
- Useful for progress/gauge visualizations
- New renderer: `RadialBarChartRenderer.tsx`

#### Composed Chart

- Uses `ComposedChart` with mixed `Bar`, `Line`, `Area` children
- Data shape: `cartesian` — same as bar/line/area
- Each series specifies its render type (`bar`, `line`, or `area`)
- Extends `ChartSeries` with `renderAs: "bar" | "line" | "area"` field
- New renderer: `ComposedChartRenderer.tsx`

#### Stacked Mode

Not a new chart type but a configuration toggle on bar and area charts:

- New config field: `stacked: boolean` (default `false`)
- When enabled, bars/areas use `stackId="stack"` prop
- Works with multi-series data only — toggle hidden for single-series

### Multi-Series Data Editing

The `ChartDataTable` component currently renders a fixed 2-column grid (`category` + `value`). Expand it:

1. **Add Series button** — adds a new column to the data table with an editable header (series name)
2. **Remove Series** — X button on each series column header (minimum 1 series)
3. **Rename Series** — click the column header to edit the series label
4. **Data model** — when series are added, switch from `value` to named series keys on each `ChartDataPoint`, and populate the `series` array
5. **Type-aware visibility** — show multi-series controls for cartesian and polar types; hide for radial (pie/donut) which are inherently single-series

The existing `ChartSeries[]` and `[seriesKey: string]` index signature on `ChartDataPoint` already support this at the data level — the gap is purely in the editor UI.

### Data Annotations

#### Reference Lines

New optional field on `ChartConfig`:

```typescript
referenceLines?: {
  axis: "x" | "y";
  value: number | string;
  label?: string;
  stroke?: string;  // defaults to muted-foreground
  strokeDasharray?: string;  // defaults to "3 3"
}[];
```

Rendered via recharts `ReferenceLine` component. Editor UI: a collapsible "Reference Lines" section in `ChartSettings` with add/remove rows (axis selector, value input, optional label).

#### Data Labels

New config field: `showDataLabels: boolean` (default `false`).

- Bar charts: `LabelList` positioned above bars
- Line charts: `LabelList` positioned above dots
- Pie/donut: `Pie.label` with percentage or value format
- Editor UI: toggle in settings alongside existing Grid and Legend toggles

New config field for pie/donut label format: `pieLabels: "none" | "value" | "percent" | "name"` (default `"none"`).

#### Axis Tick Formatting

New optional config fields:

```typescript
xTickFormat?: "plain" | "thousands" | "percent" | "currency";
yTickFormat?: "plain" | "thousands" | "percent" | "currency";
```

Implemented via `tickFormatter` prop on `XAxis`/`YAxis`. Editor UI: dropdown next to each axis label input. Default `"plain"` (no formatting, backward compatible).

### Editor UX Upgrades

#### Drag-to-Resize

Add a resize handle at the bottom edge of the chart `NodeViewWrapper`. On drag:

1. Update the `height` node attribute via ProseMirror transaction
2. Chart re-renders at new height
3. Follow the same pattern as the Drawing extension's resize behavior

Implementation: CSS `resize: vertical` on the wrapper with `overflow: hidden`, or a custom drag handle div with `onMouseDown` → `onMouseMove` tracking.

#### CSV/TSV Paste

Intercept `paste` events on the `ChartDataTable` component:

1. Parse clipboard text as TSV (tab-separated) or CSV (comma-separated)
2. If the first row looks like headers (non-numeric), use as category + series names
3. Fill the data table rows from parsed data
4. Show a toast confirming "Pasted N rows"

#### Chart Height Control

Add a height input (or slider) to `ChartSettings`:

- Range: 150–600px, step 50
- Default: 300px
- Updates the node attribute `height` on change

#### Chart Duplication

Context menu item on the chart block (right-click or overflow menu):

1. Generate a new UUID
2. Copy the sidecar JSON to the new ID
3. Insert a new chart node after the current one

#### Image Download

Hover overlay button (next to the existing "Edit" label):

- "Download" icon button
- Serializes the recharts SVG to a standalone SVG file or rasterizes to PNG via Canvas
- Triggers a native save dialog via Tauri `dialog.save()`

### Line Curve Type

New optional config field: `curveType: "monotone" | "linear" | "step" | "natural" | "basis"` (default `"monotone"`).

Applied to `Line.type` and `Area.type` props. Editor UI: dropdown in settings, visible only for line and area chart types.

### Legend Position

New optional config field: `legendPosition: "bottom" | "top" | "left" | "right"` (default `"bottom"`).

Applied to `Legend.verticalAlign` and `Legend.layout` props. Editor UI: dropdown in settings, visible only when `showLegend` is true.

### Skill Schema Expansion

Update `bundled-skills/insert-chart/references/CHART-SCHEMA.md` and `EXAMPLES.md`:

 1. **New chart types** — add `"radar"`, `"scatter"`, `"radial_bar"`, `"composed"` to `ChartType` enum
 2. **Stacked mode** — add `config.stacked` boolean
 3. **Reference lines** — add `config.referenceLines` array
 4. **Data labels** — add `config.showDataLabels` boolean and `config.pieLabels` enum
 5. **Axis formatting** — add `config.xTickFormat` and `config.yTickFormat`
 6. **Curve type** — add `config.curveType` enum
 7. **Legend position** — add `config.legendPosition` enum
 8. **Scatter data shape** — document the `x`/`y` numeric data model for scatter charts
 9. **Composed series** — document `series[].renderAs` for composed charts
10. **New examples** — radar, scatter, stacked bar, composed, radial bar

### PPTX Export

Update `markdown_to_pptx.rs` to map new chart types:

- `"radar"` → `ChartType::Radar` (if ppt-rs supports it, else SVG fallback)
- `"scatter"` → `ChartType::Scatter` (if supported)
- `"radial_bar"` → SVG fallback
- `"composed"` → SVG fallback (no native PPTX equivalent)

For types without native PPTX chart mapping, embed the cached SVG as an image.

## UI/UX

### Expanded Chart Type Selector

The current 6-button grid becomes a scrollable 2-row grid (or 11-button grid with smaller icons):

```
[Bar] [H.Bar] [Line] [Area] [Stacked] [Composed]
[Pie] [Donut] [Radar] [Scatter] [Radial]
```

Each button shows a Lucide icon and short label. The "Stacked" button is a mode variant — selecting it toggles stacked mode on bar/area and highlights both the base type and the stacked indicator.

Alternative: keep the 6-type grid and add a "More" expansion row. This avoids overwhelming new users while making advanced types discoverable.

### Multi-Series Data Table

```
┌─ Data ──────────────────────────────────────────────┐
│ Category  │ Revenue ($K)  │ Expenses ($K)  │  [+]   │
│ Jan       │ 120           │ 95             │        │
│ Feb       │ 135           │ 100            │        │
│ Mar       │ 148           │ 105            │        │
│           │               │                │ [+ Row]│
└─────────────────────────────────────────────────────┘
```

- Series column headers are editable (click to rename)
- \[+\] button at the right adds a new series column
- Each series header has an X button to remove it
- Minimum 1 series column

### Reference Lines Section

```
┌─ Reference Lines ───────────────────────────────────┐
│ [Y ▼]  [150    ]  [Target      ]        [× Remove] │
│ [Y ▼]  [125    ]  [Average     ]        [× Remove] │
│                                    [+ Add Line]     │
└─────────────────────────────────────────────────────┘
```

Collapsible section in `ChartSettings`, collapsed by default. Each row has: axis dropdown (X/Y), value input, optional label input, remove button.

### Settings Panel Expansion

The existing toggles row expands to accommodate new controls:

```
[✓] Grid  [✓] Legend  [ ] Labels   Palette: [Neutral ▼]
Legend: [Bottom ▼]  Curve: [Monotone ▼]  [✓] Stacked
Y Format: [Plain ▼]  Height: [300px ▼]
```

Controls are context-aware:

- "Curve" only visible for line/area types
- "Stacked" only visible for bar/area with multi-series
- "Legend position" only visible when legend is on
- "Labels" shows pie-specific format dropdown for pie/donut
- "Y Format" / "X Format" only for cartesian types

### Resize Handle

A 4px grab zone at the bottom edge of the chart block. Cursor changes to `ns-resize` on hover. Drag updates height in real-time. Minimum 150px, maximum 600px.

### Download Button

Appears in the hover overlay alongside "Edit":

```
                              [↓ Download] [✏ Edit]
```

Click opens a dropdown: "Save as SVG" / "Save as PNG".

## Data Model

### Extended ChartType

```typescript
export type ChartType =
  | "bar" | "line" | "area" | "pie" | "donut" | "horizontal_bar"  // existing
  | "radar" | "scatter" | "radial_bar" | "composed";              // new
```

### Extended ChartDataPoint

```typescript
export interface ChartDataPoint {
  category: string;
  value: number;
  x?: number;                          // scatter charts: numeric X
  y?: number;                          // scatter charts: numeric Y
  [seriesKey: string]: string | number | undefined;
}
```

### Extended ChartSeries

```typescript
export interface ChartSeries {
  key: string;
  label: string;
  renderAs?: "bar" | "line" | "area";  // composed charts only
}
```

### Extended ChartConfig

```typescript
export interface ChartConfig {
  // Existing fields (unchanged)
  xLabel: string;
  yLabel: string;
  showGrid: boolean;
  showLegend: boolean;
  colorScheme: ColorScheme;

  // New fields (all optional for backward compatibility)
  showDataLabels?: boolean;
  pieLabels?: "none" | "value" | "percent" | "name";
  stacked?: boolean;
  curveType?: "monotone" | "linear" | "step" | "natural" | "basis";
  legendPosition?: "bottom" | "top" | "left" | "right";
  xTickFormat?: "plain" | "thousands" | "percent" | "currency";
  yTickFormat?: "plain" | "thousands" | "percent" | "currency";
  referenceLines?: ReferenceLine[];
}

export interface ReferenceLine {
  axis: "x" | "y";
  value: number | string;
  label?: string;
  stroke?: string;
  strokeDasharray?: string;
}
```

### New Renderer Components

```
src/components/editor/charts/
├── BarChartRenderer.tsx         # existing (add stacked + data labels)
├── LineChartRenderer.tsx        # existing (add curve type + data labels)
├── PieChartRenderer.tsx         # existing (add slice labels)
├── RadarChartRenderer.tsx       # new
├── ScatterChartRenderer.tsx     # new
├── RadialBarChartRenderer.tsx   # new
├── ComposedChartRenderer.tsx    # new
├── ChartRenderer.tsx            # update switch statement
├── ChartDataTable.tsx           # rewrite for multi-series columns
├── ChartSettings.tsx            # expand with new controls
├── ChartTypeSelector.tsx        # expand grid
├── ChartEditorPanel.tsx         # add resize, download
└── ChartNodeView.tsx            # add resize handle, download button
```

## Dependencies

No new npm dependencies. All new chart types use components already exported by `recharts` 3.8.0 (already installed). The PPTX viewer already imports `RadarChart`, `ScatterChart`, `ZAxis`, `PolarGrid`, `PolarAngleAxis`, `PolarRadiusAxis` from recharts.

## Quality Gates

### Functional

- [x] All 10 chart types render correctly (6 existing + radar, scatter, radial bar, composed)

- [x] Stacked mode works for bar and area charts with multi-series data

- [x] Multi-series data editing: add, remove, rename series columns in the visual editor

- [x] Reference lines render on cartesian charts with correct axis, value, and label

- [x] Data labels display on bar, line, pie, and donut charts when enabled

- [x] Pie/donut slice labels support value, percent, and name formats

- [x] Axis tick formatting applies thousands/percent/currency formatting

- [x] Line curve type selection changes the line interpolation

- [x] Legend position control moves the legend to top/bottom/left/right

- [x] CSV/TSV paste into data table correctly parses rows and headers

- [x] Drag-to-resize updates chart height between 150–600px

- [x] Chart duplication creates a new chart with copied data

- [x] Image download produces valid SVG and PNG files

- [x] Chart height control in settings updates the rendered height

### Backward Compatibility

- [x] All existing charts (6 types) continue to render identically

- [x] Existing sidecar JSON files load without errors (new fields are optional)

- [x] Markdown round-trip: `<div data-chart-id="<id>" data-type="chart" class="chart-block"></div>` unchanged

- [x] All existing round-trip tests pass

- [x] PDF, DOCX, PPTX export of existing chart types unaffected

### Skill Parity

- [x] `insert-chart` skill schema updated with all new types and config fields

- [x] Skill examples include radar, scatter, stacked bar, composed, radial bar

- [x] Agents can create charts with reference lines, data labels, and all new options

### Export

- [x] New chart types export to PDF via cached SVG

- [x] New chart types export to PPTX (native where supported, SVG fallback otherwise)

- [x] Stacked charts export correctly

- [x] Reference lines appear in exported output

- [x] Data labels appear in exported output

### Design

- [x] New chart types match the neutral aesthetic of existing charts

- [x] Radar chart uses polar grid styled with `--color-border` CSS variable

- [x] Scatter chart dots use palette colors consistently

- [x] Expanded type selector doesn't feel cramped — icons and labels readable

- [x] Multi-series data table is clean, not spreadsheet-like

- [x] Reference lines section is unobtrusive when collapsed

- [x] Resize handle is discoverable but not visually heavy

- [x] All new UI works in both light and dark mode

### Testing

- [x] Unit tests for each new renderer component

- [x] Unit tests for multi-series data table (add/remove/rename series)

- [x] Unit tests for CSV paste parsing

- [x] Unit tests for reference line rendering

- [x] Unit tests for axis tick formatting

- [x] Unit tests for ChartConfig backward compatibility (missing optional fields → defaults)

- [x] Existing chart tests continue to pass

- [x] Performance: chart editor panel opens in &lt;100ms with 30-row dataset

## Out of Scope

- **Treemap, Sankey, Sunburst, Funnel** — complex hierarchical data models; defer until demand
- **Dual Y axes** — complex UX for axis-to-series mapping; separate PRD if needed
- **Gradient / pattern fills** — visual polish; not blocking workflows
- **Custom per-series colors** — palette-based assignment is sufficient
- **Chart-from-table** — requires table↔chart coupling; separate PRD
- **Animation control** — recharts defaults work well
- **Real-time / live-data binding** — requires a data source abstraction layer
- **Logarithmic scale** — niche; add when requested
- **Brush (zoom/pan)** — interactive exploration; conflicts with the static-SVG-export model
- **Error bars** — scientific niche; add when requested
# PRD: Inline Charts

|  |  |
| --- | --- |
| **Date** | 2026-03-29 |
| **Status** | Draft |
| **Priority** | High |
| **Impact** | Users can insert beautiful, data-driven charts inline in documents for polished reports |
| **Research** | [rich-content-editor-features](../research/2026-03-29-rich-content-editor-features.md) |
| **Tasks** | [inline-charts-tasks](../tasks/2026-03-29-inline-charts-tasks.md) |

## Problem

Notesage users writing reports, project updates, and analysis documents need to present data visually. Today the only option is to create a chart in an external tool (Sheets, Excel, a web app), export it as an image, and paste it in. This produces static, un-editable raster images that look blurry when scaled and can't be updated when data changes.

Charts are core to report generation. Notion, Coda, and Moss Notes all offer inline charts. Notesage should too — with SVG output that looks crisp at any scale and exports perfectly to PDF.

## Goals

1. **Six chart types** — bar, line, area, pie, donut, and horizontal bar — covering the vast majority of report needs
2. **Inline chart blocks** with a visual data editor — no code, no syntax, no spreadsheet formulas
3. **Beautiful SVG output** that matches Notesage's neutral aesthetic and looks premium by default
4. **PDF export** — charts render as crisp vector graphics via the existing Typst pipeline
5. **Sidecar storage** — chart data stored as JSON in `.notesage/charts/`, keeping markdown clean

## Non-Goals

- Live data binding to document tables (future — requires table enhancements first)
- Sparklines in table cells (separate feature, depends on dynamic table enhancements)
- Interactive/animated charts (static SVG is the output — hover tooltips only in the editor)
- Chart templates or presets
- Data import from CSV/Excel files
- Real-time collaborative chart editing

## User Stories

- As a report author, I want to insert a bar chart showing quarterly metrics so that my report presents data visually, not just as a table
- As a user, I want to edit chart data in a simple table without learning a syntax or formula language
- As a user exporting to PDF, I want my charts to render as crisp vector graphics that look professional
- As a user, I want to change the chart type (e.g., bar → line) without re-entering data, so I can find the best visualization

## Technical Approach

### shadcn/ui Charts (Recharts) as the Chart Engine

Use shadcn/ui's [Charts component](https://ui.shadcn.com/charts), which wraps Recharts with themed, composable primitives.

**Why shadcn/ui Charts:**

- **Design system mandate** — "Never build a custom component if shadcn/ui already has one." shadcn/ui already has charts.
- Built on **Recharts** (31.9M weekly npm downloads, 26.9K GitHub stars, actively maintained)
- Outputs **SVG** (not canvas) — crisp at any scale, PDF-friendly
- Uses the same **CSS variable theming** as the rest of Notesage — light/dark/soft-contrast modes work automatically
- Composable primitives (`ChartContainer`, `ChartTooltip`, `ChartLegend`) follow shadcn/ui's copy-paste philosophy
- Built-in `ChartConfig` type for declarative color/label mapping
- Tree-shakeable via Recharts underneath
- React 19 compatible (Recharts v3.x)

**Why not Nivo:** Homepage deployment paused (nivo.rocks down), last npm release May 2025 (10 months ago). Beautiful defaults but slower maintenance cadence and react-spring dependency adds weight.

**Why not Chart.js:** Canvas-based (rasterized), not SVG. Blurry when scaled, poor PDF export.

**Why not visx:** Low-level D3 primitives — 3-5x more implementation effort for equivalent output. Last release Nov 2025.

### Tiptap Node Extension

A new `Chart` atom node:

```typescript
{
  group: 'block',
  atom: true,
  attrs: {
    chartId: { default: null },  // UUID linking to .notesage/charts/<id>.json
    width: { default: null },    // null = full editor width
    height: { default: 300 },   // rendered height in pixels
  },
}
```

### Storage: Sidecar Files

Chart data and configuration stored as JSON:

```
<project>/.notesage/charts/<chartId>.json
```

```json
{
  "type": "bar",
  "title": "Q1 Revenue by Region",
  "data": [
    { "category": "North", "value": 42000 },
    { "category": "South", "value": 35000 },
    { "category": "East", "value": 28000 },
    { "category": "West", "value": 51000 }
  ],
  "config": {
    "xLabel": "Region",
    "yLabel": "Revenue ($)",
    "showGrid": true,
    "showLegend": false,
    "colorScheme": "neutral"
  }
}
```

**Why sidecar:** Chart data + config can be 1-5KB. Embedding in markdown would clutter the file. The sidecar follows the same pattern as drawings (`.notesage/drawings/`) and comments (`.notesage/comments/`).

### Markdown Serialization

```markdown
![chart](/.notesage/charts/abc123.json)
```

Standard image syntax with `.json` extension in the `.notesage/charts/` path as the discriminator. The parser creates a `Chart` node; the serializer outputs the image reference.

### Chart Data Editor

A slide-out panel (similar to the PDF export dialog) that appears when creating or editing a chart:

**Panel sections:**

1. **Chart type selector** — visual thumbnails of the six types, click to switch
2. **Data table** — simple rows with category + value columns. Add/remove rows with +/- buttons. Editable inline.
3. **Settings** — axis labels, show/hide grid, show/hide legend, color scheme
4. **Live preview** — the chart renders in real-time as data changes

The data table adapts per chart type:

- **Bar/horizontal bar/area/line:** category (string) + value (number) columns. Line/area support multiple series.
- **Pie/donut:** label (string) + value (number) columns

### Color Schemes

Curated palettes that match Notesage's neutral aesthetic:

| Scheme | Colors | Use Case |
| --- | --- | --- |
| `neutral` (default) | Greys with subtle warmth | Professional, understated |
| `monochrome` | Single hue, varying lightness | Minimal, elegant |
| `warm` | Muted earth tones | Friendly, approachable |
| `cool` | Muted blue-greys | Technical, clean |

All schemes use low-chroma colors consistent with the design system. No bright/saturated palettes.

### SVG Preview & PDF Export

**Editor:** Recharts (via shadcn/ui `ChartContainer`) renders the chart as an inline SVG directly in the document. The SVG is the live React component (with hover tooltips in the editor via `ChartTooltip`).

**PDF export:** The chart node's SVG is serialized to a standalone `.svg` file at export time. The Typst converter includes it via `#image()`. Since Recharts outputs SVG, this is straightforward — render the React component to SVG string, write to a temp file, reference in Typst.

### Data Flow

```
User clicks /chart or toolbar button
  → Insert Chart node with new UUID
  → Open chart editor panel
  → User selects type, enters data
  → Live preview updates in the panel (Recharts via shadcn/ui ChartContainer)

User clicks "Done" / closes panel
  → Save chart JSON to .notesage/charts/<id>.json
  → Chart renders inline as SVG

User clicks existing chart
  → Load JSON from sidecar
  → Open chart editor panel with existing data

PDF export
  → Render Nivo chart to SVG string
  → Write temp .svg file
  → Typst #image() includes it
```

## UI/UX

### Inserting a Chart

- **Slash command:** `/chart` opens the chart editor panel immediately
- **Toolbar:** Add a chart button (using the `bar-chart-3` Lucide icon) to the toolbar, after the drawing button

### Chart Editor Panel

```
┌─ New Chart ──────────────────────────── Done ───┐
│                                                  │
│  [Bar] [Line] [Area] [Pie] [Donut] [H.Bar]     │
│                                                  │
│  ┌─ Data ─────────────────────────────────────┐ │
│  │ Category     │ Value                        │ │
│  │ North        │ 42000                        │ │
│  │ South        │ 35000                        │ │
│  │ East         │ 28000                        │ │
│  │ West         │ 51000                        │ │
│  │              │              [+ Add row]     │ │
│  └─────────────────────────────────────────────┘ │
│                                                  │
│  Title: [Q1 Revenue by Region          ]        │
│  X Label: [Region] Y Label: [Revenue ($)]       │
│  [✓] Grid  [ ] Legend  Palette: [Neutral ▼]     │
│                                                  │
│  ┌─ Preview ──────────────────────────────────┐ │
│  │                                             │ │
│  │       [Live Recharts chart preview]          │ │
│  │                                             │ │
│  └─────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

- Opens as a side panel or modal (consistent with the PDF export dialog pattern)
- Chart type selector at the top with visual icons
- Data table is a clean, minimal grid — not a spreadsheet
- Live preview updates on every keystroke/change
- "Done" button saves and closes

### Inline Chart Appearance

```
┌─────────────────────────────────────────────────┐
│            Q1 Revenue by Region                 │
│   50K ┤  ████                          ████     │
│   40K ┤  ████                          ████     │
│   30K ┤  ████  ████                    ████     │
│   20K ┤  ████  ████  ████              ████     │
│   10K ┤  ████  ████  ████              ████     │
│     0 ┤──────────────────────────────────────   │
│        North  South  East              West     │
│                                        ✏️ Edit  │
└─────────────────────────────────────────────────┘
```

- Full editor content width, fixed height (configurable, default 300px)
- Subtle border, rounded corners
- "Edit" label with pencil icon on hover (bottom-right)
- Click anywhere on the chart opens the editor panel
- Title rendered above the chart area

### Theming

shadcn/ui `ChartConfig` + CSS variables configured to match Notesage:

- Axis text: `var(--color-muted-foreground)`, system font
- Grid lines: `var(--color-border)` at 50% opacity
- Background: transparent (inherits editor background)
- Tooltip: uses shadcn/ui `ChartTooltip` + `ChartTooltipContent` (matches Notesage's tooltip style automatically)
- Light/dark mode: CSS variables switch with the app theme — no manual theme toggling needed
- Color schemes defined as CSS variables (e.g., `--color-chart-1` through `--color-chart-5`) per palette

### Deleting a Chart

Select the chart block → Delete/Backspace. Shows confirmation toast with undo since the sidecar file is also removed.

## Data Model

### Chart Sidecar Schema

```typescript
interface ChartData {
  type: 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'horizontal_bar';
  title: string;
  data: ChartDataPoint[];
  series?: ChartSeries[];  // for multi-series line/area charts
  config: ChartConfig;
}

interface ChartDataPoint {
  category: string;
  value: number;
  [seriesKey: string]: string | number;  // additional series columns
}

interface ChartSeries {
  key: string;
  label: string;
}

interface ChartConfig {
  xLabel: string;
  yLabel: string;
  showGrid: boolean;
  showLegend: boolean;
  colorScheme: 'neutral' | 'monochrome' | 'warm' | 'cool';
}
```

### Tiptap Extension

```typescript
// src/components/editor/extensions/chart.ts
interface ChartAttrs {
  chartId: string;     // UUID, maps to .notesage/charts/<id>.json
  width: number | null;
  height: number;
}
```

### New Components

```typescript
// src/components/editor/ChartEditor.tsx
// Side panel / modal for chart data entry and configuration
// Uses shadcn/ui ChartContainer + Recharts for the live preview

// src/components/editor/ChartPreview.tsx
// Inline chart renderer (ReactNodeViewRenderer)
// Uses shadcn/ui ChartContainer for themed SVG output
```

## Dependencies

| Dependency | Size (gzipped) | License | Purpose |
| --- | --- | --- | --- |
| `recharts` | \~139KB | MIT | Chart rendering (bar, line, area, pie) |

shadcn/ui chart primitives (`ChartContainer`, `ChartTooltip`, `ChartLegend`, `ChartConfig`) are copy-pasted into `src/components/ui/chart.tsx` via `pnpm dlx shadcn@latest add chart` — no additional npm dependency.

Total new dependency: `recharts` (\~139KB gzipped). Tree-shakeable — only the used chart types are bundled. Recharts pulls in D3 submodules (scales, shapes, interpolation) but these are tree-shaken to only what's used.

## Quality Gates

### Functional

- [ ] `/chart` slash command opens chart editor panel

- [ ] Toolbar button opens chart editor panel

- [ ] All six chart types render correctly (bar, line, area, pie, donut, horizontal bar)

- [ ] Data table supports add/remove rows

- [ ] Chart updates live as data is edited

- [ ] Chart type switching preserves data

- [ ] Chart saved to `.notesage/charts/<id>.json` on close

- [ ] Click on inline chart reopens editor with existing data

- [ ] Chart survives tab switch and app restart

- [ ] Delete chart removes node and sidecar file

### Markdown Round-Trip

- [ ] Chart node serializes to `![chart](/.notesage/charts/<id>.json)`

- [ ] Parsing the image syntax with chart path creates a Chart node

- [ ] Regular images are not affected

- [ ] Round-trip test passes

### PDF Export

- [ ] Charts render as SVG images in exported PDFs

- [ ] SVG renders at full quality (vector, crisp at any scale)

- [ ] Chart title included in export

- [ ] Missing chart files gracefully handled

### Design

- [ ] Charts look polished with Notesage's neutral aesthetic

- [ ] All four color schemes produce beautiful, cohesive output

- [ ] Charts look great in both light and dark mode

- [ ] Data editor panel is clean and intuitive — not spreadsheet-like

- [ ] Consistent border-radius, spacing, and hover states with the rest of the editor

### Testing

- [ ] Unit tests for chart data serialization/deserialization

- [ ] Unit tests for markdown parse/serialize of chart nodes

- [ ] Unit tests for SVG export generation

- [ ] All existing markdown round-trip tests continue to pass

## Out of Scope

- **Live data binding to document tables** — requires dynamic table enhancements; future feature that would connect a chart's data source to a table node in the same document
- **Table sparklines** — separate feature, tracked in the research doc
- **Data import (CSV/Excel)** — adds file parsing complexity; users enter data manually for v1
- **Interactive/animated charts** — SVG output is static in export; hover tooltips are editor-only
- **Chart templates/presets** — the six chart types with the four color schemes provide enough variety
- **Real-time collaborative editing** — future, requires CRDT integration
- **3D charts, radar charts, heatmaps** — six types cover 90%+ of report needs; more types can be added later via the same architecture
# Chart Library Feature Audit: Recharts in Notesage

**Library:** Recharts 3.8.0 (via shadcn/ui `ChartContainer` wrapper)
**Date:** 2026-04-08

## Overview

Notesage embeds charts in documents via a Tiptap node extension backed by sidecar JSON files (`.notesage/charts/{id}.json`). Charts are created either manually through the visual Chart Editor panel, or programmatically by AI agents using the `insert-chart` bundled skill. This audit inventories every feature Recharts provides and maps each to its support status in Notesage.

### Legend

| Symbol | Meaning |
|--------|---------|
| **Supported (Manual)** | Available in the visual Chart Editor panel |
| **Supported (Skill)** | Achievable by agents writing sidecar JSON via `insert-chart` |
| **Supported (PPTX viewer)** | Used in the PPTX viewer's chart renderer only |
| **Not supported** | Recharts supports it but Notesage does not use it |

---

## 1. Chart Types

### Available in Recharts

| Chart Type | Recharts Component | Manual Editor | insert-chart Skill | Notes |
|---|---|---|---|---|
| Vertical Bar | `BarChart` + `Bar` | **Supported** | **Supported** | Core chart type |
| Horizontal Bar | `BarChart layout="vertical"` | **Supported** | **Supported** | `"horizontal_bar"` type |
| Line | `LineChart` + `Line` | **Supported** | **Supported** | Core chart type |
| Area | `AreaChart` + `Area` | **Supported** | **Supported** | Core chart type |
| Pie | `PieChart` + `Pie` | **Supported** | **Supported** | Core chart type |
| Donut | `PieChart` + `Pie` (innerRadius) | **Supported** | **Supported** | Variant of pie |
| Radar | `RadarChart` + `Radar` | **Not supported** | **Not supported** | Used in PPTX viewer only |
| Scatter | `ScatterChart` + `Scatter` | **Not supported** | **Not supported** | Used in PPTX viewer only |
| Bubble | `ScatterChart` + `Scatter` + `ZAxis` | **Not supported** | **Not supported** | Used in PPTX viewer only |
| Radial Bar | `RadialBarChart` + `RadialBar` | **Not supported** | **Not supported** | Useful for gauge/progress |
| Composed/Mixed | `ComposedChart` | **Not supported** | **Not supported** | Mix bars + lines + areas on one chart |
| Treemap | `Treemap` | **Not supported** | **Not supported** | Hierarchical data visualization |
| Sunburst | `SunburstChart` | **Not supported** | **Not supported** | Hierarchical radial |
| Funnel | `FunnelChart` + `Funnel` | **Not supported** | **Not supported** | Conversion funnels |
| Sankey | `Sankey` | **Not supported** | **Not supported** | Flow diagrams |

**Summary:** 6 of 15 chart types supported. The PPTX viewer separately renders radar, scatter, and bubble charts from imported PPTX files, but those types cannot be authored in Notesage documents.

---

## 2. Cartesian Components (Axes, Grid, etc.)

| Component | Recharts Name | Manual Editor | insert-chart Skill | Notes |
|---|---|---|---|---|
| X Axis | `XAxis` | **Supported** | **Supported** | Always rendered for cartesian types |
| Y Axis | `YAxis` | **Supported** | **Supported** | Always rendered for cartesian types |
| X Axis label | `XAxis.label` | **Supported** | **Supported** | `config.xLabel` |
| Y Axis label | `YAxis.label` | **Supported** | **Supported** | `config.yLabel` |
| Cartesian Grid | `CartesianGrid` | **Supported** | **Supported** | `config.showGrid` toggle |
| Z Axis | `ZAxis` | **Not supported** | **Not supported** | Only in PPTX viewer for bubble charts |
| Axis tick formatting | `XAxis.tickFormatter` | **Not supported** | **Not supported** | Custom number/date formatting on axes |
| Axis domain/range | `XAxis.domain`, `YAxis.domain` | **Not supported** | **Not supported** | Force min/max scale values |
| Axis type (number) | `XAxis.type="number"` | **Not supported** | **Not supported** | Currently always categorical X axis |
| Dual Y axes | Two `YAxis` components | **Not supported** | **Not supported** | Left + right axis for different scales |
| Reversed axis | `XAxis.reversed` | **Not supported** | **Not supported** | Flip axis direction |
| Axis tick rotation | `XAxis.angle` | **Not supported** | **Not supported** | Angled labels for long text |
| Axis tick count | `XAxis.tickCount` | **Not supported** | **Not supported** | Control number of tick marks |
| Logarithmic scale | `YAxis.scale="log"` | **Not supported** | **Not supported** | Log scale for exponential data |

---

## 3. Data Annotation & Reference Components

| Component | Recharts Name | Manual Editor | insert-chart Skill | Notes |
|---|---|---|---|---|
| Reference Line | `ReferenceLine` | **Not supported** | **Not supported** | Horizontal/vertical reference marks (e.g., target line, average) |
| Reference Dot | `ReferenceDot` | **Not supported** | **Not supported** | Point annotations |
| Reference Area | `ReferenceArea` | **Not supported** | **Not supported** | Shaded regions (e.g., highlight a range) |
| Error Bar | `ErrorBar` | **Not supported** | **Not supported** | Confidence intervals on data points |
| Label | `Label` | **Not supported** | **Not supported** | Arbitrary positioned text labels |
| LabelList | `LabelList` | **Not supported** | **Not supported** | Data value labels on bars/lines/dots (used in PPTX viewer) |
| Brush | `Brush` | **Not supported** | **Not supported** | Interactive range selector for zooming/panning |

---

## 4. Interactive Components

| Component | Recharts Name | Manual Editor | insert-chart Skill | Notes |
|---|---|---|---|---|
| Tooltip | `Tooltip` / `ChartTooltip` | **Supported** | **Supported** | Uses shadcn `ChartTooltipContent` |
| Legend | `Legend` / `ChartLegend` | **Supported** | **Supported** | `config.showLegend` toggle |
| Legend position | `Legend.verticalAlign`, `Legend.layout` | **Not supported** | **Not supported** | Always bottom-aligned, horizontal |
| Click handlers | `onClick` on chart elements | **Not supported** | **Not supported** | Interactive data selection |
| Active shape (hover) | `activeShape` on Pie/Bar | **Partial** | **Partial** | `activeDot` used on Line only |
| Cursor | `Tooltip.cursor` | **Not supported** | **Not supported** | Crosshair cursor on hover |
| Custom tooltip content | `Tooltip.content` | **Supported** | **Supported** | Uses shadcn wrapper |

---

## 5. Styling & Visual Features

| Feature | Recharts Mechanism | Manual Editor | insert-chart Skill | Notes |
|---|---|---|---|---|
| Color palette selection | CSS variables via `ChartConfig` | **Supported** | **Supported** | 4 palettes: neutral, monochrome, warm, cool |
| Per-series custom colors | `fill`/`stroke` per element | **Not supported** | **Not supported** | Colors assigned by palette index only |
| Gradient fills | `<defs>` + `<linearGradient>` | **Not supported** | **Not supported** | Gradient fills on areas/bars |
| Pattern fills | `<defs>` + `<pattern>` | **Not supported** | **Not supported** | Striped, dotted, etc. fills |
| Rounded corners (bar) | `Bar.radius` | **Supported** | **Supported** | `[4, 4, 0, 0]` hardcoded |
| Bar corner radius customization | `Bar.radius` per value | **Not supported** | **Not supported** | Currently hardcoded |
| Line curve type | `Line.type` / `Area.type` | **Partial** | **Partial** | Hardcoded `"monotone"`. Recharts supports: linear, basis, step, natural, etc. |
| Line dot style | `Line.dot` | **Partial** | **Partial** | Fixed `r: 3` dot. No customization. |
| Active dot | `Line.activeDot` | **Supported** | **Supported** | `r: 5` on hover |
| Area fill opacity | `Area.fillOpacity` | **Partial** | **Partial** | Hardcoded `0.2`. Not configurable. |
| Stroke width | `strokeWidth` | **Partial** | **Partial** | Hardcoded `2` for lines. Not configurable. |
| Stroke dash style | `strokeDasharray` | **Not supported** | **Not supported** | Dashed/dotted lines for differentiation |
| Animation | `isAnimationActive`, `animationDuration` | **Default** | **Default** | Uses recharts defaults, no user control |
| Bar gap / category gap | `BarChart.barGap`, `barCategoryGap` | **Not supported** | **Not supported** | Bar spacing customization |
| Stacked bars/areas | `Bar.stackId` / `Area.stackId` | **Not supported** | **Not supported** | Stacked series visualization |
| Bar size | `Bar.barSize` | **Not supported** | **Not supported** | Fixed bar width |
| Pie label | `Pie.label` | **Not supported** | **Not supported** | Inline slice labels (values, percentages) |
| Pie label lines | `Pie.labelLine` | **Not supported** | **Not supported** | Connector lines to pie labels |
| Custom shapes | `Bar.shape`, `Dot.shape` | **Not supported** | **Not supported** | Custom SVG shapes for data points |

---

## 6. Polar Chart Components

| Component | Recharts Name | Manual Editor | insert-chart Skill | Notes |
|---|---|---|---|---|
| PolarGrid | `PolarGrid` | **Not supported** | **Not supported** | Grid for radar/radial charts |
| PolarAngleAxis | `PolarAngleAxis` | **Not supported** | **Not supported** | Angular axis labels |
| PolarRadiusAxis | `PolarRadiusAxis` | **Not supported** | **Not supported** | Radial axis labels/ticks |

---

## 7. Layout & Container

| Feature | Recharts Mechanism | Manual Editor | insert-chart Skill | Notes |
|---|---|---|---|---|
| Responsive container | `ResponsiveContainer` / `ChartContainer` | **Supported** | **Supported** | Via shadcn wrapper |
| Chart height | Node attribute `height` | **Partial** | **Partial** | Default 300px. Configurable in extension attrs but no UI control in editor panel. |
| Chart width | Node attribute `width` | **Partial** | **Partial** | Attribute exists but always `null` (full-width). No UI for custom width. |
| Margins | `margin` prop | **Hardcoded** | **Hardcoded** | `{ top: 8, right: 16, bottom: 8, left: 8 }` fixed |
| Aspect ratio | `ResponsiveContainer.aspect` | **Not supported** | **Not supported** | Fixed aspect ratio |

---

## 8. Data Handling

| Feature | Current Status | Manual Editor | insert-chart Skill | Notes |
|---|---|---|---|---|
| Single series | Supported | **Supported** | **Supported** | `category` + `value` pattern |
| Multi-series | Supported at render level | **Not supported** | **Supported** | Data table only supports single-series editing. Multi-series requires direct JSON. |
| Data sorting | Not implemented | **Not supported** | **Not supported** | Auto-sort by value or category |
| Data filtering | Not implemented | **Not supported** | **Not supported** | Show/hide data points |
| Real-time data | Not implemented | **Not supported** | **Not supported** | Live-updating charts |
| Negative values | Works at render level | **Supported** | **Supported** | No special handling needed |
| Missing/null values | `connectNulls` prop | **Not supported** | **Not supported** | Gap handling in line/area charts |
| Date/time axis | `XAxis.scale="time"` | **Not supported** | **Not supported** | Time-series data with proper spacing |

---

## 9. Export Support

| Export Target | Chart Support | Notes |
|---|---|---|
| PDF (Typst) | **Supported** | Chart block references are rewritten to cached `.svg` preview files |
| DOCX | **Supported** | SVG embedded as image (same cached `.svg`) |
| HTML | **Partial** | Chart markdown reference not converted to inline chart; renders as broken image if no special handling |
| PPTX | **Supported** | Native PowerPoint charts via `ppt-rs` (bar, line, area, pie, donut) |
| Clipboard (Copy HTML) | **Not supported** | Charts not included in clipboard HTML fragment |

---

## 10. Editor UX Features

| Feature | Current Status | Notes |
|---|---|---|
| Visual chart type picker | **Supported** | 6-type grid with icons |
| Data entry table | **Supported** | Category + value rows, add/remove |
| Multi-series data editing | **Not supported** | Only single-series in UI. No way to add/name series columns. |
| Title editing | **Supported** | Text input in settings |
| Axis label editing | **Supported** | X and Y label inputs |
| Grid toggle | **Supported** | Switch control |
| Legend toggle | **Supported** | Switch control |
| Color scheme picker | **Supported** | 4-scheme dropdown |
| Live preview | **Supported** | Renders in editor panel as you edit |
| Drag-to-resize | **Not supported** | No resize handles on the chart block |
| CSV/TSV paste | **Not supported** | No way to paste tabular data into the data table |
| Data import from file | **Not supported** | No file picker for data source |
| Data import from table | **Not supported** | No way to create chart from an existing document table |
| Undo/redo in chart editor | **Not supported** | Changes are immediate, no undo within the dialog |
| Chart duplication | **Not supported** | No "duplicate chart" action |
| Chart download (image) | **Not supported** | No "download as PNG/SVG" on individual charts |

---

## Improvement Opportunities

### High Priority — Chart Types

| Improvement | Rationale | Effort |
|---|---|---|
| **Add Radar chart** | Already rendered in PPTX viewer. Useful for competency assessments, product comparisons, multi-dimensional analysis. Just needs a renderer + type + editor UI. | Low-Medium |
| **Add Scatter chart** | Already rendered in PPTX viewer. Essential for correlation analysis, scientific data. Needs X/Y numeric data model (currently category-based). | Medium |
| **Add Composed/Mixed chart** | Combine bars + lines on one chart (e.g., revenue bars + trend line). Very common in business reporting. | Medium |
| **Add Stacked bar/area** | Show composition within categories (e.g., revenue by product line). Recharts supports via `stackId`. | Low |
| **Add Radial Bar chart** | Gauge-style progress visualizations. Popular for dashboards and KPIs. | Low-Medium |

### High Priority — Data & Configuration

| Improvement | Rationale | Effort |
|---|---|---|
| **Multi-series data editing in UI** | Currently only agents can create multi-series charts. Users should be able to add/remove/rename series columns in the data table. | Medium |
| **Reference lines** | Target lines, averages, thresholds are extremely common in business charts. Recharts `ReferenceLine` is trivial to add. | Low |
| **Data labels on chart** | Show values on bars/dots/slices. Recharts `LabelList` already used in PPTX viewer. Just needs a toggle in settings. | Low |
| **Axis tick formatting** | Number formatting (thousands, percentages, currency) on axes. Currently raw numbers only. | Low-Medium |
| **Pie/donut slice labels** | Show percentage or value labels on pie slices. Currently no labels — only tooltip on hover. | Low |
| **Stacked mode toggle** | For multi-series bar/area charts, toggle between grouped and stacked. | Low |
| **Line curve type selection** | Let users choose linear, monotone, step, natural, basis. Currently hardcoded to monotone. | Low |

### Medium Priority — Editor UX

| Improvement | Rationale | Effort |
|---|---|---|
| **Drag-to-resize chart blocks** | Charts are fixed height (300px). Users should be able to drag resize handles like they can with drawings. | Medium |
| **CSV/TSV paste into data table** | Copy from Excel/Sheets and paste directly. Huge productivity win for data-heavy users. | Low-Medium |
| **Chart from table** | Right-click a document table to generate a chart from its data. Natural workflow. | Medium |
| **Chart height control** | The `height` attribute exists but has no UI. Add a slider or input in the settings panel. | Low |
| **Chart duplication** | "Duplicate" in context menu to clone chart + sidecar. | Low |
| **Download chart as image** | "Save as PNG/SVG" button on hover or in context menu. SVG is already cached. | Low |
| **Legend position control** | Top, bottom, left, right. Currently always bottom. | Low |

### Lower Priority — Advanced Features

| Improvement | Rationale | Effort |
|---|---|---|
| **Dual Y axes** | Two scales on left/right for different series ranges. Common in financial charts. | Medium |
| **Gradient/pattern fills** | Visual differentiation beyond solid colors. Good for accessibility (pattern) and aesthetics (gradient). | Medium |
| **Brush (zoom/pan)** | Interactive range selection for large datasets. | Medium |
| **Custom per-series colors** | Override palette colors for individual series. | Low-Medium |
| **Treemap** | Hierarchical data display. Useful for budget breakdowns, disk usage, etc. | Medium |
| **Funnel chart** | Sales pipeline, conversion funnel visualization. | Medium |
| **Error bars** | Confidence intervals for scientific/statistical data. | Low |
| **Logarithmic scale** | Exponential data display. | Low |
| **Date/time X axis** | Proper time-series with non-uniform spacing. | Medium-High |
| **Bar gap/size control** | Fine-tune bar chart appearance. | Low |
| **Negative value styling** | Different color for negative bars (e.g., red for losses). | Low |
| **Animation control** | Toggle animations on/off, control duration. | Low |

### Skill-Specific Improvements

| Improvement | Rationale | Effort |
|---|---|---|
| **Extend skill schema for new chart types** | As types are added, update CHART-SCHEMA.md and EXAMPLES.md so agents can create them. | Low (per type) |
| **Add reference line support to schema** | Allow agents to specify target/average lines in JSON. | Low |
| **Add data labels to schema** | `config.showDataLabels` boolean so agents can toggle value labels. | Low |
| **Add stacking to schema** | `config.stacked` boolean for stacked bar/area charts. | Low |
| **Add curve type to schema** | `config.curveType` field for line/area charts. | Low |
| **Add pie label format to schema** | `config.pieLabels: "none" | "value" | "percent" | "name"` | Low |

### UX Polish Opportunities

| Improvement | Rationale |
|---|---|
| **Empty state improvement** | The "Click to add data" placeholder could show chart type thumbnails to guide selection. |
| **Keyboard shortcuts in chart editor** | Tab between fields, Enter to add row, Delete to remove row. |
| **Data validation feedback** | Show inline errors when data is malformed (e.g., non-numeric values, duplicate categories). |
| **Chart comparison view** | Side-by-side comparison of two charts (useful for before/after analysis). |
| **Theme-aware chart colors** | The 4 palettes use very low chroma (0.02-0.04). Consider offering a "Vivid" palette with higher chroma for presentations. While maintaining the neutral UI philosophy, chart content colors already allow chroma (per design system exception). |
| **Sparkline-to-chart promotion** | Click a `{{spark:...}}` inline sparkline in a table to expand it into a full chart block. |
| **Auto-title from context** | When inserting a chart below a heading, suggest the heading text as the chart title. |
| **Data table sorting** | Click column headers in the data table to sort rows by category or value. |
| **Smooth chart type switching** | When switching between compatible types (e.g., bar to line), preserve all data. When switching to incompatible types (e.g., bar to pie), warn if multi-series data will be lost. Currently all data is preserved but multi-series is silently ignored by pie. |

---

## Summary

**Current coverage:** Notesage uses **6 of 15** chart types and roughly **30% of recharts' feature surface area**. The current implementation covers the most common use cases well (basic bar, line, area, pie charts with single-series data), but there is significant room for improvement in three areas:

1. **Chart type diversity** (radar, scatter, composed, stacked, radial bar) — 5 types could be added with moderate effort since recharts already supports them and some are already rendered in the PPTX viewer.

2. **Multi-series editing gap** — The most impactful single improvement would be adding multi-series data editing to the visual chart editor. Currently, only AI agents can create multi-series charts, which limits the manual editing workflow to single-series data.

3. **Data annotation** (reference lines, data labels, axis formatting) — These are table-stakes features for business charts and are trivially supported by recharts. Adding `ReferenceLine`, `LabelList`, and tick formatters would significantly improve chart utility.

The `insert-chart` skill is well-designed for agent usage but its schema should evolve alongside new features to maintain parity between manual and agentic chart creation.

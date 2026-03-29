# Inline Charts — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-03-29 |
| **Status** | Complete |
| **PRD** | [inline-charts](../prds/2026-03-29-inline-charts.md) |
| **Research** | [rich-content-editor-features](../research/2026-03-29-rich-content-editor-features.md) |
| **Total** | 15 tasks: 4S, 7M, 4L |
| **Suggested order** | Setup (#1) → Types (#2) → Extension (#3) → Sidecar (#4) → Chart theming (#5) → Chart renderers (#6) → NodeView (#7) → Data editor (#8-#9) → Markdown (#10-#11) → Slash/Toolbar (#12-#13) → PDF (#14) → Tests (#15) |

### Risks & Open Questions

- **SVG export for PDF:** Charts render as React components in the browser. For PDF export, the SVG needs to be serialized. Two options: (a) use `renderToStaticMarkup` from `react-dom/server` in the frontend to generate SVG strings, then pass to the Typst pipeline, or (b) cache SVG strings on every chart save (same pattern as drawings). Option (b) is simpler and avoids SSR complexity.
- **Multi-series charts:** Line and area charts support multiple series (multiple Y columns per category). The data editor needs to handle dynamic column addition for series, which is more complex than the simple category+value table for bar/pie. Consider shipping single-series first and adding multi-series in a follow-up.
- **Recharts bundle size:** \~139KB gzipped for the full `recharts` package. Tree-shakeable — only the used chart components are bundled. Lazy loading (like Excalidraw) is an option but may cause visible load delay when clicking to edit.
- **ReactNodeViewRenderer:** Same pattern needed as the Drawing Canvas feature. Drawing Canvas already ships, so this task reuses the established pattern.
- **Color scheme in dark mode:** The four curated palettes must look good in both light and dark mode. shadcn/ui's CSS variable approach makes this straightforward — define `--color-chart-1` through `--color-chart-5` per palette in both `:root` and `.dark` scopes.

---

### #1 — Install shadcn/ui chart component and Recharts ✅

**Description:** Run `pnpm dlx shadcn@latest add chart` to install the shadcn/ui chart primitives (which adds `recharts` as a dependency). Verify the Vite dev server and production build work without errors. Check that tree-shaking works (only used chart components are bundled).

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `package.json` — `recharts` added as dependency
- `src/components/ui/chart.tsx` — shadcn/ui chart primitives (auto-generated)
- `vite.config.ts` — add to `optimizeDeps.include` if needed

---

### #2 — Define chart data types and color schemes ✅

**Description:** Create the TypeScript interfaces for chart data (`ChartData`, `ChartDataPoint`, `ChartSeries`, `ChartConfig`) and the four curated color palettes (`neutral`, `monochrome`, `warm`, `cool`). Each palette must define colors for both light and dark mode.

Define a `CHART_TYPES` constant with metadata for each of the six chart types (name, icon, Recharts component, data shape).

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/chart-types.ts` — new file with interfaces, palettes, and chart type metadata

---

### #3 — Create Chart Tiptap node extension (schema only) ✅

**Description:** Create the `Chart` atom node extension with `chartId`, `width`, and `height` attrs. Implement `parseHTML` to match `<div data-chart-id="...">`, `renderHTML` to output a placeholder div, and basic commands (`insertChart`, `deleteChart`). Do NOT implement the NodeView yet.

Register in `useEditor.ts` and export from `extensions/index.ts`.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/components/editor/extensions/chart.ts` — new file
- `src/components/editor/extensions/index.ts` — export `Chart`
- `src/hooks/useEditor.ts` — register in extensions array

---

### #4 — Implement chart sidecar file operations ✅

**Description:** Create a chart storage utility (or Zustand store) for reading, writing, and deleting chart JSON sidecar files in `.notesage/charts/`. Follow the same pattern as drawing sidecar storage.

Functions:

- `loadChart(chartId, projectRoot)` → `ChartData`
- `saveChart(chartId, projectRoot, data: ChartData)` — write JSON, ensure directory
- `saveSvgPreview(chartId, projectRoot, svgString)` — cache SVG for PDF export
- `deleteChart(chartId, projectRoot)` — remove `.json` and `.svg` files
- `chartExists(chartId, projectRoot)` — check existence

All via `tauriApi` (`read_file`, `write_file`, `delete_path`, `path_exists`).

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/stores/chart-store.ts` — new file (or `src/lib/chart-storage.ts`)

---

### #5 — Create chart theme configuration with shadcn/ui ChartConfig ✅

**Description:** Build the `ChartConfig` objects and CSS variable definitions that match Notesage's design system. Create:

- CSS variables for chart colors (`--color-chart-1` through `--color-chart-5`) per palette × mode in `globals.css`
- A `getChartConfig(scheme: ColorScheme)` function that returns a shadcn/ui `ChartConfig` mapping data keys to colors and labels
- Recharts customization for axis text, grid lines, and fonts matching Notesage's type scale
- `ChartTooltipContent` styling to match Notesage's tooltip aesthetic

The four color palettes (`neutral`, `monochrome`, `warm`, `cool`) each define 5-6 colors for both light and dark mode via CSS variables.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #1, #2 **Files:**

- `src/lib/chart-theme.ts` — new file with ChartConfig builder and palette CSS variable mappings
- `src/styles/globals.css` — add `--color-chart-*` variables per palette

---

### #6 — Implement chart renderer components ✅

**Description:** Create wrapper components for each of the six chart types that accept `ChartData` and render the appropriate Recharts component inside a shadcn/ui `ChartContainer`. Each wrapper:

- Accepts `data`, `config`, `width`, `height` props
- Wraps in `<ChartContainer config={chartConfig}>` for CSS variable theming
- Maps `ChartData` to Recharts data format
- Uses `<ChartTooltip content={<ChartTooltipContent />} />` for themed tooltips
- Handles the pie→donut variant (same `PieChart` component, different `innerRadius`)
- Handles horizontal bar (same `BarChart` component, `layout="vertical"`)

Create a single `ChartRenderer` component that switches on `type` to render the correct sub-component.

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #1, #2, #5 **Files:**

- `src/components/editor/charts/ChartRenderer.tsx` — new file (dispatcher)
- `src/components/editor/charts/BarChart.tsx` — bar + horizontal bar (Recharts `BarChart`)
- `src/components/editor/charts/LineChart.tsx` — line + area (Recharts `LineChart` / `AreaChart`)
- `src/components/editor/charts/PieChart.tsx` — pie + donut (Recharts `PieChart`)

---

### #7 — Implement Chart NodeView (inline SVG preview) ✅

**Description:** Create the `ReactNodeViewRenderer` for the Chart node. On mount, load the chart data from the sidecar file and render it inline using `ChartRenderer`. Show a placeholder with "Click to add data" if the chart is empty/new.

Features:

- Render the live Recharts SVG chart inline (with hover tooltips via shadcn/ui ChartTooltip)
- Subtle border, rounded corners
- "Edit" label with pencil icon on hover (bottom-right)
- Click handler to open the chart editor panel
- Respect `width`/`height` attrs
- Title displayed above the chart area
- Theme syncs with Notesage light/dark mode

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #3, #4, #6 **Files:**

- `src/components/editor/extensions/chart.ts` — add `addNodeView()` with `ReactNodeViewRenderer`
- `src/components/editor/charts/ChartNodeView.tsx` — new React component
- `src/styles/editor.css` — add chart block styles

---

### #8 — Build chart data editor panel — data table ✅

**Description:** Create the data table section of the chart editor panel. A clean, minimal grid (not a spreadsheet) where users can:

- Edit category and value cells inline
- Add rows with a "+" button
- Remove rows with a "−" button per row
- Tab between cells for fast data entry
- See validation (value must be numeric, category must be non-empty)

The table adapts per chart type:

- Bar/horizontal bar/line/area: category (string) + value (number)
- Pie/donut: label (string) + value (number)

Use shadcn/ui `Input` and `Button` components. Keep it simple — this is NOT a spreadsheet.

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #2 **Files:**

- `src/components/editor/charts/ChartDataTable.tsx` — new file

---

### #9 — Build chart data editor panel — full panel ✅

**Description:** Assemble the complete chart editor panel with all sections:

1. **Header** — "New Chart" / "Edit Chart" title + "Done" button
2. **Chart type selector** — six visual thumbnails, click to switch type (preserves data)
3. **Data table** — from #8
4. **Settings** — title input, axis labels, show/hide grid toggle, show/hide legend toggle, color scheme dropdown
5. **Live preview** — `ChartRenderer` from #6, updates on every change

Open as a dialog or side panel (follow the pattern of `ExportDialog.tsx` or `SettingsDialog`). State managed locally (not Zustand) — only saved to sidecar on "Done".

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #6, #8 **Files:**

- `src/components/editor/charts/ChartEditorPanel.tsx` — new file (main panel)
- `src/components/editor/charts/ChartTypeSelector.tsx` — new file (type picker)
- `src/components/editor/charts/ChartSettings.tsx` — new file (config section)

---

### #10 — Add chart markdown parsing ✅

**Description:** Intercept markdown image syntax where the src matches `/.notesage/charts/*.json` and create a `Chart` node instead of an `Image` node. Extract the `chartId` from the filename.

Same approach options as the Drawing Canvas feature:

1. Preprocessor in `markdown.ts` converting `![chart](path.json)` to `<div data-chart-id="...">` HTML
2. `parseHTML` priority on the Chart node matching `<img>` with chart path

Regular images must not be affected. Only paths matching `/.notesage/charts/` with `.json` extension should be intercepted.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #3 **Files:**

- `src/lib/markdown.ts` — add preprocessor (if approach 1)
- `src/components/editor/extensions/chart.ts` — add parse rules

---

### #11 — Add chart markdown serialization ✅

**Description:** Serialize the `Chart` node to:

```markdown
<div data-chart-id="<chartId>" data-type="chart" class="chart-block"></div>
```

Use the `addStorage() → markdown.serialize` pattern.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #3 **Files:**

- `src/components/editor/extensions/chart.ts` — add `addStorage()` with `markdown.serialize`

---

### #12 — Add chart slash command ✅

**Description:** Add a `/chart` entry to the slash command list. Selecting it inserts a new Chart node with a generated UUID and immediately opens the chart editor panel.

Use the `bar-chart-3` Lucide icon. Follow the existing `CommandItem` pattern.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #3, #9 **Files:**

- `src/components/editor/extensions/slash-command.tsx` — add chart command

---

### #13 — Add chart toolbar button ✅

**Description:** Add a chart button to the top toolbar (after the image or drawing button), using the `bar-chart-3` Lucide icon. Clicking inserts a new chart and opens the editor panel.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #3, #9 **Files:**

- `src/components/editor/Toolbar.tsx` — add chart button

---

### #14 — Add chart rendering in Typst/PDF export ✅

**Description:** Extend the PDF export pipeline to handle chart nodes. When the exporter encounters a chart image reference (`/.notesage/charts/<id>.json`):

1. Read the cached SVG from `.notesage/charts/<id>.svg` (written on chart save by #4/#7)
2. If no cached SVG, generate one by rendering the Nivo chart to SVG string in the frontend before export (or skip with a placeholder)
3. Pass the SVG to the Typst converter, which includes it via `#image()`

The SVG generation uses `renderToStaticMarkup` from `react-dom/server` applied to the `ChartRenderer` component. This can run in the frontend as a pre-export step.

**Complexity:** M **Category:** both **Dependencies:** Depends on #6, #7 **Files:**

- `src/lib/chart-svg-export.ts` — new file: render Recharts chart to SVG string via `renderToStaticMarkup`
- `src-tauri/src/export/markdown_to_typst.rs` — detect chart image references, substitute SVG
- `src/components/ExportDialog.tsx` — add pre-export step to generate chart SVGs

---

### #15 — Add unit and round-trip tests ✅

**Description:** Write tests covering:

- **Chart types and palettes:** Validate `ChartData` interfaces, all six types map correctly, palette definitions complete for both modes
- **Sidecar operations:** Load, save, delete, existence check (mock tauriApi)
- **Markdown parsing:** Chart image syntax → Chart node, regular images unaffected
- **Markdown serialization:** Chart node → `![chart](path.json)` syntax
- **Round-trip fixture:** Create `tests/fixtures/charts.md` with chart references, verify parse→serialize→compare
- **ChartRenderer:** Each of the six types renders without errors given valid data (snapshot or smoke test)
- **Data table:** Add/remove rows, validation, type switching preserves data

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #6, #10, #11 **Files:**

- `tests/fixtures/charts.md` — new round-trip fixture
- `src/lib/__tests__/chart-types.test.ts` — type and palette tests
- `src/components/editor/extensions/__tests__/chart.test.ts` — parse/serialize tests
- `src/components/editor/charts/__tests__/ChartDataTable.test.ts` — data table tests
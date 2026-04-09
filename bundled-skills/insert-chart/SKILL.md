---
name: insert-chart
description: Insert inline Recharts-based charts into Notesage documents
user-invocable: true
---

# Insert Chart

Insert an inline chart into a Notesage markdown document. Charts render natively in the editor using Recharts and export to PDF, DOCX, and HTML.

## How It Works

Notesage charts are stored as two pieces:
1. A **sidecar JSON file** in `.notesage/charts/{id}.json` containing the chart data and configuration
2. A **markdown image reference** `![chart](/.notesage/charts/{id}.json)` in the document

When the editor sees this markdown pattern, it renders an interactive chart. The file watcher automatically picks up changes, so the chart appears as soon as both files are written.

## Workflow

1. **Generate a unique ID** for the chart. Use `uuidgen` (available on macOS and most Linux), or any unique string — the only requirement is no collisions within the project's `.notesage/charts/` directory.

2. **Create the charts directory** if it doesn't exist:
   ```
   mkdir -p <project_root>/.notesage/charts
   ```

3. **Write the chart JSON** to `.notesage/charts/{id}.json`. See `references/CHART-SCHEMA.md` for the full data format and `references/EXAMPLES.md` for complete working examples.

4. **Insert the markdown reference** into the document at the desired location:
   ```markdown
   ![chart](/.notesage/charts/{id}.json)
   ```
   This line must be on its own paragraph (blank lines above and below).

5. **Save the document.** The editor detects the file change and renders the chart inline.

## Supported Chart Types

| Type | Description | Best For |
|------|-------------|----------|
| `bar` | Vertical bar chart | Comparing categories |
| `horizontal_bar` | Horizontal bar chart | Long category labels |
| `line` | Line chart | Trends over time |
| `area` | Filled area chart | Volume over time |
| `pie` | Pie chart | Proportions of a whole |
| `donut` | Donut chart | Proportions with center space |
| `radar` | Radar / spider chart | Multi-dimensional comparison |
| `scatter` | Scatter plot | Correlations between X/Y values |
| `radial_bar` | Radial bar chart | Progress / gauge visualization |
| `composed` | Mixed bar + line + area | Combining different visual encodings |

## Tips

- **Start with minimal data** — verify rendering with a simple 3-point single-series chart before building the full dataset. This catches format issues early.
- Keep data arrays reasonable (5–30 points for readability)
- Use `"line"` or `"area"` for time series data
- Use `"pie"` or `"donut"` only when showing parts of a whole (typically 3–8 slices)
- Multi-series charts need the `series` array — see the schema and examples. Set `showLegend: true` so series are distinguishable.
- The `colorScheme` options are `"neutral"`, `"monochrome"`, `"warm"`, and `"cool"`
- If you need to look at existing charts in the project for reference, check `.notesage/charts/*.json`

## Troubleshooting

- **Chart renders empty (axes only, no bars/lines):** Check that the `dataKey` values match. For single-series, each data point needs a `value` field. For multi-series, each data point must contain all series keys as numeric properties, and the `series` array must list them.
- **Chart disappears after switching tabs:** If the chart markdown reference (`![chart](...)`) was removed from the document (e.g., by an undo or failed edit), the editor deletes the orphaned sidecar file after 5 seconds. Re-insert the markdown line and re-create the JSON file.
- **Chart shows placeholder instead of rendering:** The sidecar JSON file may be missing or contain invalid JSON. Check that `.notesage/charts/{id}.json` exists and is valid JSON matching the schema.

## References

- `references/CHART-SCHEMA.md` — Full JSON schema for the chart sidecar file
- `references/EXAMPLES.md` — Complete working examples for each chart type

---
name: insert-chart
description: Insert inline Recharts-based charts into Notesage documents
user-invocable: true
---

# Insert Chart

Insert an inline chart into a Notesage markdown document. Charts render natively in the editor using Recharts and export to PDF, DOCX, and HTML.

## How It Works

Notesage charts are embedded directly in markdown files as fenced code blocks with the `chart` language tag:

````
```chart
{
  "type": "bar",
  "title": "Example",
  "data": [...],
  "config": {...}
}
```
````

When the editor sees a `chart` code block, it renders an interactive chart inline. No external files or directories are needed.

## Workflow

1. **Compose the chart JSON.** See `references/CHART-SCHEMA.md` for the full data format and `references/EXAMPLES.md` for complete working examples.

2. **Insert a fenced code block** into the markdown document at the desired location, using `chart` as the language tag:

   ````
   ```chart
   { ...chart JSON... }
   ```
   ````

   The code block must be on its own paragraph (blank lines above and below).

3. **Save the document.** The editor renders the chart inline.

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
- Keep data arrays reasonable (5-30 points for readability)
- Use `"line"` or `"area"` for time series data
- Use `"pie"` or `"donut"` only when showing parts of a whole (typically 3-8 slices)
- Multi-series charts need the `series` array — see the schema and examples. Set `showLegend: true` so series are distinguishable.
- The `colorScheme` options are `"neutral"`, `"monochrome"`, `"warm"`, and `"cool"`

## Troubleshooting

- **Chart renders empty (axes only, no bars/lines):** Check that the `dataKey` values match. For single-series, each data point needs a `value` field. For multi-series, each data point must contain all series keys as numeric properties, and the `series` array must list them.
- **Chart shows as a code block instead of rendering:** Make sure the language tag is exactly `chart` (lowercase, no spaces). The JSON must be valid — check for trailing commas or missing quotes.

## References

- `references/CHART-SCHEMA.md` — Full JSON schema for the chart data format
- `references/EXAMPLES.md` — Complete working examples for each chart type

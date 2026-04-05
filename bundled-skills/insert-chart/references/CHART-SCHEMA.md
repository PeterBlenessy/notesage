# Chart Sidecar JSON Schema

The chart sidecar file (`.notesage/charts/{id}.json`) must conform to the following structure. Notesage renders charts using [Recharts](https://recharts.org/), so the data format maps directly to Recharts component props.

## Top-Level Object: ChartData

```json
{
  "type": "<ChartType>",
  "title": "<string>",
  "data": [<ChartDataPoint>, ...],
  "series": [<ChartSeries>, ...],
  "config": <ChartConfig>
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | ChartType | Yes | Chart type (see below) |
| `title` | string | Yes | Chart title displayed above the chart. Can be empty string. |
| `data` | ChartDataPoint[] | Yes | Array of data points |
| `series` | ChartSeries[] | No | Required only for multi-series charts |
| `config` | ChartConfig | Yes | Display configuration |

## ChartType

One of: `"bar"`, `"line"`, `"area"`, `"pie"`, `"donut"`, `"horizontal_bar"`

**Recharts mapping:**

| ChartType | Recharts Component | Data Shape |
|-----------|-------------------|------------|
| `bar` | `<BarChart>` with vertical `<Bar>` | cartesian |
| `horizontal_bar` | `<BarChart layout="vertical">` | cartesian |
| `line` | `<LineChart>` with `<Line>` | cartesian |
| `area` | `<AreaChart>` with `<Area>` | cartesian |
| `pie` | `<PieChart>` with `<Pie>` | radial |
| `donut` | `<PieChart>` with `<Pie innerRadius>` | radial |

## ChartDataPoint

Each data point is an object in the `data` array:

```json
{ "category": "<string>", "value": <number> }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `category` | string | Yes | Label for this data point. Used as the X-axis label (cartesian) or slice label (radial). This is the Recharts `dataKey` for the `<XAxis>`. |
| `value` | number | Yes | Numeric value. This is the Recharts `dataKey` for the default series. |

**For multi-series charts**, each data point must also include additional numeric properties matching each series key:

```json
{ "category": "Q1", "revenue": 100, "expenses": 80 }
```

When using multi-series, the `value` field is not used — the series keys replace it.

## ChartSeries

Only needed for multi-series charts (2+ data lines/bars). Omit entirely for single-series charts.

```json
{ "key": "<string>", "label": "<string>" }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | string | Yes | Property name on each data point (e.g., `"revenue"`). Must match a key in every ChartDataPoint object. |
| `label` | string | Yes | Human-readable label shown in legend and tooltips |

## ChartConfig

```json
{
  "xLabel": "<string>",
  "yLabel": "<string>",
  "showGrid": <boolean>,
  "showLegend": <boolean>,
  "colorScheme": "<ColorScheme>"
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `xLabel` | string | Yes | `""` | X-axis label. Empty string for no label. |
| `yLabel` | string | Yes | `""` | Y-axis label. Empty string for no label. |
| `showGrid` | boolean | Yes | `true` | Show background grid lines |
| `showLegend` | boolean | Yes | `false` | Show chart legend. Recommended for multi-series. |
| `colorScheme` | ColorScheme | Yes | `"neutral"` | Color palette for the chart |

## ColorScheme

One of: `"neutral"`, `"monochrome"`, `"warm"`, `"cool"`

| Scheme | Description |
|--------|-------------|
| `neutral` | Low-chroma grey-blue tones (default, matches Notesage design) |
| `monochrome` | Pure greyscale |
| `warm` | Orange and red tones |
| `cool` | Blue and purple tones |

Each scheme provides 5 distinct colors for multi-series differentiation, with separate light and dark mode variants that the editor applies automatically.

## Validation Rules

- `data` must have at least 1 entry
- `category` must be a string (even for numeric years — use `"2020"`, not `2020`)
- `value` must be a number (not a string)
- For multi-series: every data point must contain all series keys as numeric properties
- `type` must be one of the 6 valid chart types
- `colorScheme` must be one of the 4 valid schemes

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

One of: `"bar"`, `"line"`, `"area"`, `"pie"`, `"donut"`, `"horizontal_bar"`, `"radar"`, `"scatter"`, `"radial_bar"`, `"composed"`

**Recharts mapping:**

| ChartType | Recharts Component | Data Shape |
|-----------|-------------------|------------|
| `bar` | `<BarChart>` with vertical `<Bar>` | cartesian |
| `horizontal_bar` | `<BarChart layout="vertical">` | cartesian |
| `line` | `<LineChart>` with `<Line>` | cartesian |
| `area` | `<AreaChart>` with `<Area>` | cartesian |
| `pie` | `<PieChart>` with `<Pie>` | radial |
| `donut` | `<PieChart>` with `<Pie innerRadius>` | radial |
| `radar` | `<RadarChart>` with `<Radar>` | polar |
| `scatter` | `<ScatterChart>` with `<Scatter>` | xy |
| `radial_bar` | `<RadialBarChart>` with `<RadialBar>` | radial |
| `composed` | `<ComposedChart>` with mixed `<Bar>`, `<Line>`, `<Area>` | cartesian |

## ChartDataPoint

Each data point is an object in the `data` array:

```json
{ "category": "<string>", "value": <number> }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `category` | string | Yes | Label for this data point. Used as the X-axis label (cartesian) or slice label (radial). |
| `value` | number | Yes | Numeric value. Used as the default series value. |
| `x` | number | No | Scatter charts only: numeric X coordinate. |
| `y` | number | No | Scatter charts only: numeric Y coordinate. |

**For multi-series charts**, each data point must also include additional numeric properties matching each series key:

```json
{ "category": "Q1", "revenue": 100, "expenses": 80 }
```

When using multi-series, the `value` field is not used — the series keys replace it.

**For scatter charts**, use `x` and `y` instead of `category` and `value`:

```json
{ "category": "", "value": 0, "x": 10, "y": 25 }
```

## ChartSeries

Only needed for multi-series charts (2+ data lines/bars). Omit entirely for single-series charts.

```json
{ "key": "<string>", "label": "<string>", "renderAs": "<string>" }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | string | Yes | Property name on each data point (e.g., `"revenue"`). Must match a key in every ChartDataPoint object. |
| `label` | string | Yes | Human-readable label shown in legend and tooltips |
| `renderAs` | string | No | Composed charts only: `"bar"`, `"line"`, or `"area"`. Defaults to `"bar"`. |

## ChartConfig

```json
{
  "xLabel": "<string>",
  "yLabel": "<string>",
  "showGrid": <boolean>,
  "showLegend": <boolean>,
  "colorScheme": "<ColorScheme>",
  "showDataLabels": <boolean>,
  "pieLabels": "<string>",
  "stacked": <boolean>,
  "curveType": "<string>",
  "legendPosition": "<string>",
  "xTickFormat": "<string>",
  "yTickFormat": "<string>",
  "referenceLines": [<ReferenceLine>, ...]
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `xLabel` | string | Yes | `""` | X-axis label. Empty string for no label. |
| `yLabel` | string | Yes | `""` | Y-axis label. Empty string for no label. |
| `showGrid` | boolean | Yes | `true` | Show background grid lines |
| `showLegend` | boolean | Yes | `false` | Show chart legend. Recommended for multi-series. |
| `colorScheme` | ColorScheme | Yes | `"neutral"` | Color palette for the chart |
| `showDataLabels` | boolean | No | `false` | Show value labels on data points (bars, lines, pie slices) |
| `pieLabels` | string | No | `"none"` | Pie/donut label format: `"none"`, `"value"`, `"percent"`, or `"name"` |
| `stacked` | boolean | No | `false` | Stack bars/areas in multi-series charts |
| `curveType` | string | No | `"monotone"` | Line/area interpolation: `"monotone"`, `"linear"`, `"step"`, `"natural"`, `"basis"` |
| `legendPosition` | string | No | `"bottom"` | Legend position: `"bottom"`, `"top"`, `"left"`, `"right"` |
| `xTickFormat` | string | No | `"plain"` | X-axis format: `"plain"`, `"thousands"`, `"percent"`, `"currency"` |
| `yTickFormat` | string | No | `"plain"` | Y-axis format: `"plain"`, `"thousands"`, `"percent"`, `"currency"` |
| `referenceLines` | ReferenceLine[] | No | `[]` | Reference lines on cartesian charts |

## ReferenceLine

```json
{ "axis": "y", "value": 150, "label": "Target" }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `axis` | string | Yes | `"x"` or `"y"` |
| `value` | number or string | Yes | Position on the axis |
| `label` | string | No | Label displayed near the line |
| `stroke` | string | No | Line color (defaults to muted foreground) |
| `strokeDasharray` | string | No | Dash pattern (defaults to `"3 3"`) |

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
- `type` must be one of the 10 valid chart types
- `colorScheme` must be one of the 4 valid schemes
- All new config fields are optional — existing charts with only the 5 base fields continue to work

# Embedded Chart Examples

Complete examples of all 10 chart types using the inline ```` ```chart ```` fenced code block format. Copy any example directly into a markdown document — no sidecar files, UUIDs, or directories needed.

## Format

```
<div data-chart-json="{
  &quot;type&quot;: &quot;&lt;ChartType&gt;&quot;,
  &quot;title&quot;: &quot;Chart Title&quot;,
  &quot;data&quot;: [...],
  &quot;config&quot;: { ... }
}" data-type="chart" class="chart-block"></div>
```

The JSON is embedded directly in the markdown. The editor renders it as an interactive chart in WYSIWYG mode.

---

## 1. Bar Chart — Quarterly Revenue

```chart
{
  "type": "bar",
  "title": "2025 Quarterly Revenue",
  "data": [
    {
      "category": "Q1",
      "value": 142
    },
    {
      "category": "Q2",
      "value": 168
    },
    {
      "category": "Q3",
      "value": 155
    },
    {
      "category": "Q4",
      "value": 193
    }
  ],
  "config": {
    "xLabel": "Quarter",
    "yLabel": "Revenue ($M)",
    "showGrid": true,
    "showLegend": false,
    "colorScheme": "neutral"
  }
}
```

---

## 2. Line Chart — S&P 500 Performance

```chart
{
  "type": "line",
  "title": "S&P 500 Annual Close",
  "data": [
    {
      "category": "2018",
      "value": 2507
    },
    {
      "category": "2019",
      "value": 3231
    },
    {
      "category": "2020",
      "value": 3756
    },
    {
      "category": "2021",
      "value": 4766
    },
    {
      "category": "2022",
      "value": 3840
    },
    {
      "category": "2023",
      "value": 4770
    },
    {
      "category": "2024",
      "value": 5881
    },
    {
      "category": "2025",
      "value": 5693
    }
  ],
  "config": {
    "xLabel": "Year",
    "yLabel": "Close Price (USD)",
    "showGrid": true,
    "showLegend": false,
    "colorScheme": "neutral"
  }
}
```

---

## 3. Area Chart — Website Traffic

```chart
{
  "type": "area",
  "title": "Monthly Website Visitors",
  "data": [
    {
      "category": "Jan",
      "value": 12400
    },
    {
      "category": "Feb",
      "value": 15200
    },
    {
      "category": "Mar",
      "value": 18700
    },
    {
      "category": "Apr",
      "value": 16300
    },
    {
      "category": "May",
      "value": 21500
    },
    {
      "category": "Jun",
      "value": 24800
    }
  ],
  "config": {
    "xLabel": "Month",
    "yLabel": "Visitors",
    "showGrid": true,
    "showLegend": false,
    "colorScheme": "cool",
    "curveType": "monotone",
    "yTickFormat": "thousands"
  }
}
```

---

## 4. Pie Chart — Market Share

```chart
{
  "type": "pie",
  "title": "Browser Market Share (2025)",
  "data": [
    {
      "category": "Chrome",
      "value": 65
    },
    {
      "category": "Safari",
      "value": 18
    },
    {
      "category": "Firefox",
      "value": 6
    },
    {
      "category": "Edge",
      "value": 5
    },
    {
      "category": "Other",
      "value": 6
    }
  ],
  "config": {
    "xLabel": "",
    "yLabel": "",
    "showGrid": false,
    "showLegend": true,
    "colorScheme": "vivid",
    "pieLabels": "percent"
  }
}
```

For pie and donut charts, `xLabel`, `yLabel`, and `showGrid` are ignored but must be present. Set `showLegend: true` so slice labels are visible.

---

## 5. Donut Chart — Budget Allocation

```chart
{
  "type": "donut",
  "title": "Department Budget Allocation",
  "data": [
    {
      "category": "Engineering",
      "value": 45
    },
    {
      "category": "Marketing",
      "value": 20
    },
    {
      "category": "Sales",
      "value": 18
    },
    {
      "category": "Operations",
      "value": 12
    },
    {
      "category": "HR",
      "value": 5
    }
  ],
  "config": {
    "xLabel": "",
    "yLabel": "",
    "showGrid": false,
    "showLegend": true,
    "colorScheme": "neutral",
    "pieLabels": "value"
  }
}
```

---

## 6. Horizontal Bar Chart — Programming Languages

```chart
{
  "type": "horizontal_bar",
  "title": "Top Programming Languages (2025)",
  "data": [
    {
      "category": "Python",
      "value": 28
    },
    {
      "category": "JavaScript",
      "value": 22
    },
    {
      "category": "TypeScript",
      "value": 15
    },
    {
      "category": "Java",
      "value": 12
    },
    {
      "category": "Rust",
      "value": 8
    }
  ],
  "config": {
    "xLabel": "Usage (%)",
    "yLabel": "",
    "showGrid": true,
    "showLegend": false,
    "colorScheme": "cool"
  }
}
```

Category labels appear on the Y-axis, values on the X-axis. Good for long category names.

---

## 7. Radar Chart — Product Comparison

```chart
{
  "type": "radar",
  "title": "Product Feature Comparison",
  "data": [
    {
      "category": "Performance",
      "productA": 90,
      "productB": 65
    },
    {
      "category": "Usability",
      "productA": 75,
      "productB": 85
    },
    {
      "category": "Design",
      "productA": 80,
      "productB": 70
    },
    {
      "category": "Price",
      "productA": 60,
      "productB": 90
    },
    {
      "category": "Support",
      "productA": 85,
      "productB": 55
    },
    {
      "category": "Features",
      "productA": 95,
      "productB": 80
    }
  ],
  "series": [
    {
      "key": "productA",
      "label": "Product A"
    },
    {
      "key": "productB",
      "label": "Product B"
    }
  ],
  "config": {
    "xLabel": "",
    "yLabel": "",
    "showGrid": true,
    "showLegend": true,
    "colorScheme": "ocean"
  }
}
```

Multi-series renders multiple overlaid polygons. Great for comparing items across multiple dimensions.

---

## 8. Scatter Chart — Height vs Weight

```chart
{
  "type": "scatter",
  "title": "Height vs Weight",
  "data": [
    {
      "category": "",
      "value": 0,
      "x": 160,
      "y": 55
    },
    {
      "category": "",
      "value": 0,
      "x": 165,
      "y": 62
    },
    {
      "category": "",
      "value": 0,
      "x": 170,
      "y": 68
    },
    {
      "category": "",
      "value": 0,
      "x": 175,
      "y": 75
    },
    {
      "category": "",
      "value": 0,
      "x": 180,
      "y": 80
    },
    {
      "category": "",
      "value": 0,
      "x": 185,
      "y": 88
    },
    {
      "category": "",
      "value": 0,
      "x": 172,
      "y": 70
    },
    {
      "category": "",
      "value": 0,
      "x": 168,
      "y": 65
    }
  ],
  "config": {
    "xLabel": "Height (cm)",
    "yLabel": "Weight (kg)",
    "showGrid": true,
    "showLegend": false,
    "colorScheme": "neutral"
  }
}
```

Scatter charts use `x` and `y` for coordinates. `category` and `value` must be present but are not rendered.

---

## 9. Radial Bar Chart — Goal Progress

```chart
{
  "type": "radial_bar",
  "title": "Q1 Goal Progress",
  "data": [
    {
      "category": "Revenue",
      "value": 85
    },
    {
      "category": "Users",
      "value": 72
    },
    {
      "category": "NPS",
      "value": 93
    },
    {
      "category": "Retention",
      "value": 68
    }
  ],
  "config": {
    "xLabel": "",
    "yLabel": "",
    "showGrid": false,
    "showLegend": true,
    "colorScheme": "neutral"
  }
}
```

Each data point renders as a concentric arc. Good for progress/gauge visualizations.

---

## 10. Composed Chart — Revenue Analysis

```chart
{
  "type": "composed",
  "title": "Revenue Analysis",
  "data": [
    {
      "category": "Jan",
      "revenue": 120,
      "target": 110,
      "growth": 8
    },
    {
      "category": "Feb",
      "revenue": 135,
      "target": 120,
      "growth": 12
    },
    {
      "category": "Mar",
      "revenue": 148,
      "target": 130,
      "growth": 10
    },
    {
      "category": "Apr",
      "revenue": 142,
      "target": 140,
      "growth": -4
    },
    {
      "category": "May",
      "revenue": 165,
      "target": 150,
      "growth": 16
    },
    {
      "category": "Jun",
      "revenue": 178,
      "target": 160,
      "growth": 8
    }
  ],
  "series": [
    {
      "key": "revenue",
      "label": "Revenue ($K)",
      "renderAs": "bar"
    },
    {
      "key": "target",
      "label": "Target ($K)",
      "renderAs": "line"
    },
    {
      "key": "growth",
      "label": "Growth (%)",
      "renderAs": "area"
    }
  ],
  "config": {
    "xLabel": "Month",
    "yLabel": "Amount",
    "showGrid": true,
    "showLegend": true,
    "colorScheme": "neutral"
  }
}
```

Each series specifies `renderAs` (`"bar"`, `"line"`, or `"area"`). Defaults to `"bar"` if omitted.

---

## Multi-Series Patterns

### Multi-Series Line (Revenue vs Expenses)

```chart
{
  "type": "line",
  "title": "Revenue vs Expenses",
  "data": [
    {
      "category": "Jan",
      "revenue": 120,
      "expenses": 95
    },
    {
      "category": "Feb",
      "revenue": 135,
      "expenses": 100
    },
    {
      "category": "Mar",
      "revenue": 148,
      "expenses": 105
    },
    {
      "category": "Apr",
      "revenue": 142,
      "expenses": 110
    },
    {
      "category": "May",
      "revenue": 165,
      "expenses": 108
    },
    {
      "category": "Jun",
      "revenue": 178,
      "expenses": 115
    }
  ],
  "series": [
    {
      "key": "revenue",
      "label": "Revenue ($K)"
    },
    {
      "key": "expenses",
      "label": "Expenses ($K)"
    }
  ],
  "config": {
    "xLabel": "Month",
    "yLabel": "Amount ($K)",
    "showGrid": true,
    "showLegend": true,
    "colorScheme": "neutral"
  }
}
```

Each series `key` must exist as a property on every data point. `value` is not needed when using explicit series keys. Set `showLegend: true` so series are distinguishable.

### Stacked Bar (Resource Allocation)

```chart
{
  "type": "bar",
  "title": "Team Resource Allocation",
  "data": [
    {
      "category": "Engineering",
      "frontend": 8,
      "backend": 12,
      "devops": 4
    },
    {
      "category": "Design",
      "frontend": 2,
      "backend": 0,
      "devops": 0
    },
    {
      "category": "Product",
      "frontend": 1,
      "backend": 1,
      "devops": 1
    },
    {
      "category": "QA",
      "frontend": 3,
      "backend": 3,
      "devops": 2
    }
  ],
  "series": [
    {
      "key": "frontend",
      "label": "Frontend"
    },
    {
      "key": "backend",
      "label": "Backend"
    },
    {
      "key": "devops",
      "label": "DevOps"
    }
  ],
  "config": {
    "xLabel": "Department",
    "yLabel": "Headcount",
    "showGrid": true,
    "showLegend": true,
    "colorScheme": "cool",
    "stacked": true
  }
}
```

Add `"stacked": true` to stack bars vertically. Only applies to multi-series bar and area charts.

---

## Advanced Config Options

### Reference Lines and Data Labels

```chart
{
  "type": "bar",
  "title": "Monthly Sales vs Target",
  "data": [
    {
      "category": "Jan",
      "value": 142
    },
    {
      "category": "Feb",
      "value": 168
    },
    {
      "category": "Mar",
      "value": 155
    },
    {
      "category": "Apr",
      "value": 193
    },
    {
      "category": "May",
      "value": 178
    },
    {
      "category": "Jun",
      "value": 210
    }
  ],
  "config": {
    "xLabel": "Month",
    "yLabel": "Sales ($K)",
    "showGrid": true,
    "showLegend": false,
    "colorScheme": "neutral",
    "showDataLabels": true,
    "yTickFormat": "currency",
    "referenceLines": [
      {
        "axis": "y",
        "value": 175,
        "label": "Target"
      },
      {
        "axis": "y",
        "value": 150,
        "label": "Baseline"
      }
    ]
  }
}
```

- `referenceLines` — dashed lines at specified axis positions
- `showDataLabels` — value labels above bars/dots
- `yTickFormat: "currency"` — formats axis ticks as `$1,500`

### Config Reference

| Field | Values | Default | Notes |
| --- | --- | --- | --- |
| `colorScheme` | `neutral`, `monochrome`, `warm`, `cool` | `neutral` | 5 colors per scheme, light/dark variants |
| `curveType` | `monotone`, `linear`, `step`, `natural`, `basis` | `monotone` | Line/area interpolation |
| `legendPosition` | `bottom`, `top`, `left`, `right` | `bottom` | Legend placement |
| `pieLabels` | `none`, `value`, `percent`, `name` | `none` | Pie/donut slice labels |
| `xTickFormat` | `plain`, `thousands`, `percent`, `currency` | `plain` | X-axis formatting |
| `yTickFormat` | `plain`, `thousands`, `percent`, `currency` | `plain` | Y-axis formatting |
| `stacked` | `true`, `false` | `false` | Multi-series bar/area stacking |
| `showDataLabels` | `true`, `false` | `false` | Value labels on data points |

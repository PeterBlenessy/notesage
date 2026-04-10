# Chart Examples

Complete inline chart examples ready to use. Each example shows the fenced code block to insert directly into a markdown document.

---

## Example 1: Line Chart — S&P 500 Performance

````markdown
```chart
{
  "type": "line",
  "title": "S&P 500 Annual Close",
  "data": [
    { "category": "2016", "value": 2239 },
    { "category": "2017", "value": 2674 },
    { "category": "2018", "value": 2507 },
    { "category": "2019", "value": 3231 },
    { "category": "2020", "value": 3756 },
    { "category": "2021", "value": 4766 },
    { "category": "2022", "value": 3840 },
    { "category": "2023", "value": 4770 },
    { "category": "2024", "value": 5881 },
    { "category": "2025", "value": 5693 }
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
````

---

## Example 2: Bar Chart — Quarterly Revenue

````markdown
```chart
{
  "type": "bar",
  "title": "2025 Quarterly Revenue",
  "data": [
    { "category": "Q1", "value": 142 },
    { "category": "Q2", "value": 168 },
    { "category": "Q3", "value": 155 },
    { "category": "Q4", "value": 193 }
  ],
  "config": {
    "xLabel": "Quarter",
    "yLabel": "Revenue ($M)",
    "showGrid": true,
    "showLegend": false,
    "colorScheme": "cool"
  }
}
```
````

---

## Example 3: Pie Chart — Market Share

````markdown
```chart
{
  "type": "pie",
  "title": "Browser Market Share (2025)",
  "data": [
    { "category": "Chrome", "value": 65 },
    { "category": "Safari", "value": 18 },
    { "category": "Firefox", "value": 6 },
    { "category": "Edge", "value": 5 },
    { "category": "Other", "value": 6 }
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
````

Note: For pie and donut charts, `xLabel`, `yLabel`, and `showGrid` are ignored but must still be present in the config object. Set `showLegend` to `true` so slice labels are visible.

---

## Example 4: Horizontal Bar Chart — Programming Languages

````markdown
```chart
{
  "type": "horizontal_bar",
  "title": "Top Programming Languages (2025)",
  "data": [
    { "category": "Python", "value": 28 },
    { "category": "JavaScript", "value": 22 },
    { "category": "TypeScript", "value": 15 },
    { "category": "Java", "value": 12 },
    { "category": "Rust", "value": 8 }
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
````

Note: Horizontal bar charts work like vertical bar charts but with `"type": "horizontal_bar"`. Category labels appear on the Y-axis, values on the X-axis. Good for long category names.

---

## Example 5: Multi-Series Line Chart — Revenue vs Expenses

````markdown
```chart
{
  "type": "line",
  "title": "Revenue vs Expenses",
  "data": [
    { "category": "Jan", "revenue": 120, "expenses": 95 },
    { "category": "Feb", "revenue": 135, "expenses": 100 },
    { "category": "Mar", "revenue": 148, "expenses": 105 },
    { "category": "Apr", "revenue": 142, "expenses": 110 },
    { "category": "May", "revenue": 165, "expenses": 108 },
    { "category": "Jun", "revenue": 178, "expenses": 115 }
  ],
  "series": [
    { "key": "revenue", "label": "Revenue ($K)" },
    { "key": "expenses", "label": "Expenses ($K)" }
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
````

Note: Multi-series charts use `series` to define each data line. Each series `key` must exist as a property on every data point. The `value` field is not needed when using explicit series keys. Set `showLegend` to `true` so series are distinguishable.

---

## Example 6: Radar Chart — Product Comparison

````markdown
```chart
{
  "type": "radar",
  "title": "Product Feature Comparison",
  "data": [
    { "category": "Performance", "productA": 90, "productB": 65 },
    { "category": "Usability", "productA": 75, "productB": 85 },
    { "category": "Design", "productA": 80, "productB": 70 },
    { "category": "Price", "productA": 60, "productB": 90 },
    { "category": "Support", "productA": 85, "productB": 55 },
    { "category": "Features", "productA": 95, "productB": 80 }
  ],
  "series": [
    { "key": "productA", "label": "Product A" },
    { "key": "productB", "label": "Product B" }
  ],
  "config": {
    "xLabel": "",
    "yLabel": "",
    "showGrid": true,
    "showLegend": true,
    "colorScheme": "neutral"
  }
}
```
````

Note: Radar charts use categories as the angle axis. Multi-series renders multiple overlaid polygons. Great for comparing items across multiple dimensions.

---

## Example 7: Scatter Chart — Height vs Weight

````markdown
```chart
{
  "type": "scatter",
  "title": "Height vs Weight",
  "data": [
    { "category": "", "value": 0, "x": 160, "y": 55 },
    { "category": "", "value": 0, "x": 165, "y": 62 },
    { "category": "", "value": 0, "x": 170, "y": 68 },
    { "category": "", "value": 0, "x": 175, "y": 75 },
    { "category": "", "value": 0, "x": 180, "y": 80 },
    { "category": "", "value": 0, "x": 185, "y": 88 },
    { "category": "", "value": 0, "x": 172, "y": 70 },
    { "category": "", "value": 0, "x": 168, "y": 65 }
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
````

Note: Scatter charts use `x` and `y` fields for numeric coordinates. The `category` and `value` fields must still be present but are not rendered. Good for correlation analysis.

---

## Example 8: Stacked Bar Chart — Resource Allocation

````markdown
```chart
{
  "type": "bar",
  "title": "Team Resource Allocation",
  "data": [
    { "category": "Engineering", "frontend": 8, "backend": 12, "devops": 4 },
    { "category": "Design", "frontend": 2, "backend": 0, "devops": 0 },
    { "category": "Product", "frontend": 1, "backend": 1, "devops": 1 },
    { "category": "QA", "frontend": 3, "backend": 3, "devops": 2 }
  ],
  "series": [
    { "key": "frontend", "label": "Frontend" },
    { "key": "backend", "label": "Backend" },
    { "key": "devops", "label": "DevOps" }
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
````

Note: Add `"stacked": true` to the config to stack bars vertically. Only applies to multi-series bar and area charts.

---

## Example 9: Composed Chart — Revenue Trend

````markdown
```chart
{
  "type": "composed",
  "title": "Revenue Analysis",
  "data": [
    { "category": "Jan", "revenue": 120, "target": 110, "growth": 8 },
    { "category": "Feb", "revenue": 135, "target": 120, "growth": 12 },
    { "category": "Mar", "revenue": 148, "target": 130, "growth": 10 },
    { "category": "Apr", "revenue": 142, "target": 140, "growth": -4 },
    { "category": "May", "revenue": 165, "target": 150, "growth": 16 },
    { "category": "Jun", "revenue": 178, "target": 160, "growth": 8 }
  ],
  "series": [
    { "key": "revenue", "label": "Revenue ($K)", "renderAs": "bar" },
    { "key": "target", "label": "Target ($K)", "renderAs": "line" },
    { "key": "growth", "label": "Growth (%)", "renderAs": "area" }
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
````

Note: Composed charts mix different visual encodings. Each series specifies `renderAs` (`"bar"`, `"line"`, or `"area"`). If omitted, defaults to `"bar"`.

---

## Example 10: Radial Bar Chart — Goal Progress

````markdown
```chart
{
  "type": "radial_bar",
  "title": "Q1 Goal Progress",
  "data": [
    { "category": "Revenue", "value": 85 },
    { "category": "Users", "value": 72 },
    { "category": "NPS", "value": 93 },
    { "category": "Retention", "value": 68 }
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
````

Note: Radial bar charts show each data point as a concentric arc. Good for progress/gauge visualizations. Data shape is the same as pie/donut (category + value).

---

## Example 11: Bar Chart with Reference Lines and Data Labels

````markdown
```chart
{
  "type": "bar",
  "title": "Monthly Sales vs Target",
  "data": [
    { "category": "Jan", "value": 142 },
    { "category": "Feb", "value": 168 },
    { "category": "Mar", "value": 155 },
    { "category": "Apr", "value": 193 },
    { "category": "May", "value": 178 },
    { "category": "Jun", "value": 210 }
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
      { "axis": "y", "value": 175, "label": "Target" },
      { "axis": "y", "value": 150, "label": "Baseline" }
    ]
  }
}
```
````

Note: `referenceLines` adds dashed lines at specified axis positions. `showDataLabels` shows values above bars/dots. `yTickFormat: "currency"` formats axis ticks as `$1,500`.

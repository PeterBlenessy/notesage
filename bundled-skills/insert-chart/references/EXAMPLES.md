# Chart Examples

Complete sidecar JSON examples ready to use. Each example includes the JSON file content and the markdown line to insert.

---

## Example 1: Line Chart — S&P 500 Performance

**Markdown to insert:**
```markdown
![chart](/.notesage/charts/sp500-example.json)
```

**Sidecar JSON** (`.notesage/charts/sp500-example.json`):
```json
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

---

## Example 2: Bar Chart — Quarterly Revenue

**Markdown to insert:**
```markdown
![chart](/.notesage/charts/revenue-example.json)
```

**Sidecar JSON** (`.notesage/charts/revenue-example.json`):
```json
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

---

## Example 3: Pie Chart — Market Share

**Markdown to insert:**
```markdown
![chart](/.notesage/charts/market-share-example.json)
```

**Sidecar JSON** (`.notesage/charts/market-share-example.json`):
```json
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

Note: For pie and donut charts, `xLabel`, `yLabel`, and `showGrid` are ignored but must still be present in the config object. Set `showLegend` to `true` so slice labels are visible.

---

## Example 4: Multi-Series Line Chart — Revenue vs Expenses

**Markdown to insert:**
```markdown
![chart](/.notesage/charts/rev-vs-exp-example.json)
```

**Sidecar JSON** (`.notesage/charts/rev-vs-exp-example.json`):
```json
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

Note: Multi-series charts use `series` to define each data line. Each series `key` must exist as a property on every data point. The `value` field is not needed when using explicit series keys. Set `showLegend` to `true` so series are distinguishable.

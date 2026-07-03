# Quarterly review

A working page for the numbers — dynamic tables and inline charts live right in the document.

## Revenue by line

| Product | Revenue <!-- type:currency,currency:USD,summary:sum --> | Trend |
| --- | --- | --- |
| Widget | 29990 | {{spark:12,15,9,22,18,24}} |
| Gadget | 49500 | {{spark:5,8,12,7,15,19}} |
| Gizmo | 12000 | {{spark:8,11,14,10,17,21}} |
| Doohickey | 8600 | {{spark:3,6,5,9,8,12}} |

The footer totals the currency column automatically; the sparklines read a `{{spark:…}}` list inline.

## Quarter over quarter

```chart
{
  "type": "bar",
  "title": "Revenue by quarter",
  "data": [
    { "category": "Q1", "value": 82 },
    { "category": "Q2", "value": 104 },
    { "category": "Q3", "value": 138 },
    { "category": "Q4", "value": 171 }
  ],
  "config": {
    "xLabel": "",
    "yLabel": "",
    "showGrid": true,
    "showLegend": false,
    "colorScheme": "neutral"
  }
}
```

Notes for @alex: growth held through the quarter. #review

# Chart Examples

A showcase of all chart types and features available in Notesage.

---

## Bar Charts

### Simple Bar Chart

A basic single-series bar chart with neutral palette.

![chart](/.notesage/charts/ex-bar-simple.json)

### Multi-Series Bar Chart

Three series (Revenue, Expenses, Profit) with cool palette and legend.

![chart](/.notesage/charts/ex-bar-multi.json)

### Stacked Bar Chart

Multi-series bar chart with `stacked: true` — bars stacked vertically to show composition.

![chart](/.notesage/charts/ex-bar-stacked.json)

### Bar Chart with Data Labels and Reference Lines

Data labels on each bar, currency-formatted Y axis, and two reference lines (Target and Minimum).

![chart](/.notesage/charts/ex-bar-labels-refs.json)

### Horizontal Bar Chart

Horizontal layout with percent-formatted X axis and data labels. Good for long category names.

![chart](/.notesage/charts/ex-hbar.json)

---

## Line Charts

### Simple Line Chart

S&P 500 trend with thousands-formatted Y axis.

![chart](/.notesage/charts/ex-line-simple.json)

### Multi-Series Line Chart with Step Curve

Two series with `curveType: "step"`, data labels, top legend position, and a break-even reference line.

![chart](/.notesage/charts/ex-line-multi-curves.json)

### Line Chart with Natural Curve

Temperature forecast using `curveType: "natural"` for smooth interpolation, with data labels and warm palette.

![chart](/.notesage/charts/ex-line-natural.json)

---

## Area Charts

### Stacked Area Chart

Three traffic sources stacked with monotone curve, thousands-formatted Y axis, and warm palette.

![chart](/.notesage/charts/ex-area-stacked.json)

### Area Chart with Basis Curve

Memory usage over time using `curveType: "basis"` with monochrome palette and a warning threshold reference line.

![chart](/.notesage/charts/ex-area-basis.json)

---

## Pie & Donut Charts

### Pie Chart with Percent Labels

Browser market share with `pieLabels: "percent"` showing percentage on each slice.

![chart](/.notesage/charts/ex-pie-labels.json)

### Donut Chart with Name Labels

Expense breakdown with `pieLabels: "name"`, right-positioned legend, and monochrome palette.

![chart](/.notesage/charts/ex-donut-names.json)

---

## Radar Charts

### Multi-Series Radar Chart

Two products compared across 6 dimensions with overlaid radar polygons.

![chart](/.notesage/charts/ex-radar.json)

### Single-Series Radar Chart

Developer skills assessment — single polygon with cool palette.

![chart](/.notesage/charts/ex-radar-single.json)

---

## Scatter Chart

Scatter plot showing correlation between study hours (X) and exam scores (Y) with numeric axes.

![chart](/.notesage/charts/ex-scatter.json)

---

## Radial Bar Chart

Goal progress as concentric arcs — each category shown as a different arc length.

![chart](/.notesage/charts/ex-radial.json)

---

## Composed Chart

Mixed chart with bar (Revenue), line (Target), and area (Growth) on the same axes. Each series uses `renderAs` to specify its visual encoding.

![chart](/.notesage/charts/ex-composed.json)

---

## Feature Coverage

| Feature | Examples Above |
| --- | --- |
| 10 chart types | bar, horizontal_bar, line, area, pie, donut, radar, scatter, radial_bar, composed |
| Multi-series | bar-multi, bar-stacked, line-multi, area-stacked, radar, composed |
| Stacked mode | bar-stacked, area-stacked |
| Data labels | bar-labels-refs, hbar, line-multi, line-natural, pie-labels, donut-names |
| Reference lines | bar-labels-refs, line-multi, area-basis |
| Axis tick formatting | bar-labels-refs (currency), hbar (percent), line-simple (thousands), area-stacked (thousands) |
| Curve types | line-multi (step), line-natural (natural), area-stacked (monotone), area-basis (basis) |
| Legend positions | line-multi (top), donut-names (right), composed (top) |
| Pie label formats | pie-labels (percent), donut-names (name) |
| Color schemes | neutral, cool, warm, monochrome |

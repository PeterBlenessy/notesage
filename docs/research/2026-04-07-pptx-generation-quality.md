# Research: Rich PPTX Generation (PptxGenJS)

|  |  |
| --- | --- |
| **Date** | 2026-04-07 |
| **Status** | Research complete |
| **Library** | PptxGenJS v3.12.0 |
| **Current usage** | \~5% of library capabilities |
| **Script** | `bundled-skills/generate-presentation/scripts/generate.mjs` (782 lines) |
| **PRD** | [rich-pptx-generation](../prds/2026-04-07-rich-pptx-generation.md) (Draft) |
| **Tasks** | [rich-pptx-generation-tasks](../tasks/2026-04-07-rich-pptx-generation-tasks.md) (18 tasks: 9S, 7M, 2L) |

## Context

The `generate-presentation` skill uses PptxGenJS to produce `.pptx` files from agent-structured markdown. Today it generates: headings, bullets, numbered lists, tables, code blocks, images, speaker notes, callouts, and blockquotes — with three built-in styles and user template theme extraction.

PptxGenJS is a comprehensive library supporting charts, shapes, media, slide masters, hyperlinks, shadows, animations, and rich formatting. The script uses roughly 5% of its API surface.

There is also a **Rust built-in exporter** (`markdown_to_pptx.rs` using `ppt-rs`) for the Cmd+Shift+E path. It has one unique capability: chart generation from JSON sidecar files. Otherwise it's lower quality than the PptxGenJS path.

## Full PptxGenJS Feature Inventory

### Text Formatting

| Feature | PptxGenJS API | Used Today? | Effort to Add |
| --- | --- | --- | --- |
| Font face, size, color | `fontFace`, `fontSize`, `color` | Yes | \- |
| Bold, italic | `bold`, `italic` | Yes | \- |
| Underline (with style + color) | `underline: { style, color }` | Partial — `sng` only | S |
| Strikethrough | `strike: boolean | 'sngStrike' | 'dblStrike'` | Yes | \- |
| **Subscript / superscript** | `subscript`, `superscript` | No | S |
| **Character spacing** | `charSpacing` (number) | No | S |
| **Line spacing** | `lineSpacing` (pt), `lineSpacingMultiple` (0-9.99) | No | S |
| **Paragraph space before/after** | `paraSpaceBefore`, `paraSpaceAfter` | Partial — `after` only | S |
| **Hyperlinks** | `hyperlink: { url?, slide?, tooltip? }` | No | **S** |
| Text highlight | `highlight` (hex color) | No | S |
| Text transparency | `transparency` (0-100) | No | S |
| Text outline | `outline: { color, size }` | No | S |
| Text glow | `glow: { color, opacity, size }` | No | S |
| **Text shadow** | `shadow: { type, opacity, blur, angle, offset, color }` | No | S |
| Text fit (shrink/resize) | `fit: 'none' | 'shrink' | 'resize'` | No | S |
| Text rotation | `rotate` (-360 to 360) | No | S |
| Vertical text | `vert` (7 orientations: horz, vert, vert270, eaVert, etc.) | No | S |
| RTL mode | `rtlMode` (per-text or global) | No | S |
| Tab stops | `tabStops: [{ position, alignment }]` | No | S |
| Language tag | `lang` (ISO 639-1) | No | S |
| Alignment (l/ctr/r/just) | `align` | Yes | \- |
| Vertical alignment | `valign` (top/middle/bottom) | Yes | \- |

### Bullet & List Formatting

| Feature | PptxGenJS API | Used Today? | Effort to Add |
| --- | --- | --- | --- |
| Bullet character | `bullet: { characterCode }` | Yes | \- |
| Numbered bullets | `bullet: { type: 'number' }` | Yes | \- |
| **Number format variants** | `bullet: { numberType }` — 16 types (alphaLc, romanUc, etc.) | No | S |
| Number start value | `bullet: { numberStartAt }` | No | S |
| Bullet indent | `bullet: { indent }` | No | S |
| Indent level | `indentLevel` (0-based) | Yes | \- |
| Break before paragraph | `softBreakBefore` | No | S |

### Shapes

| Feature | PptxGenJS API | Used Today? | Effort to Add |
| --- | --- | --- | --- |
| **187 preset shape types** | `addShape(ShapeType.xxx, opts)` | Only `rect` (accent bar) | **M** |
| Shape fill (solid color) | `fill: { color }` | Yes | \- |
| Shape fill (transparency) | `fill: { transparency }` | No | S |
| Shape fill (gradient) | `fill: { colorGrad }` | No — templates don't extract gradients | M |
| Shape line (color, width) | `line: { color, width }` | No | S |
| **Shape line dash styles** | `line: { dashType }` — 8 types | No | S |
| Shape arrows | `line: { beginArrowType, endArrowType }` — 6 types | No | S |
| Shape rotation | `rotate` (-360 to 360) | No | S |
| Shape flip | `flipH`, `flipV` | No | S |
| **Shape shadow** | `shadow: { type, opacity, blur, angle, offset, color }` | No | **S** |
| Shape hyperlink | `hyperlink: { url?, slide? }` | No | S |
| **Custom geometry paths** | `points: [{ x, y, moveTo?, curve?, close? }]` | No | L |
| Arc / pie shapes | `angleRange`, `arcThicknessRatio` | No | S |
| Rounded rectangle radius | `rectRadius` (0-1.0) | No | S |

**Key shape types available** (subset of 187):

- Basic: `rect`, `roundRect`, `ellipse`, `triangle`, `diamond`, `pentagon`, `hexagon`, `octagon`, `trapezoid`, `parallelogram`
- Arrows: `rightArrow`, `leftArrow`, `upArrow`, `downArrow`, `bentArrow`, `curvedArrow`, `uturnArrow`, `notchedRightArrow`, `chevron`
- Callouts: `wedgeRectCallout`, `wedgeEllipseCallout`, `cloudCallout`, `borderCallout1-3`, `accentCallout1-3`
- Flowchart: 25+ types (`flowChartProcess`, `flowChartDecision`, `flowChartDocument`, `flowChartConnector`, `flowChartMerge`, etc.)
- Stars: `star4` through `star32` (10 variants)
- Math: `mathPlus`, `mathMinus`, `mathMultiply`, `mathDivide`, `mathEqual`, `mathNotEqual`
- Misc: `heart`, `lightningBolt`, `moon`, `sun`, `cloud`, `gear6`, `gear9`, `funnel`, `frame`, `can`, `cube`

### Charts

| Feature | PptxGenJS API | Used Today? | Effort to Add |
| --- | --- | --- | --- |
| **Bar chart (2D)** | `addChart(ChartType.bar, data, opts)` | No | **M** |
| **Bar chart (3D)** | `ChartType.bar3D` | No | S (after bar) |
| **Line chart** | `ChartType.line` | No | M |
| **Pie chart** | `ChartType.pie` | No | M |
| **Doughnut chart** | `ChartType.doughnut` | No | S (after pie) |
| **Area chart** | `ChartType.area` | No | S (after line) |
| **Scatter chart** | `ChartType.scatter` | No | M |
| **Radar chart** | `ChartType.radar` | No | M |
| **Bubble chart** | `ChartType.bubble` | No | M |
| **Combination charts** | `addChart([{ type, data, opts }, ...])` | No | M |
| Chart title | `title`, `titleFontFace/Size/Color/Bold/Align/Pos/Rotate` | No | S |
| Chart legend | `showLegend`, `legendPos`, `legendFontFace/Size/Color` | No | S |
| Data labels | `showValue/Label/Percent/SerName`, `dataLabelFontFace/Size/Color/Pos/FormatCode` | No | S |
| Data table | `showDataTable`, `dataTableFontSize/FormatCode`, border options | No | M |
| Category axis | `catAxisTitle`, label styling, line styling, tick marks, orientation, format code | No | M |
| Value axis | `valAxisTitle`, `valAxisMinVal/MaxVal/MajorUnit`, display unit, log scale, format code | No | M |
| Gridlines | `catGridLine/valGridLine: { color, size, style, cap }` | No | S |
| Chart area + plot area | `chartArea/plotArea: { border, fill, roundedCorners }` | No | S |
| Series colors + opacity | `chartColors`, `chartColorsOpacity` | No | S |
| Bar options | `barDir`, `barGapWidthPct` (0-500), `barGrouping`, `barOverlapPct` (-100 to 100) | No | S |
| Line options | `lineSize`, `lineSmooth`, `lineDataSymbol` (7 types), `lineDash` (8 types) | No | S |
| Pie options | `firstSliceAng`, `holeSize` (doughnut) | No | S |
| Radar options | `radarStyle` (standard/marker/filled) | No | S |
| 3D perspective | `v3DPerspective`, `v3DRotX/Y`, `v3DRAngAx` | No | S |
| Shadow on chart | `shadow: ShadowProps` | No | S |

### Tables

| Feature | PptxGenJS API | Used Today? | Effort to Add |
| --- | --- | --- | --- |
| Basic table | `addTable(rows, opts)` | Yes | \- |
| Column widths | `colW: number[]` | Yes | \- |
| Row heights | `rowH: number | number[]` | No | S |
| Cell fill (solid) | `fill: { color }` | Yes | \- |
| Cell border (uniform) | `border: { type, pt, color }` | Yes | \- |
| **Cell border (per-side)** | `border: [top, right, bottom, left]` | No | S |
| Cell margin | `margin: [T, R, B, L]` | Yes | \- |
| **Colspan / rowspan** | `colspan`, `rowspan` | No | S |
| **Auto-page (split across slides)** | `autoPage: true`, `autoPageRepeatHeader`, `autoPageHeaderRows` | No | **M** |
| Auto-page start Y | `autoPageSlideStartY` | No | S |
| Cell hyperlink | `hyperlink: { url }` | No | S |
| **HTML table conversion** | `tableToSlides(elementId, opts)` | No | M |

### Images

| Feature | PptxGenJS API | Used Today? | Effort to Add |
| --- | --- | --- | --- |
| Image from path | `path` | Yes | \- |
| Image from base64 | `data` | No | S |
| Image sizing (contain/cover/crop) | `sizing: { type, w, h, x?, y? }` | Partial — `contain` only | S |
| Image rounding | `rounding: true` | No | S |
| Image rotation | `rotate` (-360 to 360) | No | S |
| Image flip | `flipH`, `flipV` | No | S |
| Image transparency | `transparency` (0-100) | No | S |
| Image shadow | `shadow: ShadowProps` | No | S |
| Image hyperlink | `hyperlink: { url }` | No | S |
| Image alt text | `altText` | No | S |

### Media (Audio / Video)

| Feature | PptxGenJS API | Used Today? | Effort to Add |
| --- | --- | --- | --- |
| Video from file | `addMedia({ type: 'video', path })` | No | M |
| Video from base64 | `addMedia({ type: 'video', data })` | No | M |
| YouTube embed | `addMedia({ type: 'online', link })` | No | S |
| Audio from file | `addMedia({ type: 'audio', path })` | No | M |
| Cover image | `cover` (string) | No | S |

### Slide Masters & Layouts

| Feature | PptxGenJS API | Used Today? | Effort to Add |
| --- | --- | --- | --- |
| **Define slide master** | `defineSlideMaster({ title, background, objects, slideNumber, margin })` | No | **M** |
| Master with placeholders | `objects: [{ placeholder: { name, type, x, y, w, h } }]` | No | M |
| Placeholder types | `title`, `body`, `pic`, `chart`, `tbl`, `media` | No | M |
| Master with shapes/images | `objects: [{ rect: {...} }, { image: {...} }]` | No | S |
| Use master on slide | `addSlide({ masterName: 'TITLE' })` | No | S |
| Sections | `addSection({ title, order })` | No | S |

### Slide Options

| Feature | PptxGenJS API | Used Today? | Effort to Add |
| --- | --- | --- | --- |
| Background color | `slide.background = { color }` | Yes | \- |
| Background image | `slide.background = { path | data }` | No | S |
| Background transparency | `slide.background = { fill: { transparency } }` | No | S |
| **Built-in slide numbers** | `slide.slideNumber = { x, y, fontSize, color, ... }` | No — manual text used | **S** |
| Default text color | `slide.color` | No | S |
| Hidden slide | `slide.hidden = true` | No | S |
| Speaker notes | `slide.addNotes(text)` | Yes | \- |
| **Slide transitions** | Not documented in TypeScript defs (may be unofficial) | No | Unknown |

### Presentation Options

| Feature | PptxGenJS API | Used Today? | Effort to Add |
| --- | --- | --- | --- |
| Layout size | `pptx.layout` (4 presets) | Yes — `LAYOUT_WIDE` | \- |
| Custom layout | `pptx.defineLayout({ name, width, height })` | No | S |
| **Metadata** (author, company, title, subject) | `pptx.author`, `.company`, `.title`, `.subject` | No | **S** |
| Revision number | `pptx.revision` | No | S |
| RTL mode | `pptx.rtlMode` | No | S |
| **Theme** | `pptx.theme = { headFontFace, bodyFontFace }` | No — manually applied | S |
| Output compression | `write({ compression: true })` | No | S |

### Shadows (shared interface, applies to text/shapes/images/charts)

| Property | Type | Used? |
| --- | --- | --- |
| `type` | `'outer' | 'inner' | 'none'` | No |
| `opacity` | 0.0-1.0 | No |
| `blur` | 0-100 pt | No |
| `angle` | 0-359 degrees | No |
| `offset` | 0-200 pt | No |
| `color` | HexColor | No |
| `rotateWithShape` | boolean | No |

## Rust Exporter Comparison (`ppt-rs` v0.2)

| Feature | PptxGenJS | ppt-rs | Winner |
| --- | --- | --- | --- |
| Visual quality | High | Low | PptxGenJS |
| Charts | 10 types (unused) | 7 types (from JSON) | ppt-rs (implemented) |
| Tables | Full styling | Basic via QuickTable | PptxGenJS |
| Images | Embed + URL | Path-based only | PptxGenJS |
| Shapes | 187 types | None | PptxGenJS |
| Overflow handling | Manual | Auto-split "(cont.)" | ppt-rs |
| Template support | Theme extraction from ZIP | Config-based colors | PptxGenJS |
| Dependency | Node.js + npm install | Zero (compiled in) | ppt-rs |

**Recommendation:** PptxGenJS is the primary generation path. The Rust exporter remains useful as a zero-dependency fallback for Cmd+Shift+E quick export.

## Recommended Approach

### Tier 1 — High Impact, Low Effort (quick wins)

| \# | Feature | Effort | Value |
| --- | --- | --- | --- |
| G1 | **Hyperlinks** — `[text](url)` → clickable links | S | High — URLs currently lost |
| G2 | **Presentation metadata** — author, title, company from frontmatter | S | Medium — professional output |
| G3 | **Built-in slide numbers** — replace manual text with `slideNumber` API | S | Medium — cleaner implementation |
| G4 | **Subscript / superscript** — `H~2~O`, `x^2^` markdown | S | Low — niche but easy |
| G5 | **Shadow on title shapes** — subtle elevation | S | Medium — more polished |

### Tier 2 — High Impact, Medium Effort (core improvements)

| \# | Feature | Effort | Value |
| --- | --- | --- | --- |
| G6 | **Charts** — bar, line, pie, doughnut from YAML/JSON code blocks | M-L | **High** — data visualization |
| G7 | **Slide masters** — define reusable layouts (Title, Section, Content, Picture) | M | High — proper layout system |
| G8 | **Two-column layout** — detect paired content, position side-by-side | M | High — layout variety |
| G9 | **Callout/accent shapes** — visual callout boxes, decorative elements | M | Medium — visual hierarchy |
| G10 | **Auto-page tables** — large tables split across slides | M | Medium — data presentations |

### Tier 3 — Medium Impact (extended features)

| \# | Feature | Effort | Value |
| --- | --- | --- | --- |
| G11 | **Content overflow handling** — detect + auto-split overflowing slides | M | High — prevents cut-off text |
| G12 | **Background images** — from template or agent-specified | S | Medium |
| G13 | **Image enhancements** — rounding, shadow, alt text, crop sizing | S | Low |
| G14 | **Table enhancements** — colspan, per-side borders, row heights, auto-page | M | Medium |
| G15 | **Scatter / radar / bubble charts** | M | Low — niche chart types |

### Tier 4 — Low Priority

Media embedding (video/YouTube/audio), animations, RTL support, custom geometry paths, HTML table import.

## Input Format for New Features

Charts need an input format the agent can write in markdown. Two options:

**Option A: YAML code block**

```markdown
```chart
type: bar
title: Q1 Revenue
labels: [Jan, Feb, Mar]
series:
  - name: Product A
    values: [120, 150, 180]
  - name: Product B
    values: [90, 110, 140]
```
```

**Option B: JSON code block** (simpler for LLMs)

```markdown
```chart
{
  "type": "bar",
  "title": "Q1 Revenue",
  "labels": ["Jan", "Feb", "Mar"],
  "series": [
    { "name": "Product A", "values": [120, 150, 180] },
    { "name": "Product B", "values": [90, 110, 140] }
  ]
}
```
```

Recommend **Option A** (YAML) — more readable, and agents generate YAML naturally.

## Key Files

| File | Lines | Purpose |
| --- | --- | --- |
| `bundled-skills/generate-presentation/scripts/generate.mjs` | 782 | PptxGenJS generation script |
| `bundled-skills/generate-presentation/scripts/package.json` | \~10 | Dependencies (pptxgenjs, jszip) |
| `bundled-skills/generate-presentation/SKILL.md` | \~200 | Agent instructions |
| `bundled-skills/generate-presentation/references/TEMPLATES.md` | \~50 | Style/template documentation |
| `src-tauri/src/export/markdown_to_pptx.rs` | 1653 | Rust built-in exporter (ppt-rs) |
| `src-tauri/src/export/templates.rs` | \~200 | Rust template configurations |
| `node_modules/pptxgenjs/types/index.d.ts` | \~1500 | Full PptxGenJS TypeScript API |

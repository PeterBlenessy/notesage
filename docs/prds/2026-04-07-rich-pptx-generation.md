# PRD: Rich PPTX Generation

|  |  |
| --- | --- |
| **Date** | 2026-04-07 |
| **Status** | Draft |
| **Priority** | High |
| **Impact** | Generated presentations evolve from text-heavy decks to rich, data-driven presentations with charts, shapes, professional layouts, and proper hyperlinking |
| **Research** | [pptx-generation-quality](../research/2026-04-07-pptx-generation-quality.md) |
| **Tasks** | Linked per feature in status table below |

## Problem

The `generate-presentation` PptxGenJS script (`generate.mjs`, 782 lines) uses roughly **5% of the PptxGenJS library's capabilities**. The previous PRD ([2026-04-06-high-quality-pptx-generation](2026-04-06-high-quality-pptx-generation.md)) established the script, three built-in styles, template theme extraction, and markdown-to-slide parsing. That foundation is solid but the output is still fundamentally limited:

1. **No charts.** Data-heavy presentations (quarterly reviews, market analysis, dashboards) have no way to visualize data. All numbers stay as bullet text or tables. PptxGenJS supports 10 chart types — none are used.

2. **No hyperlinks.** Markdown `[text](url)` links are stripped to plain text. URLs, references, and cross-slide links are lost in the generated output.

3. **No shapes beyond accent bars.** PptxGenJS exposes 187 shape types — the script uses only `rect` for the business style accent bar. No callout boxes, arrows, flowchart shapes, or decorative elements.

4. **No slide masters.** Every slide is built ad-hoc with manual positioning. PptxGenJS supports `defineSlideMaster()` for reusable layouts with typed placeholders — unused.

5. **No multi-column layouts.** Every slide is single-column top-to-bottom. Two-column comparison slides, image-beside-text layouts, and side-by-side content are impossible.

6. **No presentation metadata.** Author, company, title, and subject fields are empty in the generated file properties.

7. **Basic formatting only.** No subscript/superscript, no text shadows, no image enhancements (rounding, shadow, alt text), no per-side table borders, no colspan/rowspan.

8. **Large tables break.** Tables that exceed slide height are clipped. PptxGenJS has `autoPage: true` for automatic multi-slide table splitting — unused.

9. **No content overflow handling.** Slides with too many bullets or mixed content types overflow the bottom edge with no detection or splitting.

## Goals

Enable the PptxGenJS generation script to produce rich, professional presentations that leverage the full breadth of the library:

- **G1-G5 (Tier 1):** Quick wins — hyperlinks, metadata, proper slide numbers, subscript/superscript, title shadows
- **G6-G10 (Tier 2):** Core improvements — charts from YAML, slide masters, two-column layout, callout shapes, auto-page tables
- **G11-G15 (Tier 3):** Extended features — content overflow handling, background images, image enhancements, table enhancements, additional chart types
- **G16-G18 (Tier 4):** Low priority — media embedding, custom geometry, HTML table import

## Non-Goals

- **Improving the Rust built-in exporter** (`markdown_to_pptx.rs` / `ppt-rs`) — out of scope, separate codebase
- **Full animation system** — PptxGenJS animation support is limited/unofficial; not worth the complexity
- **Media embedding beyond YouTube** — video/audio file embedding requires codec handling and large binary payloads
- **RTL text support** — niche requirement, can be added later if needed
- **Custom geometry paths** — `points: [{ x, y, curve, close }]` is too complex for agent-generated content
- **Real-time slide preview** in the Notesage editor
- **Slide transitions** — not well-documented in PptxGenJS TypeScript definitions

## Technical Approach

### Tier 1 — Quick Wins (G1-G5)

#### G1: Hyperlinks

**Problem:** `[text](url)` markdown links are currently stripped to plain text by `stripMarkdownFormatting()` and `parseInlineFormatting()`. URLs are lost.

**PptxGenJS API:**

```javascript
// On text runs:
{ text: "Click here", options: { hyperlink: { url: "https://example.com", tooltip: "Example" } } }

// On images:
slide.addImage({ path: "img.png", hyperlink: { url: "https://example.com" } })

// Cross-slide links:
{ text: "See slide 3", options: { hyperlink: { slide: 3 } } }
```

**Changes to** `generate.mjs`**:**

- Update `parseInlineFormatting()` to emit `hyperlink: { url }` on link text runs instead of stripping links
- Update `stripMarkdownFormatting()` to preserve link text (already does) but also return link metadata when needed
- Add hyperlink support to table cells via cell-level `hyperlink` option
- Handle both external URLs (`http/https/mailto`) and internal slide references (`#slide-N`)

**SKILL.md update:** Document that `[text](url)` links become clickable hyperlinks in the output. Add cross-slide link syntax: `[see results](#slide-5)`.

**Effort:** S

---

#### G2: Presentation Metadata

**Problem:** Generated `.pptx` files have empty Author, Title, Subject, and Company fields in File &gt; Properties.

**PptxGenJS API:**

```javascript
pptx.author = "Jane Doe";
pptx.company = "Acme Corp";
pptx.title = "Q4 Quarterly Review";
pptx.subject = "Business Performance";
pptx.revision = "1";
```

**Changes to** `generate.mjs`**:**

- Parse YAML frontmatter from the input markdown for metadata fields:

  ```yaml
  ---
  author: Jane Doe
  company: Acme Corp
  subject: Business Performance
  ---
  ```
- If no frontmatter, derive `title` from the first H1 heading
- Apply metadata to the `pptx` instance before generating slides

**SKILL.md update:** Document optional YAML frontmatter fields for presentation metadata.

**Effort:** S

---

#### G3: Built-in Slide Numbers

**Problem:** Slide numbers are rendered as manual `addText()` calls with hardcoded positioning. PptxGenJS has a dedicated `slideNumber` API that integrates with the slide master system.

**PptxGenJS API:**

```javascript
slide.slideNumber = {
  x: 12.2, y: 6.9, w: 0.8, h: 0.4,
  fontSize: 10, fontFace: "Calibri",
  color: "555555",
};
```

**Changes to** `generate.mjs`**:**

- Replace the manual `slide.addText(si + 1, ...)` slide number rendering with `slide.slideNumber = { ... }`
- Position and style slide numbers using theme colors
- Skip slide numbers on title-only slides (existing behavior preserved)

**SKILL.md update:** None required.

**Effort:** S

---

#### G4: Subscript and Superscript

**Problem:** Scientific and mathematical notation (`H~2~O`, `x^2^`, `10^9^`) renders as plain text.

**PptxGenJS API:**

```javascript
// Subscript:
{ text: "2", options: { subscript: true } }
// Superscript:
{ text: "2", options: { superscript: true } }
```

**Markdown syntax:**

- Subscript: `H~2~O` (tilde-wrapped)
- Superscript: `x^2^` (caret-wrapped)

**Changes to** `generate.mjs`**:**

- Extend `parseInlineFormatting()` regex to detect `~text~` (subscript) and `^text^` (superscript) patterns
- Emit text runs with `subscript: true` or `superscript: true` options

**SKILL.md update:** Document subscript/superscript syntax in the Slide Format Reference.

**Effort:** S

---

#### G5: Title Shadows

**Problem:** Title text is flat with no depth. A subtle shadow adds visual polish without complexity.

**PptxGenJS API:**

```javascript
slide.addText("Title", {
  shadow: {
    type: "outer",
    blur: 4,
    offset: 2,
    angle: 45,
    opacity: 0.3,
    color: "000000",
  },
});
```

**Changes to** `generate.mjs`**:**

- Add a `shadow` property to title text options on non-title-only slides
- Make shadow configurable per style (e.g., business and report get shadows, simple does not)
- Shadow parameters: outer, blur 3-4pt, offset 1-2pt, opacity 0.2-0.4, angle 45

**SKILL.md update:** None required (automatic visual enhancement).

**Effort:** S

---

### Tier 2 — Core Improvements (G6-G10)

#### G6: Charts from YAML Code Blocks

**Problem:** Data visualization is the most requested missing feature. Quarterly reviews, market analysis, and dashboards are text-only.

**PptxGenJS API:**

```javascript
// Bar chart:
slide.addChart(pptx.charts.BAR, chartData, {
  x: 0.8, y: 1.9, w: 11.73, h: 4.5,
  showTitle: true, title: "Q1 Revenue",
  titleFontFace: "Calibri", titleFontSize: 16,
  showLegend: true, legendPos: "b",
  showValue: false,
  chartColors: ["4472C4", "ED7D31", "A5A5A5"],
  catAxisLabelFontSize: 12,
  valAxisLabelFontSize: 12,
  barDir: "bar",  // horizontal; omit for vertical
  barGapWidthPct: 150,
});

// chartData format:
const chartData = [
  { name: "Product A", labels: ["Jan", "Feb", "Mar"], values: [120, 150, 180] },
  { name: "Product B", labels: ["Jan", "Feb", "Mar"], values: [90, 110, 140] },
];

// Pie chart:
slide.addChart(pptx.charts.PIE, chartData, {
  showPercent: true,
  showLegend: true,
  legendPos: "r",
});

// Line chart:
slide.addChart(pptx.charts.LINE, chartData, {
  lineSmooth: true,
  lineDataSymbol: "circle",
  lineDataSymbolSize: 8,
});

// Doughnut chart:
slide.addChart(pptx.charts.DOUGHNUT, chartData, {
  holeSize: 50,
  showPercent: true,
});

// Area chart:
slide.addChart(pptx.charts.AREA, chartData, {
  opacity: 50,
});
```

**Markdown input format (YAML code block):**

```markdown
```chart
type: bar
title: Q1 Revenue by Product
labels: [Jan, Feb, Mar, Apr]
series:
  - name: Product A
    values: [120, 150, 180, 210]
  - name: Product B
    values: [90, 110, 140, 160]
options:
  showLegend: true
  legendPos: b
  showValue: false
  barDir: col
```
```

**Supported chart types (initial):** `bar`, `line`, `pie`, `doughnut`, `area`

**Changes to** `generate.mjs`**:**

- Add YAML parsing dependency (`js-yaml`) or implement lightweight YAML parser for chart blocks
- Detect ```` ```chart ```` code blocks in the markdown parser — parse as chart data instead of code text
- Add `chart` content type to the slide data model: `{ type: "chart", data: { chartType, title, labels, series, options } }`
- Implement `renderChart(slide, chartItem, theme)` function that:
  1. Maps `type` string to `pptx.charts.*` constant
  2. Transforms `series` array to PptxGenJS `chartData` format (each series: `{ name, labels, values }`)
  3. Applies theme colors as `chartColors`
  4. Sets positioning based on available slide area (full-width or alongside other content)
  5. Applies chart-specific options (`barDir`, `lineSmooth`, `holeSize`, etc.)
- Add a default chart color palette per style (6+ colors derived from theme accent colors)

**SKILL.md update:** Add Chart section to Slide Format Reference with YAML code block syntax, supported chart types, and options reference.

**Effort:** M-L

---

#### G7: Slide Masters

**Problem:** Every slide is built with manual `addText`/`addShape` positioning. Slide masters define reusable layouts with typed placeholders, producing cleaner OOXML that PowerPoint can re-theme.

**PptxGenJS API:**

```javascript
pptx.defineSlideMaster({
  title: "TITLE_SLIDE",
  background: { color: theme.titleSlide.bgColor },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.8, y: 2.5, w: 11.73, h: 1.0 } } },
    { placeholder: { options: { name: "subtitle", type: "body", x: 0.8, y: 3.8, w: 11.73, h: 0.5 } } },
  ],
});

pptx.defineSlideMaster({
  title: "CONTENT",
  background: { color: theme.background.color },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.8, y: 0.4, w: 11.73, h: 0.8 } } },
    { placeholder: { options: { name: "body", type: "body", x: 0.8, y: 1.9, w: 11.73, h: 4.9 } } },
  ],
  slideNumber: { x: 12.2, y: 6.9, fontSize: 10, color: theme.colors.dk2 },
});

// Usage:
const slide = pptx.addSlide({ masterName: "CONTENT" });
```

**Defined masters:**

| Master | Placeholders | Used When |
| --- | --- | --- |
| `TITLE_SLIDE` | title, subtitle, date | First slide or explicit title-only |
| `SECTION_HEADER` | title, subtitle | H1 after `---` or `---` + H1 |
| `CONTENT` | title, body | Standard content slides |
| `TWO_CONTENT` | title, body_left, body_right | Two-column layout (G8) |
| `PICTURE` | title, body, picture | Image-heavy slides |
| `BLANK` | (none) | Full-bleed images or custom layouts |

**Changes to** `generate.mjs`**:**

- Add `defineSlidesMasters(pptx, theme)` function that creates all master definitions
- Update `generatePptx()` to use `pptx.addSlide({ masterName })` instead of manual element placement
- Refactor accent bar, slide number, and footer rendering into master definitions
- Update layout inference to map to master names

**SKILL.md update:** None required (internal architectural change).

**Effort:** M

---

#### G8: Two-Column Layout

**Problem:** All content is single-column. Comparison slides, pros/cons, and image-beside-text layouts are impossible.

**Markdown syntax:**

```markdown
# Feature Comparison

:::columns
**Current State**
- Manual processes
- 3-day turnaround
- Error-prone

---column---

**Proposed Solution**
- Automated pipeline
- Same-day delivery
- 99.9% accuracy
:::
```

**Changes to** `generate.mjs`**:**

- Detect `:::columns` / `:::` block syntax in the markdown parser
- `---column---` separator splits content into left and right columns
- Map to `TWO_CONTENT` slide master (G7)
- Left column: `x: 0.8, w: 5.5` — Right column: `x: 7.0, w: 5.5`
- Each column independently supports bullets, text, images, tables
- If no `:::columns` wrapper, auto-detect two consecutive bullet lists on the same slide as a two-column candidate

**SKILL.md update:** Document `:::columns` syntax and `---column---` separator.

**Effort:** M

---

#### G9: Callout and Accent Shapes

**Problem:** Slides lack visual hierarchy elements. Callout boxes, key metric highlights, and decorative shapes are missing.

**PptxGenJS API:**

```javascript
// Rounded rectangle callout:
slide.addShape(pptx.ShapeType.roundRect, {
  x: 0.8, y: 2.0, w: 4.0, h: 2.0,
  fill: { color: "F0F4FF" },
  line: { color: "4472C4", width: 1.5 },
  rectRadius: 0.2,
  shadow: { type: "outer", blur: 3, offset: 1, opacity: 0.2, color: "000000" },
});

// Callout shape with pointer:
slide.addShape(pptx.ShapeType.wedgeRectCallout, { ... });

// Arrow:
slide.addShape(pptx.ShapeType.rightArrow, { ... });
```

**Markdown syntax:**

```markdown
:::callout
**Key Insight:** Revenue grew 18% YoY driven by enterprise expansion.
:::
```

**Changes to** `generate.mjs`**:**

- Add `:::callout` block detection to the markdown parser (new content type: `callout_box`)
- Render callout boxes as `roundRect` shapes with theme-colored fill and border
- Add optional shape type override: `:::callout shape=wedgeRectCallout`
- Support `:::highlight` for key metric boxes (larger font, centered, accent background)
- Agent can use decorative shapes — the shapes are pre-positioned based on slide layout

**SKILL.md update:** Document `:::callout` and `:::highlight` syntax.

**Effort:** M

---

#### G10: Auto-Page Tables

**Problem:** Large tables (more than \~8 rows) overflow the slide bottom. Content is clipped or invisible.

**PptxGenJS API:**

```javascript
slide.addTable(rows, {
  autoPage: true,
  autoPageRepeatHeader: true,
  autoPageHeaderRows: 1,
  autoPageSlideStartY: 1.9,
  autoPageCharWeight: 0, // auto-calculate
  newSlideStartY: 0.5,   // continuation slides start higher
});
```

**Changes to** `generate.mjs`**:**

- Enable `autoPage: true` on all table renders
- Set `autoPageRepeatHeader: true` to repeat header row on continuation slides
- Set `autoPageHeaderRows: 1` (default)
- Continuation slides inherit the current slide's background and style
- Remove the manual `Math.min(rows.length * 0.4, 3.5)` height capping — let auto-page handle overflow

**SKILL.md update:** Document that large tables automatically span multiple slides.

**Effort:** M

---

### Tier 3 — Extended Features (G11-G15)

#### G11: Content Overflow Handling

**Problem:** Slides with many bullets, mixed content types, or verbose text overflow the bottom edge (Y &gt; 6.8") with no detection or splitting.

**Approach:**

- Track `curY` during content rendering and detect when it would exceed `MAX_CONTENT_BOTTOM` (6.8")
- When overflow is detected, create a continuation slide with the same title + "(cont.)" suffix
- Reset `curY` on the continuation slide and continue rendering remaining content items
- Apply to all content types: bullets, text, tables, code blocks, images
- For bullet lists: split at the item boundary closest to the overflow point (never mid-item)

**Changes to** `generate.mjs`**:**

- Add `estimateContentHeight(item, theme)` function for each content type
- Before rendering each item, check if `curY + estimatedHeight > MAX_CONTENT_BOTTOM`
- If overflow, call `createContinuationSlide(pptx, slideData, theme)` and reset positioning
- Long bullet lists: split into chunks that fit, each chunk on its own slide

**SKILL.md update:** None required (automatic behavior).

**Effort:** M

---

#### G12: Background Images

**Problem:** Slides only support solid-color backgrounds. Background images (from templates, agent instructions, or per-slide) are unsupported.

**PptxGenJS API:**

```javascript
// Image background:
slide.background = { path: "/path/to/bg.jpg" };
// or base64:
slide.background = { data: "data:image/png;base64,..." };
// Transparent overlay on background:
slide.background = { fill: { color: "000000", transparency: 50 } };
```

**Markdown syntax:**

```markdown
# Section Title
<!-- background: ./images/section-bg.jpg -->
```

**Changes to** `generate.mjs`**:**

- Parse HTML comments `<!-- background: path -->` as slide background directives
- Resolve relative paths from the input markdown directory
- Add semi-transparent overlay option: `<!-- background: path overlay=0.4 -->`
- Template extraction: if the user template has a background image, apply it to content slides

**SKILL.md update:** Document background image syntax.

**Effort:** S

---

#### G13: Image Enhancements

**Problem:** Images are rendered with basic `contain` sizing only. No rounding, shadows, alt text, or crop control.

**PptxGenJS API:**

```javascript
slide.addImage({
  path: "photo.jpg",
  x: 2, y: 2, w: 6, h: 4,
  rounding: true,           // circular crop
  shadow: { type: "outer", blur: 4, offset: 2, opacity: 0.3, color: "000000" },
  altText: "Team photo",    // accessibility
  sizing: { type: "cover", w: 6, h: 4 },  // cover (crop to fill) vs contain
  hyperlink: { url: "https://example.com" },
});
```

**Changes to** `generate.mjs`**:**

- Pass `altText` from markdown image alt text: `![Team photo](path)` -&gt; `altText: "Team photo"`
- Add subtle shadow to images by default (consistent with title shadow style)
- Support image sizing hints via markdown attributes: `![alt](path "cover")` or `![alt](path "round")`
- Keyword detection in alt text or title: `round` triggers `rounding: true`, `cover` triggers `sizing.type: "cover"`

**SKILL.md update:** Document image enhancement keywords.

**Effort:** S

---

#### G14: Table Enhancements

**Problem:** Tables have uniform borders, no colspan/rowspan, and no row height control.

**PptxGenJS API:**

```javascript
// Per-side borders:
border: [
  { type: "solid", pt: 1, color: "000000" },  // top
  { type: "solid", pt: 1, color: "000000" },  // right
  { type: "solid", pt: 1, color: "000000" },  // bottom
  { type: "solid", pt: 1, color: "000000" },  // left
]

// Colspan/rowspan:
{ text: "Merged", options: { colspan: 2 } }
{ text: "Tall", options: { rowspan: 3 } }

// Row heights:
rowH: [0.6, 0.4, 0.4, 0.4]
```

**Changes to** `generate.mjs`**:**

- Apply per-side borders: heavier bottom border on header row, lighter internal borders
- Detect colspan syntax in markdown tables (cells with `||` empty adjacent cells)
- Support explicit row height via HTML comment: `<!-- rowH: 0.6, 0.4, 0.4 -->`
- Better alternating row colors using theme colors with transparency

**SKILL.md update:** Document colspan syntax and table styling options.

**Effort:** M

---

#### G15: Scatter, Radar, and Bubble Charts

**Problem:** Only basic chart types (bar, line, pie, doughnut, area) are covered by G6. Scientific and analytical presentations need scatter plots, radar charts, and bubble charts.

**PptxGenJS API:**

```javascript
// Scatter:
slide.addChart(pptx.charts.SCATTER, [
  { name: "Series A", values: [{ x: 1, y: 2 }, { x: 3, y: 5 }, { x: 5, y: 3 }] }
], { showLegend: true });

// Radar:
slide.addChart(pptx.charts.RADAR, chartData, {
  radarStyle: "filled",  // "standard" | "marker" | "filled"
});

// Bubble:
slide.addChart(pptx.charts.BUBBLE, [
  { name: "Q1", values: [{ x: 1, y: 2, size: 10 }, { x: 3, y: 5, size: 20 }] }
]);
```

**YAML input format:**

```markdown
```chart
type: scatter
title: Price vs Performance
series:
  - name: Product Line A
    values:
      - 
      - 
      - 
```
```

```markdown
```chart
type: bubble
title: Market Opportunity
series:
  - name: Segment A
    values:
      - 
      - 
```
```

**Changes to** `generate.mjs`**:**

- Extend chart type mapping to include `scatter`, `radar`, `bubble`
- Scatter/bubble use `{ x, y }` or `{ x, y, size }` value format instead of flat arrays
- Radar uses the same `labels` + `values` format as bar/line

**SKILL.md update:** Add scatter, radar, and bubble to the chart type reference.

**Effort:** M

---

### Tier 4 — Low Priority (G16-G18)

#### G16: YouTube Video Embedding

**PptxGenJS API:**

```javascript
slide.addMedia({
  type: "online",
  link: "https://www.youtube.com/embed/VIDEO_ID",
  x: 2, y: 2, w: 8, h: 4.5,
});
```

**Markdown syntax:** Standard YouTube URL in an embed directive: `<!-- youtube: https://youtube.com/watch?v=xxx -->`

**Changes to** `generate.mjs`**:** Detect YouTube URLs, convert to embed format, add as online media.

**Effort:** S

---

#### G17: Custom Geometry Paths

**PptxGenJS API:**

```javascript
slide.addShape(pptx.ShapeType.custGeom, {
  points: [
    { x: 0, y: 0, moveTo: true },
    { x: 5, y: 0 },
    { x: 5, y: 3, curve: { type: "arc", hR: 1, wR: 1 } },
    { x: 0, y: 3 },
    { close: true },
  ],
});
```

**Complexity:** Very high — agents would need to generate precise coordinate paths. Not practical for LLM-generated content.

**Effort:** L

---

#### G18: HTML Table Import

**PptxGenJS API:**

```javascript
pptx.tableToSlides("htmlTableElementId", {
  autoPage: true,
  addHeaderToEach: true,
});
```

**Note:** Requires a DOM environment (not available in Node.js without jsdom). Low value since markdown tables already work.

**Effort:** M

---

## Chart Input Format

Charts are specified as YAML inside fenced code blocks with the `chart` language tag:

```markdown
```chart
type: bar
title: "Quarterly Revenue"
labels: [Q1, Q2, Q3, Q4]
series:
  - name: "2025"
    values: [120, 150, 180, 210]
  - name: "2026"
    values: [140, 175, 200, 245]
options:
  showLegend: true
  legendPos: b
  showValue: false
  barDir: col
```
```

### Schema

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `type` | string | Yes | Chart type: `bar`, `line`, `pie`, `doughnut`, `area`, `scatter`, `radar`, `bubble` |
| `title` | string | No | Chart title displayed above the chart |
| `labels` | string\[\] | Yes (bar/line/area/radar) | Category axis labels |
| `series` | array | Yes | One or more data series |
| `series[].name` | string | Yes | Series name (legend label) |
| `series[].values` | number\[\] or object\[\] | Yes | Data values — flat array for bar/line/pie/area/radar, `{ x, y }` for scatter, `{ x, y, size }` for bubble |
| `options` | object | No | Chart-specific options (passthrough to PptxGenJS) |

### Supported Options by Chart Type

| Option | Charts | Values | Default |
| --- | --- | --- | --- |
| `showLegend` | All | `true`/`false` | `true` (multi-series), `false` (single) |
| `legendPos` | All | `t`, `b`, `l`, `r`, `tr` | `b` |
| `showValue` | Bar, Line, Area | `true`/`false` | `false` |
| `showPercent` | Pie, Doughnut | `true`/`false` | `true` |
| `barDir` | Bar | `col` (vertical), `bar` (horizontal) | `col` |
| `barGapWidthPct` | Bar | 0-500 | 150 |
| `lineSmooth` | Line | `true`/`false` | `false` |
| `lineDataSymbol` | Line | `circle`, `dash`, `diamond`, `dot`, `none`, `square`, `triangle` | `circle` |
| `holeSize` | Doughnut | 10-90 | 50 |
| `radarStyle` | Radar | `standard`, `marker`, `filled` | `standard` |

### Parser Detection

The markdown parser detects chart blocks by checking for ```` ```chart ```` as the code block language tag. When detected:

1. Attempt YAML parse of the block content
2. Validate required fields (`type`, `series`)
3. If parsing fails, fall back to rendering as a regular code block
4. Emit a `{ type: "chart", data: { ... } }` content item in the slide model

### Chart Color Palette

Each built-in style defines a 6-color chart palette derived from theme colors:

| Style | Colors |
| --- | --- |
| Simple | `4472C4`, `ED7D31`, `A5A5A5`, `FFC000`, `5B9BD5`, `70AD47` |
| Business | `2D2D2D`, `555555`, `888888`, `4472C4`, `ED7D31`, `A5A5A5` |
| Report | `404040`, `666666`, `4472C4`, `ED7D31`, `A5A5A5`, `FFC000` |

Custom templates use accent1-accent6 from the extracted theme.

---

## Feature Status

| \# | Feature | Tier | Effort | Status | Tasks |
| --- | --- | --- | --- | --- | --- |
| G1 | Hyperlinks | 1 | S | Not started | [G1-tasks](../tasks/2026-04-07-pptx-gen-g1-hyperlinks-tasks.md) |
| G2 | Presentation metadata | 1 | S | Not started | [G2-tasks](../tasks/2026-04-07-pptx-gen-g2-metadata-tasks.md) |
| G3 | Built-in slide numbers | 1 | S | Not started | [G3-tasks](../tasks/2026-04-07-pptx-gen-g3-slide-numbers-tasks.md) |
| G4 | Subscript / superscript | 1 | S | Not started | [G4-tasks](../tasks/2026-04-07-pptx-gen-g4-sub-super-tasks.md) |
| G5 | Title shadows | 1 | S | Not started | [G5-tasks](../tasks/2026-04-07-pptx-gen-g5-title-shadows-tasks.md) |
| G6 | Charts from YAML | 2 | M-L | Not started | [G6-tasks](../tasks/2026-04-07-pptx-gen-g6-charts-tasks.md) |
| G7 | Slide masters | 2 | M | Not started | [G7-tasks](../tasks/2026-04-07-pptx-gen-g7-slide-masters-tasks.md) |
| G8 | Two-column layout | 2 | M | Not started | [G8-tasks](../tasks/2026-04-07-pptx-gen-g8-two-column-tasks.md) |
| G9 | Callout / accent shapes | 2 | M | Not started | [G9-tasks](../tasks/2026-04-07-pptx-gen-g9-callout-shapes-tasks.md) |
| G10 | Auto-page tables | 2 | M | Not started | [G10-tasks](../tasks/2026-04-07-pptx-gen-g10-auto-page-tables-tasks.md) |
| G11 | Content overflow handling | 3 | M | Not started | [G11-tasks](../tasks/2026-04-07-pptx-gen-g11-overflow-tasks.md) |
| G12 | Background images | 3 | S | Not started | [G12-tasks](../tasks/2026-04-07-pptx-gen-g12-background-images-tasks.md) |
| G13 | Image enhancements | 3 | S | Not started | [G13-tasks](../tasks/2026-04-07-pptx-gen-g13-image-enhancements-tasks.md) |
| G14 | Table enhancements | 3 | M | Not started | [G14-tasks](../tasks/2026-04-07-pptx-gen-g14-table-enhancements-tasks.md) |
| G15 | Scatter / radar / bubble charts | 3 | M | Not started | [G15-tasks](../tasks/2026-04-07-pptx-gen-g15-advanced-charts-tasks.md) |
| G16 | YouTube video embedding | 4 | S | Not started | [G16-tasks](../tasks/2026-04-07-pptx-gen-g16-youtube-tasks.md) |
| G17 | Custom geometry paths | 4 | L | Not started | [G17-tasks](../tasks/2026-04-07-pptx-gen-g17-custom-geometry-tasks.md) |
| G18 | HTML table import | 4 | M | Not started | [G18-tasks](../tasks/2026-04-07-pptx-gen-g18-html-table-tasks.md) |

---

## Quality Gates

### Tier 1 (G1-G5)

- [ ] Markdown `[text](url)` links render as clickable hyperlinks in PowerPoint

- [ ] Cross-slide links (`#slide-N`) navigate to the correct slide

- [ ] YAML frontmatter `author`, `title`, `company`, `subject` appear in File &gt; Properties

- [ ] Title derived from first H1 when no frontmatter is present

- [ ] Slide numbers use `slideNumber` API (verify in OOXML — `<p:sldNum>` element, not `<a:t>`)

- [ ] Subscript `H~2~O` renders with lowered "2" in PowerPoint

- [ ] Superscript `x^2^` renders with raised "2" in PowerPoint

- [ ] Title text has subtle shadow on business and report styles

- [ ] Simple style titles have no shadow

- [ ] All Tier 1 features work with all three built-in styles and custom templates

### Tier 2 (G6-G10)

- [ ] Bar chart renders from YAML code block with correct data, labels, and legend

- [ ] Line chart renders with smooth/straight line options

- [ ] Pie chart renders with percentage labels

- [ ] Doughnut chart renders with configurable hole size

- [ ] Area chart renders with proper fill opacity

- [ ] Chart colors follow the active theme's palette

- [ ] Slide masters are defined in the PPTX (verify `slideMaster*.xml` in ZIP)

- [ ] Content slides use the `CONTENT` master

- [ ] Title slides use the `TITLE_SLIDE` master

- [ ] `:::columns` syntax produces two-column layout with equal-width columns

- [ ] `---column---` correctly splits content between left and right

- [ ] `:::callout` renders as a rounded rectangle with theme accent colors

- [ ] Tables with &gt;10 rows auto-page across multiple slides

- [ ] Auto-paged tables repeat the header row on each continuation slide

- [ ] Invalid YAML in chart blocks falls back to code block rendering

### Tier 3 (G11-G15)

- [ ] Slides with &gt;8 bullet items split into continuation slides

- [ ] Continuation slides have title with "(cont.)" suffix

- [ ] `<!-- background: path -->` applies image as slide background

- [ ] Image alt text appears in PowerPoint accessibility info

- [ ] Images have subtle shadow by default

- [ ] Table header row has heavier bottom border

- [ ] Scatter chart renders XY data points correctly

- [ ] Radar chart renders with filled/marker/standard styles

- [ ] Bubble chart renders with sized data points

### Tier 4 (G16-G18)

- [ ] YouTube embed creates a clickable media placeholder in PowerPoint

## Dependencies

- **PptxGenJS v3.12.0** — already installed in `bundled-skills/generate-presentation/scripts/`
- **JSZip** — already installed (used for template theme extraction)
- **js-yaml** (new, for G6) — YAML parsing for chart code blocks. Lightweight, MIT license. Alternative: implement a minimal YAML subset parser to avoid the dependency.

No Rust backend changes required. No new Tauri commands. All changes are confined to:

1. `bundled-skills/generate-presentation/scripts/generate.mjs` — generation script
2. `bundled-skills/generate-presentation/SKILL.md` — agent instructions
3. `bundled-skills/generate-presentation/scripts/package.json` — if `js-yaml` added

## Key Files

| File | Purpose |
| --- | --- |
| `bundled-skills/generate-presentation/scripts/generate.mjs` | Main PptxGenJS generation script (all changes) |
| `bundled-skills/generate-presentation/SKILL.md` | Agent instructions (syntax documentation) |
| `bundled-skills/generate-presentation/references/TEMPLATES.md` | Style/template reference |
| `bundled-skills/generate-presentation/scripts/package.json` | Script dependencies |
| `docs/research/2026-04-07-pptx-generation-quality.md` | Research — full PptxGenJS API inventory |
| `docs/prds/2026-04-06-high-quality-pptx-generation.md` | Previous PRD (foundation, complete) |

## References

- PptxGenJS docs: https://gitbrent.github.io/PptxGenJS/
- PptxGenJS TypeScript definitions: `node_modules/pptxgenjs/types/index.d.ts`
- Research doc: [2026-04-07-pptx-generation-quality](../research/2026-04-07-pptx-generation-quality.md)
- Previous PRD: [2026-04-06-high-quality-pptx-generation](2026-04-06-high-quality-pptx-generation.md)
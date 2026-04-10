# PPTX Generation Polish — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-04-08 |
| **Status** | Complete |
| **PRD** | [pptx-generation-polish](../prds/2026-04-08-pptx-generation-polish.md) |
| **Research** | [pptx-generation-quality](../research/2026-04-07-pptx-generation-quality.md) |
| **Total** | 21 tasks: 16S, 5M |
| **Suggested order** | Tier A quick wins (#1-#6) → Tier B text & charts (#7-#10) → Tier C shapes (#11-#14) → Tier D images & tables (#15-#19) → Tier E slides & presentation (#20-#21) |

**Risks:**

- Script is already 1381 lines. Several tasks add new parsing and rendering functions — may want to extract helpers into a separate module if it grows past ~1800 lines.
- Shape directives use HTML comments (`<!-- shape: ... -->`) which are a new parsing pattern distinct from the existing `<!-- background: ... -->` pattern. Should use a unified comment directive parser.
- P20 (rowspan) with `^^` marker requires careful interaction with existing `||` colspan detection to avoid conflicts in edge cases.
- All features are in a single file (`generate.mjs`) with no Rust backend changes — low blast radius but high merge conflict potential if multiple tasks are worked in parallel.

**Note:** P22 (sections), P23 (hidden), P26 (custom layout) are combined into a single task (#21) since they're all simple slide-level HTML comment directives. P24 (compression) and P25 (theme API) are combined into #6 since both are one-liner changes.

---

### #1 — Add character & line spacing per style (P2)

**Description:** Add `charSpacing`, `lineSpacing`, and `paraSpaceBefore` to the three built-in style definitions. Apply these properties to body text, bullet items, and headings throughout the rendering pipeline.

Values per style:
- Simple: `charSpacing: 0`, `lineSpacing: 24` (1.0×)
- Business: `charSpacing: -0.5`, `lineSpacing: 26` (1.08×)
- Report: `charSpacing: 0`, `lineSpacing: 28` (1.15×)

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**
- `bundled-skills/generate-presentation/scripts/generate.mjs` — style definitions, text rendering

**Acceptance criteria:**
- Line spacing visibly differs between simple/business/report styles
- `paraSpaceBefore` applied alongside existing `paraSpaceAfter`
- `charSpacing` applied to body text runs

---

### #2 — Add bullet number format variants (P4)

**Description:** Support ordered list format specifiers via markdown comment before the list: `<!-- list: alpha-lc -->`, `<!-- list: roman-uc -->`, `<!-- list: start=5 -->`. Map to PptxGenJS `bullet.numberType` and `bullet.numberStartAt`.

Supported formats: `arabic` (default), `alpha-lc` → `alphaLcParenR`, `alpha-uc` → `alphaUcParenR`, `roman-lc` → `romanLcParenR`, `roman-uc` → `romanUcParenR`.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**
- `bundled-skills/generate-presentation/scripts/generate.mjs` — comment parsing in `parseMarkdown()`, bullet rendering
- `bundled-skills/generate-presentation/SKILL.md` — document list format syntax

**Acceptance criteria:**
- `<!-- list: alpha-lc -->` before ordered list produces a), b), c) numbering
- `<!-- list: start=5 -->` starts numbering at 5
- Default ordered lists unchanged (arabic)

---

### #3 — Add chart data labels (P5)

**Description:** Extend chart YAML `options` parsing to support `showDataLabels`, `dataLabelPos`, `dataLabelFontSize`, `dataLabelFormatCode`. Map to PptxGenJS `showValue`, `dataLabelPosition`, `dataLabelFontSize`, `dataLabelFormatCode`.

**Complexity:** S **Category:** frontend **Dependencies:** None (chart rendering already exists from G6) **Files:**
- `bundled-skills/generate-presentation/scripts/generate.mjs` — extend `renderChart()` options mapping
- `bundled-skills/generate-presentation/SKILL.md` — add data labels to chart options table

**Acceptance criteria:**
- `showDataLabels: true` displays values on chart data points
- `dataLabelPos: outsideEnd` positions labels outside data points
- `dataLabelFormatCode: "#,##0"` formats values with thousands separator

---

### #4 — Add bar3d chart type (P8)

**Description:** Add `bar3d` to the recognized chart type map. Map to `pptx.charts.BAR3D`. Reuses the same series format and options as 2D bar.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**
- `bundled-skills/generate-presentation/scripts/generate.mjs` — add to chart type map in `renderChart()`
- `bundled-skills/generate-presentation/SKILL.md` — add `bar3d` to chart types list

**Acceptance criteria:**
- `type: bar3d` in chart YAML renders a 3D bar chart
- All existing bar chart options (barDir, barGrouping) work with bar3d

---

### #5 — Add theme API and output compression (P24, P25)

**Description:** Two one-liner improvements:
1. Set `pptx.theme = { headFontFace, bodyFontFace }` using the active style's font definitions, reducing per-element font specifications.
2. Enable `compression: true` in the `pptx.write()` call to reduce output file size.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**
- `bundled-skills/generate-presentation/scripts/generate.mjs` — add theme assignment after pptx creation, add compression to write options

**Acceptance criteria:**
- `pptx.theme` set with correct fonts per style
- Output `.pptx` file is smaller with compression enabled
- Generated PPTX still opens without repair in PowerPoint

---

### #6 — Add unit tests for tier A features (#1-#5)

**Description:** Add tests for character/line spacing in style definitions, bullet number format detection, chart data label options, bar3d type mapping, theme API, and compression flag. Follow existing test patterns in `generate.test.mjs`.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #1-#5 **Files:**
- `bundled-skills/generate-presentation/scripts/generate.test.mjs`

**Acceptance criteria:**
- Style definitions include `charSpacing`, `lineSpacing`, `paraSpaceBefore` with correct values
- Bullet format comment parsing produces correct `numberType` and `numberStartAt`
- Chart options map `showDataLabels` → `showValue`
- `bar3d` maps to correct PptxGenJS chart type
- All existing 80+ tests still pass

---

### #7 — Add text highlight support (P1)

**Description:** Extend `parseInlineFormatting()` to detect `==text==` syntax (highlight). Emit `{ highlight: "FFFF00" }` on text runs. Support optional color: `==text=={FF0000}`.

Regex pattern: `/==([^=]+)==(?:\{([A-Fa-f0-9]{6})\})?/g`

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**
- `bundled-skills/generate-presentation/scripts/generate.mjs` — extend `parseInlineFormatting()` regex
- `bundled-skills/generate-presentation/SKILL.md` — document highlight syntax

**Acceptance criteria:**
- `==important==` renders as yellow-highlighted text in PowerPoint
- `==warning=={FF0000}` renders with red highlight
- Nested with bold: `**==text==**` works correctly

---

### #8 — Add underline styles (P3)

**Description:** Extend `parseInlineFormatting()` to support double underline via `++text++` → `underline: { style: "dbl" }`. Also make existing single underline emit the proper style object `{ style: "sng" }` if not already.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**
- `bundled-skills/generate-presentation/scripts/generate.mjs` — extend `parseInlineFormatting()`
- `bundled-skills/generate-presentation/SKILL.md` — document underline styles

**Acceptance criteria:**
- `++text++` renders with double underline in PowerPoint
- Existing single underline still works
- Nested with other formatting works

---

### #9 — Add chart axis titles & formatting (P6)

**Description:** Extend chart YAML `options` parsing for axis configuration: `catAxisTitle`, `valAxisTitle`, `valAxisFormatCode`, `valAxisMinVal`, `valAxisMaxVal`, `valAxisMajorUnit`, `catAxisLabelFormatCode`, `valAxisLabelFormatCode`. Pass these through to PptxGenJS chart options.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**
- `bundled-skills/generate-presentation/scripts/generate.mjs` — extend chart options mapping in `renderChart()`
- `bundled-skills/generate-presentation/SKILL.md` — add axis options to chart documentation

**Acceptance criteria:**
- `catAxisTitle: Quarter` displays X-axis title in chart
- `valAxisTitle: Revenue ($M)` displays Y-axis title
- `valAxisFormatCode: "$#,##0"` formats Y-axis labels as currency
- `valAxisMinVal`/`valAxisMaxVal`/`valAxisMajorUnit` control axis scale

---

### #10 — Add chart gridlines & plot area styling (P7)

**Description:** Add gridline and plot area options to chart YAML: `showGridlines`, `gridlineColor`, `plotAreaBorder`, `plotAreaFill`. Map to PptxGenJS `catGridLine`, `valGridLine`, `plotArea`, `chartArea`.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**
- `bundled-skills/generate-presentation/scripts/generate.mjs` — extend chart options mapping

**Acceptance criteria:**
- `gridlineColor: DDDDDD` changes gridline color
- `plotAreaFill: F8F8F8` adds background to plot area
- Gridlines can be hidden with `showGridlines: false`

---

### #11 — Add preset shape library (P9, P12, P13, P14)

**Description:** Implement `renderShape(slide, directive, theme, pptx)` function. Parse `<!-- shape: type x y w h [options] -->` HTML comments in `parseMarkdown()`. Support a curated subset of 17 shape types: `rect`, `roundRect`, `ellipse`, `triangle`, `diamond`, `pentagon`, `hexagon`, `star5`, `rightArrow`, `leftArrow`, `upArrow`, `downArrow`, `chevron`, `heart`, `lightningBolt`, `cloud`, `gear6`.

Options parsed from the comment: `fill=COLOR`, `line=COLOR`, `lineW=PT`, `text="..."`, `rotate=DEGREES`, `flipH`, `flipV`, `dash=STYLE`, `link=URL`, `link=#slide-N`.

Includes P12 (dash styles), P13 (rotation/flip), P14 (hyperlinks) since they're all shape options.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**
- `bundled-skills/generate-presentation/scripts/generate.mjs` — new `renderShape()`, comment parsing in `parseMarkdown()`
- `bundled-skills/generate-presentation/SKILL.md` — document shape syntax with all options

**Acceptance criteria:**
- `<!-- shape: rightArrow 2 3 3 1 fill=accent1 text="Next" -->` renders an arrow shape
- All 17 shape types render correctly
- `dash=dash` produces dashed outline
- `rotate=45` rotates shape 45 degrees
- `link=https://example.com` makes shape clickable

---

### #12 — Add shape gradient fills (P10)

**Description:** Support gradient fill syntax in shape directives: `fill=gradient(COLOR1,COLOR2,ANGLE)`. Map to PptxGenJS `fill: { colorGrad: [{ color, position }, ...], gradType: 'linear', gradAngle: ANGLE }`.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #11 **Files:**
- `bundled-skills/generate-presentation/scripts/generate.mjs` — extend shape fill parsing in `renderShape()`

**Acceptance criteria:**
- `fill=gradient(333333,666666,90)` produces smooth vertical gradient
- Default angle is 0 (left to right) when omitted
- Non-gradient fills still work

---

### #13 — Add arrow connectors (P11)

**Description:** Parse `<!-- arrow: x1 y1 x2 y2 [options] -->` HTML comments. Render as `addShape(pptx.ShapeType.line, { x, y, w, h, line: { ... } })`. Calculate position/size from start/end coordinates. Options: `head=STYLE`, `tail=STYLE`, `dash=STYLE`, `color=COLOR`, `width=PT`.

Arrow types: `triangle`, `stealth`, `diamond`, `oval`, `arrow`, `none`.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #11 (shares comment parsing pattern) **Files:**
- `bundled-skills/generate-presentation/scripts/generate.mjs` — arrow comment parsing, line rendering

**Acceptance criteria:**
- `<!-- arrow: 2 3 8 3 head=triangle -->` renders horizontal arrow
- `tail=none` removes tail arrowhead
- `dash=dash` produces dashed line

---

### #14 — Add unit tests for tiers B & C (#7-#13)

**Description:** Add tests for: highlight regex parsing, double underline parsing, axis title chart options, gridline options, shape directive parsing (all 17 types), gradient fill parsing, arrow directive parsing. Follow existing patterns.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #7-#13 **Files:**
- `bundled-skills/generate-presentation/scripts/generate.test.mjs`

**Acceptance criteria:**
- `==text==` parsed to highlight run
- `++text++` parsed to double underline run
- Shape comment directive parsed into correct type, position, and options
- Arrow comment parsed into line with arrowhead options
- Gradient fill `gradient(A,B,90)` parsed to correct `colorGrad` array
- All existing tests still pass

---

### #15 — Add image rotation, flip & transparency (P15, P16)

**Description:** Parse image title attributes for rotation, flip, and transparency: `![alt](path "rotate=90 flipH opacity=50")`. Apply to `addImage()` options: `rotate`, `flipH`, `flipV`, `transparency`.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**
- `bundled-skills/generate-presentation/scripts/generate.mjs` — extend image rendering
- `bundled-skills/generate-presentation/SKILL.md` — document image options

**Acceptance criteria:**
- `![](img.png "rotate=90")` rotates image 90 degrees
- `![](img.png "flipH")` flips image horizontally
- `![](img.png "opacity=50")` makes image 50% transparent

---

### #16 — Add image base64 and hyperlinks (P17, P18)

**Description:** Support `data:image/png;base64,...` URIs in image paths. Detect and pass as `{ data: "image/png;base64,..." }` instead of `{ path }`. Also support `![alt](path "link=https://example.com")` for clickable images.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**
- `bundled-skills/generate-presentation/scripts/generate.mjs` — extend image path handling, add hyperlink option

**Acceptance criteria:**
- `![](data:image/png;base64,iVBOR...)` embeds base64 image
- `![](img.png "link=https://example.com")` makes image clickable
- Regular path-based images still work

---

### #17 — Add table row heights and rowspan (P19, P20)

**Description:** Parse `<!-- rowH: 0.5, 0.3, 0.3 -->` comment before tables to set explicit row heights via `rowH` option. Detect `^^` cell content as rowspan marker — cell merges with the cell above. Set `rowspan` on the spanning cell and emit empty placeholder for merged cells.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**
- `bundled-skills/generate-presentation/scripts/generate.mjs` — table comment parsing, rowspan detection
- `bundled-skills/generate-presentation/SKILL.md` — document rowH and rowspan syntax

**Acceptance criteria:**
- `<!-- rowH: 0.5, 0.3, 0.3 -->` sets per-row heights
- `^^` cell merges vertically with cell above
- Rowspan works alongside existing `||` colspan
- Regular tables without these features unchanged

---

### #18 — Add auto-page start Y (P21)

**Description:** Add `autoPageSlideStartY` option to table rendering, defaulting to `CONTENT_Y_BASE` (1.9"). Parse from `<!-- autoPageStartY: 1.5 -->` comment before tables.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**
- `bundled-skills/generate-presentation/scripts/generate.mjs` — add `autoPageSlideStartY` to table options

**Acceptance criteria:**
- Continuation slides from auto-page start content at the specified Y position
- Default matches `CONTENT_Y_BASE` when not specified

---

### #19 — Add unit tests for tiers D (#15-#18)

**Description:** Add tests for: image title attribute parsing (rotate, flip, opacity, link), base64 image path detection, table rowH comment parsing, rowspan `^^` marker detection, autoPageStartY parsing.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #15-#18 **Files:**
- `bundled-skills/generate-presentation/scripts/generate.test.mjs`

**Acceptance criteria:**
- Image title `"rotate=90 flipH opacity=50"` parsed into correct options object
- `data:image/png;base64,...` detected as base64 (not file path)
- `^^` cells produce correct rowspan values
- `<!-- rowH: 0.5, 0.3 -->` parsed to `[0.5, 0.3]` array
- All existing tests still pass

---

### #20 — Add slide sections, hidden slides, and custom layout (P22, P23, P26)

**Description:** Parse three HTML comment directives:
1. `<!-- section: Name -->` → `pptx.addSection({ title: "Name" })` before the next slide
2. `<!-- hidden -->` → `slide.hidden = true` on the current slide
3. `<!-- layout: W H -->` → `pptx.defineLayout({ name: 'CUSTOM', width: W, height: H })` at document level

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**
- `bundled-skills/generate-presentation/scripts/generate.mjs` — comment parsing in `parseMarkdown()`, slide rendering
- `bundled-skills/generate-presentation/SKILL.md` — document all three directives

**Acceptance criteria:**
- Sections appear in PowerPoint's slide sorter navigation pane
- Hidden slides skipped during slideshow but visible in editor
- `<!-- layout: 10 7.5 -->` produces non-standard slide dimensions
- All features work across all three styles

---

### #21 — Update SKILL.md with all new features

**Description:** Comprehensive update to `SKILL.md` documenting all new syntax added in P1-P26. Add sections for: text formatting (highlight, underline styles, spacing), chart enhancements (data labels, axis titles, gridlines, bar3d), shapes (preset library, gradients, arrows, dash styles), image options (rotation, flip, transparency, base64, hyperlinks), table enhancements (row heights, rowspan, auto-page Y), and slide directives (sections, hidden, custom layout).

Include examples for each feature that agents can reference when generating presentations.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on all prior tasks **Files:**
- `bundled-skills/generate-presentation/SKILL.md`

**Acceptance criteria:**
- Every new markdown syntax documented with at least one example
- Chart YAML options table includes all new fields
- Shape directive syntax fully documented with all 17 types and all options
- Arrow directive documented with all arrow types
- Image title attribute syntax documented
- Table comment directives documented

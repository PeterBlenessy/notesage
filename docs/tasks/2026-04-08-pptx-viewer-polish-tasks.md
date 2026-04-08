# PPTX Viewer Polish — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-04-08 |
| **Status** | Complete |
| **PRD** | [pptx-viewer-polish](../prds/2026-04-08-pptx-viewer-polish.md) |
| **Research** | [pptx-viewer-quality](../research/2026-04-07-pptx-viewer-quality.md) |
| **Total** | 23 tasks: 12S, 8M, 3L |
| **Suggested order** | Text polish (#1-#5) → Paragraphs (#6-#8) → Charts (#9-#11) → Shapes (#12-#14) → Tables (#15-#17) → Images (#18-#20) → Other (#21-#23) |

**Risks:**

- VP9 (pattern fills) requires defining \~48 SVG patterns. Start with the 10 most common and use solid foreground fallback for the rest.
- VP12 (table style resolution) is L complexity — theme table style IDs must be resolved against `a:tblStyleLst` which can be in theme XML or a separate `tableStyles.xml` file.
- VP17 (trendlines) requires computing regression lines (linear, polynomial) from data points — needs a math utility or simple least-squares implementation.
- VP7 (default run properties) interacts with master/layout inheritance — test carefully against the existing V2 master/layout pipeline.

**Feature Progress:**

| Feature | Tier | Tasks | Status |
| --- | --- | --- | --- |
| VP1 — Underline styles | A | #1 | Done |
| VP2 — All caps / small caps | A | #2 | Done |
| VP3 — CJK / complex script fonts | B | #6 | Done |
| VP4 — Text highlight | A | #3 | Done |
| VP5 — Kerning | A | #4 | Done |
| VP6 — Bullet font/color/size | B | #7 | Done |
| VP7 — Default run properties | B | #8 | Done |
| VP8 — Tab stops | B | #5 | Done |
| VP9 — Pattern fills | D | #12 | Done |
| VP10 — Picture fill on shapes | D | #13 | Done |
| VP11 — Glow and soft edge | D | #14 | Done |
| VP12 — Table style resolution | E | #15 | Done |
| VP13 — Banded rows/columns | E | #16 | Done |
| VP14 — Cell gradient fill | E | #17 | Done |
| VP15 — Radar/bubble charts | C | #9 | Done |
| VP16 — Chart data labels | C | #10 | Done |
| VP17 — Secondary axes/trendlines | C | #11 | Done |
| VP18 — Image transparency | F | #18 | Done |
| VP19 — Image effects | F | #19 | Done |
| VP20 — Linked images | F | #20 | Done |
| VP21 — Slide headers/footers | G | #21 | Done |
| VP22 — Comments rendering | G | #22 | Done |
| VP23 — Sections in navigation | G | #23 | Done |

---

### #1 — Add underline style parsing and rendering (VP1) ✅

**Description:** Parse the full `rPr@u` attribute value in `pptx-parser.ts` (currently only checks for presence). Map OOXML underline types to CSS: `sng` → `underline`, `dbl` → `border-bottom: 3px double`, `heavy` → `text-decoration-thickness: 2px`, `dotted`/`dash`/`wavy` → corresponding `text-decoration-style`. Also parse underline color from `a:uFill > a:solidFill`. Add `underlineStyle` and `underlineColor` to `PptxTextRun` in `pptx-types.ts`.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-types.ts` — add `underlineStyle?: string`, `underlineColor?: string` to `PptxTextRun`
- `src/lib/pptx-parser.ts` — parse `u` attribute values and `a:uFill`
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — map underline styles to CSS

**Acceptance criteria:**

- Single, double, dotted, dashed, wavy underlines render distinctly
- Colored underlines display the authored color
- Unrecognized underline types fall back to single underline

---

### #2 — Add all-caps and small-caps rendering (VP2) ✅

**Description:** The `caps` field already exists on `PptxTextRun` (added in v2) and is parsed. Verify it's rendered in `PptxSlideRenderer.tsx`: `all` → `text-transform: uppercase`, `small` → `font-variant: small-caps`. If rendering is missing, add it.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/components/editor/viewers/PptxSlideRenderer.tsx` — add CSS for `caps` field

**Acceptance criteria:**

- `cap="all"` text renders in uppercase
- `cap="small"` text renders in small caps
- Mixed caps and non-caps runs on the same line render correctly

---

### #3 — Add text highlight rendering (VP4) ✅

**Description:** Parse run-level highlight from `a:rPr > a:highlight` or `a:rPr > a:solidFill` (when used as text background). Add `highlight?: string` (hex color) to `PptxTextRun`. Render as `background-color` on the text span.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-types.ts` — add `highlight?: string` to `PptxTextRun`
- `src/lib/pptx-parser.ts` — parse highlight fill from run properties
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — apply background-color

**Acceptance criteria:**

- Highlighted text shows colored background
- Multiple highlight colors on the same paragraph work
- Highlight respects theme colors if using `schemeClr`

---

### #4 — Add kerning support (VP5) ✅

**Description:** Parse `rPr@kern` attribute (minimum font size in hundredths of a point for automatic kerning). When present and font size exceeds the threshold, apply CSS `font-kerning: normal` on the text span. Add `kern?: number` to `PptxTextRun`.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-types.ts` — add `kern?: number` to `PptxTextRun`
- `src/lib/pptx-parser.ts` — parse `kern` attribute
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — apply font-kerning CSS

**Acceptance criteria:**

- Kerning-enabled text has `font-kerning: normal`
- No visual change when kern threshold exceeds font size

---

### #5 — Add tab stop support (VP8) ✅

**Description:** Parse `a:tabLst > a:tab` elements with `pos` (EMU position) and `algn` (left/center/right/decimal). Convert tab characters in text runs to positioned `<span>` elements with `margin-left` calculated from the tab stop position. Add `tabStops?: { pos: number; align: string }[]` to `PptxParagraph`.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-types.ts` — add `tabStops` to `PptxParagraph`
- `src/lib/pptx-parser.ts` — parse `a:tabLst`
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — render tab characters as positioned spans

**Acceptance criteria:**

- Tab characters align to defined tab stop positions
- Left, center, and right alignment types work
- Missing tab stops fall back to default spacing

---

### #6 — Add CJK and complex script font resolution (VP3) ✅

**Description:** Parse `a:ea` (East Asian) and `a:cs` (Complex Script) font elements from run properties. Build a CSS `font-family` fallback chain: `latin, ea, cs, sans-serif`. Add `eaFont?: string` and `csFont?: string` to `PptxTextRun`.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-types.ts` — add `eaFont?: string`, `csFont?: string` to `PptxTextRun`
- `src/lib/pptx-parser.ts` — parse `a:ea` and `a:cs` typeface attributes
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — build font-family chain

**Acceptance criteria:**

- CJK text renders with the specified East Asian font
- Font fallback chain degrades gracefully when fonts are unavailable
- Theme font refs (`+mj-ea`, `+mn-ea`) resolve from theme

---

### #7 — Add bullet font, color, and size overrides (VP6) ✅

**Description:** Parse `a:buFont` (typeface), `a:buClr` (color via `srgbClr` or `schemeClr`), and `a:buSzPct` (percentage of text size) from paragraph properties. The `bulletFont`, `bulletColor`, and `bulletSizePercent` fields already exist on `PptxParagraph` from v2. Ensure they're parsed and rendered: apply font/color/size to the bullet character `<span>` separately from the text run styling.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — parse `a:buFont`, `a:buClr`, `a:buSzPct`
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — apply bullet-specific styling

**Acceptance criteria:**

- Bullet characters use the specified font (e.g., Wingdings)
- Bullet color differs from text color when specified
- Bullet size scales correctly relative to text size

---

### #8 — Add default run property resolution (VP7) ✅

**Description:** Parse `a:defRPr` from `a:pPr` (paragraph properties). These define default font, size, color, and style for runs that don't specify their own. When a run's properties are empty, merge from the paragraph's `defRPr`. Fall back to layout/master `defRPr` when slide-level is absent (via the existing placeholder inheritance pipeline).

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — parse `a:defRPr`, merge into run properties during `parseTextBody()`
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — no change (runs already use merged properties)

**Acceptance criteria:**

- Text with empty `a:rPr` inherits font/size/color from `a:defRPr`
- Explicit run properties override defaults
- Master/layout defaults cascade correctly through placeholder inheritance

---

### #9 — Add radar and bubble chart rendering (VP15) ✅

**Description:** Add `c:radarChart` and `c:bubbleChart` parsing in `pptx-parser.ts`. The `chartType` enum already includes `"radar"` and `"bubble"` from v2. Add recharts rendering in `PptxChartRenderer.tsx`:

- Radar: `<RadarChart>` + `<PolarGrid>` + `<PolarAngleAxis>` + `<Radar>`
- Bubble: `<ScatterChart>` + `<Scatter>` with `<ZAxis>` for bubble size

Parse radar categories from `c:cat`, values from `c:val`. Parse bubble X/Y/size from `c:xVal`, `c:yVal`, `c:bubbleSize`.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — parse `c:radarChart`, `c:bubbleChart`
- `src/components/editor/viewers/PptxChartRenderer.tsx` — add RadarChart and BubbleChart components

**Acceptance criteria:**

- Radar chart renders with polar grid and category labels
- Bubble chart renders with sized circles at correct positions
- Multiple series work for both chart types
- Chart colors match theme palette

---

### #10 — Add chart data label rendering (VP16) ✅

**Description:** Parse `c:dLbls` from chart XML. Extract `showVal`, `showCatName`, `showSerName`, `showPercent`, and `dLblPos` (position: t/b/l/r/ctr/outEnd/inEnd/inBase). The `showDataLabels` and `dataLabelType` fields already exist on `PptxChart` from v2. Render using recharts `<LabelList>` component on each series.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — parse `c:dLbls` child elements
- `src/lib/pptx-types.ts` — add `dataLabelPosition?: string` to `PptxChart`
- `src/components/editor/viewers/PptxChartRenderer.tsx` — add `<LabelList>` to chart series

**Acceptance criteria:**

- Data values display on bar/line/area chart data points
- Percentage labels display on pie/doughnut slices
- Label position (top, center, outside end) is respected
- Labels don't overlap or obscure the chart

---

### #11 — Add chart secondary axes and trendlines (VP17) ✅

**Description:** Parse secondary `c:valAx` (identified by different `axId` than the primary). Render as recharts `<YAxis yAxisId="right" orientation="right" />` with series assigned to the secondary axis.

Parse `c:trendline` on series: extract type (`linear`, `exponential`, `polynomial`), order (for polynomial), and forward/backward extrapolation. Compute trendline points using least-squares regression and render as an overlay `<Line>` series.

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #10 **Files:**

- `src/lib/pptx-parser.ts` — parse secondary axes, trendline elements
- `src/lib/pptx-types.ts` — add `secondaryAxis?: {...}` and `trendlines?: {...}[]` to `PptxChart`
- `src/components/editor/viewers/PptxChartRenderer.tsx` — dual Y axis rendering, trendline overlay

**Acceptance criteria:**

- Secondary Y axis renders on the right side
- Series assigned to secondary axis scale independently
- Linear trendline renders as a straight line through data points
- Trendline extends forward/backward when extrapolation is specified

---

### #12 — Add pattern fill support (VP9) ✅

**Description:** Parse `a:pattFill` with `prst` (pattern preset name), `a:fgClr`, and `a:bgClr`. Create `src/lib/pptx-patterns.ts` with CSS background generators for the 10 most common patterns:

- `horz`, `vert`, `dnDiag`, `upDiag` → `repeating-linear-gradient`
- `dkHorz`, `dkVert`, `dkDnDiag`, `dkUpDiag` → thicker `repeating-linear-gradient`
- `ltHorz`, `ltVert` → thinner `repeating-linear-gradient`

Remaining \~38 patterns fall back to solid foreground color. Extend `PptxFill` union with a richer `pattern` variant.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-types.ts` — extend pattern fill type with `preset`, `foreground`, `background`
- `src/lib/pptx-parser.ts` — parse `a:pattFill`
- `src/lib/pptx-patterns.ts` — new file with pattern CSS generators
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — apply pattern CSS background

**Acceptance criteria:**

- Horizontal/vertical/diagonal patterns render as repeating stripes
- Foreground and background colors are respected
- Unknown patterns fall back to solid foreground fill
- Patterns work on shapes, backgrounds, and table cells

---

### #13 — Add picture fill on shapes (VP10) ✅

**Description:** Parse `a:blipFill` inside shape/textbox properties (currently only parsed for standalone images). Extract the relationship ID, resolve to image data from the ZIP, and apply as CSS `background-image` on the shape div. Respect `a:stretch` (stretch fill), `a:tile` (tiled fill), and `a:srcRect` (source crop).

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — detect `a:blipFill` in shape properties, resolve image data
- `src/lib/pptx-types.ts` — add `pictureFill` variant to `PptxFill` union
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — render as CSS background-image

**Acceptance criteria:**

- Shapes with picture fill display the image
- Stretch mode scales image to fill the shape
- Tile mode repeats the image
- Source crop clips the image before applying

---

### #14 — Add glow and soft edge effects (VP11) ✅

**Description:** Parse `a:glow` (radius, color, alpha) and `a:softEdge` (radius) from `a:effectLst` on shapes. Add `glow?: { radius: number; color: string; alpha: number }` and `softEdge?: number` to `PptxShape`. Render as:

- Glow: CSS `box-shadow: 0 0 <radius>px <color>` with alpha
- Soft edge: CSS `filter: blur(<radius>px)` applied to a clipping container

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-types.ts` — add `glow`, `softEdge` to `PptxShape`
- `src/lib/pptx-parser.ts` — parse from `a:effectLst`
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — CSS box-shadow and filter

**Acceptance criteria:**

- Shapes with glow have visible colored halo
- Shapes with soft edge have blurred borders
- Effects combine correctly with existing shadow rendering

---

### #15 — Add table style resolution (VP12) ✅

**Description:** Parse `tbl@tblStyle` attribute (style ID GUID). Resolve against `a:tblStyleLst` in the theme XML (or `ppt/tableStyles.xml`). Extract styling for `wholeTbl`, `band1H`, `band2H`, `firstRow`, `lastRow`, `firstCol`, `lastCol`. Each style part defines fill, border, and text formatting. Apply as default cell styles, overridden by explicit `tcPr` properties.

**Complexity:** L **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — parse `tblStyle`, resolve from theme, extract parts
- `src/lib/pptx-types.ts` — add `PptxTableStyle` interface, `style?: PptxTableStyle` to `PptxTable`
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — apply style cascade

**Acceptance criteria:**

- Tables with theme styles render with correct fills and borders
- First/last row/column formatting applies when present
- Explicit cell-level properties override theme style defaults
- Tables without a style ID render unchanged (no regression)

---

### #16 — Add banded rows and columns (VP13) ✅

**Description:** Parse `a:tblPr@bandRow` and `a:tblPr@bandCol` attributes. When banding is enabled and a table style is resolved (from #15), apply alternating styles from `band1H`/`band2H` (horizontal) or `band1V`/`band2V` (vertical). If no resolved style exists, apply a generic alternating fill using theme `lt2` color.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #15 **Files:**

- `src/lib/pptx-parser.ts` — parse `bandRow`, `bandCol` attributes
- `src/lib/pptx-types.ts` — add `bandRow?: boolean`, `bandCol?: boolean` to `PptxTable`
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — apply alternating styles

**Acceptance criteria:**

- Alternating row colors visible on banded tables
- Column banding alternates by column
- Banding does not override explicit cell fills

---

### #17 — Add cell gradient fill (VP14) ✅

**Description:** Parse `a:gradFill` inside `a:tcPr` (table cell properties). Reuse the existing gradient parsing logic from shape fills. Add gradient fill option to `PptxTableCell`. Render as CSS gradient on the cell.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — detect gradient fill in cell properties
- `src/lib/pptx-types.ts` — change `fill` on `PptxTableCell` from `string | null` to `PptxFill | string | null`
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — render gradient on cells

**Acceptance criteria:**

- Cells with gradient fill display CSS linear/radial gradient
- Solid fill cells continue to work unchanged
- Gradient direction matches authored angle

---

### #18 — Add image transparency support (VP18) ✅

**Description:** The `opacity` field already exists on `PptxImage` from v2 and `alphaModFix` is already parsed. Verify rendering in `PptxSlideRenderer.tsx`: apply CSS `opacity: <value>` on the image element. If the rendering is missing, add it.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/components/editor/viewers/PptxSlideRenderer.tsx` — apply opacity CSS

**Acceptance criteria:**

- Images with `alphaModFix` render with reduced opacity
- Full opacity (100000) renders normally
- Transparency combines correctly with image crop

---

### #19 — Add image effects (shadow, reflection) (VP19) ✅

**Description:** Parse `a:effectLst` on image shapes. The `shadow` field already exists on `PptxImage` from v2. Verify shadow is rendered on images (it may only be applied to shapes currently). Add reflection support as a CSS approximation: flipped, faded duplicate positioned below the image using CSS `transform: scaleY(-1)` with `mask-image: linear-gradient(transparent, black)`.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — ensure shadow parsed for images (may already work)
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — add shadow CSS to image elements, add reflection rendering

**Acceptance criteria:**

- Images with outer shadow have visible drop shadow
- Reflection appears as a faded mirror below the image
- Effects don't break image crop or positioning

---

### #20 — Add linked (external) image support (VP20) ✅

**Description:** Parse `r:link` (as opposed to `r:embed`) in image relationship entries. These reference external URLs instead of embedded ZIP data. Detect in `pptx-parser.ts` and set `dataUrl` to the external URL. Render as `<img src="url">` with an error fallback placeholder (grey box with "External image" text) for unreachable URLs.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — detect `r:link` vs `r:embed` in relationships
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — add `onError` fallback for external images

**Acceptance criteria:**

- External image URLs render when reachable
- Unreachable URLs show a fallback placeholder (not a broken image icon)
- Embedded images continue to work unchanged

---

### #21 — Add slide header and footer rendering (VP21) ✅

**Description:** The `headerFooter` field already exists on `PptxSlide` from v2 with `showDate`, `showFooter`, `showSlideNum` flags. Parse the actual text content: `dt` (date format or fixed text), `ftr` (footer text) from slide or master. Render positioned at the bottom of the slide in standard locations: date (left), footer (center), slide number (right).

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — parse footer text, date format from slide/master `p:hf`
- `src/lib/pptx-types.ts` — add `dateText?: string`, `footerText?: string` to `headerFooter`
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — render header/footer elements

**Acceptance criteria:**

- Footer text displays at the bottom of slides when authored
- Slide numbers auto-populate from slide index
- Date renders in the specified format
- Header/footer elements respect visibility flags

---

### #22 — Add comments rendering (VP22) ✅

**Description:** Parse `p:cmLst` from the comments XML part (e.g., `ppt/comments/comment1.xml` referenced from slide relationships). Extract author index, date, text, and anchor position. Display as a toggleable overlay: comment marker icons on the slide at anchor positions, with a side panel showing full comment text, author, and date.

**Complexity:** L **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — parse comments XML, resolve author names from `commentAuthors.xml`
- `src/lib/pptx-types.ts` — add `PptxComment` interface, `comments?: PptxComment[]` to `PptxSlide`
- `src/components/editor/viewers/PptxViewer.tsx` — add comment toggle button
- `src/components/editor/viewers/PptxCommentOverlay.tsx` — new component for comment markers and panel

**Acceptance criteria:**

- Comment markers appear at authored positions on the slide
- Clicking a marker shows the comment text, author, and date
- Toggle button in toolbar shows/hides all comment markers
- Slides without comments show no markers

---

### #23 — Add sections in navigation (VP23) ✅

**Description:** Parse `p:sectionLst` from `presentation.xml`. Each section has a name and a list of slide IDs. Display section names as labels in the slide counter/navigation area. Allow clicking a section name to jump to its first slide.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — parse `p:sectionLst` from presentation XML
- `src/lib/pptx-types.ts` — add `sections?: { name: string; startSlide: number }[]` to `PptxPresentation`
- `src/components/editor/viewers/PptxViewer.tsx` — display section names in navigation, jump-to-section

**Acceptance criteria:**

- Section names appear in the slide navigation area
- Clicking a section name jumps to its first slide
- Current section is indicated visually
- Presentations without sections show no change
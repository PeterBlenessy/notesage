# PPTX Viewer Quality v2 — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-04-07 |
| **Status** | Complete |
| **PRD** | [pptx-viewer-v2](../prds/2026-04-07-pptx-viewer-v2.md) |
| **Research** | [pptx-viewer-quality](../research/2026-04-07-pptx-viewer-quality.md) |
| **Total** | 21 tasks: 10S, 8M, 3L |
| **Suggested order** | Color (V1: #1-#2) → Body props (V3: #3) → Spacing (V4: #4) → Tier 2 quick wins (#5-#10) → Master/layout (V2: #11-#13) → Charts (V7: #14) → Shadows (V8: #15) → Image crop (V9: #16) → Tier 3 (#17-#21) |

**Risks:**

- V2 (master/layout inheritance) is the largest and riskiest task — it changes the parsing pipeline fundamentally. Do V1 and V3 first to establish confidence.
- V11 (preset geometries) requires \~30 SVG path definitions. Use the OOXML spec or open-source references (LibreOffice `oox/source/drawingml/customshapes/` has all paths).
- Chart label rendering (V7) may require updating recharts or using custom positioned `<div>` elements if recharts' built-in label components don't match OOXML formatting.

**Feature Progress:**

| Feature | Tier | Tasks | Status |
| --- | --- | --- | --- |
| V1 — Color transforms | 1 | #1-#2 | Complete |
| V2 — Master/layout inheritance | 1 | #11-#13 | Complete |
| V3 — Body properties | 1 | #3 | Complete |
| V4 — Line/paragraph spacing | 2 | #4 | Complete |
| V5 — Auto-numbered bullets | 2 | #5 | Complete |
| V6 — Table cell borders/margins | 2 | #6 | Complete |
| V7 — Chart titles/legends/axes | 2 | #14 | Complete |
| V8 — Shape shadow | 2 | #15 | Complete |
| V9 — Image crop | 2 | #16 | Complete |
| V10 — Hyperlinks | 2 | #7 | Complete |
| V11 — Preset geometries | 3 | #17-#18 | Complete |
| V12 — Strikethrough/super/sub | 3 | #8 | Complete |
| V13 — Flip transforms | 3 | #9 | Complete |
| V14 — Dash styles | 3 | #10 | Complete |
| V15 — Radar/bubble charts | 3 | #19 | Complete |
| V1-V15 tests | \- | #20-#21 | Complete |

---

### #1 — Implement color transform pipeline (V1) ✅

**Description:** Create `applyColorTransforms()` in `pptx-parser.ts` that takes a base hex color and a list of OOXML transform elements, converts to HSL, applies transforms in spec order (hue → saturation → luminance → tint/shade → alpha), and returns the result.

Transforms to implement:

- `lumMod` / `lumOff` — L_new = L \* lumMod + lumOff
- `tint` — mix toward white by percentage
- `shade` — mix toward black by percentage
- `satMod` / `satOff` — saturation multiply/offset
- `hueMod` / `hueOff` — hue rotate/offset
- `alpha` — opacity (return as separate value)

Include hex→HSL→hex conversion helpers.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — new `applyColorTransforms()`, `hexToHsl()`, `hslToHex()` functions

**Acceptance criteria:**

- `lumMod=40000, lumOff=60000` on a dark color produces a light variant
- `tint=50000` on accent1 produces a 50% lighter version
- `shade=75000` on accent1 produces a 25% darker version
- `alpha=50000` returns opacity 0.5

---

### #2 — Integrate color transforms into all resolve paths (V1) ✅

**Description:** Update `resolveColor()` and all call sites in `pptx-parser.ts` to pass child transform elements through `applyColorTransforms()`. This affects: solid fills, gradient stops, line colors, font colors, table cell fills, chart series colors.

Currently `resolveColor()` at line \~471-500 has a stub comment. Replace the stub with the real pipeline.

Add `alpha?: number` to color-bearing types in `pptx-types.ts`. Apply alpha as CSS `opacity` or `rgba()` in the renderer.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #1 **Files:**

- `src/lib/pptx-parser.ts` — update `resolveColor()`, `parseFill()`, `parseTextRuns()`
- `src/lib/pptx-types.ts` — add `alpha` to fill/color types
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — apply alpha in rendering

**Acceptance criteria:**

- Theme-based presentations render correct shades (compare against PowerPoint screenshot)
- Gradient stops with color transforms produce correct intermediate colors
- Table cell fills with scheme colors + transforms render correctly

---

### #3 — Parse and render body properties (V3) ✅

**Description:** Parse `bodyPr` attributes from text-bearing elements and apply as CSS.

Parse:

- `anchor` → vertical alignment (t/ctr/b)
- `lIns/tIns/rIns/bIns` → internal margins (EMU → px)
- `normAutofit@fontScale` → text shrink factor
- `spAutoFit` → overflow visible
- `wrap` → nowrap when `"none"`

Render:

- `anchor` → `display: flex; flex-direction: column; justify-content` (start/center/end)
- Margins → CSS `padding`
- `fontScale` → multiply all font sizes in the container
- `spAutoFit` → `overflow: visible`

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — parse `bodyPr` into new `BodyProperties` type
- `src/lib/pptx-types.ts` — add `BodyProperties` interface, add `bodyProps` to text containers
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — apply body property CSS

**Acceptance criteria:**

- Text with `anchor="ctr"` is vertically centered
- Text with `normAutofit fontScale="75000"` renders at 75% font size
- Internal margins create visible padding inside text boxes

---

### #4 — Parse and render line/paragraph spacing (V4) ✅

**Description:** Parse `lnSpc`, `spcBef`, `spcAft`, `indent`, `marL` from paragraph properties. Render as CSS line-height, margin-top/bottom, text-indent, padding-left.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — parse paragraph spacing into `PptxParagraph`
- `src/lib/pptx-types.ts` — add spacing fields
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — apply spacing CSS

**Acceptance criteria:**

- 150% line spacing is visibly more spaced than default
- Space before/after creates visible gaps between paragraphs
- Left margin (`marL`) indents paragraphs correctly

---

### #5 — Implement auto-numbered bullets (V5) ✅

**Description:** Replace the simplified bullet dot rendering for `buAutoNum` with actual numbered output. Parse `buAutoNum@type` and `@startAt`. Track per-level counters per slide. Map type to formatting: `arabicPeriod` → "1.", `alphaLcPeriod` → "a.", `romanUcPeriod` → "I.", etc.

Also parse and apply `buFont`, `buClr`, `buSzPct` to all bullet types.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — parse `buAutoNum` attributes
- `src/lib/pptx-types.ts` — add `bulletAutoNum` type
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — counter logic + formatting

**Acceptance criteria:**

- `arabicPeriod` renders 1. 2. 3.
- `alphaLcPeriod` renders a. b. c.
- `romanUcPeriod` renders I. II. III.
- Counter resets at level changes and non-numbered paragraphs

---

### #6 — Parse and render table cell borders and margins (V6) ✅

**Description:** Replace hardcoded `1px solid #d1d5db` borders with actual per-side border parsing from `tcPr`. Parse `lnL/lnR/lnT/lnB` (width, color, dash, noFill), `marL/marT/marR/marB` (margins), `anchor` (vertical alignment).

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — parse `tcPr` borders, margins, anchor
- `src/lib/pptx-types.ts` — add `borders`, `margins`, `verticalAlign` to `PptxTableCell`
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — apply per-cell border/margin/valign CSS

**Acceptance criteria:**

- Tables with thick colored borders render correctly
- Tables with no borders render without visible borders
- Cell margins from `marL/marT/marR/marB` replace hardcoded padding
- Cell `anchor="ctr"` vertically centers text

---

### #7 — Parse and render hyperlinks (V10) ✅

**Description:** Parse `a:hlinkClick` on text runs and shapes. Resolve `r:id` to target URL via slide `.rels` file. Render text hyperlinks as `<a>` tags. Handle internal slide links (`ppaction://hlinksldjump`).

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — parse `hlinkClick`, resolve relationships
- `src/lib/pptx-types.ts` — add `hyperlink?: string` to `PptxTextRun` and `PptxElement`
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — render `<a>` wrappers, handle slide navigation

**Acceptance criteria:**

- External URLs open in system browser via `target="_blank"`
- Internal slide links navigate to the target slide in the viewer
- Hyperlinked text has underline and scheme `hlink` color

---

### #8 — Parse and render strikethrough, superscript, subscript (V12) ✅

**Description:** Parse `rPr@strike` (sngStrike/dblStrike) and `rPr@baseline` (positive=super, negative=sub). Render as CSS text-decoration and `<sup>`/`<sub>` elements.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — parse `strike`, `baseline`
- `src/lib/pptx-types.ts` — add to `PptxTextRun`
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — render decorations

**Acceptance criteria:**

- Single strikethrough visible as line-through
- Double strikethrough visible as double line-through
- Superscript text raised and smaller
- Subscript text lowered and smaller

---

### #9 — Parse and render flip transforms (V13) ✅

**Description:** Parse `xfrm@flipH` and `xfrm@flipV`. Apply CSS `transform: scaleX(-1)` / `scaleY(-1)`, combined with existing rotation.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — parse flip attributes
- `src/lib/pptx-types.ts` — add `flipH`, `flipV` to element
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — combine flip with rotation in CSS transform

**Acceptance criteria:**

- Horizontally flipped arrow points opposite direction
- Flip combined with rotation produces correct orientation

---

### #10 — Parse and render dash styles on lines (V14) ✅

**Description:** Parse `a:prstDash@val` on `a:ln` elements. Map preset dash names to CSS `stroke-dasharray` (SVG) and `border-style` (shapes).

Map: `dot` → dotted, `dash` → dashed, `dashDot` → `4 3 1 3`, `lgDash` → `8 3`, etc.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — parse `prstDash`
- `src/lib/pptx-types.ts` — add `dashStyle` to line properties
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — apply dash CSS

**Acceptance criteria:**

- Dotted lines render as dots, not solid
- Dashed lines render as dashes
- DashDot pattern visible

---

### #11 — Parse slide masters and layouts (V2 — parsing) ✅

**Description:** During `parsePptx()`, read all `slideMasters/slideMasterN.xml` and `slideLayouts/slideLayoutN.xml` from the ZIP. Build a registry of masters and layouts keyed by relationship ID.

Parse from each:

- Shape tree (`p:cSld/p:spTree`) — reuse existing shape parsing
- Background (`p:cSld/p:bg`)
- Placeholder definitions (`p:ph@type`, `p:ph@idx`)
- Default text styles (`p:txStyles`)
- Relationships to resolve the master→layout→slide chain

**Complexity:** L **Category:** frontend **Dependencies:** None (but benefits from V1 being done first for correct master colors) **Files:**

- `src/lib/pptx-parser.ts` — new `parseSlideMaster()`, `parseSlideLayout()`, master/layout registry
- `src/lib/pptx-types.ts` — new `SlideMaster`, `SlideLayout`, `Placeholder` interfaces

**Acceptance criteria:**

- All masters and layouts are parsed without errors
- Registry correctly maps relationship IDs to parsed objects
- Placeholder types and indices are captured

---

### #12 — Implement master/layout inheritance merging (V2 — merging) ✅

**Description:** For each slide, resolve its layout (via `.rels`) and the layout's master. Merge shape trees: master shapes (bottom) + layout shapes (middle) + slide shapes (top). Inherit master background when slide has no explicit background.

For placeholder shapes on the slide that lack explicit `xfrm`, inherit position/size from the matching layout placeholder (matched by `ph@type` + `ph@idx`).

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #11 **Files:**

- `src/lib/pptx-parser.ts` — new `resolveInheritance()` function, update `parsePptx()` to call it
- `src/lib/pptx-types.ts` — add `masterShapes`, `layoutShapes` to `PptxSlide`

**Acceptance criteria:**

- Master slide logos appear on all slides
- Layout placeholder positions are inherited by slide content
- Master background visible when slide has no explicit background
- Shapes from master/layout rendered behind slide shapes

---

### #13 — Render inherited master/layout shapes (V2 — rendering) ✅

**Description:** Update `PptxSlideRenderer.tsx` to render master shapes, layout shapes, and slide shapes in the correct z-order. Handle placeholder visibility (dt/ftr/sldNum may be hidden by the slide).

Render master/layout text styles as fallback when slide text has no explicit formatting.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #12 **Files:**

- `src/components/editor/viewers/PptxSlideRenderer.tsx` — render merged shape layers
- `src/components/editor/viewers/PptxViewer.tsx` — may need to pass master/layout data to renderer

**Acceptance criteria:**

- Master decorative shapes (lines, logos) appear behind slide content
- Footer, date, slide number placeholders visible when not hidden
- Text without explicit formatting inherits from layout/master defaults

---

### #14 — Parse and render chart titles, legends, axes, data labels (V7) ✅

**Description:** Expand chart parsing to extract title, legend, axis labels, and data labels from chart XML. Render using recharts built-in components.

Parse: `c:title`, `c:legend` + `c:legendPos`, `c:catAx`/`c:valAx` (titles, labels, formatting, visibility), `c:dLbls` (show value/category/percentage).

Render:

- Title: `<div>` above chart
- Legend: recharts `<Legend>` with position mapping
- Axes: recharts `<XAxis label>`, `<YAxis label>`, number format
- Data labels: recharts `<LabelList>`

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — parse chart title, legend, axes, data labels
- `src/lib/pptx-types.ts` — expand `PptxChart`
- `src/components/editor/viewers/PptxChartRenderer.tsx` — add recharts components

**Acceptance criteria:**

- Chart title displayed above chart
- Legend with series names and colors at correct position
- Axis labels render with number formatting
- Data labels shown on data points when enabled

---

### #15 — Parse and render shape shadow (V8) ✅

**Description:** Parse `a:effectLst > a:outerShdw` from shape properties. Extract blur radius, distance, direction, color (with alpha). Convert to CSS `box-shadow`.

Direction in OOXML is in 60,000ths of a degree. Convert to x/y offsets: `x = dist * sin(dir)`, `y = dist * cos(dir)`.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #1 (color transforms for shadow color) **Files:**

- `src/lib/pptx-parser.ts` — parse `outerShdw`
- `src/lib/pptx-types.ts` — add `shadow?: Shadow` to `PptxElement`
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — apply `box-shadow` CSS

**Acceptance criteria:**

- Shapes with outer shadow have visible CSS box-shadow
- Shadow direction, blur, and color match the authored values
- Shadow alpha (opacity) applied correctly

---

### #16 — Parse and render image crop (V9) ✅

**Description:** Parse `a:srcRect` on `blipFill` (crop percentages from each edge: l, t, r, b in 1/1000ths). Render with CSS `clip-path: inset()` or `object-fit: cover` + `object-position`.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — parse `srcRect` into crop percentages
- `src/lib/pptx-types.ts` — add `crop?: { l, t, r, b }` to image elements
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — apply clip-path CSS

**Acceptance criteria:**

- Cropped images show only the visible region
- Crop percentages from all four edges applied correctly
- Non-cropped images unaffected

---

### #17 — Create preset geometry SVG path library (V11 — data) ✅

**Description:** Create `src/lib/pptx-preset-geometries.ts` with a lookup table mapping \~30 common DrawingML preset names to SVG `<path>` `d` attributes. The paths should be in a normalized 0-1 coordinate space (scaled to shape bounds at render time).

Priority shapes (most commonly seen in real presentations):

- Arrows: `rightArrow`, `leftArrow`, `upArrow`, `downArrow`, `chevron`, `notchedRightArrow`
- Stars: `star5`, `star6`
- Basic: `triangle`, `diamond`, `pentagon`, `hexagon`, `octagon`, `trapezoid`, `parallelogram`
- Callouts: `wedgeRectCallout`, `cloudCallout`
- Flowchart: `flowChartProcess`, `flowChartDecision`, `flowChartDocument`, `flowChartTerminator`, `flowChartConnector`
- Misc: `heart`, `cloud`, `lightningBolt`, `frame`, `can`

Reference: LibreOffice `oox/source/drawingml/customshapes/` or the OOXML spec (ECMA-376 Part 1 Section 20.1.10.55).

**Complexity:** L **Category:** frontend **Dependencies:** None **Files:**

- Create: `src/lib/pptx-preset-geometries.ts`

**Acceptance criteria:**

- At least 30 preset shapes defined with correct SVG paths
- Path data is in normalized 0-1 coordinate space
- Exported as a simple `Record<string, string>` lookup

---

### #18 — Render preset geometry shapes as SVG (V11 — rendering) ✅

**Description:** Update `PptxSlideRenderer.tsx` to render shapes with known preset geometries as `<svg>` elements instead of `<div>` rectangles. Scale the normalized path to the shape's bounding box. Apply fill, stroke, and effects to the SVG.

Fall back to rectangle for unmapped presets (current behavior).

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #17 **Files:**

- `src/components/editor/viewers/PptxSlideRenderer.tsx` — SVG rendering for shapes
- `src/lib/pptx-parser.ts` — pass preset name through to element data

**Acceptance criteria:**

- Arrow shapes render as arrows, not rectangles
- Star shapes render as stars
- Flowchart shapes have correct outlines
- Fill and stroke applied to SVG paths
- Unknown presets still render as rectangles

---

### #19 — Parse and render radar and bubble charts (V15) ✅

**Description:** Add radar and bubble chart support to the parser and renderer.

Radar: Parse `c:radarChart` with `c:radarStyle`, series categories and values. Render with recharts `<RadarChart>` + `<Radar>` + `<PolarGrid>` + `<PolarAngleAxis>`.

Bubble: Parse `c:bubbleChart` with `xVal`, `yVal`, `bubbleSize` per series. Render with recharts `<ScatterChart>` + `<Scatter>` + `<ZAxis>` for size.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — add `radarChart`, `bubbleChart` to chart type map, parse series data
- `src/lib/pptx-types.ts` — add chart type variants
- `src/components/editor/viewers/PptxChartRenderer.tsx` — new radar and bubble renderers

**Acceptance criteria:**

- Radar chart renders with polar grid and category labels
- Bubble chart renders with size-varying circles
- Series colors applied correctly

---

### #20 — Add unit tests for color transform pipeline ✅

**Description:** Write Vitest tests for `applyColorTransforms()`, `hexToHsl()`, `hslToHex()`. Test cases:

- Identity (no transforms) returns original color
- `lumMod` + `lumOff` produces expected lightened color
- `tint` and `shade` produce expected mixed colors
- `alpha` returns correct opacity value
- Multiple combined transforms in spec order
- Edge cases: 0% and 100% values, black/white base colors

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #1 **Files:**

- Create: `src/lib/__tests__/pptx-color-transforms.test.ts`

**Acceptance criteria:**

- At least 10 test cases covering all transform types
- Edge cases covered (0%, 100%, black, white)
- Tests pass

---

### #21 — Add unit tests for bullet numbering and spacing ✅

**Description:** Write Vitest tests for auto-numbered bullet formatting and spacing parsing. Test cases:

- `arabicPeriod` → "1.", "2.", "3."
- `alphaLcPeriod` → "a.", "b.", "c." (and wrapping at z)
- `romanUcPeriod` → "I.", "II.", "III."
- Counter reset on level change
- `startAt` offset
- Spacing percentage → CSS line-height conversion
- Spacing points → CSS value conversion
- EMU → pixel margin conversion

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #4, #5 **Files:**

- Create: `src/lib/__tests__/pptx-bullet-spacing.test.ts`

**Acceptance criteria:**

- All numbering formats produce correct output
- Counter logic handles resets
- Spacing conversions are accurate
- Tests pass
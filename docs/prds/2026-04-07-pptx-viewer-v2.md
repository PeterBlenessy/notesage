# PRD: PPTX Viewer Quality v2

|  |  |
| --- | --- |
| **Date** | 2026-04-07 |
| **Status** | Complete (all tiers) |
| **Priority** | High |
| **Impact** | PPTX viewer renders themed presentations with correct colors, text layout, tables, charts, and master slide elements — usable as a real preview tool |
| **Research** | [pptx-viewer-quality](../research/2026-04-07-pptx-viewer-quality.md) |
| **Tasks** | Linked per feature in status table below |

## Problem

The PPTX viewer currently covers \~28% of OOXML PresentationML/DrawingML features (46 fully supported, 19 partial, 98 unsupported out of 163 inventoried). The result is that most real-world presentations look broken:

1. **Colors are wrong.** Theme-based color transforms (`lumMod`, `lumOff`, `tint`, `shade`) are stubbed out. Every corporate deck that uses scheme colors with transforms renders with incorrect colors throughout.

2. **Slide masters and layouts are ignored.** Master slide logos, footers, decorative shapes, and background images are missing. Placeholder positioning from layouts is not applied, causing title/body content to appear in wrong locations.

3. **Text overflows and is mispositioned.** Body properties (auto-fit/shrink, vertical anchoring, internal margins) are not parsed. Text spills outside its container, sits at the top when it should be centered, and touches shape edges.

4. **Tables look generic.** Cell borders are hardcoded to 1px grey regardless of the authored styling. Cell margins, vertical alignment, and theme-driven table styles are missing.

5. **Charts lack context.** No titles, no legends, no axis labels, no data labels. Charts are colored shapes with no way to identify what they represent.

6. **Everything looks flat.** Shape shadows (`outerShdw`) are not rendered. No depth, no visual hierarchy.

7. **Basic features are missing.** Hyperlinks are not clickable. Numbered bullets render as dots. Line/paragraph spacing is wrong. Cropped images show the full uncropped source.

Research doc: `docs/research/2026-04-07-pptx-viewer-quality.md`

## Goals

- **G1:** Color transforms render correctly — scheme colors with `lumMod`/`lumOff`/`tint`/`shade`/`alpha` produce the correct output color on all themed presentations.
- **G2:** Slide master and layout inheritance works — master slide elements (logos, footers, shapes, backgrounds) appear on slides, and layout placeholders position content correctly.
- **G3:** Text containers respect body properties — auto-fit shrinks text to fit, vertical anchoring positions text correctly, and internal margins provide proper padding.
- **G4:** Tables render with authored cell borders, margins, and vertical alignment.
- **G5:** Charts display titles, legends, axis labels, and data labels.
- **G6:** Shape shadows provide visual depth.
- **G7:** Missing basic features are filled in: hyperlinks, numbered bullets, line/paragraph spacing, image cropping, strikethrough, super/subscript, flip transforms, dash styles.

## Non-Goals

- **Full animation engine** — slide transitions and build animations are XL effort for a static viewer. Not in scope.
- **SmartArt data model parsing** — XL effort, the fallback image approach is sufficient. Not in scope.
- **OLE embedded objects** — requires rendering arbitrary embedded content. Not in scope.
- **3D effects (rotation, bevel, perspective)** — CSS 3D transforms cannot faithfully reproduce DrawingML 3D. Not in scope.
- **Custom geometry paths** (`a:custGeom`) — L effort for a niche feature. Not in scope (preset geometries cover the common cases).
- **Full table style resolution** — resolving `a:tblStyle` references against theme `tblStyleLst` is L effort. We handle explicit cell-level styling only.
- **Video/audio playback** — media embedding is out of scope.
- **Ink annotations and math equations** — low priority, L effort each.
- **Pattern fills** — complex CSS pattern generation for 48 DrawingML patterns is not worth the effort.

## Technical Approach

### Tier 1 — Critical (V1-V3)

These cause visibly incorrect rendering on most corporate/themed presentations. Must be done first.

#### V1 — Color Transforms

**Problem:** `resolveSchemeColor()` in `pptx-parser.ts` resolves `a:schemeClr` to a hex value but ignores child transform elements. Colors like "accent1 with 40% luminance modifier and 60% luminance offset" (a common "light accent" pattern) render as the raw accent color.

**OOXML elements to parse:**

- `a:lumMod` — luminance modulation (multiply L channel, value in 1/1000ths, e.g., `val="40000"` = 40%)
- `a:lumOff` — luminance offset (add to L channel after modulation)
- `a:tint` — mix toward white (value in 1/1000ths)
- `a:shade` — mix toward black
- `a:alpha` — opacity (value in 1/1000ths)
- `a:satMod` — saturation modulation
- `a:satOff` — saturation offset
- `a:hueMod` — hue modulation
- `a:hueOff` — hue offset

**Rendering approach:**

- Convert hex color to HSL
- Apply transforms in OOXML-specified order: hue transforms, then saturation transforms, then luminance transforms, then tint/shade, then alpha
- `lumMod`/`lumOff`: `L_new = L * lumMod + lumOff` (both in 0-1 range after dividing by 100000)
- `tint`: mix the color toward white by the tint percentage
- `shade`: mix the color toward black by the shade percentage
- `alpha`: set CSS `opacity` or use `rgba()`
- Return the transformed hex color

**Apply everywhere colors are resolved:** solid fills, gradient stops, line colors, font colors, table cell fills, chart series colors. Every call site that resolves a `schemeClr` or `srgbClr` must pass through the transform pipeline.

**Key files:** `src/lib/pptx-parser.ts` (new `applyColorTransforms()` function, update `resolveColor()`), `src/lib/pptx-types.ts` (add `alpha?: number` to color-bearing types)

#### V2 — Slide Master/Layout Inheritance

**Problem:** Each slide in OOXML inherits from a slide layout, which inherits from a slide master. The current parser reads only `ppt/slides/slideN.xml` and ignores the inheritance chain. Master slide logos, footers, decorative shapes, and background images are missing. Layout placeholder positioning is not applied.

**OOXML elements to parse:**

- `slide.xml` → `p:sld/p:cSld/p:spTree` (slide-level shapes, already parsed)
- `slide.xml` → relationship to `slideLayoutN.xml` via `r:id` in `p:sld` attributes
- `slideLayoutN.xml` → `p:cSld/p:spTree` (layout shapes and placeholder positions)
- `slideLayoutN.xml` → relationship to `slideMasterN.xml`
- `slideMasterN.xml` → `p:cSld/p:spTree` (master shapes: logos, footers, lines)
- `slideMasterN.xml` → `p:cSld/p:bg` (master background)
- `p:ph@type` — placeholder type (title, body, dt, ftr, sldNum, etc.)
- `p:ph@idx` — placeholder index for matching slide content to layout positions
- `p:txStyles` — default text styles from master (title, body, other)

**Rendering approach:**

1. During parsing, build a `SlideLayout[]` and `SlideMaster[]` registry (keyed by relationship ID)
2. For each slide, resolve its layout and master
3. Merge shape trees: master shapes (bottom layer) + layout shapes (middle) + slide shapes (top)
4. For placeholder shapes on the slide that lack explicit `xfrm` positioning, inherit position/size from the matching layout placeholder (matched by `ph@type` + `ph@idx`)
5. For text without explicit run properties, fall back to layout defaults, then master `txStyles`
6. Master background applied when slide has no explicit background
7. Shapes with `p:ph` type `dt` (date), `ftr` (footer), `sldNum` (slide number) on the master/layout rendered if not hidden by the slide

**Key files:** `src/lib/pptx-parser.ts` (new `parseSlideMaster()`, `parseSlideLayout()`, `resolveInheritance()` functions; expand `parsePptx()` to build master/layout registry), `src/lib/pptx-types.ts` (new `SlideMaster`, `SlideLayout`, `Placeholder` interfaces; add `masterShapes`, `layoutShapes` to `PptxSlide`)

#### V3 — Body Properties

**Problem:** Text containers ignore `bodyPr` attributes. Text overflows its bounding box, sits at the top of tall containers, and touches the edges of shapes.

**OOXML elements to parse:**

- `bodyPr@anchor` — vertical anchoring: `t` (top), ctr (middle), `b` (bottom)
- `bodyPr@lIns/tIns/rIns/bIns` — internal margins in EMU (defaults: 91440 left/right = \~0.1in, 45720 top/bottom = \~0.05in)
- `a:normAutofit@fontScale` — shrink text to fit (scale factor in 1/1000ths)
- `a:spAutoFit` — shape resizes to fit text (viewer: just let text overflow with hidden overflow)
- `bodyPr@wrap` — `square` (default, wrap) vs `none` (no wrap)

**Rendering approach:**

- `anchor`: map to CSS `display: flex; align-items` — `t` = `flex-start`, `ctr` = `center`, `b` = `flex-end`
- Internal margins: convert EMU to pixels, apply as CSS `padding`
- `normAutofit`: apply `font-size` scaling factor to all text in the container. If `fontScale="75000"`, multiply all font sizes by 0.75.
- `spAutoFit`: set `overflow: visible` on the container (let it grow)
- `wrap="none"`: set `white-space: nowrap`

**Key files:** `src/lib/pptx-parser.ts` (parse `bodyPr` attributes into new `BodyProperties` interface), `src/lib/pptx-types.ts` (add `BodyProperties` to text-bearing elements), `src/components/editor/viewers/PptxSlideRenderer.tsx` (apply body properties as CSS on text containers)

---

### Tier 2 — High (V4-V10)

These cause noticeable quality loss but don't make slides unreadable.

#### V4 — Line and Paragraph Spacing

**Problem:** All paragraphs render with browser-default line height and margins. Text density is wrong — too loose or too tight compared to the original.

**OOXML elements to parse:**

- `a:lnSpc` — line spacing within a paragraph. Child: `a:spcPct` (percentage, e.g., `val="150000"` = 150%) or `a:spcPts` (absolute points, e.g., `val="1800"` = 18pt)
- `a:spcBef` — space before paragraph. Same child options.
- `a:spcAft` — space after paragraph. Same child options.
- `pPr@indent` — first-line indent in EMU
- `pPr@marL` — left margin in EMU (used for bullet indentation levels)

**Rendering approach:**

- `lnSpc` percentage: CSS `line-height: 1.5` (for 150%)
- `lnSpc` points: CSS `line-height: 18pt`
- `spcBef`/`spcAft`: CSS `margin-top`/`margin-bottom` on the paragraph `<p>` element
- `indent`: CSS `text-indent`
- `marL`: CSS `padding-left` or `margin-left`

**Key files:** `src/lib/pptx-parser.ts` (parse paragraph properties), `src/lib/pptx-types.ts` (add spacing fields to `PptxParagraph`), `src/components/editor/viewers/PptxSlideRenderer.tsx` (apply spacing CSS)

#### V5 — Auto-Numbered Bullets

**Problem:** `a:buAutoNum` paragraphs all render as bullet dots. Numbered lists, lettered lists, and roman numeral lists are indistinguishable.

**OOXML elements to parse:**

- `a:buAutoNum@type` — numbering scheme: `arabicPeriod`, `arabicParenR`, `alphaLcPeriod`, `alphaUcPeriod`, `romanLcPeriod`, `romanUcPeriod`, and \~20 more variants
- `a:buAutoNum@startAt` — starting number (default 1)
- `a:buFont` — bullet font override
- `a:buClr` — bullet color
- `a:buSzPct` — bullet size as percentage of text size

**Rendering approach:**

- Track a per-slide, per-level counter. Reset when numbering type changes or a non-numbered paragraph appears at the same level.
- Map `type` to a formatting function: `arabicPeriod` → `"1."`, `alphaLcPeriod` → `"a."`, `romanUcPeriod` → `"I."`, etc.
- Render the computed bullet string as a `<span>` prefix with appropriate font, color, and size.
- Also apply `buFont`, `buClr`, `buSzPct` to character bullets (`a:buChar`) which currently ignore these.

**Key files:** `src/lib/pptx-parser.ts` (parse `buAutoNum` attributes), `src/lib/pptx-types.ts` (add `bulletAutoNum` to paragraph type), `src/components/editor/viewers/PptxSlideRenderer.tsx` (numbering counter logic, bullet rendering)

#### V6 — Table Cell Borders and Margins

**Problem:** All table cells have hardcoded `1px solid` grey borders and fixed padding. Tables with thick colored borders, no borders, or mixed border styles look wrong.

**OOXML elements to parse:**

- `a:tcPr` → `a:lnL`, `a:lnR`, `a:lnT`, `a:lnB` — per-side border lines
- Each `a:ln` has `@w` (width in EMU), `a:solidFill` (color), `a:prstDash` (dash style), `a:noFill` (no border)
- `a:tcPr@marL/marT/marR/marB` — cell margins in EMU
- `a:tcPr@anchor` — cell vertical alignment (`t`/`ctr`/`b`)

**Rendering approach:**

- Parse each cell's 4 border lines into `{ width, color, style }` objects
- Map to CSS `border-left`, `border-right`, etc.
- `a:noFill` on a border line → `border-X: none`
- Cell margins → CSS `padding` on `<td>`
- Cell `anchor` → CSS `vertical-align: top/middle/bottom`

**Key files:** `src/lib/pptx-parser.ts` (parse `tcPr` borders and margins), `src/lib/pptx-types.ts` (add `borders`, `margins`, `verticalAlign` to `PptxTableCell`), `src/components/editor/viewers/PptxSlideRenderer.tsx` (apply border/margin CSS to `<td>` elements)

#### V7 — Chart Titles, Legends, Axis Labels, and Data Labels

**Problem:** Charts render as colored shapes with no way to identify what they represent. No title, no legend, no axis labels.

**OOXML elements to parse:**

- `c:title` → `c:tx` → `c:rich` → paragraphs/runs (chart title text and formatting)
- `c:legend` → `c:legendPos` (position: `b`, `t`, `l`, `r`, `tr`), `c:legendEntry` (per-series labels)
- `c:catAx` / `c:valAx` → `c:title` (axis titles), `c:numFmt` (number format), `c:txPr` (text properties), `c:delete` (hidden)
- `c:dLbls` → `c:showVal`, `c:showCatName`, `c:showSerName`, `c:showPercent`, `c:numFmt`
- Per-series `c:dLbl` overrides

**Rendering approach:**

- **Chart title:** Render as a `<div>` above the recharts `<ResponsiveContainer>`, styled from the title's run properties
- **Legend:** Use recharts' built-in `<Legend>` component, positioned per `legendPos`. Extract series names from `c:ser/c:tx` or fall back to "Series 1", "Series 2".
- **Axis labels:** Use recharts `<XAxis label>` and `<YAxis label>` props. Apply number formatting from `numFmt@formatCode`.
- **Data labels:** Use recharts `<LabelList>` component on each series. Format values per `numFmt`.
- **Axis title:** Render as rotated text beside the axis via recharts `label` prop or a positioned `<div>`.

**Key files:** `src/lib/pptx-parser.ts` (parse chart title, legend, axes, data labels into chart data model), `src/lib/pptx-types.ts` (expand `PptxChart` with title, legend, axes, dataLabels), `src/components/editor/viewers/PptxChartRenderer.tsx` (add Legend, axis labels, title, LabelList to recharts composition)

#### V8 — Shape Shadow (Outer)

**Problem:** Shapes have no shadow effects. Presentations designed with depth and layering look flat.

**OOXML elements to parse:**

- `a:effectLst` → `a:outerShdw` — outer shadow
  - `@blurRad` — blur radius in EMU
  - `@dist` — shadow offset distance in EMU
  - `@dir` — shadow direction in 60,000ths of a degree (e.g., `5400000` = 90 degrees = below)
  - `@algn` — shadow alignment
  - Child color element (`a:srgbClr`, `a:schemeClr` with transforms including `a:alpha`)

**Rendering approach:**

- Convert EMU blur to pixels: `blurRad / 12700`
- Convert distance + direction to x/y offsets: `x = dist * cos(dir)`, `y = dist * sin(dir)` (convert from EMU and 60,000ths-degree)
- Map to CSS `box-shadow: Xpx Ypx blurPx color`
- Apply alpha from the shadow color's `a:alpha` child

**Key files:** `src/lib/pptx-parser.ts` (parse `effectLst/outerShdw`), `src/lib/pptx-types.ts` (add `shadow?: Shadow` to `PptxElement`), `src/components/editor/viewers/PptxSlideRenderer.tsx` (apply `box-shadow` CSS)

#### V9 — Image Crop

**Problem:** Images with `a:srcRect` crop regions show the full uncropped image, which may include content the author intentionally removed.

**OOXML elements to parse:**

- `a:srcRect` on `a:blipFill` — crop offsets as percentages from each edge
  - `@l` — left crop (percentage in 1/1000ths, e.g., `val="25000"` = 25% from left)
  - `@t` — top crop
  - `@r` — right crop
  - `@b` — bottom crop

**Rendering approach:**

- Use CSS `clip-path: inset(top right bottom left)` on the `<img>` element
- Scale the image to fill the shape bounds, then clip
- Alternatively: use `object-fit: cover` with `object-position` and scale calculations to show only the visible portion

**Key files:** `src/lib/pptx-parser.ts` (parse `srcRect` into crop percentages), `src/lib/pptx-types.ts` (add `crop?: { l, t, r, b }` to image elements), `src/components/editor/viewers/PptxSlideRenderer.tsx` (apply clip-path CSS)

#### V10 — Hyperlinks

**Problem:** Links in presentations are not clickable. Users cannot follow URLs or navigate between slides.

**OOXML elements to parse:**

- `a:hlinkClick` on `a:rPr` — hyperlink on a text run
  - `r:id` → relationship to external URL or internal slide
  - `@action` — action type (e.g., `ppaction://hlinksldjump` for slide links)
- `a:hlinkClick` on `p:cNvPr` — hyperlink on a shape
- Relationship resolution: `slide1.xml.rels` maps `r:id` to target URL

**Rendering approach:**

- During parsing, resolve `r:id` to the target URL via the slide's `.rels` file
- For text runs with hyperlinks: wrap in `<a href="..." target="_blank" rel="noopener">` with appropriate styling (underline, scheme color `hlink`)
- For shape-level hyperlinks: wrap the entire shape in an `<a>` tag or add `onClick` handler
- Internal slide links (`ppaction://hlinksldjump`): navigate to the target slide number via the viewer's navigation

**Key files:** `src/lib/pptx-parser.ts` (parse `hlinkClick`, resolve relationships), `src/lib/pptx-types.ts` (add `hyperlink?: string` to text runs and shapes), `src/components/editor/viewers/PptxSlideRenderer.tsx` (render `<a>` wrappers)

---

### Tier 3 — Medium (V11-V15)

Nice-to-have improvements that enhance specific presentation types.

#### V11 — Preset Geometries

**Problem:** \~180 DrawingML preset shapes (arrows, stars, callouts, flowchart symbols, math operators, action buttons) all render as plain rectangles. Any slide with diagrams or flowcharts is broken.

**OOXML elements to parse:**

- `a:prstGeom@prst` — preset shape name (e.g., `rightArrow`, `star5`, `flowChartProcess`, `heart`, `cloud`)
- Preset geometry definitions are defined by the OOXML spec as parametric path data

**Rendering approach:**

- Build a lookup table mapping preset names to SVG `<path>` data strings
- Start with the \~30 most common shapes (arrows, stars, callouts, flowchart basics, chevrons, pentagons, hexagons)
- Render as `<svg>` elements with the path data, scaled to the shape's bounding box
- Apply fill, stroke, and effects to the SVG
- Fall back to rectangle for unmapped presets (same as current behavior)
- Reference: the OOXML spec Part 1, Section 20.1.10.55 lists all preset geometry definitions

**Key files:** `src/lib/pptx-preset-geometries.ts` (new file — SVG path data lookup table), `src/components/editor/viewers/PptxSlideRenderer.tsx` (SVG rendering for preset shapes)

#### V12 — Strikethrough, Superscript, Subscript

**Problem:** Text formatting is incomplete. Strikethrough text, chemical formulas (H2O), and footnote markers are not rendered.

**OOXML elements to parse:**

- `rPr@strike` — strikethrough: `sngStrike` (single) or `dblStrike` (double)
- `rPr@baseline` — superscript/subscript: positive percentage = superscript (e.g., `30000` = 30% above baseline), negative = subscript

**Rendering approach:**

- `strike="sngStrike"`: CSS `text-decoration: line-through`
- `strike="dblStrike"`: CSS `text-decoration: line-through; text-decoration-style: double`
- Positive `baseline`: wrap in `<sup>` with `font-size: 0.65em; vertical-align: super`
- Negative `baseline`: wrap in `<sub>` with `font-size: 0.65em; vertical-align: sub`

**Key files:** `src/lib/pptx-parser.ts` (parse `strike`, `baseline`), `src/lib/pptx-types.ts` (add to `PptxRun`), `src/components/editor/viewers/PptxSlideRenderer.tsx` (apply CSS/elements)

#### V13 — Flip Transforms

**Problem:** Shapes with `flipH` or `flipV` attributes render in their unflipped orientation. Horizontally mirrored arrows point the wrong direction.

**OOXML elements to parse:**

- `a:xfrm@flipH` — flip horizontal (`1` or `true`)
- `a:xfrm@flipV` — flip vertical

**Rendering approach:**

- Apply CSS `transform: scaleX(-1)` for `flipH`, `scaleY(-1)` for `flipV`
- Combine with existing rotation transform if present

**Key files:** `src/lib/pptx-parser.ts` (parse flip attributes), `src/lib/pptx-types.ts` (add `flipH`, `flipV` to element transform), `src/components/editor/viewers/PptxSlideRenderer.tsx` (apply CSS transform)

#### V14 — Dash Styles on Lines

**Problem:** All lines and shape outlines render as solid regardless of the authored dash style.

**OOXML elements to parse:**

- `a:prstDash@val` — preset dash style: `solid`, `dot`, `dash`, `lgDash`, `dashDot`, `lgDashDot`, `lgDashDotDot`, `sysDash`, `sysDot`, `sysDashDot`, `sysDashDotDot`

**Rendering approach:**

- Map each preset to a CSS `stroke-dasharray` value (for SVG lines) or `border-style` (for shape outlines)
- `dot` → `stroke-dasharray: 1 3` / `border-style: dotted`
- `dash` → `stroke-dasharray: 4 3` / `border-style: dashed`
- `dashDot` → `stroke-dasharray: 4 3 1 3`
- `lgDash` → `stroke-dasharray: 8 3`
- Etc.

**Key files:** `src/lib/pptx-parser.ts` (parse `prstDash`), `src/lib/pptx-types.ts` (add `dashStyle` to line properties), `src/components/editor/viewers/PptxSlideRenderer.tsx` (apply dash CSS to lines and shape borders)

#### V15 — Radar and Bubble Charts

**Problem:** Radar and bubble charts are not rendered at all. Slides with these chart types show nothing.

**OOXML elements to parse:**

- `c:radarChart` → `c:radarStyle` (marker/filled), `c:ser` (series data with `c:cat` categories and `c:val` values)
- `c:bubbleChart` → `c:ser` with `c:xVal`, `c:yVal`, `c:bubbleSize`

**Rendering approach:**

- **Radar:** Use recharts `<RadarChart>` + `<Radar>` + `<PolarGrid>` + `<PolarAngleAxis>` + `<PolarRadiusAxis>`. Map categories to `PolarAngleAxis` dataKey, values to `Radar` data.
- **Bubble:** Use recharts `<ScatterChart>` + `<Scatter>` with `<ZAxis>` for bubble size. Map `xVal`/`yVal` to x/y, `bubbleSize` to z. Render as `shape="circle"` with size from z-axis.

**Key files:** `src/lib/pptx-parser.ts` (parse radar/bubble chart data), `src/lib/pptx-types.ts` (add chart type variants), `src/components/editor/viewers/PptxChartRenderer.tsx` (new radar and bubble renderers)

---

### Tier 4 — Low Priority

These are documented for completeness but are not planned for implementation in this cycle.

#### V16 — Slide Transitions

Basic slide transitions (fade, push, wipe) for presentation playback mode. Requires `p:transition` parsing and CSS animation keyframes. L effort.

#### V17 — Additional Chart Types

Combination charts (multiple chart types on one axis), stock charts (`c:stockChart`), surface charts (`c:surfaceChart`). Each is M-L effort.

#### V18 — Character Spacing

`rPr@spc` — letter spacing in 1/100ths of a point. Map to CSS `letter-spacing`. S effort.

#### V19 — Image Backgrounds

`p:bgPr > blipFill` — background images on slides and masters. Parse the image relationship, render as CSS `background-image` with appropriate sizing. M effort.

#### V20 — Bullet Font, Color, and Size

`a:buFont`, `a:buClr`, `a:buSzPct` — styled bullets. Apply font, color, and size to bullet character/number span. S effort.

#### V21 — Text Caps

`rPr@cap` — `all` (ALL CAPS) or `small` (small caps). Map to CSS `text-transform: uppercase` or `font-variant: small-caps`. S effort.

#### V22 — Slide Headers and Footers

`p:hf` — show/hide date, footer text, slide number placeholders from the master. Parse visibility flags and populate placeholder content. M effort.

#### V23 — Image Transparency

`a:alphaModFix@amt` — image opacity as percentage. Map to CSS `opacity`. S effort.

#### V24 — Line Head Arrows

Complete arrow head rendering (currently only tail arrows work). Parse `a:headEnd@type/w/len`, render SVG arrowhead markers. S effort.

---

## Feature Status Table

| \# | Feature | Tier | Effort | Status | Tasks |
| --- | --- | --- | --- | --- | --- |
| V1 | Color transforms (lumMod/lumOff/tint/shade/alpha) | 1 - Critical | M | **Complete** | [v2-tasks #1-#2](../tasks/2026-04-07-pptx-viewer-v2-tasks.md) |
| V2 | Slide master/layout inheritance | 1 - Critical | L | **Complete** | [v2-tasks #11-#13](../tasks/2026-04-07-pptx-viewer-v2-tasks.md) |
| V3 | Body properties (autofit, anchoring, margins) | 1 - Critical | M | **Complete** | [v2-tasks #3](../tasks/2026-04-07-pptx-viewer-v2-tasks.md) |
| V4 | Line and paragraph spacing | 2 - High | S | **Complete** | [v2-tasks #4](../tasks/2026-04-07-pptx-viewer-v2-tasks.md) |
| V5 | Auto-numbered bullets | 2 - High | S | **Complete** | [v2-tasks #5](../tasks/2026-04-07-pptx-viewer-v2-tasks.md) |
| V6 | Table cell borders and margins | 2 - High | M | **Complete** | [v2-tasks #6](../tasks/2026-04-07-pptx-viewer-v2-tasks.md) |
| V7 | Chart titles, legends, axis labels, data labels | 2 - High | M | **Complete** | [v2-tasks #14](../tasks/2026-04-07-pptx-viewer-v2-tasks.md) |
| V8 | Shape shadow (outer) | 2 - High | M | **Complete** | [v2-tasks #15](../tasks/2026-04-07-pptx-viewer-v2-tasks.md) |
| V9 | Image crop | 2 - High | M | **Complete** | [v2-tasks #16](../tasks/2026-04-07-pptx-viewer-v2-tasks.md) |
| V10 | Hyperlinks | 2 - High | S | **Complete** | [v2-tasks #7](../tasks/2026-04-07-pptx-viewer-v2-tasks.md) |
| V11 | Preset geometries (44 shapes) | 3 - Medium | L | **Complete** | [v2-tasks #17-#18](../tasks/2026-04-07-pptx-viewer-v2-tasks.md) |
| V12 | Strikethrough, superscript, subscript | 3 - Medium | S | **Complete** | [v2-tasks #8](../tasks/2026-04-07-pptx-viewer-v2-tasks.md) |
| V13 | Flip transforms | 3 - Medium | S | **Complete** | [v2-tasks #9](../tasks/2026-04-07-pptx-viewer-v2-tasks.md) |
| V14 | Dash styles on lines | 3 - Medium | S | **Complete** | [v2-tasks #10](../tasks/2026-04-07-pptx-viewer-v2-tasks.md) |
| V15 | Radar and bubble charts | 3 - Medium | M | **Complete** | [v2-tasks #19](../tasks/2026-04-07-pptx-viewer-v2-tasks.md) |
| V16 | Slide transitions | 4 - Low | L | Not planned | \- |
| V17 | Additional chart types (combo, stock, surface) | 4 - Low | L | Not planned | \- |
| V18 | Character spacing | 4 - Low | S | **Complete** | [tier4-tasks #1](../tasks/2026-04-07-pptx-viewer-v2-tier4-tasks.md) |
| V19 | Image backgrounds | 4 - Low | M | **Complete** | [tier4-tasks #5-#6](../tasks/2026-04-07-pptx-viewer-v2-tier4-tasks.md) |
| V20 | Bullet font, color, and size | 4 - Low | S | **Complete** (done as part of V5) | [v2-tasks #5](../tasks/2026-04-07-pptx-viewer-v2-tasks.md) |
| V21 | Text caps (all caps, small caps) | 4 - Low | S | **Complete** | [tier4-tasks #2](../tasks/2026-04-07-pptx-viewer-v2-tier4-tasks.md) |
| V22 | Slide headers and footers | 4 - Low | M | **Complete** | [tier4-tasks #7](../tasks/2026-04-07-pptx-viewer-v2-tier4-tasks.md) |
| V23 | Image transparency | 4 - Low | S | **Complete** | [tier4-tasks #3](../tasks/2026-04-07-pptx-viewer-v2-tier4-tasks.md) |
| V24 | Line head arrows | 4 - Low | S | **Complete** | [tier4-tasks #4](../tasks/2026-04-07-pptx-viewer-v2-tier4-tasks.md) |

## Quality Gates

### Tier 1 Complete

- [x] Theme deck with `lumMod`/`lumOff` colors renders correct shades (compare against PowerPoint screenshot)

- [x] Theme deck with `tint`/`shade` colors renders correct values

- [x] Slide master logos and decorative shapes appear on all slides

- [x] Slide layout placeholder positions are inherited (title and body content in correct locations)

- [x] Master background appears when slide has no explicit background

- [x] Text with `anchor="ctr"` is vertically centered in its container

- [x] Text with `normAutofit` shrinks to fit its bounding box

- [x] Internal margins (`lIns/tIns/rIns/bIns`) provide correct padding inside text boxes

### Tier 2 Complete

- [x] Line spacing set to 150% renders visibly more spaced than default

- [x] Space before/after paragraphs creates visible gaps between paragraphs

- [x] Numbered lists (`buAutoNum`) display correct numbers (1, 2, 3 or a, b, c or I, II, III)

- [x] Table cell borders match authored width, color, and presence/absence

- [x] Table cells with `anchor="ctr"` vertically center text

- [x] Chart titles appear above charts

- [x] Chart legends appear with series names and colors

- [x] Axis labels render on both X and Y axes

- [x] Shapes with outer shadow have visible CSS box-shadow

- [x] Cropped images show only the visible region

- [x] Hyperlinks are rendered as clickable `<a>` elements

- [x] Internal slide links navigate to the correct slide

### Tier 3 Complete

- [x] Common preset shapes (arrows, stars, chevrons, flowchart symbols) render as correct SVG paths

- [x] Strikethrough text has a visible line-through decoration

- [x] Superscript and subscript text is positioned correctly

- [x] Flipped shapes appear mirrored vs their unflipped version

- [x] Dashed lines render with correct dash patterns

- [x] Radar charts render with polar grid and category labels

- [x] Bubble charts render with size-varying circles

### Visual Regression

- [x] All existing supported features (text, images, basic shapes, gradients, tables, charts) continue to render correctly

- [x] No regressions in rendering performance (slides render &lt; 100ms)

- [x] Dark mode rendering unaffected (slide content uses authored colors, not theme)

## Dependencies

No new external library additions needed. All rendering uses:

- Existing React/CSS infrastructure in `PptxSlideRenderer.tsx`
- Existing recharts library in `PptxChartRenderer.tsx`
- Existing JSZip for ZIP extraction in `pptx-parser.ts`
- SVG paths for preset geometries (static data, no library needed)

## Key Files

| File | Purpose |
| --- | --- |
| `src/lib/pptx-parser.ts` | XML parsing, element extraction, theme/color resolution, master/layout registry |
| `src/lib/pptx-types.ts` | TypeScript data model for all parsed PPTX elements |
| `src/components/editor/viewers/PptxSlideRenderer.tsx` | React element rendering (text, shapes, tables, images) |
| `src/components/editor/viewers/PptxChartRenderer.tsx` | Recharts-based chart rendering (title, legend, axes, labels) |
| `src/components/editor/viewers/PptxViewer.tsx` | Orchestrator, navigation, zoom, search, notes |
| `src/components/editor/viewers/PptxSearchBar.tsx` | Search hook + find bar |
| `src/components/editor/viewers/PptxZoomControls.tsx` | Zoom hook + toolbar |
| `src/lib/pptx-preset-geometries.ts` | **New** — SVG path data for \~30 common DrawingML preset shapes |

## References

- OOXML spec (ECMA-376 Part 1): DrawingML color transforms (Section 20.1.2), preset geometries (Section 20.1.10.55)
- Research doc: `docs/research/2026-04-07-pptx-viewer-quality.md`
- Current viewer implementation: `src/components/editor/viewers/Pptx*.tsx`
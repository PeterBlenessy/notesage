# PRD: PPTX Viewer Polish

|  |  |
| --- | --- |
| **Date** | 2026-04-08 |
| **Status** | Draft |
| **Priority** | Medium |
| **Impact** | Improved rendering fidelity for underline styles, CJK fonts, text effects, table theming, chart types, pattern fills, and media placeholders — closing the gap between viewer and PowerPoint |
| **Research** | [pptx-viewer-quality](../research/2026-04-07-pptx-viewer-quality.md) |
| **Predecessor** | [pptx-viewer-v2](../prds/2026-04-07-pptx-viewer-v2.md) (Complete — 21/21 tasks) |

## Problem

The PPTX viewer v2 PRD (V1-V15) implemented the critical and high-impact features: color transforms, master/layout inheritance, body properties, spacing, auto-numbered bullets, table borders, chart labels, shadows, image crop, hyperlinks, preset geometries, and text formatting. Coverage rose from ~28% to ~60% of the OOXML feature inventory.

The remaining ~40% contains polish features that affect specific presentation types:

1. **Text effects gaps.** No underline styles beyond single-line (18 OOXML types). No all-caps/small-caps rendering. No text highlight, outline, or kerning. CJK/complex-script font families not resolved.

2. **Paragraph gaps.** Bullet font/color/size overrides ignored — all bullets use the same style. No picture bullets. No tab stops. No RTL text. No default run properties from masters.

3. **Body property gaps.** No word wrap mode, text columns, or text rotation on containers.

4. **Shape gaps.** Custom geometries (`a:custGeom`) render as rectangles. No pattern fills. No picture fills on shapes. No group fill inheritance. Radial gradient always centered. Compound lines, joins, and caps not parsed. No glow, soft edge, or reflection effects.

5. **Table gaps.** No theme-driven table styles (`a:tblStyle`). No banded rows/columns. No first/last row/column formatting. No gradient fills in cells. No text direction in cells.

6. **Image gaps.** No image effects (shadow, glow). No image transparency (`alphaModFix`). No linked/external images. No WMF/EMF metafile rendering. No stretch/tile fill modes.

7. **Chart gaps.** No radar, bubble, stock, or surface charts. No combination charts. No trendlines, error bars, or secondary axes. No 3D perspective.

8. **Other gaps.** No slide headers/footers (`p:hf`). No comments. No OLE objects. No media placeholders with poster frames. No math equations. No ink annotations. No sections in navigation.

## Goals

Improve viewer fidelity for the most commonly encountered remaining features:

- **VP1-VP5 (Text):** Underline styles, all-caps/small-caps, CJK fonts, text highlight, character spacing/kerning
- **VP6-VP8 (Paragraphs):** Bullet font/color/size, default run properties, tab stops
- **VP9-VP11 (Shapes):** Custom geometry fallback, pattern fills, picture fills, glow/soft-edge
- **VP12-VP14 (Tables):** Table style resolution, banded rows, cell gradient fills
- **VP15-VP17 (Charts):** Radar/bubble charts, data labels, trendlines, secondary axes
- **VP18-VP20 (Images):** Image transparency, image effects, linked images
- **VP21-VP23 (Other):** Slide headers/footers, comments rendering, sections, media poster frames

## Non-Goals

- **Full animation engine** — slide transitions and build animations (XL effort, static viewer)
- **SmartArt data model parsing** — XL effort, fallback image approach sufficient
- **OLE embedded objects** — arbitrary embedded content rendering
- **3D effects** — CSS cannot faithfully reproduce DrawingML 3D
- **Custom geometry paths** — deferred; preset geometries (44 shapes) cover common cases
- **Stock/surface charts** — niche chart types, low priority
- **WMF/EMF metafile conversion** — requires server-side image conversion (L effort)
- **Full math equation rendering (OMML)** — would need a LaTeX/MathML renderer
- **Ink annotations** — niche feature
- **Video/audio playback** — media embedding out of scope

## Technical Approach

All changes are in the viewer frontend files. No Rust backend changes.

### VP1: Underline Styles

Parse the full `rPr@u` attribute value. OOXML defines 18 underline types. Map the most common to CSS:

| OOXML | CSS |
|-------|-----|
| `sng` | `underline` (current) |
| `dbl` | `border-bottom: 3px double` |
| `heavy` | `text-decoration-thickness: 2px` |
| `dotted` | `text-decoration-style: dotted` |
| `dash` | `text-decoration-style: dashed` |
| `wavy` | `text-decoration-style: wavy` |
| Others | Fall back to `underline` |

Also parse underline color from `a:uFill > a:solidFill`.

**Files:** `pptx-parser.ts` (parse `u` attribute values), `PptxSlideRenderer.tsx` (map to CSS)

### VP2: All Caps / Small Caps

Parse `rPr@cap` attribute: `all` → CSS `text-transform: uppercase`, `small` → CSS `font-variant: small-caps`.

**Files:** `pptx-parser.ts`, `PptxSlideRenderer.tsx`

### VP3: CJK / Complex Script Fonts

Parse `a:ea` (East Asian) and `a:cs` (Complex Script) font elements. Apply as `font-family` fallback chain: `latin, ea, cs, sans-serif`.

**Files:** `pptx-parser.ts` (extract `ea`/`cs` typeface), `PptxSlideRenderer.tsx` (build font stack)

### VP4: Text Highlight

Parse run-level fill (`a:solidFill` or `a:highlight` inside `a:rPr`). Apply as `background-color` on the text span.

**Files:** `pptx-parser.ts`, `PptxSlideRenderer.tsx`

### VP5: Kerning

Parse `rPr@kern` (minimum font size for kerning in hundredths of a point). When present, apply CSS `font-kerning: normal` on the text span.

**Files:** `pptx-parser.ts`, `PptxSlideRenderer.tsx`

### VP6: Bullet Font, Color, and Size

Parse `a:buFont` (typeface), `a:buClr` (color via `srgbClr` or `schemeClr`), and `a:buSzPct` (percentage of text size). Apply to the bullet character's styling.

Currently all bullets use the run's font — this override allows presentations with distinct bullet styling (common in corporate templates).

**Files:** `pptx-parser.ts` (extract bullet properties), `PptxSlideRenderer.tsx` (apply to bullet span)

### VP7: Default Run Properties

Parse `a:defRPr` from paragraph properties. These define the default font, size, and color for runs that don't specify their own. Fall back to master/layout `defRPr` when slide-level is absent.

This fixes the common issue of text appearing unstyled when the run relies on inherited defaults.

**Files:** `pptx-parser.ts` (parse and merge `defRPr`), `PptxSlideRenderer.tsx`

### VP8: Tab Stops

Parse `a:tabLst > a:tab` elements with `pos` (EMU) and `algn` (left/center/right/decimal). Render as CSS `tab-size` or positioned `<span>` elements with inline margin.

**Files:** `pptx-parser.ts`, `PptxSlideRenderer.tsx`

### VP9: Pattern Fills

Parse `a:pattFill` with `prst` (pattern name), `a:fgClr`, and `a:bgClr`. Render as CSS background using SVG data URIs for the 48 OOXML pattern presets. Group into families:

- Hatching (horizontal, vertical, diagonal): `repeating-linear-gradient`
- Dots/checks: tiny SVG pattern via `background-image: url("data:image/svg+xml,...")`
- Fallback: solid foreground color

**Files:** `pptx-parser.ts` (parse pattern fill), `PptxSlideRenderer.tsx` (CSS pattern rendering), new `pptx-patterns.ts` (pattern SVG definitions)

### VP10: Picture Fill on Shapes

Parse `a:blipFill` inside shape properties. Extract the image relationship ID, resolve to the image in the ZIP, and apply as `background-image` on the shape div. Respect `a:stretch` / `a:tile` modes and `a:srcRect` cropping.

**Files:** `pptx-parser.ts` (extract blipFill), `PptxSlideRenderer.tsx` (CSS background-image)

### VP11: Glow and Soft Edge

Parse `a:glow` (radius, color, alpha) and `a:softEdge` (radius) from `a:effectLst`. Render as:
- Glow: CSS `box-shadow: 0 0 <radius>px <color>` (approximation)
- Soft edge: CSS `filter: blur(<radius>px)` on a clipping wrapper

**Files:** `pptx-parser.ts`, `PptxSlideRenderer.tsx`

### VP12: Table Style Resolution

Parse `a:tblStyle@styleId` and resolve against the theme's `a:tblStyleLst`. Extract:
- `wholeTbl` (default cell styling)
- `band1H`, `band2H` (horizontal banding)
- `band1V`, `band2V` (vertical banding)
- `firstRow`, `lastRow`, `firstCol`, `lastCol` (special formatting)

Apply as default styles, overridden by explicit cell-level properties.

**Files:** `pptx-parser.ts` (parse tblStyle, resolve from theme), `PptxSlideRenderer.tsx` (apply cascade)

### VP13: Banded Rows and Columns

When a table has `bandRow="1"` or `bandCol="1"` attributes, apply alternating styles from the resolved table style (VP12). This is the most common table styling mechanism in PowerPoint templates.

**Files:** `PptxSlideRenderer.tsx` (conditional row/column styling)

### VP14: Cell Gradient Fill

Parse `a:gradFill` inside `a:tcPr` (table cell properties). Reuse the existing gradient rendering from shape fills.

**Files:** `pptx-parser.ts` (extract gradient from cell), `PptxSlideRenderer.tsx` (CSS gradient)

### VP15: Radar and Bubble Charts

Add recharts `<RadarChart>` and custom bubble rendering to `PptxChartRenderer.tsx`. Parse `c:radarChart` and `c:bubbleChart` from chart XML.

Radar: uses `<PolarGrid>`, `<PolarAngleAxis>`, `<Radar>` from recharts.
Bubble: uses `<ScatterChart>` with `<ZAxis>` for bubble size.

**Files:** `pptx-parser.ts` (parse radar/bubble chart data), `PptxChartRenderer.tsx` (recharts components)

### VP16: Chart Data Labels

Parse `c:dLbls` (data labels) from chart XML. Extract `showVal`, `showCatName`, `showSerName`, `showPercent`, `dLblPos`. Render using recharts `<Label>` or custom positioned elements.

**Files:** `pptx-parser.ts` (parse dLbls), `PptxChartRenderer.tsx` (label rendering)

### VP17: Chart Secondary Axes and Trendlines

Parse secondary `c:valAx` (when `axId` references differ) and `c:trendline` elements. Render as:
- Secondary axis: recharts `<YAxis yAxisId="right" orientation="right" />`
- Trendlines: computed overlay line based on trend type (linear, exponential, polynomial)

**Files:** `pptx-parser.ts`, `PptxChartRenderer.tsx`

### VP18: Image Transparency

Parse `a:alphaModFix@amt` on image elements. Apply as CSS `opacity: <amt/100000>`.

**Files:** `pptx-parser.ts` (extract alphaModFix), `PptxSlideRenderer.tsx` (CSS opacity)

### VP19: Image Effects

Parse `a:effectLst` on image shapes. Support `a:outerShdw` (reuse existing shadow rendering from VP8/shapes) and `a:reflection` (CSS approximation with flipped, faded duplicate).

**Files:** `pptx-parser.ts`, `PptxSlideRenderer.tsx`

### VP20: Linked (External) Images

Parse `r:link` (as opposed to `r:embed`) image relationships. These reference external URLs. Render as `<img src="url">` with a fallback placeholder if the URL is unreachable.

**Files:** `pptx-parser.ts` (detect link vs embed), `PptxSlideRenderer.tsx` (img src)

### VP21: Slide Headers and Footers

Parse `p:hf` (header/footer) elements from slides. Render date, footer text, and slide number in their designated positions. Respect visibility flags (`dt`, `ftr`, `sldNum` attributes).

**Files:** `pptx-parser.ts` (parse p:hf), `PptxSlideRenderer.tsx` (positioned footer elements)

### VP22: Comments Rendering

Parse `p:cmLst` (comment list) from the comments XML part. Display as a toggleable overlay or side panel showing author, date, and text. Position markers on slides at the comment's anchor point.

**Files:** `pptx-parser.ts` (parse comments XML), `PptxViewer.tsx` (comment toggle), new comment overlay component

### VP23: Sections in Navigation

Parse `p:sectionLst` from `presentation.xml`. Display section names in the slide counter/navigation UI, allowing users to jump between sections.

**Files:** `pptx-parser.ts` (parse sections), `PptxViewer.tsx` (section navigation)

## UI/UX

- VP22 (comments): adds a toggleable comment panel — similar to the existing speaker notes toggle
- VP23 (sections): adds section labels to the slide navigation bar
- All other features are rendering improvements with no new UI controls

## Data Model

Extended `pptx-types.ts` interfaces:
- `TextRun`: add `underlineStyle`, `caps`, `highlight`, `kern`, `eaFont`, `csFont`
- `Paragraph`: add `bulletFont`, `bulletColor`, `bulletSizePct`, `tabStops`, `defRPr`
- `Shape`: add `patternFill`, `pictureFill`, `glow`, `softEdge`
- `TableCell`: add `gradientFill`
- `Chart`: add `radarData`, `bubbleData`, `dataLabels`, `secondaryAxis`, `trendlines`
- `Slide`: add `headerFooter`, `comments`, `section`

## Dependencies

None. All features use existing libraries (recharts for charts, JSZip for parsing).

## Quality Gates

### Functional
- [ ] Underline styles render distinctly (at minimum: single, double, dotted, dashed, wavy)
- [ ] All-caps and small-caps text transforms apply correctly
- [ ] CJK fonts resolve when `a:ea` is specified
- [ ] Bullet font/color/size overrides display correctly
- [ ] Pattern fills render recognizable patterns (not solid fallback)
- [ ] Table banding applies alternating row colors from theme
- [ ] Radar chart renders with polar grid
- [ ] Chart data labels display values on data points
- [ ] Image transparency reduces opacity visually
- [ ] Slide footer text appears when authored
- [ ] All features work in both light and dark mode
- [ ] No regressions in existing 79 PPTX viewer unit tests

### Testing
- [ ] Unit tests for new parser features (underline styles, caps, pattern fills, etc.)
- [ ] Unit tests for chart data label extraction
- [ ] Visual regression tests with sample PPTX files covering each feature
- [ ] Existing test suite passes

## Suggested Implementation Order

| Tier | Features | Effort | Rationale |
| --- | --- | --- | --- |
| A — Text polish | VP1 (underline), VP2 (caps), VP4 (highlight), VP5 (kerning) | 4S | Quick text rendering improvements |
| B — Paragraph & body | VP3 (CJK fonts), VP6 (bullet styling), VP7 (defRPr), VP8 (tabs) | 3S + 1M | Better paragraph rendering |
| C — Charts | VP15 (radar/bubble), VP16 (data labels), VP17 (secondary axes) | 1M + 1M + 1M | Chart completeness |
| D — Shapes & fills | VP9 (patterns), VP10 (picture fill), VP11 (glow/soft-edge) | 1S + 1M + 1M | Shape rendering variety |
| E — Tables | VP12 (table styles), VP13 (banding), VP14 (cell gradients) | 1L + 1S + 1S | Table theming |
| F — Images | VP18 (transparency), VP19 (effects), VP20 (linked) | 3S | Image polish |
| G — Other | VP21 (headers/footers), VP22 (comments), VP23 (sections) | 1M + 1M + 1S | Navigation and metadata |

## Out of Scope

- Full animation engine (transitions, entrance/exit, motion paths, build animations)
- SmartArt data model parsing (fallback image approach retained)
- OLE embedded objects
- 3D effects (rotation, bevel, perspective)
- Custom geometry paths (`a:custGeom`)
- Stock and surface charts
- WMF/EMF metafile conversion
- Math equations (OMML)
- Ink annotations
- Video/audio playback
- RTL text (separate initiative if needed)

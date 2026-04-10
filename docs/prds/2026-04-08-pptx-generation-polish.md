# PRD: PPTX Generation Polish

|  |  |
| --- | --- |
| **Date** | 2026-04-08 |
| **Status** | Complete |
| **Priority** | Medium |
| **Impact** | Enhanced text formatting, chart customization, shape variety, and image/table polish — closing the gap between generated and hand-crafted presentations |
| **Research** | [pptx-generation-quality](../research/2026-04-07-pptx-generation-quality.md) |
| **Predecessor** | [rich-pptx-generation](2026-04-07-rich-pptx-generation.md) (Complete — 17/17 tasks) |

## Problem

The first PPTX generation PRD (G1-G18) implemented the major structural features: charts, slide masters, two-column layout, overflow handling, and content type variety. The script grew from 782 to 1381 lines and now covers ~40% of PptxGenJS's API surface.

However, the remaining ~60% contains polish features that separate "good enough" from "presentation-ready":

1. **Text formatting gaps.** No text highlight, character spacing, line spacing control, or paragraph spacing before. Underline is hardcoded to single-line — no colored or styled underlines. Agents can't emphasize key numbers or control whitespace rhythm.

2. **Chart customization is basic.** Charts render with default axis labels, no data labels, no gridline control, no axis titles, no format codes (e.g., currency on Y axis). The chart YAML `options` block supports a handful of properties but ignores most of PptxGenJS's chart configuration.

3. **No decorative shapes.** Only `rect` and `roundRect` are used. PptxGenJS has 187 preset shapes — arrows, flowchart symbols, stars, callouts — none accessible. Agents writing process flows, comparison slides, or visual metaphors are limited to text.

4. **Image features missing.** No rotation, flip, transparency, or hyperlinks on images. Base64 image data (from agent-generated content) not supported.

5. **Table polish incomplete.** No row heights, no rowspan (only colspan), no auto-page start Y customization.

6. **Slide-level features unused.** No sections (for slide sorter organization), no hidden slides, no background transparency, no default text color per slide.

7. **Presentation-level gaps.** No output compression, no theme API (`pptx.theme`), no custom layout sizes.

## Goals

Close the formatting and customization gap so generated presentations match the quality of hand-crafted PowerPoint decks:

- **P1-P4 (Text & Lists):** Rich text formatting — highlight, spacing, underline styles, bullet format variants
- **P5-P8 (Charts):** Chart polish — data labels, axis titles, gridlines, format codes
- **P9-P14 (Shapes):** Decorative shapes — preset shape library, arrows, gradient fills, dash styles, rotation
- **P15-P18 (Images):** Image polish — rotation, flip, transparency, base64, hyperlinks
- **P19-P21 (Tables):** Table polish — row heights, rowspan, auto-page start Y
- **P22-P26 (Slides & Presentation):** Sections, hidden slides, compression, theme API, custom layouts

## Non-Goals

- **3D chart perspective** — visual gimmick, rarely used in professional presentations
- **Combination charts** — complex data model, niche use case
- **Video/audio file embedding** — requires codec handling and large binary payloads
- **Custom geometry paths** — too complex for agent-generated content (decided in G1-G18 PRD)
- **RTL text support** — niche requirement, can be added later
- **Slide transitions/animations** — not well-documented in PptxGenJS TypeScript definitions
- **Vertical text** — niche, rarely needed in business presentations
- **Tab stops** — edge case formatting

## Technical Approach

All changes are in `bundled-skills/generate-presentation/scripts/generate.mjs` (1381 lines). No Rust backend changes. No new dependencies.

### P1: Text Highlight

Extend `parseInlineFormatting()` to detect `==text==` (highlight) syntax. Emit `{ highlight: "FFFF00" }` on text runs. Default yellow, configurable via `==text=={color}` extended syntax.

**PptxGenJS API:** `{ text: "highlighted", options: { highlight: "FFFF00" } }`

### P2: Character & Line Spacing

Add `charSpacing` and `lineSpacing` options to the style definitions. Apply to body text, bullet items, and headings. Values per style:
- Simple: `charSpacing: 0`, `lineSpacing: 24` (1.0×)
- Business: `charSpacing: -0.5`, `lineSpacing: 26` (1.08×)
- Report: `charSpacing: 0`, `lineSpacing: 28` (1.15×)

Also expose `paraSpaceBefore` alongside the existing `paraSpaceAfter`.

**PptxGenJS API:** `charSpacing`, `lineSpacing` (pt), `lineSpacingMultiple`, `paraSpaceBefore`

### P3: Underline Styles

Extend `parseInlineFormatting()` to support styled underlines. Current `[text](url)` uses `underline: { style: "sng" }`. Add support for:
- `++text++` → double underline (`underline: { style: "dbl" }`)
- Colored underlines via extended syntax or style-dependent defaults

**PptxGenJS API:** `underline: { style: 'sng'|'dbl'|'heavy'|'dotted'|'dash'|'wavy', color?: string }`

### P4: Bullet Number Formats

Support ordered list format specifiers via markdown attributes:
- `1. item` → arabic (default)
- `a. item` → `alphaLcParenR`
- `A. item` → `alphaUcParenR`
- `i. item` → `romanLcParenR`
- `I. item` → `romanUcParenR`

Also support start value via `<!-- start: 5 -->` comment before the list.

**PptxGenJS API:** `bullet: { numberType: 'alphaLcParenR', numberStartAt: 5 }`

### P5: Chart Data Labels

Add `dataLabels` option to chart YAML. When `showDataLabels: true`, display values on data points. Configurable position (top, center, bottom, outside), font size, and format code.

```yaml
options:
  showDataLabels: true
  dataLabelPos: outsideEnd
  dataLabelFontSize: 10
  dataLabelFormatCode: "#,##0"
```

**PptxGenJS API:** `showValue`, `dataLabelPosition`, `dataLabelFontSize`, `dataLabelFormatCode`

### P6: Chart Axis Titles & Formatting

Add axis configuration to chart YAML:

```yaml
options:
  catAxisTitle: Quarter
  valAxisTitle: Revenue ($M)
  valAxisFormatCode: "$#,##0"
  valAxisMinVal: 0
  valAxisMaxVal: 100
  valAxisMajorUnit: 20
```

**PptxGenJS API:** `catAxisTitle`, `valAxisTitle`, `valAxisMinVal`, `valAxisMaxVal`, `valAxisMajorUnit`, `catAxisLabelFormatCode`, `valAxisLabelFormatCode`

### P7: Chart Gridlines & Plot Area

Add gridline and plot area styling to chart YAML options:

```yaml
options:
  showGridlines: true
  gridlineColor: DDDDDD
  plotAreaBorder: true
  plotAreaFill: F8F8F8
```

**PptxGenJS API:** `catGridLine`, `valGridLine`, `plotArea: { border, fill }`, `chartArea: { border, fill, roundedCorners }`

### P8: Bar Chart 3D

Add `bar3d` as a recognized chart type. Map to `pptx.charts.BAR3D`. Minimal effort since it reuses the same series format and options as 2D bar.

**PptxGenJS API:** `pptx.charts.BAR3D`

### P9: Preset Shape Library

Detect `<!-- shape: type x y w h -->` HTML comments in the markdown parser. Support a curated subset of the 187 PptxGenJS shape types:

**Supported shapes:** `rect`, `roundRect`, `ellipse`, `triangle`, `diamond`, `pentagon`, `hexagon`, `star5`, `rightArrow`, `leftArrow`, `upArrow`, `downArrow`, `chevron`, `heart`, `lightningBolt`, `cloud`, `gear6`

Options: `fill`, `line`, `text`, `rotation`, `flip`.

```markdown
<!-- shape: rightArrow 2 3 3 1 fill=accent1 text="Next Step" -->
```

**PptxGenJS API:** `addShape(pptx.ShapeType.xxx, { x, y, w, h, fill, line, rotate, flipH, flipV, text })`

### P10: Shape Gradient Fills

Add gradient fill support to shapes. Detect `fill=gradient(color1,color2,angle)` in shape directives.

```markdown
<!-- shape: rect 1 1 5 3 fill=gradient(333333,666666,90) -->
```

**PptxGenJS API:** `fill: { colorGrad: [{ color, position }, ...], gradType: 'linear', gradAngle: 90 }`

### P11: Shape Arrows & Connectors

Detect `<!-- arrow: x1 y1 x2 y2 -->` comments for line connectors with optional arrowheads.

```markdown
<!-- arrow: 2 3 8 3 head=triangle tail=none dash=solid -->
```

**PptxGenJS API:** `addShape(pptx.ShapeType.line, { line: { beginArrowType, endArrowType, dashType, width, color } })`

### P12: Shape Dash Styles

Add `dash` option to shape lines. Support all 8 PptxGenJS dash types: `solid`, `dash`, `dashDot`, `lgDash`, `lgDashDot`, `lgDashDotDot`, `sysDash`, `sysDot`.

**PptxGenJS API:** `line: { dashType: 'dash' }`

### P13: Shape Rotation & Flip

Add `rotate`, `flipH`, `flipV` options to shape directives.

**PptxGenJS API:** `rotate` (-360 to 360), `flipH: true`, `flipV: true`

### P14: Shape Hyperlinks

Add `link` option to shape directives for clickable shapes.

**PptxGenJS API:** `hyperlink: { url?, slide?, tooltip? }`

### P15: Image Rotation & Flip

Support rotation and flip via image title syntax: `![alt](path "rotate=90")`, `![alt](path "flipH")`.

**PptxGenJS API:** `rotate`, `flipH`, `flipV`

### P16: Image Transparency

Support transparency via title syntax: `![alt](path "opacity=50")`.

**PptxGenJS API:** `transparency` (0-100, where 100 is fully transparent)

### P17: Image Base64

Support `data:image/png;base64,...` URIs in image paths. This enables agent-generated images (diagrams, charts rendered as images) without writing to disk.

**PptxGenJS API:** `data: "image/png;base64,iVBOR..."`

### P18: Image Hyperlinks

Support `![alt](path "link=https://example.com")` to make images clickable.

**PptxGenJS API:** `hyperlink: { url: "..." }`

### P19: Table Row Heights

Detect `<!-- rowH: 0.5, 0.3, 0.3 -->` comment before tables to set explicit row heights.

**PptxGenJS API:** `rowH: number | number[]`

### P20: Table Rowspan

Detect `^^` as a rowspan marker (cell merges with the cell above). Complementary to the existing `||` colspan marker.

**PptxGenJS API:** `rowspan: number`

### P21: Auto-Page Start Y

Add `autoPageSlideStartY` option for continuation slides when tables auto-page. Default to `CONTENT_Y_BASE` (1.9").

**PptxGenJS API:** `autoPageSlideStartY: number`

### P22: Slide Sections

Detect `<!-- section: Section Name -->` comments to create PowerPoint sections. These appear in the slide sorter and navigation pane.

**PptxGenJS API:** `pptx.addSection({ title: "Section Name" })`

### P23: Hidden Slides

Detect `<!-- hidden -->` comment to mark slides as hidden in the presentation.

**PptxGenJS API:** `slide.hidden = true`

### P24: Output Compression

Enable ZIP compression on output. Reduces file size, especially for presentations with embedded images.

**PptxGenJS API:** `pptx.write({ outputType: "nodebuffer", compression: true })`

### P25: Theme API

Use PptxGenJS's native theme API instead of manually applying fonts to each text element:

```javascript
pptx.theme = { headFontFace: theme.fonts.heading, bodyFontFace: theme.fonts.body };
```

This sets default fonts globally, reducing per-element font specifications.

**PptxGenJS API:** `pptx.theme = { headFontFace, bodyFontFace }`

### P26: Custom Layout Sizes

Support `<!-- layout: width height -->` for non-standard slide dimensions (e.g., portrait, square, or custom aspect ratios).

```markdown
<!-- layout: 10 7.5 -->
```

**PptxGenJS API:** `pptx.defineLayout({ name: 'CUSTOM', width: 10, height: 7.5 })`

## UI/UX

No UI changes — all features are in the generation script. The agent writes markdown with the new syntax; the script produces richer PPTX output.

## Data Model

No new stores or Tauri commands. All changes are within `generate.mjs`:
- Extended `parseInlineFormatting()` regex for highlight and underline styles
- Extended `parseMarkdown()` HTML comment parsing for shapes, arrows, sections, layout
- Extended `renderChart()` options mapping for axis, labels, gridlines
- New `renderShape()` function for preset shapes, gradients, arrows
- Extended image and table rendering with new options

## Dependencies

None. All features use existing PptxGenJS v3.12.0 APIs.

## Quality Gates

### Functional
- [ ] Text highlight (`==text==`) renders as yellow highlight in PowerPoint
- [ ] Character and line spacing differ visibly between simple/business/report styles
- [ ] Chart data labels display on data points when enabled
- [ ] Chart axis titles render on X and Y axes
- [ ] Preset shapes render correctly for all 17 supported types
- [ ] Gradient fills produce smooth color transitions
- [ ] Arrow connectors render with correct head/tail styles
- [ ] Image rotation, flip, and transparency work in PowerPoint
- [ ] Table rowspan merges cells vertically
- [ ] Slide sections appear in PowerPoint navigation pane
- [ ] Output compression produces smaller files
- [ ] All features work across simple/business/report styles
- [ ] Generated PPTX opens without errors in Microsoft PowerPoint (no repair needed)

### Testing
- [ ] Unit tests for new parseInlineFormatting patterns (highlight, underline styles)
- [ ] Unit tests for new HTML comment parsing (shapes, arrows, sections, layout)
- [ ] Unit tests for chart YAML option extensions
- [ ] Unit tests for bullet number format detection
- [ ] Shadow values must use fresh object copies (no PptxGenJS mutation bug)
- [ ] All existing 80 tests continue to pass

### Documentation
- [ ] SKILL.md updated with new markdown syntax for all features
- [ ] Chart YAML options table in SKILL.md includes axis, labels, gridlines

## Suggested Implementation Order

| Tier | Features | Effort | Rationale |
| --- | --- | --- | --- |
| A — Quick wins | P2 (spacing), P4 (bullet formats), P5 (data labels), P8 (bar3d), P24 (compression), P25 (theme API) | 6S | Immediate quality improvement with minimal risk |
| B — Text & charts | P1 (highlight), P3 (underline), P6 (axis titles), P7 (gridlines) | 3S + 1M | Better formatting control and chart readability |
| C — Shapes | P9 (shape library), P10 (gradients), P11 (arrows), P12 (dash), P13 (rotation), P14 (hyperlinks) | 5S + 1M | Visual variety for process flows and diagrams |
| D — Images & tables | P15 (rotation), P16 (transparency), P17 (base64), P18 (hyperlinks), P19 (row heights), P20 (rowspan), P21 (auto-page Y) | 7S | Polish pass on existing content types |
| E — Slides & presentation | P22 (sections), P23 (hidden), P26 (custom layout) | 3S | Organizational features |

## Out of Scope

- 3D chart perspective (`v3DPerspective`)
- Combination charts (multi-type chart overlay)
- Video/audio file embedding
- Custom geometry paths
- RTL text support
- Slide transitions and animations
- Vertical text orientation
- Tab stops
- Text outline, glow, and rotation (very niche text effects)

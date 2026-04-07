# Research: PPTX Viewer Quality Improvements

| | |
| --- | --- |
| **Date** | 2026-04-07 |
| **Status** | Research complete |
| **Current coverage** | 46 fully / 19 partially / 98 not supported (of 163 inventoried OOXML features) |
| **Code size** | ~1555 lines across 5 files |
| **PRD** | [pptx-viewer-v2](../prds/2026-04-07-pptx-viewer-v2.md) (Draft) |
| **Tasks** | [pptx-viewer-v2-tasks](../tasks/2026-04-07-pptx-viewer-v2-tasks.md) (21 tasks: 10S, 8M, 3L) |

## Context

The PPTX viewer renders slides by parsing OOXML XML from the `.pptx` ZIP and converting to React components. It covers ~28% of OOXML PresentationML/DrawingML features. The result: theme-based presentations have wrong colors, text spacing is off, most shapes render as rectangles, tables look generic, and charts lack labels/legends. The viewer is usable for simple text-heavy slides but breaks down on anything with visual design.

## Architecture

```
.pptx (ZIP) → pptx-parser.ts (XML → JS objects) → pptx-types.ts (data model)
  → PptxSlideRenderer.tsx (React components)
  → PptxChartRenderer.tsx (recharts)
  → PptxViewer.tsx (orchestrator, navigation, zoom, search, notes)
```

## Feature Inventory

### Text & Typography

| Feature | OOXML Element | Status | Impact | Effort |
| --- | --- | --- | --- | --- |
| Bold | `rPr@b` | Supported | - | - |
| Italic | `rPr@i` | Supported | - | - |
| Underline (single) | `rPr@u` | Supported | - | - |
| Underline styles (18 types) | `rPr@u` values | Not supported | Low | S |
| Font size | `rPr@sz` | Supported | - | - |
| Font family (Latin) | `a:latin@typeface` | Supported | - | - |
| Font family (East Asian, Complex Script) | `a:ea`, `a:cs` | Not supported | Medium (CJK decks) | S |
| Theme font refs (`+mj-lt`, `+mn-lt`) | `a:latin@typeface` | Supported | - | - |
| Font color (RGB) | `a:srgbClr` | Supported | - | - |
| Font color (scheme) | `a:schemeClr` | Supported | - | - |
| **Color transforms (lumMod/lumOff)** | `a:lumMod`, `a:lumOff` | **Stubbed** | **Critical** — wrong colors on most theme decks | **M** |
| Color transforms (tint/shade/alpha) | `a:tint`, `a:shade`, `a:alpha` | Not supported | High | M |
| **Strikethrough** | `rPr@strike` | Not supported | Medium | S |
| **Superscript / subscript** | `rPr@baseline` | Not supported | Medium | S |
| All caps / small caps | `rPr@cap` | Not supported | Low | S |
| **Character spacing** | `rPr@spc` | Not supported | Medium — text density wrong | S |
| Kerning | `rPr@kern` | Not supported | Low | S |
| Text outline | `a:ln` on run | Not supported | Low | M |
| Text shadow | `a:effectLst` on run | Not supported | Low | M |
| Text highlight | run fill | Not supported | Low | S |
| Language tag | `rPr@lang` | Not supported | Low | S |
| Line breaks | `a:br` | Supported | - | - |

### Paragraph Properties

| Feature | OOXML Element | Status | Impact | Effort |
| --- | --- | --- | --- | --- |
| Alignment (l/ctr/r/just) | `pPr@algn` | Supported | - | - |
| Bullet character | `a:buChar` | Supported | - | - |
| Bullet level | `pPr@lvl` | Supported | - | - |
| Bullet none | `a:buNone` | Supported | - | - |
| **Auto-numbered bullets** | `a:buAutoNum` | **Partial** — all rendered as dots | **High** — numbered lists look wrong | **S** |
| Bullet font / color / size | `a:buFont`, `a:buClr`, `a:buSzPct` | Not supported | Medium | S |
| Picture bullets | `a:buBlip` | Not supported | Low | M |
| **Indent / margins** | `pPr@indent`, `pPr@marL` | Not supported | Medium — indentation wrong | S |
| **Line spacing** | `a:lnSpc` | Not supported | **High** — text density wrong | **S** |
| **Space before / after** | `a:spcBef`, `a:spcAft` | Not supported | High — paragraph gaps wrong | S |
| Tab stops | `a:tabLst` | Not supported | Low | S |
| RTL text | `pPr@rtl` | Not supported | Medium (RTL users) | M |
| Default run properties | `a:defRPr` | Not supported | Medium | M |

### Body Properties (Text Containers)

| Feature | OOXML Element | Status | Impact | Effort |
| --- | --- | --- | --- | --- |
| **Auto-fit / shrink text** | `a:spAutoFit`, `a:normAutofit` | Not supported | **High** — text overflows | **M** |
| Word wrap mode | `bodyPr@wrap` | Not supported | Medium | S |
| Text columns | `bodyPr@numCol` | Not supported | Low | M |
| **Vertical anchoring** | `bodyPr@anchor` (top/mid/bottom) | Not supported | **High** — text mispositioned | **S** |
| Text rotation | `bodyPr@rot` | Not supported | Low | S |
| **Internal margins** | `bodyPr@lIns/tIns/rIns/bIns` | Not supported | **High** — text too close to edges | **S** |
| Vertical text | `bodyPr@vert` | Not supported | Medium (CJK) | M |

### Shapes & Geometry

| Feature | OOXML Element | Status | Impact | Effort |
| --- | --- | --- | --- | --- |
| Rectangle, rounded rect, ellipse | `a:prstGeom` | Supported | - | - |
| Lines, connectors | `a:prstGeom` | Supported | - | - |
| Arrow shapes (6 variants) | `a:prstGeom` | Partial — rendered as lines | Medium | S |
| **All other presets (~180)** | `a:prstGeom` | **Not supported** — rendered as rectangles | **High** — diagrams broken | **L** |
| Custom geometries (paths) | `a:custGeom` | Not supported | Medium | L |
| Solid fill | `a:solidFill` | Supported | - | - |
| Linear gradient | `a:gradFill` + `a:lin` | Supported | - | - |
| Radial gradient | `a:gradFill` + `a:path` | Partial — always centered ellipse | Low | S |
| Pattern fill | `a:pattFill` | Partial — solid fallback only | Low | M |
| Picture fill on shapes | `a:blipFill` | Not supported | Medium | M |
| Group fill | `a:grpFill` | Not supported | Low | M |
| No fill | `a:noFill` | Supported | - | - |
| Line width + color | `a:ln@w`, fill | Supported | - | - |
| **Dash styles** | `a:prstDash` | Not supported | Medium | S |
| Line arrows (head/tail) | `a:headEnd`, `a:tailEnd` | Partial — tail only | Medium | S |
| Compound lines, joins, caps | `a:cmpd`, `a:join`, `a:cap` | Not supported | Low | S |
| **Shadow** | `a:outerShdw`, `a:innerShdw` | Not supported | **High** — everything looks flat | **M** |
| Glow | `a:glow` | Not supported | Low | M |
| Soft edge | `a:softEdge` | Not supported | Low | S |
| Reflection | `a:reflection` | Not supported | Low | M |
| 3D rotation / bevel | `a:scene3d`, `a:sp3d` | Not supported | Low | L |
| Flip horizontal / vertical | `xfrm@flipH/flipV` | Not supported | Medium | S |

### Tables

| Feature | OOXML Element | Status | Impact | Effort |
| --- | --- | --- | --- | --- |
| Table structure (rows, cols) | `a:tbl`, `a:tr`, `a:tc` | Supported | - | - |
| Column widths | `a:tblGrid` | Supported | - | - |
| Row heights | `a:tr@h` | Supported | - | - |
| Cell text | `a:txBody` | Supported | - | - |
| Cell solid fill | `a:tcPr > solidFill` | Supported | - | - |
| Cell merge (colspan, rowspan) | `gridSpan`, `rowSpan`, `vMerge` | Supported | - | - |
| **Cell borders (per-side)** | `a:lnL/lnR/lnT/lnB` | Not supported — hardcoded 1px grey | **High** | **M** |
| **Cell margins** | `tcPr@marL/marT/marR/marB` | Not supported — hardcoded padding | Medium | S |
| **Cell vertical alignment** | `tcPr@anchor` | Not supported | Medium | S |
| Table styles | `a:tblStyle` | Not supported | Medium | L |
| Banded rows / columns | Theme table style | Not supported | Medium | M |
| First/last row/column formatting | Theme table style | Not supported | Medium | M |
| Cell gradient fill | `a:gradFill` | Not supported | Low | S |
| Text direction in cells | `tcPr@vert` | Not supported | Low (CJK) | S |

### Images

| Feature | OOXML Element | Status | Impact | Effort |
| --- | --- | --- | --- | --- |
| Embedded images (PNG, JPEG, GIF) | `r:embed` | Supported | - | - |
| SVG images | `r:embed` | Partial — browser-dependent | Low | S |
| WMF/EMF metafiles | `r:embed` | Partial — browsers can't render | Medium | L (conversion) |
| Image positioning + sizing | `a:xfrm` | Supported | - | - |
| Image rotation | `a:xfrm@rot` | Supported | - | - |
| **Image crop / clip** | `a:srcRect` | Not supported | **High** — cropped images show full | **M** |
| Image effects (shadow, etc.) | `a:effectLst` | Not supported | Medium | M |
| Image transparency | `a:alphaModFix` | Not supported | Medium | S |
| Linked (external) images | `r:link` | Not supported | Medium | S |
| Stretch / tile fill modes | `a:stretch`, `a:tile` | Not supported | Low | S |

### Charts

| Feature | OOXML Element | Status | Impact | Effort |
| --- | --- | --- | --- | --- |
| Bar chart (2D, 3D) | `c:barChart` | Supported (recharts) | - | - |
| Line chart | `c:lineChart` | Supported | - | - |
| Pie chart (2D, 3D) | `c:pieChart` | Supported | - | - |
| Area chart | `c:areaChart` | Supported | - | - |
| Scatter chart | `c:scatterChart` | Supported | - | - |
| Doughnut chart | `c:doughnutChart` | Supported | - | - |
| Radar chart | `c:radarChart` | Not supported | Medium | M |
| Bubble chart | `c:bubbleChart` | Not supported | Low | M |
| Stock chart | `c:stockChart` | Not supported | Low | L |
| Surface chart | `c:surfaceChart` | Not supported | Low | L |
| Combination charts | Multiple chart types | Not supported | Medium | M |
| Series data + colors | `c:ser`, `c:val`, `c:cat` | Supported | - | - |
| **Chart title** | `c:title` | Not supported | **High** — charts lack context | **S** |
| **Axis labels + formatting** | `c:catAx`, `c:valAx` | Not supported | **High** — axes unreadable | **M** |
| **Legend** | `c:legend` | Not supported | **High** — series unidentifiable | **S** |
| **Data labels** | `c:dLbls` | Not supported | High — values not shown | M |
| Gridlines styling | `c:majorGridlines` | Partial — hardcoded dashed | Low | S |
| Trendlines | `c:trendline` | Not supported | Low | M |
| Error bars | `c:errBars` | Not supported | Low | M |
| 3D perspective | `c:view3D` | Not supported — 3D rendered as 2D | Low | L |
| Secondary axes | `c:valAx` (2nd) | Not supported | Medium | M |

### Backgrounds & Masters

| Feature | OOXML Element | Status | Impact | Effort |
| --- | --- | --- | --- | --- |
| Solid fill background | `p:bgPr > solidFill` | Supported | - | - |
| Gradient background | `p:bgPr > gradFill` | Supported | - | - |
| Pattern background | `p:bgPr > pattFill` | Partial — solid fallback | Low | M |
| Image background | `p:bgPr > blipFill` | Not supported | Medium | M |
| **Slide master inheritance** | `p:sldMaster` | Not supported | **Critical** — master logos, footers, decorations missing | **L** |
| **Slide layout inheritance** | `p:sldLayout` | Not supported | **Critical** — placeholder positioning wrong | **L** |
| **Placeholder type resolution** | `p:ph@type` | Not supported | High — title/body confusion | M |
| Theme format scheme | `a:fmtScheme` | Not supported | Medium | M |
| Default text styles from master | `p:txStyles` | Not supported | Medium | M |

### SmartArt / Diagrams

| Feature | OOXML Element | Status | Impact | Effort |
| --- | --- | --- | --- | --- |
| Fallback image | `dgm:relIds` | Partial — extracts if available | - | - |
| Placeholder for missing fallback | - | Partial — grey dashed box | - | - |
| SmartArt data model | `dgm:dataModel` | Not supported | High | XL |
| Layout / visual properties | `dgm:layoutDef` | Not supported | High | XL |

### Animations & Transitions

| Feature | OOXML Element | Status | Impact | Effort |
| --- | --- | --- | --- | --- |
| Slide transitions (23 types) | `p:transition` | Not supported | Medium | L |
| Entrance animations | `p:animLst` | Not supported | Medium | XL |
| Exit / emphasis animations | `p:animLst` | Not supported | Low | XL |
| Motion paths | `p:animMotion` | Not supported | Low | XL |
| Build animations (bullet-by-bullet) | `p:bldLst` | Not supported | Medium | XL |

### Other Features

| Feature | OOXML Element | Status | Impact | Effort |
| --- | --- | --- | --- | --- |
| **Hyperlinks** | `a:hlinkClick` | Not supported | **High** — links not clickable | **S** |
| Slide headers / footers | `p:hf` | Not supported | Medium | M |
| Comments | `p:comment` | Not supported | Low | M |
| OLE embedded objects | `p:oleObj` | Not supported | Medium | L |
| Media (video, audio) | `p:extLst` | Not supported — placeholder shown | Low | L |
| Ink annotations | `p:inkLst` | Not supported | Low | L |
| Math equations (OMML) | `a:mathPara` | Not supported | Low | L |
| Sections | `p:sectionLst` | Not supported | Low | S |

## Recommended Approach

The viewer is fundamentally a "best-effort preview" — matching PowerPoint fidelity is unrealistic. However, the top 10 gaps cover ~80% of the visual quality issues users will notice.

### Tier 1 — Critical (wrong output)

These cause visibly incorrect rendering on most corporate/themed presentations:

| # | Feature | Effort | Impact |
| --- | --- | --- | --- |
| V1 | Color transforms (lumMod/lumOff/tint/shade) | M | Colors wrong on every themed deck |
| V2 | Slide master/layout inheritance | L | Master logos, footers, decorations missing |
| V3 | Body properties (autofit, anchoring, margins) | M | Text overflows and mispositioned |

### Tier 2 — High (degraded but usable)

These cause noticeable quality loss but don't make slides unreadable:

| # | Feature | Effort | Impact |
| --- | --- | --- | --- |
| V4 | Line/paragraph spacing | S | Text density wrong |
| V5 | Auto-numbered bullets | S | Numbered lists show dots |
| V6 | Table styles + cell borders | M | Tables look generic |
| V7 | Chart titles, legends, data labels | M | Charts lack context |
| V8 | Shape shadow (outer) | M | Everything looks flat |
| V9 | Image crop | M | Cropped images show full |
| V10 | Hyperlinks | S | Links not clickable |

### Tier 3 — Medium (nice-to-have)

| # | Feature | Effort | Impact |
| --- | --- | --- | --- |
| V11 | Preset geometries (~180 shapes) | L | Diagrams render as rectangles |
| V12 | Strikethrough, super/subscript | S | Text formatting incomplete |
| V13 | Flip transforms | S | Some shapes appear mirrored |
| V14 | Dash styles on lines | S | All lines solid |
| V15 | Radar/bubble charts | M | Missing chart types |

### Tier 4 — Low priority

Animations, SmartArt data model parsing, 3D effects, OLE objects, ink annotations, math equations.

## Key Files

| File | Lines | Purpose |
| --- | --- | --- |
| `src/lib/pptx-parser.ts` | 1039 | XML parsing, element extraction, theme resolution |
| `src/lib/pptx-types.ts` | ~80 | TypeScript data model |
| `src/components/editor/viewers/PptxSlideRenderer.tsx` | 352 | React element rendering |
| `src/components/editor/viewers/PptxChartRenderer.tsx` | 164 | Recharts-based chart rendering |
| `src/components/editor/viewers/PptxViewer.tsx` | ~350 | Orchestrator, navigation, zoom, search, notes |
| `src/components/editor/viewers/PptxSearchBar.tsx` | ~100 | Search hook + find bar |
| `src/components/editor/viewers/PptxZoomControls.tsx` | ~100 | Zoom hook + toolbar |

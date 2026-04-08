# PPTX Viewer — Test Matrix

Reference for manual visual verification after PPTX viewer changes.

## Test Fixture Locations

- **Primary fixtures:** `tests/fixtures/pptx/` (12 files from Apache POI test suite)
- **Integration fixture:** `tests/fixtures/test-presentation.pptx` (custom synthetic file used by `pptx-parser.test.ts`)

## Unit Test Inventory

The PPTX viewer has 14 unit test files covering parsing and rendering logic. Most tests construct XML fragments directly rather than loading fixture files. Only `pptx-parser.test.ts` loads a real PPTX from disk.

| Test file | What it covers |
| --- | --- |
| `pptx-parser.test.ts` | End-to-end parse of `test-presentation.pptx` (slides, themes, text runs, gradients, images, tables, charts, notes, search text, error handling) |
| `pptx-color-transforms.test.ts` | hex/HSL conversion, `applyColorTransforms` (lumMod, lumOff, tint, shade, satMod, gamma/invGamma), sRGB linearization |
| `pptx-clrmap.test.ts` | `resolveColor` with scheme color mapping (`schemeClr` → `clrMap` → theme lookup), alpha channel resolution |
| `pptx-tier4-features.test.ts` | Character spacing (`spc`), text caps (`cap`), image transparency (`alphaModFix`), arrow head parsing (head/tail, 5 types) |
| `pptx-text-enhancements.test.ts` | Underline styles, text highlight, strikethrough color, text shadow parsing from `effectLst` |
| `pptx-paragraph-enhancements.test.ts` | Tab stops, `defRPr` font size/bold/color inheritance, paragraph `spcBef`/`spcAft` from pPr |
| `pptx-bullet-spacing.test.ts` | `formatBulletNumber` for all auto-numbered bullet formats (arabic, alpha, roman — period and parenthesis variants) |
| `pptx-chart-enhancements.test.ts` | Data label position parsing, secondary axis detection, trendline type/order/periods, `linearRegression` computation |
| `pptx-shape-effects.test.ts` | Pattern fill parsing and CSS generation (10 presets), picture fill rendering (stretch/tile/cover), glow and soft edge effects, combined effects |
| `pptx-bugfix-shadows.test.ts` | Text-level shadow parsing from `rPr > effectLst > outerShdw` |
| `pptx-image-reflection.test.ts` | Reflection effect parsing (blur, opacity, distance, direction, scale) |
| `pptx-slide-features.test.ts` | External (linked) images, slide header/footer text, comments parsing, presentation sections |
| `pptx-table-enhancements.test.ts` | Cell gradient fills, radial gradients, table style element parsing |
| `pptx-text-inheritance.test.ts` | `resolveInheritance` — master/layout style merging, placeholder type resolution, font/color/size inheritance |
| `pptx-ole-objects.test.ts` | OLE object graphic frame parsing |

---

## Test Files

### `test-presentation.pptx`

**Location:** `tests/fixtures/test-presentation.pptx` (not in `pptx/` subdirectory)

**Features exercised:**
- Slide dimensions (16:9 widescreen)
- Theme colors (dk1, lt1, accent1) and fonts (Arial heading, Calibri body)
- Text runs with bold, italic, underline, font size, color, font family
- Paragraph alignment (centered title)
- Bullet characters
- Linear gradient background (3 stops, 90 degree angle)
- Images (PNG, base64 extraction)
- Tables with merged cells (colspan), header row fills
- Speaker notes (multi-line)
- Charts (bar chart with 2 series, 3 categories)
- Per-slide search text extraction
- Error handling (corrupted ZIP, missing presentation.xml, 0-slide files)

**Expected rendering:**
- Slide 1: Title slide with centered bold white text, gradient background, bulleted list with italic and underline formatting
- Slide 2: Image positioned at (914400, 914400) EMU, table with blue header row and merged cell spanning 2 columns
- Slide 3: Bar chart with "Sales" and "Profit" series across Q1/Q2/Q3

**Known limitations:**
- None — this is a synthetic test file designed to exercise the parser cleanly

---

### `45545_Comment.pptx`

**Features exercised:**
- Blue gradient background (top-to-bottom)
- Title text (large, yellow, centered) with text shadows
- Non-placeholder text boxes ("Access to Finance", "Antonio Vives")
- Theme `objectDefaults` for default font size and alignment on free text boxes
- Master `clrMap` color remapping
- Decorative shapes (vertical bar, horizontal band) with solid blue fills
- Red gradient bar at bottom
- Embedded OLE object (IDB logo as EMF image)
- Slide master and layout inheritance

**Expected rendering:**
- Blue gradient background covering the full slide
- Large yellow title text centered at top with visible text shadow
- "Access to Finance" text centered and bold with appropriate sizing
- "Antonio Vives" text centered below
- Narrow vertical blue bar on left, horizontal blue band across middle
- Red gradient bar at bottom of slide
- IDB logo area shows placeholder (EMF not renderable in browser)

**Known limitations:**
- EMF/WMF images render as broken or placeholder (browsers cannot display EMF natively) — accepted limitation per PRD P7
- Non-placeholder text may not pick up shape-level `lstStyle` overrides (PRD P1/P5 — in progress)
- Master `otherStyle` not yet applied to free text boxes (PRD P2)
- `spAutoFit` (grow shape to fit text) not rendered (PRD P3)
- Presentation-level `defaultTextStyle` not parsed (PRD P4)

---

### `SampleShow.pptx`

**Features exercised:**
- Basic slide with text content
- Standard slide master/layout inheritance
- Theme color application
- Text formatting and paragraph styles

**Expected rendering:**
- Clean slide with readable text using theme fonts and colors
- Layout and master background properly inherited

**Known limitations:**
- Full text style cascade not yet implemented for non-placeholder text

---

### `bar-chart.pptx`

**Features exercised:**
- Bar chart parsing (chart type detection)
- Series data extraction (names and values)
- Category labels
- Axis labels and titles
- Data labels

**Expected rendering:**
- Bar chart with clearly labeled axes
- Data series rendered as colored bars
- Category names along the horizontal axis
- Legend identifying each series

**Known limitations:**
- Secondary axes may not render correctly
- Trendlines parsed but rendering depends on chart complexity
- Data label positioning (`dLblPos`) may not precisely match PowerPoint

---

### `line-chart.pptx`

**Features exercised:**
- Line chart parsing
- Series data with point values
- Line styling and markers

**Expected rendering:**
- Line chart with data points connected by lines
- Series distinguished by color
- Axes with appropriate labels

**Known limitations:**
- Trendline overlays not yet rendered
- Marker styling may differ from PowerPoint
- Secondary axis support is basic

---

### `pie-chart.pptx`

**Features exercised:**
- Pie chart parsing
- Slice data and percentages
- Legend rendering

**Expected rendering:**
- Circular pie chart with colored slices
- Legend identifying each slice
- Slice labels or percentages visible

**Known limitations:**
- Exploded pie slices may not render with offset
- Data label formatting may differ from PowerPoint

---

### `scatter-chart.pptx`

**Features exercised:**
- Scatter (XY) chart parsing
- X/Y data point pairs
- Point markers

**Expected rendering:**
- Scatter plot with data points positioned by X/Y values
- Axes with numeric labels

**Known limitations:**
- Bubble chart overlap rendering may differ
- Trendlines for scatter data not yet rendered

---

### `radar-chart.pptx`

**Features exercised:**
- Radar chart parsing
- Radial axis categories
- Series data on radial axes

**Expected rendering:**
- Radar/spider chart with category labels around the perimeter
- Series plotted as filled or outlined polygons

**Known limitations:**
- Fill transparency on radar series may differ from PowerPoint
- Axis label positioning is approximate

---

### `shapes.pptx`

**Features exercised:**
- Various preset geometry shapes (rectangles, ellipses, arrows, stars, etc.)
- Shape fills (solid, gradient)
- Shape outlines (color, width, dash styles)
- Shape rotation and flipping (`flipH`/`flipV`)
- Preset geometry SVG path rendering (44 supported presets)
- Shape grouping

**Expected rendering:**
- Multiple shapes rendered with correct geometry
- Fills and outlines match authored colors
- Rotated shapes display at correct angles
- Grouped shapes maintain relative positioning

**Known limitations:**
- Complex preset geometries beyond the 44 supported presets render as rectangles
- 3D effects not rendered
- Shape text with custom lstStyle may not use correct defaults

---

### `backgrounds.pptx`

**Features exercised:**
- Gradient backgrounds (linear, radial)
- Solid color backgrounds
- Image/picture backgrounds (stretch and tile modes)
- Background inheritance from slide master/layout
- Scheme color backgrounds with tint/shade transforms

**Expected rendering:**
- Slides with distinct background types clearly visible
- Gradient directions and stop colors correct
- Image backgrounds properly stretched or tiled
- Master backgrounds inherited on slides without their own

**Known limitations:**
- Complex gradient paths (rect, shape) approximated as radial
- Background image crop (`srcRect`) may not be pixel-perfect

---

### `table_test.pptx`

**Features exercised:**
- Table rendering with rows and columns
- Cell background fills (solid colors)
- Cell border styling (width, color, dash style, `noFill`)
- Cell margins and vertical alignment
- Colspan/rowspan (merged cells)
- Header row styling
- Table style element parsing

**Expected rendering:**
- Table grid with visible borders
- Header row visually distinct (background color or bold text)
- Merged cells spanning correct number of columns/rows
- Cell text properly aligned and padded

**Known limitations:**
- Complex table styles from `tableStyles.xml` partially supported
- Cell gradient fills may not match PowerPoint exactly
- Banded row/column styling depends on table style parsing completeness

---

### `minimal-gradient-fill-issue.pptx`

**Features exercised:**
- Edge case gradient fill parsing
- Minimal gradient stop configurations
- Gradient angle resolution

**Expected rendering:**
- Shape or background with gradient fill renders without errors
- Gradient direction and colors are reasonable

**Known limitations:**
- Created to reproduce a specific gradient parsing bug — primarily a regression test
- Rendering may not match PowerPoint if the gradient definition is unusual

---

### `smartart-simple.pptx`

**Features exercised:**
- SmartArt detection and fallback handling
- Fallback rasterized image extraction from SmartArt

**Expected rendering:**
- SmartArt renders as a fallback image if available in the PPTX
- If no fallback image, a placeholder is shown
- Non-SmartArt elements on the same slide render normally

**Known limitations:**
- SmartArt is not natively rendered — only fallback images are supported
- Interactive SmartArt elements (click targets, animations) are not functional
- This is an accepted non-goal per the PRD

---

## Manual Testing Checklist

After any PPTX viewer change, verify the following with the fixture files:

1. **Open each file** — no parsing errors, no blank slides, no console errors
2. **Text rendering** — fonts, sizes, colors, bold/italic/underline visible
3. **Color fidelity** — scheme colors resolve correctly, gradients render smoothly
4. **Layout** — elements positioned correctly, no overlapping where unexpected
5. **Navigation** — arrow keys and click zones work, slide counter accurate
6. **Search** — Cmd+F finds text across slides, match count correct
7. **Zoom** — zoom controls work, fit-to-width/fit-to-page modes functional
8. **Dark mode** — slide content uses authored colors (not inverted), chrome follows theme

## Global Known Limitations

These apply across all test files:

- **Animations and transitions** are not rendered (non-goal)
- **3D effects** are not rendered (non-goal)
- **EMF/WMF images** show as placeholder (browser limitation)
- **SmartArt** shows fallback image only (non-goal for native rendering)
- **Text style cascade** is partially implemented — non-placeholder text may not inherit all theme/master defaults correctly (PRD P1-P6)
- **`spAutoFit`** (grow shape to fit text) is not rendered — shapes keep original dimensions
- **Pixel-perfect rendering** is not a goal — aim is "recognizably correct"

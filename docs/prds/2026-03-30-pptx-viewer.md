# PRD: PPTX Viewer

|  |  |
| --- | --- |
| **Date** | 2026-03-30 |
| **Status** | Draft |
| **Priority** | Medium |
| **Impact** | Users can view PowerPoint files directly in Notesage without switching to another app |
| **Research** | [document-format-enhancements](../research/2026-03-30-document-format-enhancements.md) |
| **Tasks** | [pptx-viewer-tasks](../tasks/2026-03-30-pptx-viewer-tasks.md) |

## Problem

Notesage supports viewing PDFs, DOCX files, EPUBs, and plain text directly in tabs — but PowerPoint files are a blind spot. Opening a `.pptx` file currently falls through to the plain text viewer, which renders garbage binary content. Users working with mixed-format projects (research notes alongside reference presentations, meeting decks, lecture slides) must leave Notesage to view `.pptx` files.

PowerPoint is the most common presentation format in professional and academic settings. Researchers reviewing conference slides, students studying lecture decks, and professionals referencing meeting materials all need to view presentations alongside their notes.

## Goals

1. **Slide-by-slide viewer** — navigate a PPTX presentation one slide at a time with left/right controls, rendering text, images, shapes, tables, charts, and gradient fills
2. **Slide counter** — "Slide 3 of 12" indicator with direct navigation
3. **Speaker notes** — toggle a panel showing the presenter notes for the current slide
4. **Find in document** — Cmd+F to search text across all slides, with match count and prev/next navigation
5. **Chart rendering** — parse chart XML and render bar, line, pie, area, scatter, and doughnut charts using a JS charting library
6. **Gradient fills** — render linear and radial gradient fills from DrawingML `a:gradFill` elements via CSS gradients
7. **Theme-adaptive** — presentation renders correctly in both light and dark mode
8. **Aspect ratio detection** — detect 16:9 vs 4:3 from PPTX metadata and render at the correct ratio
9. **Zoom controls** — zoom in/out for detailed viewing

## Non-Goals

- Editing PPTX files (view only — same as PDF and DOCX viewers)
- Animations, transitions, or timing playback — static rendering only
- Full SmartArt layout rendering (extract fallback image instead — see Unsupported Element Handling)
- 3D objects, embedded video/audio playback — display placeholder or skip
- Pattern fills (render as foreground color solid fill fallback)
- Slide overview thumbnail sidebar (v1 — can be added later)
- Presenter view (current slide + next slide + notes in split layout)
- `.ppt` (legacy binary format) support — show a "Format not supported" message suggesting conversion to `.pptx`
- PPTX-to-Markdown conversion (separate feature, exists as a planned document import)
- Custom theme/color overrides for the rendered slides
- Slide thumbnail strip in the sidebar

## User Stories

- As a researcher, I want to open a conference slide deck alongside my notes so I can reference specific slides without switching to Keynote or PowerPoint
- As a student, I want to view lecture slides in the same app as my study notes so everything is in one place
- As a professional, I want to quickly check a meeting deck a colleague shared without launching a separate application
- As a user, I want to search for specific text across all slides so I can find the slide I need without scrolling through the entire presentation
- As a user, I want to see the speaker notes for each slide so I can understand the presenter's intent behind the bullet points

## Technical Approach

### Rendering Strategy Evaluation

Three approaches were considered:

**Option A: PPTX to HTML/CSS (Frontend JS parsing)**

- Parse PPTX (which is a ZIP of XML files) in the browser using JSZip
- Extract slide XML (`ppt/slide1.xml`, etc.), parse Open XML DrawingML elements
- Render each slide as positioned HTML/CSS elements on a canvas-like container
- **Pros:** Runs entirely in frontend, no Rust dependency, matches the DOCX viewer pattern
- **Cons:** Open XML DrawingML is complex; limited fidelity for advanced shapes, charts, grouped objects

**Option B: PPTX to SVG/PNG via Rust backend**

- Parse PPTX in Rust using a crate, render each slide to SVG or rasterized PNG
- Serve images to the frontend viewer
- **Pros:** Higher potential fidelity, consistent with backend-first approach
- **Cons:** No mature Rust PPTX rendering crate exists; would require implementing a significant portion of the Open XML rendering spec

**Option C: PPTX to PDF conversion, reuse PdfViewer**

- Convert PPTX to PDF using LibreOffice headless (`soffice --convert-to pdf`) or a similar tool
- Display the result in the existing PdfViewer
- **Pros:** Highest fidelity, reuses existing infrastructure
- **Cons:** External dependency (LibreOffice must be installed), slow conversion, large dependency

**Recommended: Option A** for v1. Parse the PPTX ZIP in the frontend, extract slide XML, and render styled HTML elements. This matches the DOCX viewer pattern (mammoth.js parses DOCX to HTML in the browser). Accept that complex features (SmartArt, 3D, charts, advanced shape effects) won't render perfectly — focus on the elements that cover 80%+ of real-world slides: text boxes, images, basic shapes (rectangles, circles, lines, arrows), tables, and backgrounds.

### PPTX File Structure

A `.pptx` file is a ZIP archive containing:

```
[Content_Types].xml
_rels/.rels
ppt/
  presentation.xml          # Slide size, slide list, slide master refs
  _rels/presentation.xml.rels  # Relationships (slides, masters, themes)
  slides/
    slide1.xml              # Slide content (DrawingML shapes)
    slide2.xml
    _rels/slide1.xml.rels   # Per-slide relationships (images, layouts)
  slideMasters/
    slideMaster1.xml        # Master slide (background, placeholder styles)
  slideLayouts/
    slideLayout1.xml        # Layout templates
  theme/
    theme1.xml              # Color scheme, fonts, effects
  media/
    image1.png              # Embedded images
  notesSlides/
    notesSlide1.xml         # Speaker notes per slide
```

### Parsing Library

Use **JSZip** (already a transitive dependency via mammoth.js) to unzip the PPTX in the browser. Parse the XML files with the browser's native `DOMParser` — no additional XML library needed.

### New Module: `src/lib/pptx-parser.ts`

A pure TypeScript module that takes a `Uint8Array` (the raw PPTX bytes) and returns a structured representation:

```typescript
interface PptxPresentation {
  slideWidth: number;    // EMUs (English Metric Units, 1 inch = 914400 EMU)
  slideHeight: number;
  slides: PptxSlide[];
  theme: PptxTheme;
}

interface PptxSlide {
  index: number;         // 0-based
  elements: PptxElement[];
  background: PptxBackground | null;
  notes: string;         // Plain text speaker notes
}

type PptxElement =
  | PptxTextBox
  | PptxImage
  | PptxShape
  | PptxTable
  | PptxChart
  | PptxGroup;

interface PptxTextBox {
  type: 'textbox';
  x: number;             // Position in EMUs
  y: number;
  width: number;
  height: number;
  rotation: number;      // Degrees
  paragraphs: PptxParagraph[];
}

interface PptxParagraph {
  alignment: 'left' | 'center' | 'right' | 'justify';
  runs: PptxTextRun[];
  bulletChar: string | null;
  bulletLevel: number;
}

interface PptxTextRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontSize: number;      // Points
  fontFamily: string;
  color: string;         // Hex (#RRGGBB)
}

interface PptxImage {
  type: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  dataUrl: string;       // Base64 data URL extracted from ZIP media/
}

interface PptxShape {
  type: 'shape';
  shapeType: 'rect' | 'ellipse' | 'line' | 'arrow' | 'roundRect' | 'other';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fill: PptxFill | null;
  stroke: string | null;  // Hex color
  strokeWidth: number;
  text: PptxParagraph[];  // Shapes can contain text
}

type PptxFill =
  | { type: 'solid'; color: string }                          // Hex color
  | { type: 'linear'; angle: number; stops: PptxGradientStop[] }
  | { type: 'radial'; stops: PptxGradientStop[] }
  | { type: 'pattern'; foreground: string };                  // Fallback to solid

interface PptxGradientStop {
  position: number;  // 0–100
  color: string;     // Hex color
}

interface PptxChart {
  type: 'chart';
  x: number;
  y: number;
  width: number;
  height: number;
  chartType: 'bar' | 'line' | 'pie' | 'area' | 'scatter' | 'doughnut' | 'other';
  series: PptxChartSeries[];
  categories: string[];
}

interface PptxChartSeries {
  name: string;
  values: number[];
  color: string | null;
}

interface PptxTable {
  type: 'table';
  x: number;
  y: number;
  width: number;
  height: number;
  rows: PptxTableRow[];
}

interface PptxTableRow {
  height: number;
  cells: PptxTableCell[];
}

interface PptxTableCell {
  width: number;
  paragraphs: PptxParagraph[];
  fill: string | null;
  colspan: number;
  rowspan: number;
}

interface PptxGroup {
  type: 'group';
  x: number;
  y: number;
  width: number;
  height: number;
  children: PptxElement[];
}

interface PptxBackground {
  fill: PptxFill | null;
  imageDataUrl: string | null;
}

interface PptxTheme {
  colors: Record<string, string>;  // Scheme color name → hex
  fonts: { heading: string; body: string };
}
```

**Parsing pipeline:**

1. `JSZip.loadAsync(bytes)` — unzip the PPTX
2. Parse `ppt/presentation.xml` — extract `sldSz` (slide dimensions), slide `rId` list
3. Parse `ppt/_rels/presentation.xml.rels` — map `rId` → slide file paths
4. Parse `ppt/theme/theme1.xml` — extract color scheme (`a:clrScheme`) and font scheme (`a:fontScheme`)
5. For each slide: a. Parse `ppt/slides/slideN.xml` — iterate `p:sp` (shapes), `p:pic` (pictures), `p:graphicFrame` (tables, charts, SmartArt), `p:grpSp` (groups) b. Parse `ppt/slides/_rels/slideN.xml.rels` — resolve image `rId` references to `ppt/media/` files, chart `rId` references to `ppt/charts/` files c. Extract images as base64 data URLs from the ZIP d. For charts: parse `ppt/charts/chartN.xml` — extract chart type, series data, categories, colors e. For SmartArt: look for fallback image in relationships; extract if present f. For gradient fills: parse `a:gradFill` elements — extract stops (position + color), type (linear with angle, radial), convert to CSS gradient values g. Parse `ppt/notesSlides/notesSlideN.xml` — extract speaker notes text
6. Resolve theme colors: DrawingML uses scheme references (`schemeClr val="dk1"`) that map to theme colors

**EMU to pixel conversion:** 1 inch = 914400 EMU. At 96 DPI, 1 pixel = 9525 EMU. The renderer scales the slide to fit the viewer container while preserving aspect ratio.

### New Component: `src/components/editor/viewers/PptxViewer.tsx`

A React component that renders the parsed presentation.

**Rendering approach:**

Each slide is rendered as a positioned container (`position: relative`) with child elements absolutely positioned within it, matching the slide's coordinate system. The container is scaled to fit the viewer area while preserving the slide's aspect ratio.

```tsx
<div className="slide-container" style={{
  width: `${slideWidth}px`,
  height: `${slideHeight}px`,
  transform: `scale(${scale})`,
  transformOrigin: 'top left',
}}>
  {slide.elements.map(element => (
    <SlideElement key={element.id} element={element} />
  ))}
</div>
```

**Element rendering:**

| PPTX Element | HTML Rendering |
| --- | --- |
| Text box (`p:sp` with `p:txBody`) | `<div>` with positioned text, styled per run (font, size, color, bold/italic) |
| Image (`p:pic`) | `<img>` with base64 data URL, positioned and sized |
| Rectangle/ellipse (`p:sp` with preset geometry) | `<div>` with CSS border-radius, background (solid or gradient), border |
| Line/arrow | `<svg>` element with `<line>` or `<polyline>` |
| Table (`p:graphicFrame > a:tbl`) | HTML `<table>` with cell styles, positioned on the slide |
| Chart (`p:graphicFrame > c:chart`) | Charting component (recharts/nivo) rendered at the chart's position and size |
| Group (`p:grpSp`) | Nested container with child elements offset by group origin |
| SmartArt (`p:graphicFrame > dgm:*`) | Fallback image from `ppt/media/`, or placeholder if no fallback exists |

**Navigation:**

- Left/right arrow keys to navigate between slides
- Click on left/right edges of the slide as navigation zones (15% width)
- Slide counter in the toolbar: "Slide 3 of 12" with clickable prev/next buttons
- Direct slide jump via clicking the counter number (opens a small input for typing a slide number)

**Zoom:**

- Zoom in/out buttons in the toolbar (same step array as PdfViewer)
- "Fit to width" and "Fit to page" modes
- Cmd+= / Cmd+- / Cmd+0 keyboard shortcuts (matching PdfViewer)
- Mouse wheel zoom when holding Cmd

**Speaker notes:**

- Toggle button in toolbar to show/hide notes panel
- Notes panel appears below the slide as a collapsible section (not a separate sidebar)
- Notes rendered as styled text with proper paragraph breaks
- Panel height is 150px default, not resizable in v1

**Dark mode:**

- Slide content renders with its original colors (not inverted) — a presentation's colors are authored intentionally
- The slide sits on a neutral background that adapts to the theme: `bg-muted` (light grey in light mode, dark grey in dark mode)
- Toolbar, notes panel, and chrome elements follow the app's theme as usual

### Search Implementation

Follow the same pattern as the DOCX viewer — DOM-based search using the shared `dom-search.ts` utility.

1. All text content from all slides is rendered in the DOM (current slide visible, others with `display: none` but still in the DOM for search)
2. `Cmd+F` opens the FindBar overlay
3. `highlightDomMatches()` searches across all slides' text nodes
4. Navigation reveals the slide containing the current match and scrolls to it
5. Match count and prev/next work across all slides

**Alternative considered:** Pre-extract all text per slide (like PdfViewer's `extractAllPageText`) and do string-level search, then highlight matches on the current slide. This is more efficient for large presentations but adds complexity. For v1, DOM search is simpler and consistent with DOCX viewer.

**Chosen approach:** Hybrid — extract plain text per slide during parsing (stored in `PptxSlide.searchText`), do string-level search to find which slides contain matches and count total matches, then highlight the current slide's DOM matches when navigating to it. This avoids rendering all slides in the DOM simultaneously (which would be slow for large presentations) while still providing accurate match counts.

### File Type Routing

`src/lib/file-utils.ts`**:**

```typescript
// Add to FileType union
export type FileType = "markdown" | "pdf" | "docx" | "epub" | "pptx" | "image" | "other";

// Add to EXTENSION_MAP
pptx: "pptx",

// Add to isBinaryFileType
export function isBinaryFileType(fileType: FileType): boolean {
  return fileType === "pdf" || fileType === "docx" || fileType === "epub" || fileType === "pptx" || fileType === "image";
}
```

`src/components/editor/EditorViewerContainer.tsx`**:**

```typescript
const PptxViewer = lazy(() => import("./viewers/PptxViewer").then(m => ({ default: m.PptxViewer })));

// Add case in switch:
case "pptx":
  viewer = <PptxViewer filePath={activeTab.filePath} fileName={activeTab.fileName} />;
  break;
```

`.ppt` **handling:** When `getFileType()` returns `"pptx"` for a `.ppt` file (mapped in EXTENSION_MAP as `ppt: "pptx"`), the PptxViewer detects the `.ppt` extension and shows an unsupported format message: "Legacy .ppt format is not supported. Please convert to .pptx using PowerPoint, LibreOffice, or Google Slides."

### Unsupported Element Handling

For elements the parser cannot fully render:

- **SmartArt:** Extract the fallback rasterized image stored in the PPTX (most SmartArt shapes include a pre-rendered PNG/EMF fallback in `ppt/media/`). If no fallback image exists, show a placeholder with "SmartArt" label.
- **Embedded OLE objects:** Show a placeholder with "Embedded Object" label
- **Video/audio:** Show a placeholder with a play icon and "Media" label
- **3D effects, shadows, reflections:** Ignored — render the base shape without effects
- **Pattern fills:** Render as the pattern's foreground color (solid fill fallback)

All placeholders use a dashed border, muted text, and a centered icon — styled consistently.

### Chart Rendering

Charts are parsed from the PPTX chart XML (`c:chartSpace` in `ppt/charts/chartN.xml`) and rendered using a lightweight JS charting library.

**Parsing:**

1. Detect chart elements in slide XML (`p:graphicFrame` containing `c:chart` references)
2. Resolve chart relationship ID → `ppt/charts/chartN.xml`
3. Parse chart XML to extract: chart type (`c:barChart`, `c:lineChart`, `c:pieChart`, `c:areaChart`, `c:scatterChart`, `c:doughnutChart`), series data (`c:ser` → `c:cat` categories + `c:val` values), series labels, and colors
4. Map to a normalized chart data structure

**Rendering:**

Render charts as inline SVG or via a lightweight charting component positioned within the slide. Use the same chart rendering approach as the editor's inline charts (nivo or recharts — whichever is already a dependency). Charts are read-only but visually match the original data.

| PPTX chart type | Rendered as |
| --- | --- |
| `c:barChart` | Bar chart |
| `c:lineChart` | Line chart |
| `c:pieChart` | Pie chart |
| `c:areaChart` | Area chart |
| `c:scatterChart` | Scatter plot |
| `c:doughnutChart` | Doughnut chart |
| Other chart types | Placeholder with "Chart" label |

**Fallback:** If chart XML parsing fails or the chart type is unsupported, show a placeholder rectangle with "Chart" label and chart icon.

### Gradient Fills

DrawingML gradient fills (`a:gradFill`) are mapped to CSS gradients.

**Parsing:**

1. Detect `a:gradFill` elements on shapes, backgrounds, and table cells
2. Extract gradient stops (`a:gs` — position as percentage + color)
3. Detect gradient type: linear (`a:lin` with `ang` attribute) or path/radial (`a:path`)
4. For linear: convert the DrawingML angle (60000ths of a degree) to CSS degrees
5. For radial: map to `radial-gradient()` with center position from `a:path` `fillToRect`

**Rendering:**

```css
/* Linear gradient example */
background: linear-gradient(135deg, #1a2b5c 0%, #3d6cb9 50%, #7eb8da 100%);

/* Radial gradient example */
background: radial-gradient(ellipse at center, #ffffff 0%, #e0e0e0 100%);
```

**Fallback:** If gradient parsing fails, fall back to the first stop color as a solid fill.

### Dependencies

- **JSZip** — already a transitive dependency (mammoth.js uses it). May need to add as a direct dependency if mammoth.js doesn't re-export it. \~45KB gzipped.
- **DOMParser** — browser native, no dependency
- **No new npm packages required** for the core implementation

### Performance Considerations

- **Large presentations (50+ slides):** Only the current slide's DOM elements are fully rendered. Adjacent slides (prev/next) are pre-rendered for smooth navigation. Others are parsed but not mounted.
- **Image-heavy presentations:** Base64 data URLs are extracted from the ZIP on first parse and cached in memory. For presentations with many high-resolution images, this could use significant memory. Mitigation: lazy-extract images only when the slide is within the render window (current + 2 adjacent).
- **Initial parse time:** JSZip + XML parsing for a 20-slide presentation should complete in under 500ms. For 100+ slide presentations, show a progress indicator during parsing.
- **Memory:** Keep the parsed `PptxPresentation` in component state (not Zustand). When the tab is closed, the data is garbage collected.

## UI Mockup

```
+------------------------------------------------------------------+
| meeting-deck.pptx            [Notes] [Fit] [- 100% +]  [Search] |
+------------------------------------------------------------------+
|                                                                  |
|  +----------------------------------------------------------+   |
|  |                                                          |   |
|  |              [Slide content rendered here]               |   |
|  |                                                          |   |
|  |    Company Strategy 2026                                 |   |
|  |                                                          |   |
|  |    * Revenue targets                                     |   |
|  |    * Market expansion                                    |   |
|  |    * Product roadmap                                     |   |
|  |                                                          |   |
|  +----------------------------------------------------------+   |
|                                                                  |
|              < Slide 3 of 12 >                                   |
|                                                                  |
+------------------------------------------------------------------+
| [Speaker notes content appears here when toggled]                |
+------------------------------------------------------------------+
```

**Toolbar elements (left to right):**

1. File name (truncated, muted text)
2. Spacer
3. Notes toggle button (StickyNote icon)
4. Fit mode button (FitWidth / FitPage toggle)
5. Zoom out button (ZoomOut icon)
6. Zoom level display (e.g., "100%")
7. Zoom in button (ZoomIn icon)

**Navigation bar (below slide, centered):**

1. Previous slide button (ChevronLeft icon)
2. "Slide N of M" text (clickable number for direct jump)
3. Next slide button (ChevronRight icon)

## Testing

### Unit Tests

- `src/lib/pptx-parser.test.ts`**:**

  - Parse a minimal PPTX fixture (text box + image on one slide)
  - Verify slide dimensions extracted correctly
  - Verify text run properties (bold, italic, font size, color)
  - Verify image data URL extraction
  - Verify chart XML parsing (type, series, categories)
  - Verify gradient fill parsing (linear angle, radial, stops)
  - Verify SmartArt fallback image extraction
  - Verify speaker notes extraction
  - Verify theme color resolution
  - Handle corrupted/invalid ZIP gracefully (error, not crash)
  - Handle PPTX with 0 slides
  - Handle PPTX with missing relationships file

- `src/components/editor/viewers/PptxViewer.test.tsx`**:**

  - Renders slide content
  - Navigation updates current slide index
  - Keyboard arrow navigation works
  - Slide counter displays correct N of M
  - Notes panel toggles visibility
  - Search finds matches across slides
  - `.ppt` file shows unsupported message
  - Error state renders for corrupted files

### E2E Tests

- Open a `.pptx` file from sidebar → viewer renders first slide
- Navigate between slides using arrow keys and buttons
- Cmd+F opens find bar, search works across slides

### Test Fixtures

- `tests/fixtures/test-presentation.pptx` — 5 slides with text boxes, one image, one table, one bar chart, one gradient background, speaker notes on slide 2
- Generated programmatically or committed as a binary fixture

## Quality Gates

### Rendering Fidelity

- [ ] Text boxes render with correct font, size, color, bold/italic/underline

- [ ] Text alignment (left, center, right, justify) renders correctly

- [ ] Bullet lists render with correct indentation and bullet characters

- [ ] Images display at correct position and size

- [ ] Basic shapes (rectangles, ellipses, rounded rectangles) render with fill and stroke

- [ ] Lines and arrows render between correct coordinates

- [ ] Tables render with cell text, borders, and background colors

- [ ] Grouped elements render at correct relative positions

- [ ] Slide background color/image/gradient renders correctly

- [ ] Linear and radial gradient fills render on shapes and backgrounds

- [ ] Charts render with correct type, data, and labels (bar, line, pie, area, scatter, doughnut)

- [ ] Unsupported chart types show a labeled placeholder

- [ ] SmartArt elements display fallback image when available, placeholder when not

- [ ] Aspect ratio (16:9 vs 4:3) detected and rendered correctly

### Navigation

- [ ] Arrow keys navigate between slides

- [ ] Click on slide edges navigates prev/next

- [ ] Slide counter displays "Slide N of M" correctly

- [ ] Direct slide number input works

- [ ] First/last slide boundary behavior correct (no navigation past ends)

### Search

- [ ] Cmd+F opens find bar

- [ ] Search finds text across all slides

- [ ] Match count is correct

- [ ] Navigating to a match switches to the slide containing it

- [ ] Current match is visually highlighted

### Theme Support

- [ ] Slide content renders with its authored colors (not inverted in dark mode)

- [ ] Slide sits on a theme-appropriate neutral background

- [ ] Toolbar and chrome follow the app theme

- [ ] Notes panel follows the app theme

### Performance

- [ ] 20-slide presentation parses in under 500ms

- [ ] Slide navigation is instant (no visible delay)

- [ ] Image-heavy presentations don't freeze the UI during parse

- [ ] 100+ slide presentations display a loading indicator and remain responsive

### Graceful Degradation

- [ ] Unsupported elements show labeled placeholders (not blank space, not crashes)

- [ ] Corrupted PPTX files show an error message

- [ ] `.ppt` files show an unsupported format message with conversion guidance

- [ ] Missing images in the ZIP show a broken-image placeholder

### Accessibility

- [ ] Keyboard navigation works (arrow keys for slides, Tab for toolbar controls)

- [ ] Slide content is in the DOM for screen readers

- [ ] Zoom controls are keyboard accessible

- [ ] Focus management: opening find bar focuses the search input

## Files to Create

| File | Purpose |
| --- | --- |
| `src/lib/pptx-parser.ts` | PPTX ZIP extraction, XML parsing, structured slide data |
| `src/components/editor/viewers/PptxViewer.tsx` | Viewer component with slide rendering, navigation, zoom, notes, search |
| `src/components/editor/viewers/PptxViewer.test.tsx` | Component tests |
| `src/lib/pptx-parser.test.ts` | Parser unit tests |
| `tests/fixtures/test-presentation.pptx` | Test fixture |

## Files to Modify

| File | Change |
| --- | --- |
| `src/lib/file-utils.ts` | Add `"pptx"` to `FileType` union, `EXTENSION_MAP`, and `isBinaryFileType()` |
| `src/components/editor/EditorViewerContainer.tsx` | Add lazy-loaded `PptxViewer` and `case "pptx"` in the switch |
| `docs/features/document-formats.md` | Add PPTX Viewer section |
| `docs/architecture.md` | Update viewer list if needed |

## Future Enhancements

- Slide overview thumbnail sidebar for quick navigation in large presentations
- Presenter view (current slide + next slide + notes in a split layout)
- PPTX-to-Markdown conversion (extract text as structured markdown with headings per slide)
- Animation timeline scrubbing (render animation steps as discrete frames)
- Pattern fill rendering (hatching, crosshatch, etc. via SVG patterns)
- Full SmartArt layout rendering (currently uses fallback images)
- Slide comparison (diff two versions of a presentation)
- Print/export current slide as PNG
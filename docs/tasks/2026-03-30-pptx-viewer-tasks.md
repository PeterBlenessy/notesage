# PPTX Viewer — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-03-30 |
| **Status** | Complete |
| **PRD** | [pptx-viewer](../prds/2026-03-30-pptx-viewer.md) |
| **Total** | 16 tasks: 4S, 7M, 5L |
| **Suggested order** | Types (#1) → Parser core (#2-#5) → File routing (#6) → Viewer shell (#7-#9) → Advanced rendering (#10-#12) → Search (#13) → Tests (#14-#15) → Docs (#16) |

**Risks:**

- DrawingML XML is deeply nested and vendor-quirky — chart and gradient parsing may need iterative refinement against real-world PPTX files
- Image-heavy presentations could spike memory if all base64 data URLs are extracted eagerly — lazy extraction (task #5) mitigates this
- JSZip may need to be added as a direct dependency if mammoth.js doesn't re-export it

---

### #1 — Define PPTX TypeScript types ✅

**Description:** Create the type definitions for the parsed PPTX data model (`PptxPresentation`, `PptxSlide`, `PptxElement`, `PptxTextBox`, `PptxImage`, `PptxShape`, `PptxTable`, `PptxChart`, `PptxGroup`, `PptxBackground`, `PptxTheme`, `PptxFill`, `PptxGradientStop`, `PptxParagraph`, `PptxTextRun`, etc.) as specified in the PRD. These types are the contract between the parser and the viewer.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- Create `src/lib/pptx-types.ts`

---

### #2 — Implement core PPTX parser — ZIP extraction, presentation metadata, and theme ✅

**Description:** Create `src/lib/pptx-parser.ts` with the main `parsePptx(bytes: Uint8Array): Promise<PptxPresentation>` entry point. Implement:

1. JSZip unzipping of the PPTX file
2. Parse `ppt/presentation.xml` to extract slide dimensions (`sldSz`) and slide `rId` list
3. Parse `ppt/_rels/presentation.xml.rels` to map `rId` → slide file paths
4. Parse `ppt/theme/theme1.xml` to extract color scheme (`a:clrScheme`) and font scheme (`a:fontScheme`)
5. Stub out per-slide parsing (delegate to task #3)

Add JSZip as a direct dependency if not already directly available. Use browser-native `DOMParser` for XML.

**Acceptance criteria:**

- Given a valid PPTX, returns correct slide dimensions and theme colors
- Given an invalid/corrupted ZIP, throws a descriptive error (not crash)
- Given a PPTX with 0 slides, returns empty slides array

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #1 **Files:**

- Create `src/lib/pptx-parser.ts`
- Possibly `package.json` (add `jszip` direct dependency)

---

### #3 — Implement slide element parsing — text boxes, images, shapes, groups ✅

**Description:** Extend the parser to iterate each slide's XML (`ppt/slides/slideN.xml`) and extract:

1. Text boxes (`p:sp` with `p:txBody`) — position, size, rotation, paragraphs with styled text runs (bold, italic, underline, font size, font family, color), alignment, bullet lists
2. Images (`p:pic`) — position, size, rotation, resolve `rId` via per-slide `.rels` to `ppt/media/*`, extract as base64 data URL
3. Basic shapes (`p:sp` with preset geometry) — rect, ellipse, roundRect, line, arrow, other; fill (solid), stroke, strokeWidth, text content
4. Groups (`p:grpSp`) — recursive child element parsing with offset transforms
5. Theme color resolution — `schemeClr val="dk1"` mapped to theme hex values
6. Slide background parsing (solid fill, image)
7. Speaker notes — parse `ppt/notesSlides/notesSlideN.xml` to extract plain text

**Acceptance criteria:**

- Text runs have correct bold/italic/underline/fontSize/fontFamily/color
- Images extracted as valid base64 data URLs
- Groups contain correctly offset children
- Speaker notes extracted as plain text

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #2 **Files:**

- Modify `src/lib/pptx-parser.ts`

---

### #4 — Implement table parsing ✅

**Description:** Parse table elements (`p:graphicFrame > a:tbl`) from slide XML:

1. Extract rows and cells with dimensions
2. Parse cell text content (reuse paragraph/run parsing from #3)
3. Extract cell fill colors and border styles
4. Handle colspan/rowspan via `gridSpan` and `vMerge`/`hMerge` attributes

**Acceptance criteria:**

- Tables with merged cells parse correctly
- Cell text styling preserved
- Cell background colors extracted

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #3 **Files:**

- Modify `src/lib/pptx-parser.ts`

---

### #5 — Implement chart parsing and gradient fills ✅

**Description:** Extend the parser for:

**Charts:**

1. Detect chart elements in slide XML (`p:graphicFrame` containing `c:chart` references)
2. Resolve chart relationship ID → `ppt/charts/chartN.xml`
3. Parse chart XML: extract chart type (`c:barChart`, `c:lineChart`, `c:pieChart`, `c:areaChart`, `c:scatterChart`, `c:doughnutChart`), series data, categories, colors
4. Map to `PptxChart` type; unsupported types get `chartType: 'other'`

**Gradient fills:**

1. Parse `a:gradFill` elements on shapes, backgrounds, and table cells
2. Extract stops (position + color), type (linear with angle, radial)
3. Convert DrawingML angle (60000ths of a degree) to CSS degrees
4. Map to `PptxFill` union type (`linear` or `radial`)

**SmartArt fallback:**

1. Detect SmartArt in `p:graphicFrame`
2. Look for fallback rasterized image in relationships
3. If present, extract as `PptxImage`; if not, create placeholder element

**Acceptance criteria:**

- Bar chart with 2 series and 5 categories parses correctly
- Linear gradient with 3 stops returns correct angle and colors
- SmartArt with fallback image returns the image

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #3 **Files:**

- Modify `src/lib/pptx-parser.ts`

---

### #6 — Add PPTX file type routing ✅

**Description:** Wire up PPTX as a recognized file type:

1. Add `"pptx"` to the `FileType` union in `file-utils.ts`
2. Add `pptx: "pptx"` and `ppt: "pptx"` to `EXTENSION_MAP`
3. Add `"pptx"` to `isBinaryFileType()`
4. Add lazy-loaded `PptxViewer` import and `case "pptx"` in `EditorViewerContainer.tsx`

Follow the exact pattern of the existing DOCX/PDF/EPUB viewers.

**Complexity:** S **Category:** frontend **Dependencies:** None (viewer component can be stubbed initially) **Files:**

- Modify `src/lib/file-utils.ts`
- Modify `src/components/editor/EditorViewerContainer.tsx`

---

### #7 — Implement PptxViewer shell — slide rendering and navigation ✅

**Description:** Create `PptxViewer.tsx` with:

 1. Load PPTX bytes from Tauri backend (`read_binary_file` or equivalent), parse via `parsePptx()`
 2. Loading state with spinner during parse
 3. Error state for corrupted files
 4. `.ppt` extension detection → show "Legacy format not supported" message
 5. Slide container with `position: relative`, child elements absolutely positioned, scaled to fit viewer area while preserving aspect ratio (16:9 vs 4:3)
 6. Render text boxes as `<div>` with styled text runs
 7. Render images as `<img>` with base64 data URLs
 8. Render slide backgrounds (solid fill, image)
 9. Navigation: left/right arrow keys, clickable edge zones (15% width), slide counter ("Slide N of M") with prev/next buttons
10. Direct slide jump via clickable counter number

Follow the existing viewer patterns (PdfViewer, DocxViewer) for component structure, toolbar placement, and theme integration.

**Acceptance criteria:**

- First slide renders on open
- Arrow keys and edge clicks navigate between slides
- Slide counter shows correct N of M
- Cannot navigate past first/last slide
- Loading spinner shown during parse
- Error message shown for corrupted files
- `.ppt` files show unsupported format message

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #1, #2, #3, #6 **Files:**

- Create `src/components/editor/viewers/PptxViewer.tsx`

---

### #8 — Implement zoom controls and fit modes ✅

**Description:** Add zoom functionality to PptxViewer:

1. Zoom in/out buttons in toolbar (same step array as PdfViewer: 50%, 75%, 100%, 125%, 150%, 200%)
2. "Fit to width" and "Fit to page" toggle modes
3. Keyboard shortcuts: Cmd+= (zoom in), Cmd+- (zoom out), Cmd+0 (reset to fit)
4. Cmd+scroll wheel zoom
5. Zoom level display in toolbar (e.g., "100%")

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #7 **Files:**

- Modify `src/components/editor/viewers/PptxViewer.tsx`

---

### #9 — Implement speaker notes panel ✅

**Description:** Add a toggleable speaker notes panel below the slide:

1. Toggle button in toolbar (StickyNote icon from lucide-react)
2. Notes panel appears below the slide as a collapsible section
3. Renders current slide's notes as styled text with paragraph breaks
4. 150px default height
5. Panel follows app theme (not slide colors)
6. Empty state: muted "No notes for this slide" text

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #7 **Files:**

- Modify `src/components/editor/viewers/PptxViewer.tsx`

---

### #10 — Implement shape and line rendering ✅

**Description:** Add rendering for basic shapes and lines:

1. Rectangles/rounded rectangles: `<div>` with CSS border-radius, background color, border
2. Ellipses: `<div>` with `border-radius: 50%`
3. Lines: `<svg>` with `<line>` element
4. Arrows: `<svg>` with `<line>` and arrowhead marker
5. Shape text content: render paragraphs inside shape divs
6. Gradient fills on shapes: convert `PptxFill` to CSS `linear-gradient()` or `radial-gradient()`
7. Pattern fill fallback: render as solid foreground color

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #7 **Files:**

- Modify `src/components/editor/viewers/PptxViewer.tsx` (or extract `SlideElement.tsx` sub-component)

---

### #11 — Implement table rendering ✅

**Description:** Render parsed tables within slides:

1. HTML `<table>` positioned absolutely on the slide
2. Cell text with styling (reuse text run rendering from #7)
3. Cell background colors and borders
4. Colspan/rowspan via HTML attributes
5. Row height and column width from parsed data

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #4, #7 **Files:**

- Modify `src/components/editor/viewers/PptxViewer.tsx`

---

### #12 — Implement chart rendering and unsupported element placeholders ✅

**Description:**

**Charts:**

1. Render parsed `PptxChart` elements using recharts (already a project dependency)
2. Map chart types: bar → BarChart, line → LineChart, pie → PieChart, area → AreaChart, scatter → ScatterChart, doughnut → PieChart with inner radius
3. Position charts absolutely within the slide container
4. Read-only rendering — no tooltips or interactions needed
5. Fallback placeholder for `chartType: 'other'`

**Placeholders:**

1. SmartArt without fallback image → dashed border placeholder with "SmartArt" label
2. Embedded OLE objects → placeholder with "Embedded Object" label
3. Video/audio → placeholder with play icon and "Media" label
4. Consistent placeholder styling: dashed border, muted text, centered icon

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #5, #7 **Files:**

- Modify `src/components/editor/viewers/PptxViewer.tsx`

---

### #13 — Implement find-in-document search ✅

**Description:** Add Cmd+F search across all slides using the hybrid approach from the PRD:

1. During parsing, store plain text per slide in `PptxSlide.searchText`
2. On Cmd+F, open the shared FindBar overlay
3. String-level search across all slides' `searchText` to count total matches and identify which slides contain matches
4. When navigating to a match, switch to the containing slide and highlight using DOM-based `dom-search.ts` utility
5. Match count and prev/next navigation across all slides
6. Current match visually highlighted, other matches on the current slide highlighted with neutral grey

**Acceptance criteria:**

- Cmd+F opens find bar
- Search finds matches across all slides
- Navigating to a match switches to the correct slide
- Match count is accurate
- Escape closes find bar

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #7 **Files:**

- Modify `src/components/editor/viewers/PptxViewer.tsx`
- Modify `src/lib/pptx-parser.ts` (add `searchText` field extraction)

---

### #14 — Write parser unit tests ✅

**Description:** Create comprehensive unit tests for the PPTX parser:

1. Create or commit a minimal test PPTX fixture (`tests/fixtures/test-presentation.pptx`) with 3-5 slides containing: text boxes, one image, one table, one chart, one gradient background, speaker notes on at least one slide
2. Test cases:
   - Parse minimal PPTX: correct slide count, dimensions
   - Text run properties: bold, italic, font size, color
   - Image data URL extraction: valid base64
   - Table parsing: rows, cells, merged cells
   - Chart parsing: type, series, categories
   - Gradient fill parsing: linear angle, radial, stops
   - Speaker notes extraction
   - Theme color resolution
   - Handle corrupted/invalid ZIP: throws error
   - Handle PPTX with 0 slides: empty array
   - Handle missing relationships file: graceful degradation

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #2, #3, #4, #5 **Files:**

- Create `src/lib/pptx-parser.test.ts`
- Create `tests/fixtures/test-presentation.pptx` (binary fixture)

---

### #15 — Write viewer component tests ✅

**Description:** Create component tests for PptxViewer:

1. Renders slide content given parsed data
2. Navigation updates current slide index
3. Keyboard arrow navigation works
4. Slide counter displays correct N of M
5. Notes panel toggles visibility
6. `.ppt` file shows unsupported message
7. Error state renders for corrupted files
8. Zoom controls update scale

Mock the parser module and Tauri IPC to isolate component behavior.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #7, #8, #9 **Files:**

- Create `src/components/editor/viewers/PptxViewer.test.tsx`

---

### #16 — Update documentation ✅

**Description:** Update project docs to reflect the new PPTX viewer:

1. Add PPTX Viewer section to `docs/features/document-formats.md` (rendering, navigation, search, chart rendering, gradient fills, key files)
2. Update `docs/architecture.md` viewer list if needed
3. Mark the PRD status as complete
4. Update research doc pipeline table status

**Complexity:** S **Category:** frontend **Dependencies:** Depends on all previous tasks **Files:**

- Modify `docs/features/document-formats.md`
- Modify `docs/prds/2026-03-30-pptx-viewer.md` (status → Complete)
- Modify `docs/research/2026-03-30-document-format-enhancements.md` (tasks row status)
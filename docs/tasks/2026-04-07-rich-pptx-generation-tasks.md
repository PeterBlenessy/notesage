# Rich PPTX Generation — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-04-07 |
| **Status** | Not started |
| **PRD** | [rich-pptx-generation](../prds/2026-04-07-rich-pptx-generation.md) |
| **Research** | [pptx-generation-quality](../research/2026-04-07-pptx-generation-quality.md) |
| **Total** | 18 tasks: 9S, 7M, 2L |
| **Suggested order** | Tier 1 quick wins (#1-#5) → Slide masters (#6) → Charts (#7-#8) → Two-column + callouts (#9-#10) → Tables (#11) → Tier 3 (#12-#16) → Tier 4 (#17-#18) |

**Risks:**

- G6 (charts) adds a YAML parsing dependency (`js-yaml`) or requires a lightweight inline parser. Evaluate whether a simple regex-based YAML subset parser is sufficient or if `js-yaml` should be added to `package.json`.
- G7 (slide masters) is an architectural refactor — current ad-hoc positioning moves into master definitions. Must verify all three built-in styles + custom templates still work after the refactor.
- G8 (two-column) introduces new markdown syntax (`:::columns`). The agent SKILL.md must clearly document this or agents won't use it.
- G11 (overflow handling) requires height estimation for each content type. Inaccurate estimates cause split at wrong points.

**Feature Progress:**

| Feature | Tier | Tasks | Status |
| --- | --- | --- | --- |
| G1 — Hyperlinks | 1 | #1 | Done |
| G2 — Presentation metadata | 1 | #2 | Done |
| G3 — Built-in slide numbers | 1 | #3 | Done |
| G4 — Subscript / superscript | 1 | #4 | Done |
| G5 — Title shadows | 1 | #5 | Done |
| G6 — Charts from YAML | 2 | #7-#8 | Done |
| G7 — Slide masters | 2 | #6 | Done |
| G8 — Two-column layout | 2 | #9 | Done |
| G9 — Callout / accent shapes | 2 | #10 | Done |
| G10 — Auto-page tables | 2 | #11 | Done |
| G11 — Content overflow | 3 | #12 | Not started |
| G12 — Background images | 3 | #13 | Not started |
| G13 — Image enhancements | 3 | #14 | Not started |
| G14 — Table enhancements | 3 | #15 | Not started |
| G15 — Scatter/radar/bubble | 3 | #16 | Not started |
| G16 — YouTube embedding | 4 | #17 | Not started |
| G17 — Custom geometry | 4 | \- | Not planned |
| G18 — HTML table import | 4 | #18 | Not started |

---

### #1 — Add hyperlink support (G1) ✅

**Description:** Update `parseInlineFormatting()` to emit `hyperlink: { url }` on link text runs instead of stripping URLs. Handle both external URLs (`http/https/mailto`) and internal cross-slide references (`#slide-N` → `{ slide: N }`). Add hyperlink support to table cells.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `bundled-skills/generate-presentation/scripts/generate.mjs` — update `parseInlineFormatting()`, table cell rendering
- `bundled-skills/generate-presentation/SKILL.md` — document link syntax and cross-slide refs

**Acceptance criteria:**

- `[text](https://example.com)` → clickable hyperlink in PowerPoint
- `[see results](#slide-5)` → navigates to slide 5
- Table cell links render as clickable
- External links open in browser from PowerPoint

---

### #2 — Add presentation metadata from frontmatter (G2) ✅

**Description:** Parse optional YAML frontmatter from the input markdown for `author`, `company`, `title`, `subject`. Apply to `pptx.author`, `.company`, `.title`, `.subject`. Fall back to deriving `title` from the first H1 heading when no frontmatter is present.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `bundled-skills/generate-presentation/scripts/generate.mjs` — frontmatter parsing, metadata application
- `bundled-skills/generate-presentation/SKILL.md` — document frontmatter fields

**Acceptance criteria:**

- YAML frontmatter `author: Jane Doe` appears in PowerPoint File &gt; Properties
- `title` derived from first H1 when no frontmatter
- Missing fields left empty (no errors)

---

### #3 — Replace manual slide numbers with slideNumber API (G3) ✅

**Description:** Replace the manual `slide.addText(si + 1, ...)` slide number rendering with `slide.slideNumber = { x, y, w, h, fontSize, color }`. Position and style using theme colors. Skip on title-only slides.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `bundled-skills/generate-presentation/scripts/generate.mjs` — replace addText slide number with slideNumber API

**Acceptance criteria:**

- Slide numbers render via `<p:sldNum>` in OOXML (not `<a:t>` text)
- Position matches existing placement
- Title-only slides have no slide number

---

### #4 — Add subscript and superscript formatting (G4) ✅

**Description:** Extend `parseInlineFormatting()` to detect `~text~` (subscript) and `^text^` (superscript) patterns. Emit text runs with `subscript: true` or `superscript: true`.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `bundled-skills/generate-presentation/scripts/generate.mjs` — extend regex in `parseInlineFormatting()`
- `bundled-skills/generate-presentation/SKILL.md` — document sub/superscript syntax

**Acceptance criteria:**

- `H~2~O` renders with lowered "2" in PowerPoint
- `x^2^` renders with raised "2"
- Nested with bold/italic: `**H~2~O**` works

---

### #5 — Add subtle shadow to title text (G5) ✅

**Description:** Add a `shadow` property to title text options. Make it configurable per style: business and report get shadows (`{ type: "outer", blur: 3, offset: 1, opacity: 0.25, angle: 45, color: "000000" }`), simple does not. Apply to non-title-only slides only.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `bundled-skills/generate-presentation/scripts/generate.mjs` — add shadow to title addText options

**Acceptance criteria:**

- Business/report style titles have visible subtle shadow in PowerPoint
- Simple style titles have no shadow
- Title-only slides have no shadow (centered title doesn't need it)

---

### #6 — Implement slide master definitions (G7) ✅

**Description:** Add `defineSlideMasters(pptx, theme)` function that creates reusable masters: `TITLE_SLIDE`, `SECTION_HEADER`, `CONTENT`, `TWO_CONTENT`, `PICTURE`, `BLANK`. Each master defines background, placeholders (title, body, picture), slide numbers, and accent elements (bar for business style).

Refactor `generatePptx()` to use `pptx.addSlide({ masterName })` instead of manual element placement. Move accent bar, slide number, and background setup into master definitions.

**Complexity:** M **Category:** frontend **Dependencies:** None (but do #3 first so slide numbers use the API) **Files:**

- `bundled-skills/generate-presentation/scripts/generate.mjs` — new `defineSlideMasters()`, refactor `generatePptx()`

**Acceptance criteria:**

- OOXML contains `slideMaster*.xml` entries (verify in ZIP)
- All three built-in styles produce correct masters
- Custom templates produce masters with extracted theme
- Content slides use `CONTENT` master, title slides use `TITLE_SLIDE`
- Visual output matches current rendering (no regressions)

---

### #7 — Add chart YAML parser (G6 — parsing) ✅

**Description:** Detect ```` ```chart ```` code blocks in the markdown parser. Parse the YAML content into a chart data model: `{ type, title, labels, series, options }`. Add `chart` content type to the slide model.

For YAML parsing: use a lightweight approach — `js-yaml` via dynamic `import()` if available, or a simple regex-based parser for the flat YAML structure used in chart blocks (top-level keys, arrays, nested objects one level deep).

Validate required fields (`type`, `series`). On parse failure, fall back to rendering as a regular code block.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `bundled-skills/generate-presentation/scripts/generate.mjs` — chart block detection in `parseMarkdown()`, YAML parsing
- `bundled-skills/generate-presentation/scripts/package.json` — add `js-yaml` dependency if used

**Acceptance criteria:**

- ```` ```chart ```` blocks parsed into chart data model
- Invalid YAML falls back to code block rendering
- All chart types recognized: bar, line, pie, doughnut, area, scatter, radar, bubble
- `labels`, `series[].name`, `series[].values` correctly extracted

---

### #8 — Render charts via PptxGenJS (G6 — rendering) ✅

**Description:** Implement `renderChart(slide, chartItem, theme, pptx)` function that maps the parsed chart data to PptxGenJS `addChart()` calls.

For each chart type:

- Map `type` string to `pptx.charts.*` constant
- Transform `series` to PptxGenJS format: `{ name, labels, values }`
- Apply theme colors as `chartColors` (6-color palette per style)
- Set chart title, legend, axis labels from chart data
- Position chart in available slide area (full-width if sole content, half-width if alongside other content)
- Apply chart-specific options: `barDir`, `lineSmooth`, `holeSize`, `radarStyle`, etc.

Initial chart types: `bar`, `line`, `pie`, `doughnut`, `area`.

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #7 **Files:**

- `bundled-skills/generate-presentation/scripts/generate.mjs` — new `renderChart()` function, chart color palettes
- `bundled-skills/generate-presentation/SKILL.md` — chart section with YAML syntax, types, and options

**Acceptance criteria:**

- Bar chart with 2 series renders with correct data, labels, legend
- Line chart renders with smooth/straight options
- Pie chart renders with percentage labels
- Doughnut chart renders with configurable hole size
- Area chart renders with fill
- Chart colors match active theme palette

---

### #9 — Add two-column layout support (G8) ✅

**Description:** Detect `:::columns` / `:::` block syntax in the markdown parser. `---column---` separator splits content into left and right columns. Map to `TWO_CONTENT` slide master. Left column: `x: 0.8, w: 5.5`, right column: `x: 7.0, w: 5.5`. Each column independently supports bullets, text, images, tables.

Optionally auto-detect two consecutive bullet lists on the same slide as a two-column candidate (heuristic, not required).

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #6 (slide masters) **Files:**

- `bundled-skills/generate-presentation/scripts/generate.mjs` — `:::columns` parser, column rendering
- `bundled-skills/generate-presentation/SKILL.md` — document column syntax

**Acceptance criteria:**

- `:::columns` with `---column---` separator produces side-by-side content
- Each column supports bullets, text, images independently
- Layout uses half-width positioning

---

### #10 — Add callout and accent shapes (G9) ✅

**Description:** Detect `:::callout` block syntax in the markdown parser. Render as `roundRect` shapes with theme-colored fill, border, and optional shadow. Support `:::highlight` for key metric boxes (larger font, centered, accent background).

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `bundled-skills/generate-presentation/scripts/generate.mjs` — `:::callout` / `:::highlight` parser, shape rendering
- `bundled-skills/generate-presentation/SKILL.md` — document callout/highlight syntax

**Acceptance criteria:**

- `:::callout` renders as rounded rectangle with accent fill/border
- `:::highlight` renders as large centered metric box
- Theme colors applied correctly
- Text inside callout supports bold/italic formatting

---

### #11 — Enable auto-page for large tables (G10) ✅

**Description:** Enable `autoPage: true` on all table `addTable()` calls. Set `autoPageRepeatHeader: true` and `autoPageHeaderRows: 1`. Remove the manual height capping (`Math.min(rows.length * 0.4, 3.5)`). Continuation slides inherit background and style.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `bundled-skills/generate-presentation/scripts/generate.mjs` — update table rendering options

**Acceptance criteria:**

- Tables with &gt;10 rows auto-split across slides
- Header row repeated on each continuation slide
- Background and style consistent on continuation slides

---

### #12 — Add content overflow detection and slide splitting (G11)

**Description:** Track `curY` during content rendering. Before each content item, estimate its height. If `curY + height > MAX_CONTENT_BOTTOM`, create a continuation slide with title + "(cont.)". Reset `curY` and continue.

Implement `estimateContentHeight(item, theme)` for each content type:

- Bullets: \~0.35" per item + nesting
- Text paragraph: \~0.4" per paragraph
- Code block: line count \* 0.25"
- Table: row count \* 0.4" (but auto-page handles overflow)
- Image: image height from positioning
- Chart: fixed 4.5"

Split bullet lists at item boundaries (never mid-item).

**Complexity:** L **Category:** frontend **Dependencies:** None **Files:**

- `bundled-skills/generate-presentation/scripts/generate.mjs` — height estimation, continuation slide logic

**Acceptance criteria:**

- Slide with &gt;8 bullet items splits into two slides
- Continuation has title with "(cont.)" suffix
- Content continues seamlessly on the next slide
- Mixed content types (bullets + table + image) handled

---

### #13 — Add background image support (G12)

**Description:** Parse `<!-- background: path -->` HTML comments as slide background directives. Resolve relative paths from the input markdown directory. Support `<!-- background: path overlay=0.4 -->` for semi-transparent overlay.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `bundled-skills/generate-presentation/scripts/generate.mjs` — background comment parser, `slide.background` with path/data
- `bundled-skills/generate-presentation/SKILL.md` — document background syntax

**Acceptance criteria:**

- `<!-- background: ./bg.jpg -->` sets slide background image
- Overlay option adds semi-transparent color on top
- Missing image file produces clear error, not crash

---

### #14 — Add image enhancements (G13)

**Description:** Pass `altText` from markdown image alt text. Add subtle shadow to images by default (style-dependent). Support sizing keywords: `![alt](path "cover")` for crop-to-fill, `![alt](path "round")` for circular crop.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `bundled-skills/generate-presentation/scripts/generate.mjs` — alt text, shadow, sizing keywords
- `bundled-skills/generate-presentation/SKILL.md` — document image keywords

**Acceptance criteria:**

- Alt text appears in PowerPoint accessibility info
- Images have subtle shadow on business/report styles
- `"round"` keyword produces circular crop
- `"cover"` keyword produces crop-to-fill sizing

---

### #15 — Add table enhancements (G14)

**Description:** Apply per-side borders (heavier bottom border on header row, lighter internal borders). Detect colspan via `||` empty adjacent cells in markdown tables. Better alternating row colors using theme colors with transparency.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `bundled-skills/generate-presentation/scripts/generate.mjs` — per-side borders, colspan detection, alternating rows

**Acceptance criteria:**

- Header row has heavier bottom border
- Internal borders lighter than outer borders
- Alternating row colors visible with theme transparency
- `||` empty cells merge via colspan

---

### #16 — Add scatter, radar, and bubble chart types (G15)

**Description:** Extend the chart renderer (#8) to support scatter, radar, and bubble chart types. Scatter/bubble use `{ x, y }` or `{ x, y, size }` value format. Radar uses `labels` + `values` like bar/line.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #7, #8 **Files:**

- `bundled-skills/generate-presentation/scripts/generate.mjs` — extend `renderChart()` for scatter/radar/bubble
- `bundled-skills/generate-presentation/SKILL.md` — document scatter/radar/bubble YAML syntax

**Acceptance criteria:**

- Scatter chart renders XY data points
- Radar chart renders with polar grid and categories
- Bubble chart renders with sized circles
- `radarStyle` option works (standard/marker/filled)

---

### #17 — Add YouTube video embedding (G16)

**Description:** Detect YouTube URLs in `<!-- youtube: URL -->` HTML comments. Convert to embed format and add via `slide.addMedia({ type: "online", link })`.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `bundled-skills/generate-presentation/scripts/generate.mjs` — YouTube comment parser, `addMedia()` call
- `bundled-skills/generate-presentation/SKILL.md` — document YouTube syntax

**Acceptance criteria:**

- YouTube URL embedded as online media in PowerPoint
- Standard `youtube.com/watch?v=` and `youtu.be/` URLs supported
- Placeholder image shown in slide (PowerPoint renders on click)

---

### #18 — Add HTML table import support (G18)

**Description:** Implement `pptx.tableToSlides()` support for converting HTML table strings to slides. Requires a minimal DOM via `jsdom` or `linkedom`. Low priority — markdown tables already work well.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `bundled-skills/generate-presentation/scripts/generate.mjs` — HTML table detection, jsdom integration
- `bundled-skills/generate-presentation/scripts/package.json` — add `linkedom` dependency

**Acceptance criteria:**

- HTML table in markdown (raw `<table>` tags) converted to PowerPoint table
- Auto-paging works for large HTML tables
- Falls back to text rendering if DOM library not available
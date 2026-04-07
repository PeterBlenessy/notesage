# PPTX Viewer Quality v2 — Tier 4 Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-04-07 |
| **Status** | Complete |
| **PRD** | [pptx-viewer-v2](../prds/2026-04-07-pptx-viewer-v2.md) |
| **Research** | [pptx-viewer-quality](../research/2026-04-07-pptx-viewer-quality.md) |
| **Total** | 8 tasks: 6S, 2M |
| **Suggested order** | Quick wins (#1-#4) → Image backgrounds (#5-#6) → Headers/footers (#7) → Tests (#8) |

**Notes:**

- V20 (bullet font/color/size) was already implemented as part of V5 in the Tier 1-3 cycle.
- All tasks touch `pptx-parser.ts`, `pptx-types.ts`, and `PptxSlideRenderer.tsx` — the same three core files. Tasks #1-#4 are small and independent so they can run in parallel. Tasks #5-#6 are independent from #1-#4. Task #7 depends on master/layout infrastructure from V2.
- V16 (slide transitions) and V17 (additional chart types) remain not planned — high effort, low impact for a static viewer.

**Feature Progress:**

| Feature | Tasks | Status |
| --- | --- | --- |
| V18 — Character spacing | #1 | Done |
| V21 — Text caps | #2 | Done |
| V23 — Image transparency | #3 | Done |
| V24 — Line head/tail arrows | #4 | Done |
| V19 — Image backgrounds | #5-#6 | Done |
| V22 — Slide headers and footers | #7 | Done |
| Tests | #8 | Done |

---

### #1 — Parse and render character spacing (V18) ✅

**Description:** Parse `rPr@spc` (letter spacing in 1/100ths of a point) and render as CSS `letter-spacing`.

Parse: In `parseTextRuns()`, read the `spc` attribute from `rPr`. Value is in 1/100ths of a point (e.g., `300` = 3pt, `-50` = -0.5pt). Convert to `em` or `pt` for CSS.

Render: Add `letterSpacing` to the run `<span>` style in `ParagraphsRenderer` / `RunRenderer`.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — read `rPr@spc` in `parseTextRuns()`
- `src/lib/pptx-types.ts` — add `letterSpacing?: number` (in pt) to `PptxTextRun`
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — apply CSS `letterSpacing`

**Acceptance criteria:**

- Text with `spc="300"` has visibly wider letter spacing
- Text with `spc="-50"` has tighter spacing
- Text with no `spc` attribute is unaffected

---

### #2 — Parse and render text caps (V21) ✅

**Description:** Parse `rPr@cap` and render as CSS text-transform.

Values:
- `"all"` → CSS `text-transform: uppercase`
- `"small"` → CSS `font-variant: small-caps`
- `"none"` or absent → no transform

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — read `rPr@cap` in `parseTextRuns()`
- `src/lib/pptx-types.ts` — add `caps?: 'all' | 'small'` to `PptxTextRun`
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — apply CSS

**Acceptance criteria:**

- Text with `cap="all"` renders in ALL CAPS
- Text with `cap="small"` renders in Small Caps
- No effect when attribute is absent

---

### #3 — Parse and render image transparency (V23) ✅

**Description:** Parse `a:alphaModFix@amt` on image `blip` elements and apply as CSS `opacity`.

The `alphaModFix` element is a child of the `blip` element inside `blipFill`. Its `amt` attribute is in 1/1000ths (e.g., `50000` = 50% opacity).

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — in `parsePicture()`, after getting `blip`, check for `alphaModFix` child; parse `amt` attribute
- `src/lib/pptx-types.ts` — add `opacity?: number` (0-1) to `PptxImage`
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — apply CSS `opacity` on `<img>`

**Acceptance criteria:**

- Image with `alphaModFix amt="50000"` renders at 50% opacity
- Image with `alphaModFix amt="75000"` renders at 75% opacity
- Images without `alphaModFix` are fully opaque (no opacity set)

---

### #4 — Parse and render line head/tail arrows (V24) ✅

**Description:** Parse `a:headEnd` and `a:tailEnd` on `a:ln` elements to support both head and tail arrowheads with type/width/length variants.

Currently the renderer only adds a tail arrowhead (`markerEnd`) when `shapeType === "arrow"`. Replace this with proper parsing of both ends.

Parse in `parseStroke()`:
- `a:headEnd@type` — arrow type: `none`, `triangle`, `stealth`, `diamond`, `oval`, `arrow`
- `a:headEnd@w` — width: `sm`, `med`, `lg`
- `a:headEnd@len` — length: `sm`, `med`, `lg`
- Same for `a:tailEnd`

Return arrow data alongside stroke. Add to `PptxShape`.

Render in `LineRenderer`:
- Generate unique marker IDs (to avoid ID collision when multiple arrows on one slide)
- Create `<marker>` elements for both head and tail with appropriate shapes
- Apply `markerStart` for head arrows, `markerEnd` for tail arrows
- Map arrow types: `triangle` → filled triangle, `stealth` → narrow triangle, `diamond` → diamond shape, `oval` → circle, `arrow` → open arrow
- Map width/length to marker dimensions

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — parse `headEnd`/`tailEnd` in `parseStroke()`
- `src/lib/pptx-types.ts` — add `ArrowHead` interface and `headArrow?`/`tailArrow?` to `PptxShape`
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — generate SVG markers, apply markerStart/markerEnd

**Acceptance criteria:**

- Lines with `headEnd type="triangle"` show an arrowhead at the start
- Lines with both `headEnd` and `tailEnd` show arrows at both ends
- Arrow type `none` suppresses the arrowhead
- Different types (triangle, stealth, diamond, oval) render distinct shapes
- Unique marker IDs prevent cross-contamination between arrows on the same slide

---

### #5 — Parse image backgrounds on slides and masters (V19 — parsing) ✅

**Description:** Extend `parseBackground()` to handle `blipFill` (image backgrounds). Currently it only handles solid fills and gradients via `parseFill()`.

When `bgPr` contains a `blipFill` element:
1. Extract the `blip` element and its `r:embed` relationship ID
2. Resolve the relationship to a media file path
3. Extract the image data as a base64 data URL (reuse `extractImageDataUrl()`)
4. Store in `PptxBackground.imageDataUrl`

This requires passing `rels` and `zip` into `parseBackground()` since image extraction needs ZIP access. Currently `parseBackground()` only takes `(doc, theme)`.

Update the call sites:
- `parseSlide()` — already has `rels` and `zip`
- `parseSlideMaster()` — needs to read master rels and pass through
- `parseSlideLayout()` — needs to read layout rels and pass through

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — extend `parseBackground()` signature, parse `blipFill`, extract image

**Acceptance criteria:**

- Slides with `bgPr > blipFill` have `imageDataUrl` populated on their background
- Master/layout backgrounds with images are also parsed
- Solid/gradient backgrounds continue to work (no regression)

---

### #6 — Render image backgrounds (V19 — rendering) ✅

**Description:** The `backgroundStyle()` helper in `PptxSlideRenderer.tsx` already handles `bg.imageDataUrl` — it sets `backgroundImage` and `backgroundSize: "cover"`. Verify this works with the parsed data from #5.

Additionally, handle `a:stretch` and `a:tile` fill modes on `blipFill`:
- `a:stretch` (default) → `background-size: cover` (already handled)
- `a:tile` → `background-repeat: repeat` with the image's natural size

Also handle `a:srcRect` on background images (crop before tiling/stretching) — reuse the crop parsing from V9.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #5 **Files:**

- `src/components/editor/viewers/PptxSlideRenderer.tsx` — verify/enhance `backgroundStyle()`

**Acceptance criteria:**

- Slides with image backgrounds display the image filling the entire slide
- Master backgrounds with images inherit to slides without explicit backgrounds
- Tiled backgrounds repeat the image pattern

---

### #7 — Parse and render slide headers and footers (V22) ✅

**Description:** Parse `p:hf` (header/footer configuration) from slides and render date, footer text, and slide number when visible.

In OOXML, slide-level visibility of chrome placeholders is controlled by `p:hf` attributes on `p:sld`:
- `hf@dt` — show date placeholder (`0` = hidden, `1` or absent = visible depending on layout)
- `hf@ftr` — show footer placeholder
- `hf@sldNum` — show slide number placeholder
- `hf@hdr` — show header placeholder

Currently we filter out ALL `sldNum`, `dt`, `ftr` placeholders. Instead:

1. Parse `p:hf` attributes from the slide XML
2. For each chrome placeholder type, check if `hf` says it should be visible
3. If visible AND the slide inherits the placeholder from layout/master, render it
4. For `sldNum`: populate the text with the actual slide number (1-based)
5. For `dt`: populate with current date or the `dt` placeholder's authored text
6. For `ftr`: use the footer text from the layout/master placeholder

This reverses the current blanket filtering of chrome placeholders and replaces it with visibility-aware rendering.

**Complexity:** M **Category:** frontend **Dependencies:** None (uses V2 master/layout infrastructure) **Files:**

- `src/lib/pptx-parser.ts` — parse `p:hf` attributes from slide XML, store on `PptxSlide`
- `src/lib/pptx-types.ts` — add `headerFooter?: { showDate: boolean; showFooter: boolean; showSlideNum: boolean }` to `PptxSlide`
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — conditionally render chrome placeholders based on `hf` flags; populate sldNum text with slide index + 1

**Acceptance criteria:**

- Slides with `hf sldNum="1"` show the slide number from the master placeholder
- Slides with `hf ftr="1"` show footer text from the master placeholder
- Slides with `hf dt="0"` hide the date placeholder
- When no `hf` element is present, chrome placeholders remain hidden (safe default)

---

### #8 — Add unit tests for character spacing, caps, and arrow formatting ✅

**Description:** Write Vitest tests for the new parsing and formatting logic.

Create `src/lib/__tests__/pptx-tier4-features.test.ts`:

**Character spacing tests:**
- `spc="300"` → `letterSpacing: 3` (pt)
- `spc="-100"` → `letterSpacing: -1`
- No `spc` → undefined

**Text caps tests:**
- `cap="all"` → `caps: "all"`
- `cap="small"` → `caps: "small"`
- No `cap` → undefined

**Image transparency tests:**
- `alphaModFix amt="50000"` → `opacity: 0.5`
- `alphaModFix amt="100000"` → `opacity: 1`
- No alphaModFix → undefined

**Arrow head tests:**
- `headEnd type="triangle"` → `headArrow.type: "triangle"`
- `tailEnd type="stealth" w="lg"` → `tailArrow.type: "stealth"`, `tailArrow.width: "lg"`
- Both head and tail present
- `type="none"` → no arrow

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #1-#4 **Files:**

- Create: `src/lib/__tests__/pptx-tier4-features.test.ts`

**Acceptance criteria:**

- At least 12 test cases covering all new features
- Tests pass

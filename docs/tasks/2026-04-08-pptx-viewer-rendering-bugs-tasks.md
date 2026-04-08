# PPTX Viewer Rendering Bug Fixes — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-04-08 |
| **Status** | In progress |
| **Bugs** | [pptx-viewer-rendering-bugs](../bugs/2026-04-08-pptx-viewer-rendering-bugs.md) |
| **Total** | 10 tasks: 3S, 5M, 2L |
| **Suggested order** | Color pipeline (#1-#3) → Gradient (#4) → Text inheritance (#5-#7) → Polish (#8-#10) |

**Risks:**

- Task #1 (clrMap) touches `resolveColor` which is called everywhere — test every file in `tests/fixtures/pptx/` after this change.
- Task #3 (shade/tint rewrite) changes `applyColorTransforms` which has 26 existing tests in `pptx-color-transforms.test.ts` — many test expectations will change.
- Task #5 (master text style inheritance) is the most complex — the OOXML style cascade is: theme defaults → master lstStyle → layout lstStyle → shape lstStyle → paragraph pPr → run rPr. We only need master titleStyle/bodyStyle for now, not the full cascade.

---

### #1 — Implement `clrMap` color remapping (B1) ✅

**Description:** Parse `<p:clrMap>` from slide masters and `<p:clrMapOvr>` from slides/layouts. Use the color map when resolving `schemeClr` values instead of the hardcoded `altMap`.

**Implementation:**

1. Add `clrMap?: Record<string, string>` to `PptxSlideMaster` in `pptx-types.ts`
2. In `parseSlideMaster()`, parse `<p:clrMap>` element — read all attributes (`bg1`, `tx1`, `bg2`, `tx2`, `accent1`-`accent6`, `hlink`, `folHlink`) into a `Record<string, string>`
3. Store `clrMap` on the master. After `resolveInheritance()`, propagate the active clrMap to a `PptxTheme.clrMap` field (or pass it through)
4. In `resolveColor()` and `resolveColorWithAlpha()`: when resolving a `schemeClr`, first check if the value exists in `clrMap` — if so, remap it (e.g., `bg1` → `dk2`), then look up the remapped key in `theme.colors`. Remove the hardcoded `altMap` and use `clrMap` with a default mapping as fallback: `{ bg1: "lt1", bg2: "lt2", tx1: "dk1", tx2: "dk2" }` (the OOXML default when no clrMap is present)
5. Parse `<p:clrMapOvr>` on slides — if it contains `<a:overrideClrMapping>`, use those overrides. If it contains `<a:masterClrMapping/>`, inherit master's clrMap (which is the default behavior)

The key insight: `resolveColor` currently receives only `theme`. It needs the active `clrMap` too. Either embed `clrMap` in `PptxTheme` (simplest — set it after master parsing) or thread it as a parameter. Since colors are resolved during parsing (which happens per-slide), the simplest approach is: set `theme.clrMap` from the first master's clrMap before parsing slides, and update per-slide if `clrMapOvr` overrides.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-types.ts` — add `clrMap` to `PptxTheme` and `PptxSlideMaster`
- `src/lib/pptx-parser.ts` — `parseSlideMaster`, `resolveColor`, `resolveColorWithAlpha`, `parsePptx`

**Acceptance criteria:**

- `schemeClr val="bg1"` resolves to `dk2` color (#0066CC blue) when `clrMap` says `bg1="dk2"`
- `schemeClr val="tx1"` resolves to `lt1` color (#FFFF00 yellow) when `clrMap` says `tx1="lt1"`
- Files without `clrMap` use the default mapping and render unchanged
- All existing pptx tests still pass

---

### #2 — Parse `clrMap` per-slide for correct per-element color resolution (B1 cont.) ✅

**Description:** The clrMap may differ per slide (via `clrMapOvr`). Currently colors are resolved during parsing — the parser calls `resolveColor(el, theme)` from within `parseTextRuns`, `parseFill`, etc. Since these happen during `parseSlide()`, the theme's clrMap must be set correctly before each slide is parsed.

**Implementation:**

1. In `parsePptx()`, before parsing each slide: check the slide XML for `<p:clrMapOvr>`. If it has `<a:overrideClrMapping>`, temporarily override `theme.clrMap` for that slide's parsing. If `<a:masterClrMapping/>`, use master's clrMap. Restore after parsing.
2. Since layout parsing also happens before slides, set the default clrMap from the first master before layout parsing too.
3. Also parse `clrMap` from slide layouts (they can have their own `clrMapOvr`).

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #1 **Files:**

- `src/lib/pptx-parser.ts` — `parsePptx` main loop, `parseSlide`, `parseSlideLayout`

**Acceptance criteria:**

- Slides with `<a:masterClrMapping/>` use master's clrMap
- Slides with `<a:overrideClrMapping>` use the override
- Master background and decorative shapes render with correct colors

---

### #3 — Fix shade/tint to use RGB and implement gamma/invGamma (B4, B5) ✅

**Description:** Rewrite `applyColorTransforms()` to apply `shade` and `tint` in sRGB space instead of HSL, and implement `gamma`/`invGamma` for linear-space transforms.

**Implementation:**

1. Add helper functions:
   - `hexToRgb(hex) → {r, g, b}` (0-255 integers) — note: `hexToRgb` already exists in PptxSlideRenderer for shadow rendering, extract or duplicate
   - `rgbToHex(r, g, b) → string`
   - `srgbToLinear(c) → number` — `c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`
   - `linearToSrgb(c) → number` — `c <= 0.0031308 ? c*12.92 : 1.055*c^(1/2.4)-0.055`

2. Rewrite `applyColorTransforms()`:
   - Keep hue/saturation/luminance modulation in HSL (these are correct per spec)
   - Check for `<a:gamma/>` and `<a:invGamma/>` children
   - If `gamma` is present: after HSL transforms, convert hex to RGB, then to linear RGB
   - Apply `shade` in current space: if in linear RGB, multiply channels; if in sRGB (no gamma), multiply channels in sRGB
   - If `invGamma` is present: convert back from linear to sRGB
   - Apply `tint` as sRGB mix toward white: `c_new = c + (255-c) * tint_fraction` per channel

3. Update the existing 26 color transform tests — many shade/tint expectations will change slightly. Recompute expected values using the RGB method.

**Complexity:** L **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — `applyColorTransforms`, new helper functions
- `src/lib/__tests__/pptx-color-transforms.test.ts` — update expectations, add gamma/invGamma tests

**Acceptance criteria:**

- `shade val="46275"` on #0066CC produces the correct darkened blue (RGB multiplication)
- `gamma + shade + invGamma` produces perceptually correct darkening
- `tint val="50000"` on #FF0000 produces #FF8080 (not HSL-based result)
- Existing hue/sat/lum modulation tests still pass
- No visual regression on files without gamma/invGamma

---

### #4 — Fix linear gradient angle conversion (B3) ✅

**Description:** Convert OOXML gradient angles to CSS correctly. OOXML uses 0°=right, going counterclockwise. CSS uses 0°=up, going clockwise.

**Implementation:**

In `fillToCSS()` in `PptxSlideRenderer.tsx`, change the linear gradient line from:
```ts
background: `linear-gradient(${fill.angle}deg, ...)`
```
to:
```ts
background: `linear-gradient(${fill.angle + 90}deg, ...)`
```

Also verify: OOXML `ang=0` should mean left-to-right (CSS 90deg). OOXML `ang=90` should mean top-to-bottom (CSS 180deg). OOXML `ang=180` should mean right-to-left (CSS 270deg). OOXML `ang=270` should mean bottom-to-top (CSS 0deg or 360deg).

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/components/editor/viewers/PptxSlideRenderer.tsx` — `fillToCSS`

**Acceptance criteria:**

- Background gradient in `45545_Comment.pptx` runs top-to-bottom instead of left-to-right
- Horizontal gradient shapes render correctly
- All existing gradient rendering in other test files visually correct

---

### #5 — Apply master `titleStyle` to title placeholders (B2) ✅

**Description:** When a slide has a title placeholder (`ph type="title"`), inherit text properties from `master.titleStyle` (font size, bold, color, font family) as defaults for runs that don't specify their own.

**Implementation:**

1. In `resolveInheritance()`, for each slide element with `placeholderType === "title"`:
   - Find the master's `titleStyle`
   - Walk the element's paragraphs and runs — for any run property that is at the "default" value (e.g., fontSize === 18, the hardcoded fallback), replace it with the master style value

2. Better approach: thread the style info into `parseTextRuns` during slide parsing rather than post-processing. During `parseSlide()` → `parseShapeOrTextBox()` → `parseParagraphs()` → `parseTextRuns()`:
   - Pass the placeholder type to `parseParagraphs`
   - If `placeholderType === "title"`, look up master's `titleStyle.lvl1pPr.defRPr`
   - Use those values as defaults (below the existing `defRPr` from the paragraph's own `pPr`)

3. Simplest approach that avoids threading: in `resolveInheritance()`, after all slides are parsed, walk title/body placeholders and merge master style defaults onto runs that have fallback values. This is a post-processing pass.

   For each title placeholder element on each slide:
   - Get master's `titleStyle` (already on `PptxSlideMaster`)
   - For each paragraph: if no explicit alignment, use titleStyle alignment
   - For each run: if fontSize is 18 (default), use titleStyle fontSize. If color is #000000 (default), use titleStyle color. If fontFamily is the body font, use titleStyle fontFamily.

   The check `=== 18` is fragile. Better: track whether the property came from an explicit attribute or the default. But that requires changing the run parsing.

   Most practical: in `parseTextRuns`, when `rPr` is absent and `defRPr` is absent, the current code uses hardcoded defaults (fontSize 18, color #000000, etc.). Instead, accept a `masterDefaults` parameter with the fallback values from the master text style.

4. Add `PptxTextStyle` fields to `PptxSlideMaster` (already done — `titleStyle`, `bodyStyle` exist). Parse `lstStyle` level properties with per-level paragraph props (lvl1pPr through lvl9pPr) including `defRPr` for font size, bold, italic, color, font family.

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #1 (colors must resolve correctly for master style colors to be meaningful) **Files:**

- `src/lib/pptx-parser.ts` — `resolveInheritance`, `parseTextRuns`, `parseParagraphs`, `parseShapeOrTextBox`
- `src/lib/pptx-types.ts` — may need richer `PptxTextStyle` with per-level props

**Acceptance criteria:**

- Title text in `45545_Comment.pptx` renders at 44pt (not 18pt)
- Title text uses Times New Roman heading font
- Title text inherits color from master style (tx2 → lt2 via clrMap)
- Body placeholders inherit 32pt bold from master bodyStyle
- Explicit run-level properties still override inherited defaults

---

### #6 — Apply master `bodyStyle` to body placeholders (B2 cont.) ✅

**Description:** Same as #5 but for body placeholders (`ph type="body" idx="1"`). Inherit font size, bold, bullet config, color from `master.bodyStyle`.

**Implementation:** Same approach as #5, extending to body placeholder type. The body style has per-level definitions (lvl1pPr through lvl5pPr) with different font sizes and bullet configs per indent level.

For the initial fix, at minimum apply lvl1pPr defaults (32pt, bold, tx1 color).

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #5 **Files:**

- `src/lib/pptx-parser.ts` — same functions as #5

**Acceptance criteria:**

- Body text defaults to 32pt bold when no explicit size on run
- Per-level text sizes (lvl1=32pt, lvl2=28pt, lvl3=24pt, lvl4=20pt, lvl5=20pt) apply based on bullet level
- Bullet character, font, color inherited from master bodyStyle

---

### #7 — Parse and render text-level drop shadows (B7) ✅

**Description:** Text runs can have `<a:effectLst><a:outerShdw>` in their `<a:rPr>`. These should render as CSS `text-shadow`.

**Implementation:**

1. In `pptx-types.ts`, add `shadow?: PptxShadow` to `PptxTextRun`
2. In `parseTextRuns()`, after other rPr parsing, check for `effectLst > outerShdw` on the run's rPr element. Parse using the existing shadow parsing logic (dist, dir, blurRad, color, alpha). This can reuse `parseShadow()` or extract the shadow parsing from `parseEffects()`.
3. In `RunRenderer()` in `PptxSlideRenderer.tsx`, if `r.shadow` is set, add CSS `textShadow: "${offsetX}px ${offsetY}px ${blur}px rgba(${color}, ${alpha})"` to the span style.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-types.ts` — add `shadow` to `PptxTextRun`
- `src/lib/pptx-parser.ts` — `parseTextRuns`
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — `RunRenderer`

**Acceptance criteria:**

- "Access to Finance for Local Governments" text has a visible drop shadow
- "Antonio Vives" and contact info text has drop shadows
- Shadow color, blur, and offset match the XML values

---

### #8 — Handle OLE object fallback images (B6) ✅

**Description:** OLE objects (`<p:oleObj>` in graphic frames) are currently dropped. Render the preview/fallback image when available.

**Implementation:**

1. In `parseGraphicFrame()`, after the SmartArt check, add OLE object detection:
   ```ts
   const oleObj = qs(el, "oleObj");
   if (oleObj) {
     // Try to find preview image via relationship
     const rId = oleObj.getAttributeNS(RELS_NS, "id") || getAttr(oleObj, "r:id");
     // OLE objects may have an image relationship in the slide rels
     // Also check for a VML drawing relationship that contains the preview
     // Simplest: look for media files referenced by the OLE object's relationship
   }
   ```

2. OLE preview images are tricky — they can be in:
   - `ppt/media/` referenced directly by the OLE relationship
   - VML drawings (`ppt/drawings/vmlDrawing1.vml`) that reference images
   - The OLE binary itself (embedded)

   Simplest approach: check the OLE object's `r:id` relationship target. If it's a media file (png/jpg/emf/wmf), render it as an image. If it's a binary, try to find a VML drawing in the slide rels that references a media file.

3. If no preview image found, render a placeholder shape with "OLE Object" text.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-parser.ts` — `parseGraphicFrame`

**Acceptance criteria:**

- The IDB logo in `45545_Comment.pptx` renders (or shows a placeholder if no preview available)
- Existing tables, charts, and SmartArt parsing unchanged

---

### #9 — Use heading font for title placeholders (B8) ✅

**Description:** When a title placeholder's text run has no explicit font, use `theme.fonts.heading` instead of `theme.fonts.body`.

**Implementation:**

1. `parseFontFamily()` currently returns `theme.fonts.body` as the final fallback. It needs to know the placeholder context to choose between heading and body font.
2. Thread a `placeholderType` parameter through `parseParagraphs` → `parseTextRuns` → `parseFontFamily`. If `placeholderType` is `"title"`, `"ctrTitle"`, or `"subTitle"`, use `theme.fonts.heading` as fallback.
3. This can be combined with #5 — if master text style inheritance is implemented, the font family from `titleStyle.defRPr` (`+mj-lt` → heading) will automatically apply.

**Complexity:** S **Category:** frontend **Dependencies:** Depends on #5 (if done via style inheritance) or standalone **Files:**

- `src/lib/pptx-parser.ts` — `parseFontFamily`, `parseTextRuns`, `parseParagraphs`

**Acceptance criteria:**

- Title text uses `theme.fonts.heading` when no explicit font specified
- Body text still uses `theme.fonts.body`
- Files where heading ≠ body font render correctly

---

### #10 — Add rendering regression tests with `45545_Comment.pptx`

**Description:** Write tests that verify the critical rendering properties of the test file to prevent regressions.

**Implementation:**

Write a new test file `src/lib/__tests__/pptx-rendering-regression.test.ts` that:
1. Parses `tests/fixtures/pptx/45545_Comment.pptx` using `parsePptx()`
2. Asserts theme colors are correct: `theme.colors.dk2` = `#0066CC`
3. Asserts clrMap is parsed: `theme.clrMap.bg1` = `"dk2"`
4. Asserts slide 1 background fill color resolves to blue (not yellow)
5. Asserts title placeholder text fontSize (should be 44 from master)
6. Asserts gradient angle conversion: master bg gradient should be 180deg CSS
7. Asserts comments are parsed (slide 1 should have comments)
8. Asserts master has titleStyle with sz=4400

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #1-#5 **Files:**

- `src/lib/__tests__/pptx-rendering-regression.test.ts` — new file

**Acceptance criteria:**

- All assertions pass after bug fixes are applied
- Tests fail if any of the fixed bugs regress

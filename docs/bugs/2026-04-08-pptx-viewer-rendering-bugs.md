# PPTX Viewer Rendering Bugs

|  |  |
| --- | --- |
| **Date** | 2026-04-08 |
| **Severity** | Critical |
| **Test file** | `tests/fixtures/pptx/45545_Comment.pptx` |
| **Summary** | Fundamental rendering failures: wrong colors, wrong font sizes, wrong gradient angles. Root cause is missing `clrMap` support and missing master text style inheritance. |

## Critical Bugs

### B1 — `clrMap` color remapping completely ignored

The slide master defines `<p:clrMap bg1="dk2" tx1="lt1" bg2="dk1" tx2="lt2" .../>` which remaps semantic color names to different theme color slots. Our parser ignores `clrMap` entirely.

**Current behavior:** `resolveColor()` uses a hardcoded `altMap` (`bg1→lt1`, `tx1→dk1`) that is the OPPOSITE of this file's `clrMap` (`bg1→dk2`, `tx1→lt1`).

**Expected:** Parse `<p:clrMap>` from slide master, `<p:clrMapOvr>` from slides/layouts. When resolving `schemeClr val="bg1"`, look up `clrMap["bg1"]` to get the remapped key (e.g., `"dk2"`), then use `theme.colors["dk2"]`.

**Impact:** Every element using `bg1`, `bg2`, `tx1`, `tx2` scheme colors renders the wrong color. The entire slide background is yellow instead of blue. Title text is black instead of yellow.

**Files:** `pptx-parser.ts` (`resolveColor` line ~1014, `altMap` line ~1025), `pptx-types.ts` (needs `clrMap` on theme/master)

---

### B2 — Master `titleStyle` / `bodyStyle` text properties never applied to placeholders

The master's `<p:txStyles>` defines `<p:titleStyle>` with `sz="4400"` (44pt), color `tx2`, font `+mj-lt`, shadow, and `<p:bodyStyle>` with `sz="3200"` (32pt), bold, bullets. These are parsed into `PptxSlideMaster.titleStyle` / `.bodyStyle` but `resolveInheritance()` never applies them to slide elements.

**Current behavior:** Title text defaults to 18pt (the hardcoded fallback). Body text defaults to 18pt non-bold.

**Expected:** For `ph type="title"` placeholders, inherit font size, color, font family, shadow from `master.titleStyle`. For `ph type="body"`, inherit from `master.bodyStyle`. Run-level `<a:rPr>` overrides inherited defaults.

**Impact:** Title text is 18pt instead of 44pt. Body text is 18pt instead of 32pt. Wrong fonts, missing bold, missing text shadows.

**Files:** `pptx-parser.ts` (`resolveInheritance`, `parseTextRuns`, `parseParagraphs`)

---

### B3 — Linear gradient angle off by 90 degrees

OOXML gradient angles start from the right and go counterclockwise: 0°=right-to-left, 90°=top-to-bottom. CSS `linear-gradient` angles start from the bottom and go clockwise: 0°=bottom-to-top, 90°=left-to-right, 180°=top-to-bottom.

**Current behavior:** OOXML angle passed directly to CSS: `linear-gradient(90deg, ...)` renders left-to-right.

**Expected:** Convert: CSS angle = OOXML angle + 90. OOXML 90° (top-to-bottom) → CSS 180° (top-to-bottom). OOXML 0° (left-to-right) → CSS 90° (left-to-right).

**Impact:** All linear gradients rotated 90 degrees wrong. Background gradient goes left-to-right instead of top-to-bottom.

**Files:** `PptxSlideRenderer.tsx` (`fillToCSS` line ~190)

---

### B4 — `gamma`/`invGamma` color transforms not implemented

Multiple gradient stops use `<a:gamma/><a:shade val="46275"/><a:invGamma/>`. Per OOXML spec, `gamma` converts sRGB to linear RGB, `shade` is applied in linear space, `invGamma` converts back. Our parser ignores `gamma`/`invGamma` entirely.

**Current behavior:** `applyColorTransforms()` has zero handling for `gamma`/`invGamma`. Shade is applied as HSL luminance multiplication.

**Expected:** When `gamma`/`invGamma` bracket a shade/tint: convert to linear RGB (`c_linear = c_srgb^2.2`), apply shade/tint as RGB channel multiplication, convert back (`c_srgb = c_linear^(1/2.2)`).

**Impact:** Shaded gradient endpoints computed in wrong color space. Affects background gradient, master decorative shapes.

**Files:** `pptx-parser.ts` (`applyColorTransforms` line ~1125)

---

### B5 — `shade` and `tint` transforms computed in HSL instead of RGB

Even without `gamma`/`invGamma`, the OOXML spec defines `shade` as RGB channel multiplication (`R_new = R * val/100000`) and `tint` as sRGB mix toward white (`c_new = c + (255-c) * val/100000`).

**Current behavior:** Both are applied as HSL luminance operations:
- shade: `hsl.l = hsl.l * sh`
- tint: `hsl.l = hsl.l + (1 - hsl.l) * t`

**Expected:** Apply in sRGB space on individual R, G, B channels.

**Impact:** Incorrect colors for saturated hues. HSL shade changes luminance but preserves saturation; RGB shade darkens while desaturating.

**Files:** `pptx-parser.ts` (`applyColorTransforms` lines ~1168-1176)

---

## High Severity Bugs

### B6 — OLE objects silently dropped

The slide has an OLE object (`Photo Editor Photo` — the IDB logo) as a `<p:graphicFrame>` with `oleObj` in the graphic data. `parseGraphicFrame()` checks for tables, charts, and SmartArt but has no handler for OLE objects.

**Expected:** Check for `oleObj`, find the preview/fallback image (often in `ppt/media/` via VML drawing relationships or `oleObj@imgW/imgH`), render as image. If no preview available, render a placeholder.

**Impact:** Missing image on slide.

**Files:** `pptx-parser.ts` (`parseGraphicFrame` line ~1498)

---

### B7 — Text-level drop shadows not rendered

Text runs with `<a:effectLst><a:outerShdw>` in their `<a:rPr>` have no shadow rendering. `parseTextRuns()` reads bold, italic, font, color, etc. but never checks for `effectLst` on runs. `parseEffects()` only works on `spPr`.

**Expected:** Parse `outerShdw` from run properties, render as CSS `text-shadow` on the span.

**Impact:** Text in "Access to Finance...", "Antonio Vives", etc. should have drop shadows for readability on colored backgrounds.

**Files:** `pptx-parser.ts` (`parseTextRuns`), `pptx-types.ts` (add `shadow` to `PptxTextRun`), `PptxSlideRenderer.tsx` (`RunRenderer`)

---

### B8 — Title placeholder inherits wrong font (body instead of heading)

When a title placeholder's text run has no explicit `<a:latin>` font, `parseFontFamily()` falls through to `theme.fonts.body`. For title placeholders, it should use `theme.fonts.heading` (`+mj-lt`).

**Current behavior:** Falls back to body font unconditionally.

**Expected:** Use placeholder type context: titles use heading font, body uses body font.

**Impact:** Invisible when heading and body fonts match (as in this file), but wrong for files where they differ.

**Files:** `pptx-parser.ts` (`parseFontFamily`, needs placeholder context)

---

## Medium Severity Bugs

### B9 — Shadow `algn` attribute ignored

Shadows specify `algn="tl"` (top-left alignment) which affects offset calculation relative to shape bounds. Not read by `parseEffects()`.

**Files:** `pptx-parser.ts` (`parseEffects`)

---

### B10 — `scaled` attribute on linear gradient ignored

`<a:lin scaled="1"/>` controls whether gradient adapts to shape aspect ratio. Not parsed.

**Files:** `pptx-parser.ts` (`parseGradientFill`)

---

### B11 — Master decorative shapes use wrong colors

The slide master has decorative shapes (vertical band, horizontal bar, bottom bar) using `bg1` and `hlink` scheme colors with `gamma/shade/invGamma` transforms. All are wrong colors due to B1 (clrMap) and B4 (gamma).

**Impact:** The entire slide design/chrome is wrong colors.

---

## Fix Priority

1. **B1 (clrMap)** + **B3 (gradient angle)** — fixes the most visible issues (wrong colors, wrong gradient direction)
2. **B2 (master text styles)** — fixes font sizes
3. **B5 (shade/tint in RGB)** + **B4 (gamma/invGamma)** — fixes gradient endpoint colors
4. **B7 (text shadows)** — fixes text readability
5. **B6 (OLE objects)** — fixes missing images
6. **B8 (font inheritance)** — correctness for files with different heading/body fonts

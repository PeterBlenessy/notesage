# PPTX Viewer Rendering Fidelity — PRD

|  |  |
| --- | --- |
| **Date** | 2026-04-08 |
| **Status** | Complete |
| **Reference spec** | ECMA-376 Part 1 (5th edition), `docs/reference/ECMA-376-Part1.pdf` |
| **MS implementer notes** | MS-OE376 rev 4.1, `docs/reference/MS-OE376-implementer-notes.pdf` |
| **Test files** | `tests/fixtures/pptx/` (12 files from Apache POI) |
| **Goal** | Render PPTX files with high fidelity — matching PowerPoint's visual output for text, colors, shapes, and layout on common presentations. |

## Problem Statement

The PPTX viewer was built from scratch with a custom parser (`pptx-parser.ts`, ~5000 lines). It handles the basic OOXML structure (slides, shapes, text, tables, charts, images) but has fundamental gaps in the **OOXML rendering pipeline** — the chain of inheritance and resolution that determines how every element actually looks:

1. **Text style cascade** — OOXML defines a 6-level cascade: theme defaults → master lstStyle → layout lstStyle → shape lstStyle → paragraph pPr → run rPr. We only apply the last 2 levels.
2. **Color resolution** — Scheme colors go through clrMap remapping (recently fixed) but many edge cases remain.
3. **Shape/text defaults** — Theme objectDefaults, master txStyles, layout overrides are partially implemented.
4. **Text body properties** — autoFit, text wrapping, vertical centering interactions are incomplete.

## Architecture: The OOXML Rendering Pipeline

Per ECMA-376 §13.3 and §20.1, a conformant renderer must resolve properties through this cascade:

### Color Resolution (§20.1.2)
```
schemeClr value → clrMap remap → theme.colors lookup → apply transforms (tint/shade/gamma/lumMod/etc.)
```

### Text Property Resolution (§19.3, §20.1.9)
```
For placeholder text (title, body):
  1. Theme defaults (presentation.xml defaultTextStyle)
  2. Master txStyles (titleStyle / bodyStyle / otherStyle) — per-level (lvl1pPr-lvl9pPr)
  3. Layout lstStyle (if layout overrides)
  4. Shape lstStyle (shape's own lstStyle element)
  5. Paragraph pPr + defRPr
  6. Run rPr (explicit values win)

For non-placeholder text (free text boxes):
  1. Theme objectDefaults (spDef lstStyle)
  2. Shape lstStyle
  3. Paragraph pPr + defRPr
  4. Run rPr
```

### Paragraph Properties Resolution
At each level, these properties can be set:
- `algn` (alignment), `marL`/`indent` (margins), `spcBef`/`spcAft`/`lnSpc` (spacing)
- `buChar`/`buAutoNum`/`buFont`/`buClr`/`buSzPct` (bullets)
- `defRPr` (default run properties for this paragraph level)

### Run Properties Resolution
At each level, these properties can be set:
- `sz` (font size), `b`/`i`/`u` (bold/italic/underline), `strike` (strikethrough)
- `solidFill`/`gradFill` (text color), `latin`/`ea`/`cs` (fonts)
- `effectLst` (text effects like shadow), `highlight`
- `kern`, `spc` (kerning, spacing), `baseline` (super/subscript)

## Current Gaps (Ordered by Visual Impact)

### P1 — Text style cascade for non-placeholder text (HIGH)

**Problem:** Free text boxes (not placeholders) get defaults from theme `objectDefaults > spDef`. We recently added `defaultFontSize` and `defaultAlignment` but the full cascade is missing — the shape's own `lstStyle` element is ignored, and theme `otherStyle` is not applied.

**Visible in:** `45545_Comment.pptx` — "Access to Finance" text box uses theme defaults for alignment and font size but the shape may have its own lstStyle overrides.

**Spec reference:** §20.1.4.12 (lstStyle), §14.2.7 (theme objectDefaults)

**Fix:** Parse `lstStyle` from each shape's `txBody`. When resolving run defaults, check shape lstStyle before falling back to theme objectDefaults.

### P2 — Master txStyles `otherStyle` not applied (MEDIUM)

**Problem:** The master's `<p:txStyles>` has three styles: `titleStyle`, `bodyStyle`, and `otherStyle`. We apply titleStyle and bodyStyle to placeholders but ignore `otherStyle`. Per the spec, `otherStyle` provides defaults for all non-placeholder text.

**Spec reference:** §19.3.2.8 (txStyles), §19.3.2.7 (otherStyle)

**Fix:** Parse `otherStyle` from master's txStyles. Apply to non-placeholder shapes as a fallback below theme objectDefaults but above hardcoded defaults.

### P3 — Text body autoFit not fully implemented (MEDIUM)

**Problem:** `<a:bodyPr>` has three autofit modes:
- `<a:noAutofit/>` — text can overflow
- `<a:normAutofit fontScale="X"/>` — shrink text to fit (we parse fontScale but may not apply it to all text)
- `<a:spAutoFit/>` — grow/shrink shape to fit text

We parse `fontScale` and `autoFit` but `spAutoFit` (grow shape to fit) is not rendered — the shape keeps its original height.

**Spec reference:** §20.1.5.1 (bodyPr)

### P4 — Presentation-level defaultTextStyle (LOW)

**Problem:** `presentation.xml` can contain `<p:defaultTextStyle>` which provides the absolute baseline defaults for all text. We don't parse this at all.

**Spec reference:** §19.2.1.8 (defaultTextStyle)

**Fix:** Parse from presentation.xml, store on PptxPresentation, use as the bottom of the text cascade.

### P5 — Shape lstStyle for text defaults (MEDIUM)

**Problem:** Each shape's `<p:txBody>` can have a `<a:lstStyle>` element that provides per-level paragraph/run defaults for text within that shape. We parse `bodyPr` from txBody but completely ignore `lstStyle`.

**Spec reference:** §20.1.4.12 (lstStyle)

**Fix:** Parse lstStyle from txBody and merge its per-level defRPr values into the run defaults, above the master style but below explicit pPr/rPr.

### P6 — Layout-level text style overrides (LOW)

**Problem:** Slide layouts can override master text styles via their own `<a:lstStyle>` on placeholder shapes. We don't read layout-level text styles.

**Spec reference:** §19.3.1.21 (sp in slideLayout)

### P7 — EMF/WMF image rendering (MEDIUM)

**Problem:** Embedded EMF/WMF images (like the IDB logo in `45545_Comment.pptx`) render as broken or placeholder because browsers can't display EMF/WMF natively.

**Options:**
1. Convert EMF/WMF to SVG/PNG at parse time (complex, needs a converter library)
2. Use an EMF→Canvas renderer (e.g., `emf-js` npm package)
3. Accept the limitation and show a clean placeholder

### P8 — Vertical text alignment (anchor) in text bodies (LOW)

**Problem:** `<a:bodyPr anchor="ctr">` for vertical centering within a text box. We parse this and set `justifyContent: center` on the flex container, but it may not work correctly when fontScale is applied or when the text box has specific margin constraints.

## Non-Goals (Out of Scope)

- Animations and transitions (§19.5)
- SmartArt beyond fallback images (§21.4)
- 3D effects (§20.1.7.3)
- Slide show mode / presenter view
- Edit capabilities (we're a viewer only)
- Pixel-perfect rendering (we aim for "recognizably correct", not identical to PowerPoint)

## Success Criteria

Using `tests/fixtures/pptx/45545_Comment.pptx` as the primary test file:

- [ ] Background is blue gradient (top-to-bottom) ✅ (fixed)
- [ ] Title text is 44pt, yellow, centered ✅ (fixed)
- [x] "Access to Finance" text is centered, bold, appropriately sized
- [x] "Antonio Vives" text is centered, appropriately sized
- [ ] Decorative shapes (vertical bar, horizontal band) have correct blue colors ✅ (fixed)
- [ ] Red gradient bar at bottom renders correctly ✅ (fixed)
- [ ] Text shadows visible on yellow text ✅ (fixed)
- [ ] OLE logo shows placeholder (EMF conversion is out of scope)

Using other test files:
- [ ] `SampleShow.pptx` — basic slide with text renders correctly
- [ ] `bar-chart.pptx` — chart renders with labels and axes
- [ ] `table_test.pptx` — table with borders and fills renders
- [ ] `shapes.pptx` — various shape types render
- [ ] `backgrounds.pptx` — gradient and image backgrounds render

## Implementation Priority

1. **P1 + P5** — Shape lstStyle for text defaults (biggest visual impact on non-placeholder text)
2. **P2** — Master otherStyle (provides correct defaults for free text)
3. **P3** — Text body autoFit improvements
4. **P4** — Presentation defaultTextStyle
5. **P6** — Layout text overrides (edge case)
6. **P7** — EMF/WMF handling (accept limitation)

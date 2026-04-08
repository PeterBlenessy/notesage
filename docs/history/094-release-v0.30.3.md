# Release v0.30.3

**Date:** 2026-04-08
**Previous version:** 0.30.2

## Changes

### Features
- Full OOXML text property cascade: presentation defaultTextStyle, master txStyles (titleStyle/bodyStyle/otherStyle with per-level overrides), layout placeholder lstStyle, shape lstStyle, paragraph defRPr, run rPr
- Bullet inheritance from master bodyStyle (character, font, color, size)
- Layout placeholder text style inheritance (e.g., subtitle grey color from tint)
- Shape autoFit (spAutoFit) — shapes grow to fit text via height:auto + minHeight
- Persist PPTX slide position across tab switches
- 18 new diverse PPTX test fixtures from pptx-automizer and GitHub repos
- PPTX viewer test matrix documentation

### Fixes
- Fix resolveColor picking up shadow srgbClr instead of solidFill schemeClr
- Fix text centering — only use flex layout when bullets are present (textAlign was ignored under display:flex)
- Fix block arrow shapes (rightArrow, leftArrow, etc.) rendering as lines instead of filled preset geometry
- Fix scatter chart data points not rendering (was using category data instead of XY pairs)
- Fix bar chart direction — parse barDir for horizontal vs vertical layout
- Fix pie chart slice direction — clockwise from 12 o'clock matching PowerPoint
- Fix pie chart slice colors — use per-category accent colors instead of per-series
- Fix chart default colors — Office accent palette instead of all greys
- Fix chart legend text — dark grey instead of matching series color
- Fix chart auto-titles and title parsing path (c:tx > c:rich)
- Fix table rendering — explicit dimensions, no overflow clipping, width from column sum
- Fix hyperlink styling — blue color and underline
- Fix title/subtitle/ctrTitle default centering via cascade
- Fix content alignment — don't inherit alignment from layout placeholder template text
- Fix shape style references (p:style fillRef/lnRef) for shapes with theme fills
- Fix built-in table style fallbacks for 12 common Office table style GUIDs
- Skip rendering empty shapes without preset geometry (decorative background elements)
- Skip p:style fills on shapes without text (background overlays, circles, arcs)

## Files Changed
- 20 commits, 8 files significantly modified
- `src/lib/pptx-parser.ts` — text cascade, color resolution, bullet/alignment inheritance
- `src/lib/pptx-types.ts` — new fields for cascade (defaultTextStyle, shapeLevelStyles, otherStyle, etc.)
- `src/components/editor/viewers/PptxSlideRenderer.tsx` — autoFit, text centering, bullet rendering, hyperlinks
- `src/components/editor/viewers/PptxChartRenderer.tsx` — scatter/bar/pie fixes, colors, legends
- `src/components/editor/viewers/PptxViewer.tsx` — slide position persistence
- 4 new test files: pptx-text-cascade, pptx-autofit, pptx-rendering-regression, pptx-title-color
- `docs/features/pptx-viewer-test-matrix.md` — new test matrix documentation

# PPTX Viewer Rendering Fidelity — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-04-08 |
| **Status** | Complete |
| **PRD** | [pptx-viewer-fidelity](../prds/2026-04-08-pptx-viewer-fidelity.md) |
| **Total** | 8 tasks: 2S, 4M, 2L |
| **Suggested order** | Text cascade foundation (#1-#2) → Style application (#3-#5) → Polish (#6-#8) |

**Risks:**

- Task #3 (shape lstStyle) introduces a new level in the text property cascade. Must not break existing rendering — shapes without lstStyle should behave identically to before.
- Task #1 (otherStyle parsing) requires understanding the full txStyles structure. The `parseTextStyles` function already parses titleStyle and bodyStyle; otherStyle follows the same pattern.
- The text cascade refactor (#5) is the most architecturally significant — it changes how default text properties are resolved for ALL text. Thorough regression testing required.

---

### #1 — Parse master `otherStyle` and presentation `defaultTextStyle` (P2, P4) ✅

**Description:** Parse two missing text style sources:

1. Master `otherStyle`: In `parseTextStyles()`, also parse `<p:otherStyle>` from `<p:txStyles>`. This provides defaults for non-placeholder text (free text boxes, shapes). Store as `otherStyle?: PptxTextStyle` and `otherLevelStyles?: PptxTextStyle[]` on `PptxSlideMaster`.

2. Presentation `defaultTextStyle`: In `parsePptx()`, parse `<p:defaultTextStyle>` from `presentation.xml`. This is the absolute baseline. Store as `defaultTextStyle?: PptxTextStyle` on `PptxPresentation`.

Both use the same structure as titleStyle/bodyStyle — `lvl1pPr` through `lvl9pPr` with `defRPr`.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-types.ts` — add `otherStyle`, `otherLevelStyles` to `PptxSlideMaster`; add `defaultTextStyle` to `PptxPresentation`
- `src/lib/pptx-parser.ts` — `parseTextStyles` (add otherStyle), `parsePptx` (parse defaultTextStyle), `parseSlideMaster` (include otherStyle in return)

**Acceptance criteria:**

- `master.otherStyle` is populated when `<p:otherStyle>` exists
- `presentation.defaultTextStyle` is populated when `<p:defaultTextStyle>` exists
- `parseTextStyleLevels` reused for per-level parsing of both
- No visual regression (parsing only, no application yet)

---

### #2 — Parse shape-level `lstStyle` from `txBody` (P5) ✅

**Description:** Each shape's `<p:txBody>` can contain a `<a:lstStyle>` element providing per-level text defaults. Currently `parseParagraphs()` reads `txBody` for paragraphs and `parseBodyProperties()` reads `bodyPr`, but `lstStyle` is completely ignored.

Parse it and attach to the element so the text cascade can use it.

**Implementation:**

1. In `parseShapeOrTextBox()`, after parsing `bodyProps`, also parse `lstStyle` from `txBody`:
   ```ts
   const shapeLstStyle = txBody ? qs(txBody, "lstStyle") : null;
   const shapeLevelStyles = shapeLstStyle ? parseTextStyleLevels(shapeLstStyle, theme) : undefined;
   ```

2. Add `shapeLevelStyles?: PptxTextStyle[]` to `PptxTextBox` and `PptxShape` in `pptx-types.ts`.

3. Pass through to the returned shape/textbox object.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/lib/pptx-types.ts` — add `shapeLevelStyles` to `PptxTextBox` and `PptxShape`
- `src/lib/pptx-parser.ts` — `parseShapeOrTextBox`

**Acceptance criteria:**

- Shapes with `<a:lstStyle>` in their txBody have `shapeLevelStyles` populated
- Shapes without lstStyle have `shapeLevelStyles` undefined
- Existing test files still parse correctly

---

### #3 — Refactor text defaults into a unified cascade resolver (P1, P2, P5) ✅

**Description:** Create a single function that resolves text property defaults through the full OOXML cascade. Currently defaults are applied in two disconnected places: `parseTextRuns` (hardcoded fallbacks + paragraph defRPr) and `resolveInheritance` (post-processing for placeholders). This task unifies them.

**Implementation:**

Create `resolveTextDefaults()` that, given a shape element, determines the correct default font size, color, bold, font family, and alignment by walking:

1. Run rPr (explicit — already parsed)
2. Paragraph defRPr (already parsed via defRPr parameter)
3. Shape lstStyle (from #2)
4. For placeholders: master titleStyle/bodyStyle (already partially done)
5. For non-placeholders: master otherStyle (from #1)
6. Theme objectDefaults (already partially done via `defaultFontSize`/`defaultAlignment`)
7. Presentation defaultTextStyle (from #1)
8. Hardcoded OOXML spec defaults (18pt, left, non-bold, black)

The key insight: instead of checking `fontSize === 18` to detect "no explicit value" (fragile), each cascade level should produce a `Partial<RunDefaults>` and they get merged top-down, with the first non-undefined value winning.

**Approach:** Refactor `resolveInheritance()` step 4 to use the full cascade. For each element's paragraphs:

```ts
interface RunDefaults {
  fontSize: number;
  fontFamily: string;
  color: string;
  bold: boolean;
  italic: boolean;
  alignment: string;
}

function buildRunDefaults(
  placeholderType: string | undefined,
  bulletLevel: number,
  master: PptxSlideMaster | undefined,
  shapeLevelStyles: PptxTextStyle[] | undefined,
  theme: PptxTheme,
  presentation: PptxPresentation,
): RunDefaults {
  // Walk the cascade bottom-up, each level overrides
  const defaults: RunDefaults = {
    fontSize: (theme.defaultFontSize ?? 1800) / 100,
    fontFamily: theme.fonts.body,
    color: "#000000",
    bold: false,
    italic: false,
    alignment: theme.defaultAlignment ?? "left",
  };
  
  // Presentation defaultTextStyle
  if (presentation.defaultTextStyle) applyStyle(defaults, presentation.defaultTextStyle);
  
  // Master style (depends on placeholder type)
  if (placeholderType === "title" || placeholderType === "ctrTitle") {
    applyLevelStyle(defaults, master?.titleStyle, 0);
  } else if (placeholderType === "body" || placeholderType === "subTitle") {
    applyLevelStyle(defaults, master?.bodyLevelStyles, bulletLevel);
    applyStyle(defaults, master?.bodyStyle);
  } else {
    // Non-placeholder: otherStyle
    applyLevelStyle(defaults, master?.otherLevelStyles, bulletLevel);
    applyStyle(defaults, master?.otherStyle);
  }
  
  // Shape lstStyle
  applyLevelStyle(defaults, shapeLevelStyles, bulletLevel);
  
  return defaults;
}
```

Then in `resolveInheritance`, for each run, apply defaults only when the run has no explicit value (using a tracking mechanism — see below).

**Tracking explicit values:** The problem is distinguishing "explicitly set to 18pt" from "defaulted to 18pt". Two approaches:
- (A) Track explicit flags during parsing: add `explicitFontSize?: boolean` etc. to PptxTextRun. Most correct but invasive.
- (B) Apply defaults during parsing instead of post-processing: pass the cascade defaults into `parseTextRuns`. Simpler.

**Recommended approach (B):** Thread the cascade defaults through the parsing pipeline. In `parseParagraphs`, accept cascade defaults. In `parseTextRuns`, use cascade default instead of hardcoded 1800 when rPr/defRPr don't specify a value.

This means:
1. Build cascade defaults before parsing each shape's text
2. Pass them into `parseParagraphs`/`parseTextRuns`
3. Remove the post-processing in `resolveInheritance` step 4

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #1, #2 **Files:**

- `src/lib/pptx-parser.ts` — new `buildRunDefaults()`, refactor `parseParagraphs`/`parseTextRuns` signatures, remove `resolveInheritance` step 4
- `src/lib/pptx-types.ts` — may add a `TextDefaults` interface

**Acceptance criteria:**

- Title placeholder text inherits 44pt from master titleStyle (same as before)
- Body placeholder text inherits per-level sizes (same as before)
- Non-placeholder text inherits from master otherStyle when available
- Non-placeholder text falls back to theme objectDefaults
- Explicit run values always override cascade defaults
- All existing tests pass
- `45545_Comment.pptx` text sizes and alignments match PowerPoint more closely

---

### #4 — Apply cascade defaults during slide parsing (P1) ✅

**Description:** Thread the cascade defaults into the slide parsing pipeline so they're available when `parseTextRuns` runs (approach B from #3).

**Implementation:**

1. In `parsePptx()`, before each slide is parsed, build a `SlideTextContext` containing the master, the theme, and the presentation defaultTextStyle.

2. Modify `parseSlide()` to accept this context and pass it through to `parseShapeOrTextBox()`.

3. In `parseShapeOrTextBox()`:
   - Determine the placeholder type
   - Parse the shape's lstStyle (#2)
   - Call `buildRunDefaults()` to get the cascade defaults for this shape
   - Pass defaults to `parseParagraphs()`

4. In `parseParagraphs()`, accept `cascadeDefaults: RunDefaults` and pass per-paragraph defaults (adjusted for bullet level) to `parseTextRuns()`.

5. In `parseTextRuns()`, use `cascadeDefaults.fontSize` instead of `theme.defaultFontSize ?? 1800` as the base fallback. Same for color, bold, fontFamily.

6. Remove the post-processing step 4 from `resolveInheritance()`.

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #3 **Files:**

- `src/lib/pptx-parser.ts` — `parsePptx`, `parseSlide`, `parseShapeOrTextBox`, `parseParagraphs`, `parseTextRuns`, `resolveInheritance`

**Acceptance criteria:**

- Same visual output as before for all existing test files
- Non-placeholder text in `45545_Comment.pptx` gets correct defaults from cascade
- Post-processing step 4 in resolveInheritance can be removed
- All existing tests pass (some may need minor default value updates)

---

### #5 — Apply master otherStyle to non-placeholder shapes (P2) ✅

**Description:** Once #3/#4 are done, the cascade resolver will automatically apply otherStyle because `buildRunDefaults()` includes it. This task verifies and tests that it works correctly.

If #3/#4 are not done yet (too complex), implement a simpler version: extend the existing `resolveInheritance` post-processing to also handle non-placeholder shapes using `master.otherStyle`.

**Simple fallback approach** (if #3/#4 are deferred):

In `resolveInheritance()`, after the existing placeholder style application, add a pass for non-placeholder shapes:

```ts
// 5. Apply master otherStyle to non-placeholder shapes
for (const el of slide.elements) {
  if (el.type !== "textbox" && el.type !== "shape") continue;
  if (el.placeholderType) continue; // already handled
  
  const masterStyle = master.otherStyle;
  if (!masterStyle) continue;
  
  const paragraphs = el.type === "textbox" ? el.paragraphs : el.text;
  const defaultFs = (theme.defaultFontSize ?? 1800) / 100;
  for (const p of paragraphs) {
    for (const run of p.runs) {
      if (run.fontSize === defaultFs && masterStyle.fontSize) run.fontSize = masterStyle.fontSize;
      if (run.color === "#000000" && masterStyle.color) run.color = masterStyle.color;
      if (!run.bold && masterStyle.bold) run.bold = true;
    }
  }
}
```

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #1 **Files:**

- `src/lib/pptx-parser.ts` — `resolveInheritance`

**Acceptance criteria:**

- Non-placeholder text in slides with a master otherStyle gets correct defaults
- Text in shapes without placeholderType uses otherStyle for font size, color, bold
- Placeholders still use titleStyle/bodyStyle (not affected)

---

### #6 — Improve text body autoFit rendering (P3) ✅

**Description:** The `<a:spAutoFit/>` mode (shape auto-fit to text) is parsed but not rendered. When a shape has `autoFit: true`, the rendered div should grow to fit its text content rather than being clipped at the original height.

**Implementation:**

In `TextBoxRenderer` and `ShapeRenderer` in `PptxSlideRenderer.tsx`:
- When `bodyProps.autoFit === true`, set `height: 'auto'` and `minHeight: px(el.height)` instead of fixed `height: px(el.height)`.
- This lets the container grow to fit text while maintaining minimum dimensions.

Also verify that `normAutofit` (fontScale) is correctly applied — it should scale ALL text in the text body, not just the first paragraph.

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:**

- `src/components/editor/viewers/PptxSlideRenderer.tsx` — `TextBoxRenderer`, `positionStyle`

**Acceptance criteria:**

- Shapes with `<a:spAutoFit/>` grow to fit their text content
- Shapes with `<a:normAutofit fontScale="75000"/>` render text at 75% size
- Shapes with `<a:noAutofit/>` clip overflow (existing behavior)

---

### #7 — Write rendering regression tests against test PPTX files ✅

**Description:** Write integration tests that parse the actual PPTX test files and assert key rendering properties. This prevents regressions as the text cascade is refactored.

**Implementation:**

Create `src/lib/__tests__/pptx-rendering-regression.test.ts`:

```ts
// Parse 45545_Comment.pptx and assert:
// - theme.clrMap.bg1 === "dk2"
// - slide 1 has a title placeholder with fontSize >= 40
// - slide 1 has a non-placeholder shape "Text Box 8" with centered alignment
// - master.otherStyle is parsed
// - presentation.defaultTextStyle is parsed (if present)

// Parse SampleShow.pptx and assert:
// - theme colors are parsed
// - slide count matches expected

// Parse shapes.pptx and assert:
// - various shape types are detected
```

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #1 **Files:**

- `src/lib/__tests__/pptx-rendering-regression.test.ts` — new file

**Acceptance criteria:**

- Tests parse real PPTX files from `tests/fixtures/pptx/`
- Key rendering properties are asserted
- Tests catch regressions in color resolution, text sizing, alignment

---

### #8 — Visual regression documentation and test matrix ✅

**Description:** Document the expected rendering of each test file and create a test matrix for manual visual verification.

Create `docs/features/pptx-viewer-test-matrix.md` listing each test file with:
- What it tests (features exercised)
- Known limitations
- Expected rendering description

This serves as a reference for manual testing after any PPTX viewer changes.

**Complexity:** M **Category:** frontend **Dependencies:** None **Files:**

- `docs/features/pptx-viewer-test-matrix.md` — new file

**Acceptance criteria:**

- Each test file in `tests/fixtures/pptx/` is documented
- Known limitations are listed
- Can be used as a manual testing checklist

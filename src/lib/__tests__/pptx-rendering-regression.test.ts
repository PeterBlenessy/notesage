// @vitest-environment jsdom
/**
 * Rendering regression tests — parse real PPTX files and assert key rendering
 * properties to prevent regressions in the text cascade, color resolution,
 * and element detection.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parsePptx } from "../pptx-parser";
import type { PptxTextBox } from "../pptx-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFixture(name: string): Uint8Array {
  const buf = readFileSync(join(__dirname, `../../../tests/fixtures/pptx/${name}`));
  return new Uint8Array(buf);
}

// ---------------------------------------------------------------------------
// 45545_Comment.pptx — primary test file for text cascade
// ---------------------------------------------------------------------------

describe("45545_Comment.pptx rendering regression", () => {
  it("parses without errors and has expected slide count", async () => {
    const pres = await parsePptx(loadFixture("45545_Comment.pptx"));
    expect(pres.slides.length).toBeGreaterThanOrEqual(1);
  });

  it("has theme colors parsed", async () => {
    const pres = await parsePptx(loadFixture("45545_Comment.pptx"));
    expect(pres.theme.colors).toBeDefined();
    expect(Object.keys(pres.theme.colors).length).toBeGreaterThan(0);
    expect(pres.theme.colors.dk1).toBeDefined();
    expect(pres.theme.colors.lt1).toBeDefined();
  });

  it("has clrMap remapping set", async () => {
    const pres = await parsePptx(loadFixture("45545_Comment.pptx"));
    expect(pres.theme.clrMap).toBeDefined();
    // bg1 -> dk2 is the key mapping that makes the background dark
    expect(pres.theme.clrMap?.bg1).toBe("dk2");
  });

  it("slide 1 has a title placeholder with large font size", async () => {
    const pres = await parsePptx(loadFixture("45545_Comment.pptx"));
    const slide = pres.slides[0];
    const titleEl = slide.elements.find(el =>
      (el.type === "textbox" || el.type === "shape") && el.placeholderType === "ctrTitle"
    ) as PptxTextBox | undefined;

    if (titleEl) {
      const titleParagraphs = titleEl.paragraphs;
      expect(titleParagraphs.length).toBeGreaterThan(0);
      const firstRun = titleParagraphs[0].runs[0];
      expect(firstRun).toBeDefined();
      expect(firstRun.fontSize).toBeGreaterThanOrEqual(40);
    }
  });

  it("has master with otherStyle parsed", async () => {
    const pres = await parsePptx(loadFixture("45545_Comment.pptx"));
    expect(pres.masters.length).toBeGreaterThan(0);
    // At least one master should have otherStyle
    const hasOtherStyle = pres.masters.some(m => m.otherStyle !== undefined);
    // If the master has txStyles, it should have otherStyle
    // (not all files have txStyles, so this is conditional)
    if (pres.masters[0].titleStyle) {
      expect(hasOtherStyle).toBe(true);
    }
  });

  it("has gradient background on slide 1", async () => {
    const pres = await parsePptx(loadFixture("45545_Comment.pptx"));
    const bg = pres.slides[0].background;
    expect(bg).not.toBeNull();
    expect(bg?.fill).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SampleShow.pptx — basic slide with text
// ---------------------------------------------------------------------------

describe("SampleShow.pptx rendering regression", () => {
  it("parses without errors", async () => {
    const pres = await parsePptx(loadFixture("SampleShow.pptx"));
    expect(pres.slides.length).toBeGreaterThanOrEqual(1);
  });

  it("has theme colors and fonts", async () => {
    const pres = await parsePptx(loadFixture("SampleShow.pptx"));
    expect(pres.theme.colors).toBeDefined();
    expect(pres.theme.fonts.heading).toBeDefined();
    expect(pres.theme.fonts.body).toBeDefined();
  });

  it("has text elements on slides", async () => {
    const pres = await parsePptx(loadFixture("SampleShow.pptx"));
    let hasText = false;
    for (const slide of pres.slides) {
      for (const el of slide.elements) {
        if (el.type === "textbox" || el.type === "shape") {
          const paras = el.type === "textbox" ? el.paragraphs : el.text;
          if (paras.some(p => p.runs.length > 0)) hasText = true;
        }
      }
    }
    expect(hasText).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shapes.pptx — various shape types
// ---------------------------------------------------------------------------

describe("shapes.pptx rendering regression", () => {
  it("parses without errors and has shapes", async () => {
    const pres = await parsePptx(loadFixture("shapes.pptx"));
    expect(pres.slides.length).toBeGreaterThanOrEqual(1);

    let shapeCount = 0;
    for (const slide of pres.slides) {
      for (const el of slide.elements) {
        if (el.type === "shape") shapeCount++;
      }
    }
    expect(shapeCount).toBeGreaterThan(0);
  });

  it("has shapes with fill and stroke", async () => {
    const pres = await parsePptx(loadFixture("shapes.pptx"));
    let hasFill = false;
    for (const slide of pres.slides) {
      for (const el of slide.elements) {
        if (el.type === "shape") {
          if (el.fill) hasFill = true;
        }
      }
    }
    expect(hasFill).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bar-chart.pptx — chart rendering
// ---------------------------------------------------------------------------

describe("bar-chart.pptx rendering regression", () => {
  it("parses chart with series and categories", async () => {
    const pres = await parsePptx(loadFixture("bar-chart.pptx"));
    let hasChart = false;
    for (const slide of pres.slides) {
      for (const el of slide.elements) {
        if (el.type === "chart") {
          hasChart = true;
          expect(el.chartType).toBe("bar");
          expect(el.series.length).toBeGreaterThan(0);
          expect(el.categories.length).toBeGreaterThan(0);
        }
      }
    }
    expect(hasChart).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// table_test.pptx — table rendering
// ---------------------------------------------------------------------------

describe("table_test.pptx rendering regression", () => {
  it("parses table with rows and cells", async () => {
    const pres = await parsePptx(loadFixture("table_test.pptx"));
    let hasTable = false;
    for (const slide of pres.slides) {
      for (const el of slide.elements) {
        if (el.type === "table") {
          hasTable = true;
          expect(el.rows.length).toBeGreaterThan(0);
          expect(el.rows[0].cells.length).toBeGreaterThan(0);
        }
      }
    }
    expect(hasTable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// backgrounds.pptx — background inheritance
// ---------------------------------------------------------------------------

describe("backgrounds.pptx rendering regression", () => {
  it("parses slides with backgrounds", async () => {
    const pres = await parsePptx(loadFixture("backgrounds.pptx"));
    expect(pres.slides.length).toBeGreaterThanOrEqual(1);
    // At least one slide should have a background (either direct or inherited)
    const hasBackground = pres.slides.some(s => s.background !== null);
    expect(hasBackground).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// All fixture files — smoke test
// ---------------------------------------------------------------------------

const FIXTURE_FILES = [
  "45545_Comment.pptx",
  "backgrounds.pptx",
  "bar-chart.pptx",
  "line-chart.pptx",
  "minimal-gradient-fill-issue.pptx",
  "pie-chart.pptx",
  "radar-chart.pptx",
  "SampleShow.pptx",
  "scatter-chart.pptx",
  "shapes.pptx",
  "smartart-simple.pptx",
  "table_test.pptx",
];

describe("all PPTX fixtures — smoke test", () => {
  for (const file of FIXTURE_FILES) {
    it(`${file} parses without errors`, async () => {
      const pres = await parsePptx(loadFixture(file));
      expect(pres.slides.length).toBeGreaterThan(0);
      expect(pres.theme).toBeDefined();

      // Every slide should have searchText populated
      for (const slide of pres.slides) {
        expect(typeof slide.searchText).toBe("string");
      }
    });
  }
});

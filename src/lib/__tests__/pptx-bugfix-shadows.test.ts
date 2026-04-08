// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { parseTextRuns } from "../pptx-parser";
import type { PptxTheme } from "../pptx-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";

const defaultTheme: PptxTheme = {
  colors: { dk1: "#000000", lt1: "#ffffff", dk2: "#333333", lt2: "#eeeeee", accent1: "#4472c4" },
  fonts: { heading: "Calibri", body: "Calibri" },
};

function makeParagraph(inner: string): Element {
  const xml = `<a:p xmlns:a="${DRAWING_NS}">${inner}</a:p>`;
  return new DOMParser().parseFromString(xml, "application/xml").documentElement;
}

// ---------------------------------------------------------------------------
// Text-level shadow parsing
// ---------------------------------------------------------------------------

describe("parseTextRuns — text-level shadow", () => {
  it("parses shadow from rPr effectLst outerShdw", () => {
    const p = makeParagraph(`
      <a:r>
        <a:rPr>
          <a:effectLst>
            <a:outerShdw blurRad="50800" dist="38100" dir="2700000">
              <a:srgbClr val="000000">
                <a:alpha val="40000" />
              </a:srgbClr>
            </a:outerShdw>
          </a:effectLst>
        </a:rPr>
        <a:t>Shadow text</a:t>
      </a:r>
    `);

    const runs = parseTextRuns(p, defaultTheme);
    expect(runs).toHaveLength(1);
    expect(runs[0].shadow).toBeDefined();

    const shadow = runs[0].shadow!;
    // blurRad: 50800 / 12700 = 4
    expect(shadow.blur).toBe(4);
    // dist: 38100 / 12700 = 3, dir: 2700000 / 60000 = 45 degrees
    // offsetX = 3 * sin(45°) ≈ 2.1
    // offsetY = 3 * cos(45°) ≈ 2.1
    expect(shadow.offsetX).toBeCloseTo(2.1, 1);
    expect(shadow.offsetY).toBeCloseTo(2.1, 1);
    expect(shadow.color).toBe("#000000");
    // alpha: 40000 / 100000 = 0.4
    expect(shadow.alpha).toBeCloseTo(0.4, 2);
  });

  it("returns no shadow when effectLst is absent", () => {
    const p = makeParagraph(`
      <a:r>
        <a:rPr b="1" />
        <a:t>No shadow</a:t>
      </a:r>
    `);

    const runs = parseTextRuns(p, defaultTheme);
    expect(runs).toHaveLength(1);
    expect(runs[0].shadow).toBeUndefined();
  });

  it("returns no shadow when effectLst has no outerShdw", () => {
    const p = makeParagraph(`
      <a:r>
        <a:rPr>
          <a:effectLst />
        </a:rPr>
        <a:t>Empty effects</a:t>
      </a:r>
    `);

    const runs = parseTextRuns(p, defaultTheme);
    expect(runs).toHaveLength(1);
    expect(runs[0].shadow).toBeUndefined();
  });

  it("computes correct offsets for 0-degree direction (straight down)", () => {
    const p = makeParagraph(`
      <a:r>
        <a:rPr>
          <a:effectLst>
            <a:outerShdw blurRad="25400" dist="25400" dir="0">
              <a:srgbClr val="333333" />
            </a:outerShdw>
          </a:effectLst>
        </a:rPr>
        <a:t>Down shadow</a:t>
      </a:r>
    `);

    const runs = parseTextRuns(p, defaultTheme);
    const shadow = runs[0].shadow!;
    // dist = 25400 / 12700 = 2, dir = 0 degrees
    // offsetX = 2 * sin(0) = 0
    // offsetY = 2 * cos(0) = 2
    expect(shadow.offsetX).toBe(0);
    expect(shadow.offsetY).toBe(2);
    expect(shadow.blur).toBe(2); // 25400 / 12700
    expect(shadow.color).toBe("#333333");
  });

  it("computes correct offsets for 90-degree direction (right)", () => {
    const p = makeParagraph(`
      <a:r>
        <a:rPr>
          <a:effectLst>
            <a:outerShdw blurRad="0" dist="63500" dir="5400000">
              <a:srgbClr val="FF0000" />
            </a:outerShdw>
          </a:effectLst>
        </a:rPr>
        <a:t>Right shadow</a:t>
      </a:r>
    `);

    const runs = parseTextRuns(p, defaultTheme);
    const shadow = runs[0].shadow!;
    // dist = 63500 / 12700 = 5, dir = 5400000 / 60000 = 90 degrees
    // offsetX = 5 * sin(90°) = 5
    // offsetY = 5 * cos(90°) ≈ 0
    expect(shadow.offsetX).toBe(5);
    expect(shadow.offsetY).toBeCloseTo(0, 1);
    expect(shadow.color).toBe("#FF0000");
  });

  it("uses scheme color for shadow", () => {
    const p = makeParagraph(`
      <a:r>
        <a:rPr>
          <a:effectLst>
            <a:outerShdw blurRad="12700" dist="12700" dir="2700000">
              <a:schemeClr val="dk1" />
            </a:outerShdw>
          </a:effectLst>
        </a:rPr>
        <a:t>Scheme shadow</a:t>
      </a:r>
    `);

    const runs = parseTextRuns(p, defaultTheme);
    const shadow = runs[0].shadow!;
    expect(shadow.color).toBe("#000000"); // dk1 from theme
  });
});

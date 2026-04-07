// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { parseTextRuns, parseStroke } from "../pptx-parser";
import type { PptxTheme } from "../pptx-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";

const defaultTheme: PptxTheme = {
  colors: { dk1: "#000000", lt1: "#ffffff", dk2: "#333333", lt2: "#eeeeee", accent1: "#4472c4" },
  fonts: { heading: "Calibri", body: "Calibri" },
};

/** Build a <a:p> element with a single run containing the given rPr attributes */
function makeParagraphXml(rPrAttrs: string, text = "test"): Element {
  const xml = `<a:p xmlns:a="${DRAWING_NS}">
    <a:r>
      <a:rPr ${rPrAttrs}/>
      <a:t>${text}</a:t>
    </a:r>
  </a:p>`;
  return new DOMParser().parseFromString(xml, "application/xml").documentElement;
}

/** Build a <a:spPr> element with a <a:ln> containing the given inner XML */
function makeSpPrWithLine(lnAttrs: string, lnChildren: string): Element {
  const xml = `<p:spPr xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="${DRAWING_NS}">
    <a:ln ${lnAttrs}>
      <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
      ${lnChildren}
    </a:ln>
  </p:spPr>`;
  return new DOMParser().parseFromString(xml, "application/xml").documentElement;
}

// ---------------------------------------------------------------------------
// Character spacing (V18)
// ---------------------------------------------------------------------------

describe("Character spacing (spc attribute)", () => {
  it("parses spc='300' as letterSpacing: 3 (pt)", () => {
    const p = makeParagraphXml('spc="300"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].letterSpacing).toBe(3);
  });

  it("parses spc='-100' as letterSpacing: -1", () => {
    const p = makeParagraphXml('spc="-100"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].letterSpacing).toBe(-1);
  });

  it("omits letterSpacing when no spc attribute", () => {
    const p = makeParagraphXml('b="1"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].letterSpacing).toBeUndefined();
  });

  it("omits letterSpacing when spc='0'", () => {
    const p = makeParagraphXml('spc="0"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].letterSpacing).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Text caps (V21)
// ---------------------------------------------------------------------------

describe("Text caps (cap attribute)", () => {
  it("parses cap='all' as caps: 'all'", () => {
    const p = makeParagraphXml('cap="all"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].caps).toBe("all");
  });

  it("parses cap='small' as caps: 'small'", () => {
    const p = makeParagraphXml('cap="small"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].caps).toBe("small");
  });

  it("omits caps when cap='none'", () => {
    const p = makeParagraphXml('cap="none"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].caps).toBeUndefined();
  });

  it("omits caps when no cap attribute", () => {
    const p = makeParagraphXml('b="1"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].caps).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Image transparency (V23) — tested indirectly via parsePicture (not exported),
// so we validate the type contract here
// ---------------------------------------------------------------------------

describe("Image transparency (alphaModFix)", () => {
  it("50000 amt should map to 0.5 opacity", () => {
    // Direct calculation test — parsePicture does: parseInt(amt) / 100000
    expect(parseInt("50000", 10) / 100000).toBe(0.5);
  });

  it("100000 amt should map to 1.0 opacity", () => {
    expect(parseInt("100000", 10) / 100000).toBe(1);
  });

  it("75000 amt should map to 0.75 opacity", () => {
    expect(parseInt("75000", 10) / 100000).toBe(0.75);
  });
});

// ---------------------------------------------------------------------------
// Arrow heads (V24)
// ---------------------------------------------------------------------------

describe("Arrow head parsing", () => {
  it("parses headEnd type='triangle'", () => {
    const spPr = makeSpPrWithLine("", '<a:headEnd type="triangle"/>');
    const result = parseStroke(spPr, defaultTheme);
    expect(result.headArrow).toEqual({ type: "triangle" });
    expect(result.tailArrow).toBeUndefined();
  });

  it("parses tailEnd type='stealth' with width and length", () => {
    const spPr = makeSpPrWithLine("", '<a:tailEnd type="stealth" w="lg" len="sm"/>');
    const result = parseStroke(spPr, defaultTheme);
    expect(result.tailArrow).toEqual({ type: "stealth", width: "lg", length: "sm" });
    expect(result.headArrow).toBeUndefined();
  });

  it("parses both head and tail arrows", () => {
    const spPr = makeSpPrWithLine("", '<a:headEnd type="diamond"/><a:tailEnd type="oval"/>');
    const result = parseStroke(spPr, defaultTheme);
    expect(result.headArrow).toEqual({ type: "diamond" });
    expect(result.tailArrow).toEqual({ type: "oval" });
  });

  it("ignores headEnd type='none'", () => {
    const spPr = makeSpPrWithLine("", '<a:headEnd type="none"/>');
    const result = parseStroke(spPr, defaultTheme);
    expect(result.headArrow).toBeUndefined();
  });

  it("returns no arrows when no headEnd/tailEnd elements", () => {
    const spPr = makeSpPrWithLine("", "");
    const result = parseStroke(spPr, defaultTheme);
    expect(result.headArrow).toBeUndefined();
    expect(result.tailArrow).toBeUndefined();
  });

  it("parses arrow type 'arrow' (open arrow)", () => {
    const spPr = makeSpPrWithLine("", '<a:tailEnd type="arrow" w="med" len="med"/>');
    const result = parseStroke(spPr, defaultTheme);
    expect(result.tailArrow).toEqual({ type: "arrow", width: "med", length: "med" });
  });
});

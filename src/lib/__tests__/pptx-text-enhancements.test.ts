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

/** Build a <a:p> element with a single run containing the given rPr inner XML */
function makeParagraphWithRPr(rPrInner: string, text = "test"): Element {
  const xml = `<a:p xmlns:a="${DRAWING_NS}">
    <a:r>
      <a:rPr ${rPrInner}/>
      <a:t>${text}</a:t>
    </a:r>
  </a:p>`;
  return new DOMParser().parseFromString(xml, "application/xml").documentElement;
}

/** Build a <a:p> element with rPr containing child elements */
function makeParagraphWithRPrChildren(rPrAttrs: string, rPrChildren: string, text = "test"): Element {
  const xml = `<a:p xmlns:a="${DRAWING_NS}">
    <a:r>
      <a:rPr ${rPrAttrs}>${rPrChildren}</a:rPr>
      <a:t>${text}</a:t>
    </a:r>
  </a:p>`;
  return new DOMParser().parseFromString(xml, "application/xml").documentElement;
}

// ---------------------------------------------------------------------------
// Underline styles (Task #1)
// ---------------------------------------------------------------------------

describe("Underline styles", () => {
  it("parses u='sng' as underline with underlineStyle 'sng'", () => {
    const p = makeParagraphWithRPr('u="sng"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].underline).toBe(true);
    expect(runs[0].underlineStyle).toBe("sng");
  });

  it("parses u='dbl' as underline with underlineStyle 'dbl'", () => {
    const p = makeParagraphWithRPr('u="dbl"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].underline).toBe(true);
    expect(runs[0].underlineStyle).toBe("dbl");
  });

  it("parses u='heavy' as underline with underlineStyle 'heavy'", () => {
    const p = makeParagraphWithRPr('u="heavy"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].underline).toBe(true);
    expect(runs[0].underlineStyle).toBe("heavy");
  });

  it("parses u='dotted'", () => {
    const p = makeParagraphWithRPr('u="dotted"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].underline).toBe(true);
    expect(runs[0].underlineStyle).toBe("dotted");
  });

  it("parses u='dash'", () => {
    const p = makeParagraphWithRPr('u="dash"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].underline).toBe(true);
    expect(runs[0].underlineStyle).toBe("dash");
  });

  it("parses u='wavy'", () => {
    const p = makeParagraphWithRPr('u="wavy"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].underline).toBe(true);
    expect(runs[0].underlineStyle).toBe("wavy");
  });

  it("parses u='dashLong'", () => {
    const p = makeParagraphWithRPr('u="dashLong"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].underline).toBe(true);
    expect(runs[0].underlineStyle).toBe("dashLong");
  });

  it("parses u='dottedHeavy'", () => {
    const p = makeParagraphWithRPr('u="dottedHeavy"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].underline).toBe(true);
    expect(runs[0].underlineStyle).toBe("dottedHeavy");
  });

  it("parses u='dashHeavy'", () => {
    const p = makeParagraphWithRPr('u="dashHeavy"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].underline).toBe(true);
    expect(runs[0].underlineStyle).toBe("dashHeavy");
  });

  it("parses u='wavyHeavy'", () => {
    const p = makeParagraphWithRPr('u="wavyHeavy"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].underline).toBe(true);
    expect(runs[0].underlineStyle).toBe("wavyHeavy");
  });

  it("does not set underlineStyle when u='none'", () => {
    const p = makeParagraphWithRPr('u="none"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].underline).toBe(false);
    expect(runs[0].underlineStyle).toBeUndefined();
  });

  it("does not set underlineStyle when no u attribute", () => {
    const p = makeParagraphWithRPr('b="1"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].underline).toBe(false);
    expect(runs[0].underlineStyle).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Underline color (Task #1)
// ---------------------------------------------------------------------------

describe("Underline color", () => {
  it("parses underline color from uFill > solidFill > srgbClr", () => {
    const p = makeParagraphWithRPrChildren(
      'u="sng"',
      '<a:uFill><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:uFill>',
    );
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].underline).toBe(true);
    expect(runs[0].underlineColor).toBe("#FF0000");
  });

  it("parses underline color from uFill > solidFill > schemeClr", () => {
    const p = makeParagraphWithRPrChildren(
      'u="sng"',
      '<a:uFill><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:uFill>',
    );
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].underlineColor).toBe("#4472c4");
  });

  it("does not set underlineColor when no uFill", () => {
    const p = makeParagraphWithRPr('u="sng"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].underlineColor).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Text highlight (Task #3)
// ---------------------------------------------------------------------------

describe("Text highlight", () => {
  it("parses highlight from a:highlight > srgbClr", () => {
    const p = makeParagraphWithRPrChildren(
      "",
      '<a:highlight><a:srgbClr val="FFFF00"/></a:highlight>',
    );
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].highlight).toBe("#FFFF00");
  });

  it("parses highlight from a:highlight > schemeClr", () => {
    const p = makeParagraphWithRPrChildren(
      "",
      '<a:highlight><a:schemeClr val="accent1"/></a:highlight>',
    );
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].highlight).toBe("#4472c4");
  });

  it("does not set highlight when no a:highlight element", () => {
    const p = makeParagraphWithRPr('b="1"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].highlight).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Kerning (Task #4)
// ---------------------------------------------------------------------------

describe("Kerning", () => {
  it("parses kern attribute as hundredths of a point", () => {
    const p = makeParagraphWithRPr('kern="1200"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].kern).toBe(1200);
  });

  it("does not set kern when value is 0", () => {
    const p = makeParagraphWithRPr('kern="0"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].kern).toBeUndefined();
  });

  it("does not set kern when no kern attribute", () => {
    const p = makeParagraphWithRPr('b="1"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].kern).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CJK/Complex Script fonts (Task #6)
// ---------------------------------------------------------------------------

describe("CJK/Complex Script fonts", () => {
  it("parses a:ea typeface as eaFont", () => {
    const p = makeParagraphWithRPrChildren(
      "",
      '<a:ea typeface="MS Mincho"/>',
    );
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].eaFont).toBe("MS Mincho");
  });

  it("parses a:cs typeface as csFont", () => {
    const p = makeParagraphWithRPrChildren(
      "",
      '<a:cs typeface="Arial Unicode MS"/>',
    );
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].csFont).toBe("Arial Unicode MS");
  });

  it("resolves +mj-ea to theme heading font", () => {
    const theme: PptxTheme = {
      ...defaultTheme,
      fonts: { heading: "Yu Gothic", body: "Yu Mincho" },
    };
    const p = makeParagraphWithRPrChildren(
      "",
      '<a:latin typeface="Arial"/><a:ea typeface="+mj-ea"/>',
    );
    const runs = parseTextRuns(p, theme);
    expect(runs[0].eaFont).toBe("Yu Gothic");
  });

  it("resolves +mn-ea to theme body font", () => {
    const theme: PptxTheme = {
      ...defaultTheme,
      fonts: { heading: "Yu Gothic", body: "Yu Mincho" },
    };
    const p = makeParagraphWithRPrChildren(
      "",
      '<a:latin typeface="Arial"/><a:ea typeface="+mn-ea"/>',
    );
    const runs = parseTextRuns(p, theme);
    expect(runs[0].eaFont).toBe("Yu Mincho");
  });

  it("resolves +mj-cs to theme heading font", () => {
    const theme: PptxTheme = {
      ...defaultTheme,
      fonts: { heading: "Calibri", body: "Arial" },
    };
    const p = makeParagraphWithRPrChildren(
      "",
      '<a:latin typeface="Times New Roman"/><a:cs typeface="+mj-cs"/>',
    );
    const runs = parseTextRuns(p, theme);
    expect(runs[0].csFont).toBe("Calibri");
  });

  it("resolves +mn-cs to theme body font", () => {
    const theme: PptxTheme = {
      ...defaultTheme,
      fonts: { heading: "Calibri", body: "Arial" },
    };
    const p = makeParagraphWithRPrChildren(
      "",
      '<a:latin typeface="Times New Roman"/><a:cs typeface="+mn-cs"/>',
    );
    const runs = parseTextRuns(p, theme);
    expect(runs[0].csFont).toBe("Arial");
  });

  it("does not set eaFont when it matches fontFamily", () => {
    const p = makeParagraphWithRPrChildren(
      "",
      '<a:latin typeface="Calibri"/><a:ea typeface="Calibri"/>',
    );
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].fontFamily).toBe("Calibri");
    expect(runs[0].eaFont).toBeUndefined();
  });

  it("does not set csFont when it matches fontFamily", () => {
    const p = makeParagraphWithRPrChildren(
      "",
      '<a:latin typeface="Calibri"/><a:cs typeface="Calibri"/>',
    );
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].csFont).toBeUndefined();
  });

  it("does not set eaFont or csFont when no elements present", () => {
    const p = makeParagraphWithRPr('b="1"');
    const runs = parseTextRuns(p, defaultTheme);
    expect(runs[0].eaFont).toBeUndefined();
    expect(runs[0].csFont).toBeUndefined();
  });
});

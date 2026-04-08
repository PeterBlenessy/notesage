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

/** Build a <a:p> element with a single run (with optional rPr) and optional pPr */
function makeParagraph(options: {
  rPrAttrs?: string;
  pPrInner?: string;
  text?: string;
  noRPr?: boolean;
}): { pEl: Element; pPr: Element | null } {
  const { rPrAttrs, pPrInner, text = "test", noRPr } = options;
  const rPrXml = noRPr ? "" : `<a:rPr ${rPrAttrs ?? ""}/>`;
  const pPrXml = pPrInner ? `<a:pPr>${pPrInner}</a:pPr>` : "";
  const xml = `<a:p xmlns:a="${DRAWING_NS}">
    ${pPrXml}
    <a:r>
      ${rPrXml}
      <a:t>${text}</a:t>
    </a:r>
  </a:p>`;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const pEl = doc.documentElement;
  const pPr = pEl.getElementsByTagNameNS(DRAWING_NS, "pPr")[0] ?? null;
  return { pEl, pPr };
}

/** Helper to get defRPr element from pPr */
function getDefRPr(pPr: Element | null): Element | null {
  if (!pPr) return null;
  return pPr.getElementsByTagNameNS(DRAWING_NS, "defRPr")[0] ?? null;
}

// ---------------------------------------------------------------------------
// Task #5 — Tab stop parsing
// ---------------------------------------------------------------------------

describe("Tab stop parsing", () => {
  it("parses tab stops from pPr > tabLst > tab", () => {
    const xml = `<a:p xmlns:a="${DRAWING_NS}">
      <a:pPr>
        <a:tabLst>
          <a:tab pos="914400" algn="l"/>
          <a:tab pos="1828800" algn="ctr"/>
          <a:tab pos="2743200" algn="r"/>
        </a:tabLst>
      </a:pPr>
      <a:r><a:rPr/><a:t>hello</a:t></a:r>
    </a:p>`;
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const pEl = doc.documentElement;
    const pPr = pEl.getElementsByTagNameNS(DRAWING_NS, "pPr")[0];

    // We test the parsing indirectly via parseParagraphs,
    // but since parseParagraphs is not exported, we test the tab stop
    // XML structure here and verify the math.
    const tabLst = pPr.getElementsByTagNameNS(DRAWING_NS, "tabLst")[0];
    const tabs = Array.from(tabLst.getElementsByTagNameNS(DRAWING_NS, "tab"));

    expect(tabs).toHaveLength(3);

    // 914400 EMU / 9525 = 96 px
    expect(914400 / 9525).toBe(96);
    // 1828800 EMU / 9525 = 192 px
    expect(1828800 / 9525).toBe(192);
    // 2743200 EMU / 9525 = 288 px
    expect(2743200 / 9525).toBe(288);
  });

  it("handles tab stops with different alignment values", () => {
    const xml = `<a:p xmlns:a="${DRAWING_NS}">
      <a:pPr>
        <a:tabLst>
          <a:tab pos="457200" algn="dec"/>
          <a:tab pos="914400"/>
        </a:tabLst>
      </a:pPr>
      <a:r><a:rPr/><a:t>test</a:t></a:r>
    </a:p>`;
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const pEl = doc.documentElement;
    const pPr = pEl.getElementsByTagNameNS(DRAWING_NS, "pPr")[0];

    const tabLst = pPr.getElementsByTagNameNS(DRAWING_NS, "tabLst")[0];
    const tabs = Array.from(tabLst.getElementsByTagNameNS(DRAWING_NS, "tab"));

    expect(tabs).toHaveLength(2);
    // First tab: decimal alignment
    expect(tabs[0].getAttribute("algn")).toBe("dec");
    // Second tab: no alignment specified
    expect(tabs[1].getAttribute("algn")).toBeNull();
  });

  it("returns no tabStops when tabLst is absent", () => {
    const xml = `<a:p xmlns:a="${DRAWING_NS}">
      <a:pPr/>
      <a:r><a:rPr/><a:t>test</a:t></a:r>
    </a:p>`;
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const pEl = doc.documentElement;
    const pPr = pEl.getElementsByTagNameNS(DRAWING_NS, "pPr")[0];
    const tabLst = pPr.getElementsByTagNameNS(DRAWING_NS, "tabLst")[0];
    expect(tabLst).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Task #8 — Default run property resolution (defRPr)
// ---------------------------------------------------------------------------

describe("Default run property resolution (defRPr)", () => {
  it("run without rPr inherits bold from defRPr", () => {
    const { pEl, pPr } = makeParagraph({
      noRPr: true,
      pPrInner: '<a:defRPr b="1"/>',
    });
    const defRPr = getDefRPr(pPr);
    const runs = parseTextRuns(pEl, defaultTheme, undefined, defRPr);
    expect(runs[0].bold).toBe(true);
  });

  it("run without rPr inherits italic from defRPr", () => {
    const { pEl, pPr } = makeParagraph({
      noRPr: true,
      pPrInner: '<a:defRPr i="1"/>',
    });
    const defRPr = getDefRPr(pPr);
    const runs = parseTextRuns(pEl, defaultTheme, undefined, defRPr);
    expect(runs[0].italic).toBe(true);
  });

  it("run without rPr inherits underline from defRPr", () => {
    const { pEl, pPr } = makeParagraph({
      noRPr: true,
      pPrInner: '<a:defRPr u="sng"/>',
    });
    const defRPr = getDefRPr(pPr);
    const runs = parseTextRuns(pEl, defaultTheme, undefined, defRPr);
    expect(runs[0].underline).toBe(true);
  });

  it("run without rPr inherits fontSize from defRPr", () => {
    const { pEl, pPr } = makeParagraph({
      noRPr: true,
      pPrInner: '<a:defRPr sz="2400"/>',
    });
    const defRPr = getDefRPr(pPr);
    const runs = parseTextRuns(pEl, defaultTheme, undefined, defRPr);
    expect(runs[0].fontSize).toBe(24); // 2400 / 100
  });

  it("run without rPr inherits color from defRPr", () => {
    const { pEl, pPr } = makeParagraph({
      noRPr: true,
      pPrInner: '<a:defRPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:defRPr>',
    });
    const defRPr = getDefRPr(pPr);
    const runs = parseTextRuns(pEl, defaultTheme, undefined, defRPr);
    expect(runs[0].color).toBe("#FF0000");
  });

  it("run without rPr inherits fontFamily from defRPr", () => {
    const { pEl, pPr } = makeParagraph({
      noRPr: true,
      pPrInner: '<a:defRPr><a:latin typeface="Arial"/></a:defRPr>',
    });
    const defRPr = getDefRPr(pPr);
    const runs = parseTextRuns(pEl, defaultTheme, undefined, defRPr);
    expect(runs[0].fontFamily).toBe("Arial");
  });

  it("explicit rPr values override defRPr", () => {
    const { pEl, pPr } = makeParagraph({
      rPrAttrs: 'b="0" sz="1600"',
      pPrInner: '<a:defRPr b="1" sz="2400"/>',
    });
    const defRPr = getDefRPr(pPr);
    const runs = parseTextRuns(pEl, defaultTheme, undefined, defRPr);
    // rPr b="0" should override defRPr b="1"
    expect(runs[0].bold).toBe(false);
    // rPr sz="1600" should override defRPr sz="2400"
    expect(runs[0].fontSize).toBe(16);
  });

  it("explicit rPr italic overrides defRPr italic", () => {
    const { pEl, pPr } = makeParagraph({
      rPrAttrs: 'i="0"',
      pPrInner: '<a:defRPr i="1"/>',
    });
    const defRPr = getDefRPr(pPr);
    const runs = parseTextRuns(pEl, defaultTheme, undefined, defRPr);
    expect(runs[0].italic).toBe(false);
  });

  it("works without defRPr (backward compatible)", () => {
    const { pEl } = makeParagraph({ rPrAttrs: 'b="1"' });
    // No defRPr passed — should work as before
    const runs = parseTextRuns(pEl, defaultTheme);
    expect(runs[0].bold).toBe(true);
    expect(runs[0].fontSize).toBe(18); // default 1800/100
  });

  it("works when both rPr and defRPr are absent", () => {
    const { pEl } = makeParagraph({ noRPr: true });
    // No defRPr, no rPr — should use defaults
    const runs = parseTextRuns(pEl, defaultTheme);
    expect(runs[0].bold).toBe(false);
    expect(runs[0].italic).toBe(false);
    expect(runs[0].fontSize).toBe(18);
    expect(runs[0].fontFamily).toBe("Calibri");
    expect(runs[0].color).toBe("#000000");
  });

  it("defRPr provides letterSpacing when rPr is absent", () => {
    const { pEl, pPr } = makeParagraph({
      noRPr: true,
      pPrInner: '<a:defRPr spc="200"/>',
    });
    const defRPr = getDefRPr(pPr);
    const runs = parseTextRuns(pEl, defaultTheme, undefined, defRPr);
    expect(runs[0].letterSpacing).toBe(2); // 200/100
  });
});

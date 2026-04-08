// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { parseFill, parseEffects } from "../pptx-parser";
import { patternToCSS } from "../pptx-patterns";
import { fillToCSS } from "@/components/editor/viewers/PptxSlideRenderer";
import type { PptxTheme, PptxFill } from "../pptx-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PRES_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";

const defaultTheme: PptxTheme = {
  colors: { dk1: "#000000", lt1: "#ffffff", dk2: "#333333", lt2: "#eeeeee", accent1: "#4472c4" },
  fonts: { heading: "Calibri", body: "Calibri" },
};

function makeSpPr(inner: string): Element {
  const xml = `<p:spPr xmlns:p="${PRES_NS}" xmlns:a="${DRAWING_NS}">${inner}</p:spPr>`;
  return new DOMParser().parseFromString(xml, "application/xml").documentElement;
}

// ---------------------------------------------------------------------------
// Pattern fill CSS generation
// ---------------------------------------------------------------------------

describe("patternToCSS", () => {
  it("generates horizontal stripes for 'horz'", () => {
    const css = patternToCSS("horz", "#FF0000", "#FFFFFF");
    expect(css.backgroundColor).toBe("#FFFFFF");
    expect(css.backgroundImage).toContain("repeating-linear-gradient(0deg");
    expect(css.backgroundImage).toContain("#FF0000");
  });

  it("generates vertical stripes for 'vert'", () => {
    const css = patternToCSS("vert", "#0000FF", "#FFFFFF");
    expect(css.backgroundImage).toContain("repeating-linear-gradient(90deg");
  });

  it("generates diagonal down stripes for 'dnDiag'", () => {
    const css = patternToCSS("dnDiag", "#000000", "#FFFFFF");
    expect(css.backgroundImage).toContain("repeating-linear-gradient(45deg");
  });

  it("generates diagonal up stripes for 'upDiag'", () => {
    const css = patternToCSS("upDiag", "#000000", "#FFFFFF");
    expect(css.backgroundImage).toContain("-45deg");
  });

  it("generates thick horizontal stripes for 'dkHorz'", () => {
    const css = patternToCSS("dkHorz", "#000000", "#FFFFFF");
    expect(css.backgroundImage).toContain("repeating-linear-gradient(0deg");
    // Thick: 2px stripe, total 5px period
    expect(css.backgroundImage).toContain("2px");
  });

  it("generates thick vertical stripes for 'dkVert'", () => {
    const css = patternToCSS("dkVert", "#000000", "#FFFFFF");
    expect(css.backgroundImage).toContain("90deg");
  });

  it("generates thick diagonal down for 'dkDnDiag'", () => {
    const css = patternToCSS("dkDnDiag", "#000000", "#FFFFFF");
    expect(css.backgroundImage).toContain("45deg");
  });

  it("generates thick diagonal up for 'dkUpDiag'", () => {
    const css = patternToCSS("dkUpDiag", "#000000", "#FFFFFF");
    expect(css.backgroundImage).toContain("-45deg");
  });

  it("generates thin horizontal stripes for 'ltHorz'", () => {
    const css = patternToCSS("ltHorz", "#000000", "#FFFFFF");
    expect(css.backgroundImage).toContain("repeating-linear-gradient(0deg");
    // Thin: 1px stripe, 6px total period
    expect(css.backgroundImage).toContain("6px");
  });

  it("generates thin vertical stripes for 'ltVert'", () => {
    const css = patternToCSS("ltVert", "#000000", "#FFFFFF");
    expect(css.backgroundImage).toContain("90deg");
  });

  it("falls back to solid fill for unknown preset", () => {
    const css = patternToCSS("unknownPattern", "#FF0000", "#FFFFFF");
    expect(css.backgroundColor).toBe("#FF0000");
    expect(css.backgroundImage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Pattern fill parsing
// ---------------------------------------------------------------------------

describe("parseFill — pattern fills", () => {
  it("parses pattern fill with preset, foreground and background", () => {
    const spPr = makeSpPr(`
      <a:pattFill prst="horz">
        <a:fgClr><a:srgbClr val="FF0000"/></a:fgClr>
        <a:bgClr><a:srgbClr val="00FF00"/></a:bgClr>
      </a:pattFill>
    `);
    const fill = parseFill(spPr, defaultTheme);
    expect(fill).not.toBeNull();
    expect(fill!.type).toBe("pattern");
    if (fill!.type === "pattern") {
      expect(fill!.preset).toBe("horz");
      expect(fill!.foreground).toBe("#FF0000");
      expect(fill!.background).toBe("#00FF00");
    }
  });

  it("defaults foreground to #000000 and background to #ffffff when missing", () => {
    const spPr = makeSpPr(`<a:pattFill prst="vert"></a:pattFill>`);
    const fill = parseFill(spPr, defaultTheme);
    expect(fill).not.toBeNull();
    if (fill!.type === "pattern") {
      expect(fill!.foreground).toBe("#000000");
      expect(fill!.background).toBe("#ffffff");
    }
  });

  it("defaults preset to 'solid' when attribute is missing", () => {
    const spPr = makeSpPr(`
      <a:pattFill>
        <a:fgClr><a:srgbClr val="333333"/></a:fgClr>
      </a:pattFill>
    `);
    const fill = parseFill(spPr, defaultTheme);
    if (fill!.type === "pattern") {
      expect(fill!.preset).toBe("solid");
    }
  });
});

// ---------------------------------------------------------------------------
// fillToCSS — pattern fills (backward compat)
// ---------------------------------------------------------------------------

describe("fillToCSS — pattern fills", () => {
  it("renders new pattern format with patternToCSS", () => {
    const fill: PptxFill = { type: "pattern", preset: "horz", foreground: "#FF0000", background: "#FFFFFF" };
    const css = fillToCSS(fill);
    expect(css.backgroundImage).toContain("repeating-linear-gradient");
  });

  it("falls back to solid backgroundColor for old format without preset", () => {
    const fill: PptxFill = { type: "pattern", foreground: "#FF0000" };
    const css = fillToCSS(fill);
    expect(css.backgroundColor).toBe("#FF0000");
    expect(css.backgroundImage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fillToCSS — picture fills
// ---------------------------------------------------------------------------

describe("fillToCSS — picture fills", () => {
  it("renders picture fill with stretch", () => {
    const fill: PptxFill = { type: "picture", dataUrl: "data:image/png;base64,abc", stretch: true };
    const css = fillToCSS(fill);
    expect(css.backgroundImage).toBe("url(data:image/png;base64,abc)");
    expect(css.backgroundSize).toBe("100% 100%");
    expect(css.backgroundRepeat).toBe("no-repeat");
  });

  it("renders picture fill with tile", () => {
    const fill: PptxFill = { type: "picture", dataUrl: "data:image/png;base64,abc", tile: true };
    const css = fillToCSS(fill);
    expect(css.backgroundSize).toBe("auto");
    expect(css.backgroundRepeat).toBe("repeat");
  });

  it("renders picture fill with cover as default", () => {
    const fill: PptxFill = { type: "picture", dataUrl: "data:image/png;base64,abc" };
    const css = fillToCSS(fill);
    expect(css.backgroundSize).toBe("cover");
  });
});

// ---------------------------------------------------------------------------
// Glow effect parsing
// ---------------------------------------------------------------------------

describe("parseEffects — glow", () => {
  it("parses glow with radius and color", () => {
    const spPr = makeSpPr(`
      <a:effectLst>
        <a:glow rad="127000">
          <a:srgbClr val="FFD700">
            <a:alpha val="60000"/>
          </a:srgbClr>
        </a:glow>
      </a:effectLst>
    `);
    const effects = parseEffects(spPr, defaultTheme);
    expect(effects.glow).toBeDefined();
    expect(effects.glow!.radius).toBeCloseTo(10, 0); // 127000 / 12700 = 10
    expect(effects.glow!.color).toBe("#FFD700");
    expect(effects.glow!.alpha).toBeCloseTo(0.6, 1); // 60000 / 100000
  });

  it("returns undefined glow when no glow element present", () => {
    const spPr = makeSpPr(`<a:effectLst></a:effectLst>`);
    const effects = parseEffects(spPr, defaultTheme);
    expect(effects.glow).toBeUndefined();
  });

  it("defaults alpha to 0.5 when no alpha child", () => {
    const spPr = makeSpPr(`
      <a:effectLst>
        <a:glow rad="63500">
          <a:srgbClr val="FF0000"/>
        </a:glow>
      </a:effectLst>
    `);
    const effects = parseEffects(spPr, defaultTheme);
    expect(effects.glow!.alpha).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Soft edge parsing
// ---------------------------------------------------------------------------

describe("parseEffects — softEdge", () => {
  it("parses soft edge radius", () => {
    const spPr = makeSpPr(`
      <a:effectLst>
        <a:softEdge rad="63500"/>
      </a:effectLst>
    `);
    const effects = parseEffects(spPr, defaultTheme);
    expect(effects.softEdge).toBeCloseTo(5, 0); // 63500 / 12700 = 5
  });

  it("returns undefined softEdge when no element present", () => {
    const spPr = makeSpPr(`<a:effectLst></a:effectLst>`);
    const effects = parseEffects(spPr, defaultTheme);
    expect(effects.softEdge).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Combined effects
// ---------------------------------------------------------------------------

describe("parseEffects — combined", () => {
  it("parses shadow, glow, and softEdge together", () => {
    const spPr = makeSpPr(`
      <a:effectLst>
        <a:outerShdw blurRad="50800" dist="38100" dir="5400000">
          <a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr>
        </a:outerShdw>
        <a:glow rad="127000">
          <a:srgbClr val="FF0000"><a:alpha val="75000"/></a:srgbClr>
        </a:glow>
        <a:softEdge rad="25400"/>
      </a:effectLst>
    `);
    const effects = parseEffects(spPr, defaultTheme);
    expect(effects.shadow).toBeDefined();
    expect(effects.glow).toBeDefined();
    expect(effects.softEdge).toBeCloseTo(2, 0); // 25400 / 12700 = 2
  });

  it("returns empty object when no effectLst", () => {
    const spPr = makeSpPr("");
    const effects = parseEffects(spPr, defaultTheme);
    expect(effects).toEqual({});
  });
});

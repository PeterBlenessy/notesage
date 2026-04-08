// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parsePptx, parseTextStyleLevels, resolveInheritance } from "../pptx-parser";
import type { PptxTheme, PptxTextBox, PptxPresentation, PptxSlideMaster, PptxTextStyle, PptxTextRun } from "../pptx-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";

const defaultTheme: PptxTheme = {
  colors: { dk1: "#000000", lt1: "#ffffff", dk2: "#333333", lt2: "#eeeeee", accent1: "#4472c4" },
  fonts: { heading: "Calibri", body: "Arial" },
};

function loadFixture(name: string): Uint8Array {
  const buf = readFileSync(join(__dirname, `../../../tests/fixtures/${name}`));
  return new Uint8Array(buf);
}

function makeStyleElement(xml: string): Element {
  const doc = new DOMParser().parseFromString(
    `<root xmlns:a="${DRAWING_NS}">${xml}</root>`,
    "application/xml",
  );
  return doc.documentElement;
}

// ---------------------------------------------------------------------------
// parseTextStyleLevels — unit tests with synthetic XML
// ---------------------------------------------------------------------------

describe("parseTextStyleLevels", () => {
  it("parses lvl1pPr through lvl3pPr correctly", () => {
    const el = makeStyleElement(`
      <a:lvl1pPr algn="l">
        <a:defRPr sz="1800" b="1">
          <a:latin typeface="Helvetica"/>
          <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
        </a:defRPr>
      </a:lvl1pPr>
      <a:lvl2pPr algn="ctr">
        <a:defRPr sz="1400" i="1">
          <a:latin typeface="+mn-lt"/>
        </a:defRPr>
      </a:lvl2pPr>
      <a:lvl3pPr>
        <a:defRPr sz="1200"/>
      </a:lvl3pPr>
    `);

    const levels = parseTextStyleLevels(el, defaultTheme);
    expect(levels).toHaveLength(3);

    // Level 1
    expect(levels[0].alignment).toBe("left");
    expect(levels[0].fontSize).toBe(18);
    expect(levels[0].bold).toBe(true);
    expect(levels[0].fontFamily).toBe("Helvetica");
    expect(levels[0].color).toBe("#FF0000");

    // Level 2
    expect(levels[1].alignment).toBe("center");
    expect(levels[1].fontSize).toBe(14);
    expect(levels[1].italic).toBe(true);
    expect(levels[1].fontFamily).toBe("Arial"); // +mn-lt -> body font

    // Level 3
    expect(levels[2].fontSize).toBe(12);
  });

  it("resolves +mj-lt to heading font", () => {
    const el = makeStyleElement(`
      <a:lvl1pPr>
        <a:defRPr><a:latin typeface="+mj-lt"/></a:defRPr>
      </a:lvl1pPr>
    `);

    const levels = parseTextStyleLevels(el, defaultTheme);
    expect(levels).toHaveLength(1);
    expect(levels[0].fontFamily).toBe("Calibri"); // heading font
  });

  it("returns empty array when no levels are present", () => {
    const levels = parseTextStyleLevels(null, defaultTheme);
    expect(levels).toHaveLength(0);
  });

  it("handles gaps between levels", () => {
    const el = makeStyleElement(`
      <a:lvl1pPr>
        <a:defRPr sz="2400"/>
      </a:lvl1pPr>
      <a:lvl3pPr>
        <a:defRPr sz="1600"/>
      </a:lvl3pPr>
    `);

    const levels = parseTextStyleLevels(el, defaultTheme);
    expect(levels).toHaveLength(3);
    expect(levels[0].fontSize).toBe(24);
    expect(levels[1]).toEqual({}); // lvl2 is a gap
    expect(levels[2].fontSize).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// Master otherStyle — real PPTX fixture
// ---------------------------------------------------------------------------

describe("master text styles from real PPTX", () => {
  it("parses master text styles from test-presentation.pptx without errors", async () => {
    const pres = await parsePptx(loadFixture("test-presentation.pptx"));

    for (const master of pres.masters) {
      expect(master.shapes).toBeDefined();
      expect(master.placeholders).toBeDefined();

      if (master.otherStyle) {
        expect(typeof master.otherStyle).toBe("object");
        expect(Object.keys(master.otherStyle).length).toBeGreaterThan(0);
      }

      if (master.otherLevelStyles) {
        expect(Array.isArray(master.otherLevelStyles)).toBe(true);
        expect(master.otherLevelStyles.length).toBeGreaterThan(0);
      }
    }
  });

  it("master interface includes otherStyle and level style fields", () => {
    const master: import("../pptx-types").PptxSlideMaster = {
      shapes: [],
      placeholders: [],
      background: null,
      titleStyle: { fontSize: 44 },
      bodyStyle: { fontSize: 24 },
      otherStyle: { fontSize: 18, fontFamily: "Arial" },
      otherLevelStyles: [{ fontSize: 18 }, { fontSize: 16 }],
      titleLevelStyles: [{ fontSize: 44 }],
      bodyLevelStyles: [{ fontSize: 24 }],
    };
    expect(master.otherStyle?.fontSize).toBe(18);
    expect(master.otherLevelStyles).toHaveLength(2);
    expect(master.titleLevelStyles).toHaveLength(1);
    expect(master.bodyLevelStyles).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Presentation defaultTextStyle
// ---------------------------------------------------------------------------

describe("presentation defaultTextStyle", () => {
  it("parses defaultTextStyle from test-presentation.pptx if present", async () => {
    const pres = await parsePptx(loadFixture("test-presentation.pptx"));

    if (pres.defaultTextStyle) {
      expect(typeof pres.defaultTextStyle).toBe("object");
      expect(Object.keys(pres.defaultTextStyle).length).toBeGreaterThan(0);
    }

    if (pres.defaultTextLevelStyles) {
      expect(Array.isArray(pres.defaultTextLevelStyles)).toBe(true);
      expect(pres.defaultTextLevelStyles.length).toBeGreaterThan(0);
    }
  });

  it("does not set defaultTextStyle when absent from presentation XML", async () => {
    const pres = await parsePptx(loadFixture("test-presentation.pptx"));
    if (!pres.defaultTextStyle) {
      expect(pres.defaultTextStyle).toBeUndefined();
    }
    if (!pres.defaultTextLevelStyles) {
      expect(pres.defaultTextLevelStyles).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Shape-level lstStyle (shapeLevelStyles)
// ---------------------------------------------------------------------------

describe("shape-level lstStyle (shapeLevelStyles)", () => {
  it("shapes without lstStyle have shapeLevelStyles undefined", async () => {
    const pres = await parsePptx(loadFixture("test-presentation.pptx"));

    let foundElement = false;
    for (const slide of pres.slides) {
      for (const el of slide.elements) {
        if (el.type === "textbox" || el.type === "shape") {
          foundElement = true;
          if (!(el as PptxTextBox).shapeLevelStyles) {
            expect((el as PptxTextBox).shapeLevelStyles).toBeUndefined();
          }
        }
      }
    }
    expect(foundElement).toBe(true);
  });

  it("master/layout shapes preserve shapeLevelStyles when present", async () => {
    const pres = await parsePptx(loadFixture("test-presentation.pptx"));

    for (const master of pres.masters) {
      for (const el of master.shapes) {
        if (el.type === "textbox" || el.type === "shape") {
          const styles = (el as PptxTextBox).shapeLevelStyles;
          if (styles !== undefined) {
            expect(Array.isArray(styles)).toBe(true);
            expect(styles.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Cascade resolver (resolveInheritance) — buildRunDefaults integration
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<PptxTextRun> = {}): PptxTextRun {
  return {
    text: "test",
    bold: false,
    italic: false,
    underline: false,
    fontSize: 18, // default (1800/100)
    fontFamily: "Arial",
    color: "#000000",
    ...overrides,
  };
}

function makePresentation(overrides: Partial<PptxPresentation> & {
  masterOverrides?: Partial<PptxSlideMaster>;
  elementOverrides?: Record<string, unknown>;
} = {}): PptxPresentation {
  const { masterOverrides, elementOverrides, ...presOverrides } = overrides;
  return {
    slideWidth: 9144000,
    slideHeight: 6858000,
    theme: {
      colors: { dk1: "#000000", lt1: "#ffffff" },
      fonts: { heading: "Calibri", body: "Arial" },
      defaultFontSize: 1800,
      defaultAlignment: "left",
    },
    masters: [{
      shapes: [],
      placeholders: [],
      background: null,
      ...masterOverrides,
    }],
    layouts: [{
      name: "default",
      shapes: [],
      placeholders: [],
      background: null,
    }],
    slides: [{
      index: 0,
      elements: [{
        type: "textbox" as const,
        x: 0, y: 0, width: 100, height: 50, rotation: 0,
        paragraphs: [{
          alignment: "left" as const,
          runs: [makeRun()],
          bulletChar: null,
          bulletLevel: 0,
        }],
        ...elementOverrides,
      }],
      background: null,
      notes: "",
      searchText: "",
      layoutIndex: 0,
      masterIndex: 0,
    }],
    ...presOverrides,
  };
}

function getFirstRun(pres: PptxPresentation): PptxTextRun {
  const el = pres.slides[0].elements[0];
  if (el.type === "textbox") return el.paragraphs[0].runs[0];
  throw new Error("Expected textbox");
}

describe("resolveInheritance — cascade resolver", () => {
  it("applies master otherStyle to non-placeholder textboxes", () => {
    const pres = makePresentation({
      masterOverrides: {
        otherStyle: { fontSize: 24, color: "#FF0000", bold: true },
      },
    });

    resolveInheritance(pres);
    const run = getFirstRun(pres);
    expect(run.fontSize).toBe(24);
    expect(run.color).toBe("#FF0000");
    expect(run.bold).toBe(true);
  });

  it("applies master otherLevelStyles based on bullet level", () => {
    const pres = makePresentation({
      masterOverrides: {
        otherLevelStyles: [
          { fontSize: 24 },
          { fontSize: 20 },
          { fontSize: 16 },
        ],
      },
    });
    // Set bullet level to 1
    const el = pres.slides[0].elements[0];
    if (el.type === "textbox") el.paragraphs[0].bulletLevel = 1;

    resolveInheritance(pres);
    const run = getFirstRun(pres);
    expect(run.fontSize).toBe(20);
  });

  it("applies presentation defaultTextStyle as lowest priority", () => {
    const pres = makePresentation({
      defaultTextStyle: { fontSize: 22, color: "#0000FF" },
    });

    resolveInheritance(pres);
    const run = getFirstRun(pres);
    expect(run.fontSize).toBe(22);
    expect(run.color).toBe("#0000FF");
  });

  it("master otherStyle overrides presentation defaultTextStyle", () => {
    const pres = makePresentation({
      defaultTextStyle: { fontSize: 22, color: "#0000FF" },
      masterOverrides: {
        otherStyle: { fontSize: 28 },
      },
    });

    resolveInheritance(pres);
    const run = getFirstRun(pres);
    expect(run.fontSize).toBe(28);
    // color from defaultTextStyle still applies since master doesn't set it
    expect(run.color).toBe("#0000FF");
  });

  it("shapeLevelStyles overrides master otherStyle", () => {
    const pres = makePresentation({
      masterOverrides: {
        otherStyle: { fontSize: 24, color: "#FF0000" },
      },
      elementOverrides: {
        shapeLevelStyles: [{ fontSize: 32 }] as PptxTextStyle[],
      },
    });

    resolveInheritance(pres);
    const run = getFirstRun(pres);
    expect(run.fontSize).toBe(32); // from shapeLevelStyles
    expect(run.color).toBe("#FF0000"); // from otherStyle (shapeLevelStyles doesn't set color)
  });

  it("explicit run values are not overridden by cascade", () => {
    const pres = makePresentation({
      masterOverrides: {
        otherStyle: { fontSize: 24, color: "#FF0000", bold: true },
      },
    });
    // Set explicit values on the run
    const el = pres.slides[0].elements[0];
    if (el.type === "textbox") {
      el.paragraphs[0].runs[0].fontSize = 36;
      el.paragraphs[0].runs[0].color = "#00FF00";
      el.paragraphs[0].runs[0].bold = true;
    }

    resolveInheritance(pres);
    const run = getFirstRun(pres);
    expect(run.fontSize).toBe(36); // not overridden
    expect(run.color).toBe("#00FF00"); // not overridden
  });

  it("applies titleStyle to title placeholders", () => {
    const pres = makePresentation({
      masterOverrides: {
        titleStyle: { fontSize: 44, color: "#FFFF00" },
        otherStyle: { fontSize: 18 },
      },
      elementOverrides: {
        placeholderType: "title",
      },
    });

    resolveInheritance(pres);
    const run = getFirstRun(pres);
    expect(run.fontSize).toBe(44);
    expect(run.color).toBe("#FFFF00");
  });

  it("applies bodyStyle to body placeholders", () => {
    const pres = makePresentation({
      masterOverrides: {
        bodyStyle: { fontSize: 28 },
        otherStyle: { fontSize: 18 },
      },
      elementOverrides: {
        placeholderType: "body",
      },
    });

    resolveInheritance(pres);
    const run = getFirstRun(pres);
    expect(run.fontSize).toBe(28);
  });

  it("does not apply otherStyle to placeholder elements", () => {
    const pres = makePresentation({
      masterOverrides: {
        otherStyle: { fontSize: 14, color: "#FF0000" },
      },
      elementOverrides: {
        placeholderType: "title",
      },
    });

    resolveInheritance(pres);
    const run = getFirstRun(pres);
    // otherStyle should NOT apply to title placeholder
    expect(run.fontSize).toBe(18); // unchanged default
    expect(run.color).toBe("#000000"); // unchanged default
  });
});

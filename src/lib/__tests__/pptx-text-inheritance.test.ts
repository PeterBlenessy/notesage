import { describe, it, expect } from "vitest";
import { resolveInheritance } from "../pptx-parser";
import type {
  PptxPresentation,
  PptxSlide,
  PptxTextBox,
  PptxShape,
  PptxSlideMaster,
  PptxTheme,
} from "../pptx-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTheme(overrides?: Partial<PptxTheme>): PptxTheme {
  return {
    colors: { dk1: "#000000", lt1: "#FFFFFF" },
    fonts: { heading: "Calibri Light", body: "Calibri" },
    ...overrides,
  };
}

function makeTextBox(
  overrides: Partial<PptxTextBox> = {},
): PptxTextBox {
  return {
    type: "textbox",
    x: 0,
    y: 0,
    width: 9144000,
    height: 1143000,
    rotation: 0,
    paragraphs: [
      {
        alignment: "left",
        bulletChar: null,
        bulletLevel: 0,
        runs: [
          {
            text: "Sample text",
            bold: false,
            italic: false,
            underline: false,
            fontSize: 18,
            fontFamily: "Calibri",
            color: "#000000",
          },
        ],
      },
    ],
    ...overrides,
  };
}

function makeShape(
  overrides: Partial<PptxShape> = {},
): PptxShape {
  return {
    type: "shape",
    shapeType: "rect",
    x: 0,
    y: 0,
    width: 9144000,
    height: 1143000,
    rotation: 0,
    fill: null,
    stroke: null,
    strokeWidth: 0,
    text: [
      {
        alignment: "left",
        bulletChar: null,
        bulletLevel: 0,
        runs: [
          {
            text: "Shape text",
            bold: false,
            italic: false,
            underline: false,
            fontSize: 18,
            fontFamily: "Calibri",
            color: "#000000",
          },
        ],
      },
    ],
    ...overrides,
  };
}

function makeMaster(
  overrides: Partial<PptxSlideMaster> = {},
): PptxSlideMaster {
  return {
    shapes: [],
    placeholders: [],
    background: null,
    ...overrides,
  };
}

function makeSlide(
  overrides: Partial<PptxSlide> = {},
): PptxSlide {
  return {
    index: 0,
    elements: [],
    background: null,
    notes: "",
    searchText: "",
    masterIndex: 0,
    ...overrides,
  };
}

function makePresentation(
  slides: PptxSlide[],
  masters: PptxSlideMaster[],
  theme?: PptxTheme,
): PptxPresentation {
  return {
    slideWidth: 12192000,
    slideHeight: 6858000,
    slides,
    theme: theme ?? makeTheme(),
    masters,
    layouts: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PPTX text style inheritance", () => {
  describe("Task #5 — title placeholder inherits master titleStyle", () => {
    it("applies master titleStyle fontSize to title placeholder runs with default 18pt", () => {
      const titleBox = makeTextBox({ placeholderType: "title" });
      const master = makeMaster({
        titleStyle: { fontSize: 44 },
      });
      const slide = makeSlide({ elements: [titleBox] });
      const pres = makePresentation([slide], [master]);

      resolveInheritance(pres);

      expect(titleBox.paragraphs[0].runs[0].fontSize).toBe(44);
    });

    it("applies master titleStyle to ctrTitle placeholder", () => {
      const titleBox = makeTextBox({ placeholderType: "ctrTitle" });
      const master = makeMaster({
        titleStyle: { fontSize: 44, color: "#FFFFFF", bold: true },
      });
      const slide = makeSlide({ elements: [titleBox] });
      const pres = makePresentation([slide], [master]);

      resolveInheritance(pres);

      const run = titleBox.paragraphs[0].runs[0];
      expect(run.fontSize).toBe(44);
      expect(run.color).toBe("#FFFFFF");
      expect(run.bold).toBe(true);
    });

    it("does not override explicit fontSize on title runs", () => {
      const titleBox = makeTextBox({ placeholderType: "title" });
      titleBox.paragraphs[0].runs[0].fontSize = 36; // explicit, not 18
      const master = makeMaster({
        titleStyle: { fontSize: 44 },
      });
      const slide = makeSlide({ elements: [titleBox] });
      const pres = makePresentation([slide], [master]);

      resolveInheritance(pres);

      expect(titleBox.paragraphs[0].runs[0].fontSize).toBe(36);
    });

    it("does not override explicit color on title runs", () => {
      const titleBox = makeTextBox({ placeholderType: "title" });
      titleBox.paragraphs[0].runs[0].color = "#FF0000"; // explicit red
      const master = makeMaster({
        titleStyle: { color: "#FFFFFF" },
      });
      const slide = makeSlide({ elements: [titleBox] });
      const pres = makePresentation([slide], [master]);

      resolveInheritance(pres);

      expect(titleBox.paragraphs[0].runs[0].color).toBe("#FF0000");
    });

    it("works with shape elements (type=shape) with title placeholder", () => {
      const titleShape = makeShape({ placeholderType: "title" });
      const master = makeMaster({
        titleStyle: { fontSize: 44 },
      });
      const slide = makeSlide({ elements: [titleShape] });
      const pres = makePresentation([slide], [master]);

      resolveInheritance(pres);

      expect(titleShape.text[0].runs[0].fontSize).toBe(44);
    });
  });

  describe("Task #6 — body placeholder inherits master bodyStyle", () => {
    it("applies master bodyStyle fontSize to body placeholder runs", () => {
      const bodyBox = makeTextBox({ placeholderType: "body" });
      const master = makeMaster({
        bodyStyle: { fontSize: 32 },
      });
      const slide = makeSlide({ elements: [bodyBox] });
      const pres = makePresentation([slide], [master]);

      resolveInheritance(pres);

      expect(bodyBox.paragraphs[0].runs[0].fontSize).toBe(32);
    });

    it("applies master bodyStyle to subTitle placeholder", () => {
      const subTitleBox = makeTextBox({ placeholderType: "subTitle" });
      const master = makeMaster({
        bodyStyle: { fontSize: 32, color: "#666666" },
      });
      const slide = makeSlide({ elements: [subTitleBox] });
      const pres = makePresentation([slide], [master]);

      resolveInheritance(pres);

      const run = subTitleBox.paragraphs[0].runs[0];
      expect(run.fontSize).toBe(32);
      expect(run.color).toBe("#666666");
    });

    it("uses per-level bodyLevelStyles when available", () => {
      const bodyBox = makeTextBox({ placeholderType: "body" });
      // Add a second paragraph at bullet level 1
      bodyBox.paragraphs.push({
        alignment: "left",
        bulletChar: null,
        bulletLevel: 1,
        runs: [
          {
            text: "Sub-bullet",
            bold: false,
            italic: false,
            underline: false,
            fontSize: 18,
            fontFamily: "Calibri",
            color: "#000000",
          },
        ],
      });

      const master = makeMaster({
        bodyStyle: { fontSize: 32 },
        bodyLevelStyles: [
          { fontSize: 32 },  // level 0
          { fontSize: 28 },  // level 1
          { fontSize: 24 },  // level 2
        ],
      });
      const slide = makeSlide({ elements: [bodyBox] });
      const pres = makePresentation([slide], [master]);

      resolveInheritance(pres);

      expect(bodyBox.paragraphs[0].runs[0].fontSize).toBe(32); // level 0
      expect(bodyBox.paragraphs[1].runs[0].fontSize).toBe(28); // level 1
    });

    it("clamps to max available level in bodyLevelStyles", () => {
      const bodyBox = makeTextBox({ placeholderType: "body" });
      bodyBox.paragraphs[0].bulletLevel = 5; // beyond available levels

      const master = makeMaster({
        bodyLevelStyles: [
          { fontSize: 32 },
          { fontSize: 28 },
        ],
      });
      const slide = makeSlide({ elements: [bodyBox] });
      const pres = makePresentation([slide], [master]);

      resolveInheritance(pres);

      // Should clamp to last available level (index 1 = 28pt)
      expect(bodyBox.paragraphs[0].runs[0].fontSize).toBe(28);
    });

    it("does not override explicit fontSize on body runs", () => {
      const bodyBox = makeTextBox({ placeholderType: "body" });
      bodyBox.paragraphs[0].runs[0].fontSize = 24; // explicit
      const master = makeMaster({
        bodyStyle: { fontSize: 32 },
      });
      const slide = makeSlide({ elements: [bodyBox] });
      const pres = makePresentation([slide], [master]);

      resolveInheritance(pres);

      expect(bodyBox.paragraphs[0].runs[0].fontSize).toBe(24);
    });
  });

  describe("Task #9 — title placeholders use heading font", () => {
    it("switches title run from body font to heading font", () => {
      const titleBox = makeTextBox({ placeholderType: "title" });
      // Run has body font (Calibri) — should switch to heading font (Calibri Light)
      const theme = makeTheme({ fonts: { heading: "Calibri Light", body: "Calibri" } });
      const master = makeMaster({ titleStyle: { fontSize: 44 } });
      const slide = makeSlide({ elements: [titleBox] });
      const pres = makePresentation([slide], [master], theme);

      resolveInheritance(pres);

      expect(titleBox.paragraphs[0].runs[0].fontFamily).toBe("Calibri Light");
    });

    it("does not switch font when heading and body fonts are the same", () => {
      const titleBox = makeTextBox({ placeholderType: "title" });
      titleBox.paragraphs[0].runs[0].fontFamily = "Arial";
      const theme = makeTheme({ fonts: { heading: "Arial", body: "Arial" } });
      const master = makeMaster({ titleStyle: { fontSize: 44 } });
      const slide = makeSlide({ elements: [titleBox] });
      const pres = makePresentation([slide], [master], theme);

      resolveInheritance(pres);

      expect(titleBox.paragraphs[0].runs[0].fontFamily).toBe("Arial");
    });

    it("does not apply heading font to body placeholders", () => {
      const bodyBox = makeTextBox({ placeholderType: "body" });
      const theme = makeTheme({ fonts: { heading: "Calibri Light", body: "Calibri" } });
      const master = makeMaster({ bodyStyle: { fontSize: 32 } });
      const slide = makeSlide({ elements: [bodyBox] });
      const pres = makePresentation([slide], [master], theme);

      resolveInheritance(pres);

      expect(bodyBox.paragraphs[0].runs[0].fontFamily).toBe("Calibri");
    });

    it("preserves explicit non-body font on title runs", () => {
      const titleBox = makeTextBox({ placeholderType: "title" });
      titleBox.paragraphs[0].runs[0].fontFamily = "Times New Roman"; // not the body font
      const theme = makeTheme({ fonts: { heading: "Calibri Light", body: "Calibri" } });
      const master = makeMaster({ titleStyle: { fontSize: 44 } });
      const slide = makeSlide({ elements: [titleBox] });
      const pres = makePresentation([slide], [master], theme);

      resolveInheritance(pres);

      expect(titleBox.paragraphs[0].runs[0].fontFamily).toBe("Times New Roman");
    });
  });

  describe("non-placeholder elements are unaffected", () => {
    it("does not modify runs on elements without placeholderType", () => {
      const normalBox = makeTextBox(); // no placeholderType
      const master = makeMaster({
        titleStyle: { fontSize: 44, bold: true },
        bodyStyle: { fontSize: 32, color: "#FFFFFF" },
      });
      const slide = makeSlide({ elements: [normalBox] });
      const pres = makePresentation([slide], [master]);

      resolveInheritance(pres);

      const run = normalBox.paragraphs[0].runs[0];
      expect(run.fontSize).toBe(18);
      expect(run.color).toBe("#000000");
      expect(run.bold).toBe(false);
    });

    it("does not modify image or table elements", () => {
      const master = makeMaster({
        titleStyle: { fontSize: 44 },
      });
      const slide = makeSlide({
        elements: [
          {
            type: "image",
            x: 0, y: 0, width: 100, height: 100, rotation: 0,
            dataUrl: "data:image/png;base64,",
          },
        ],
      });
      const pres = makePresentation([slide], [master]);

      // Should not throw
      resolveInheritance(pres);
    });

    it("does not modify elements with non-title/body placeholder types", () => {
      const footerBox = makeTextBox({ placeholderType: "ftr" });
      const master = makeMaster({
        titleStyle: { fontSize: 44 },
        bodyStyle: { fontSize: 32 },
      });
      const slide = makeSlide({ elements: [footerBox] });
      const pres = makePresentation([slide], [master]);

      resolveInheritance(pres);

      expect(footerBox.paragraphs[0].runs[0].fontSize).toBe(18);
    });
  });

  describe("no master available", () => {
    it("does not modify elements when there is no master", () => {
      const titleBox = makeTextBox({ placeholderType: "title" });
      const slide = makeSlide({ elements: [titleBox], masterIndex: undefined });
      const pres = makePresentation([slide], []);

      resolveInheritance(pres);

      expect(titleBox.paragraphs[0].runs[0].fontSize).toBe(18);
    });
  });
});

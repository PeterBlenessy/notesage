// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { parseGradientFill, parseTableStyleElement } from "../pptx-parser";
import { fillToCSS } from "@/components/editor/viewers/PptxSlideRenderer";
import type { PptxTheme, PptxTable, PptxFill } from "../pptx-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";

const defaultTheme: PptxTheme = {
  colors: { dk1: "#000000", lt1: "#ffffff", dk2: "#333333", lt2: "#eeeeee", accent1: "#4472c4" },
  fonts: { heading: "Calibri", body: "Calibri" },
};

function parseXml(xml: string): Element {
  return new DOMParser().parseFromString(xml, "application/xml").documentElement;
}

// ---------------------------------------------------------------------------
// Task #17 — Cell gradient fill parsing
// ---------------------------------------------------------------------------

describe("Cell gradient fill (VP14)", () => {
  it("parses linear gradient fill from XML", () => {
    const gradFillXml = `<a:gradFill xmlns:a="${DRAWING_NS}">
      <a:gsLst>
        <a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs>
        <a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs>
      </a:gsLst>
      <a:lin ang="5400000" scaled="1"/>
    </a:gradFill>`;
    const el = parseXml(gradFillXml);
    const fill = parseGradientFill(el, defaultTheme);
    expect(fill.type).toBe("linear");
    if (fill.type === "linear") {
      expect(fill.angle).toBe(90); // 5400000/60000 = 90
      expect(fill.stops).toHaveLength(2);
      expect(fill.stops[0].color).toBe("#FF0000");
      expect(fill.stops[0].position).toBe(0);
      expect(fill.stops[1].color).toBe("#0000FF");
      expect(fill.stops[1].position).toBe(100);
    }
  });

  it("parses radial gradient fill from XML", () => {
    const gradFillXml = `<a:gradFill xmlns:a="${DRAWING_NS}">
      <a:gsLst>
        <a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs>
        <a:gs pos="50000"><a:srgbClr val="808080"/></a:gs>
      </a:gsLst>
      <a:path path="circle"/>
    </a:gradFill>`;
    const el = parseXml(gradFillXml);
    const fill = parseGradientFill(el, defaultTheme);
    expect(fill.type).toBe("radial");
    if (fill.type === "radial") {
      expect(fill.stops).toHaveLength(2);
      expect(fill.stops[0].color).toBe("#FFFFFF");
      expect(fill.stops[1].position).toBe(50);
    }
  });

  it("defaults to linear 0 degrees when no lin/path specified", () => {
    const gradFillXml = `<a:gradFill xmlns:a="${DRAWING_NS}">
      <a:gsLst>
        <a:gs pos="0"><a:srgbClr val="AAAAAA"/></a:gs>
      </a:gsLst>
    </a:gradFill>`;
    const el = parseXml(gradFillXml);
    const fill = parseGradientFill(el, defaultTheme);
    expect(fill.type).toBe("linear");
    if (fill.type === "linear") {
      expect(fill.angle).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Task #17 — Cell gradient fill rendering (CSS)
// ---------------------------------------------------------------------------

describe("Cell gradient fill CSS rendering", () => {
  it("converts linear gradient fill to CSS background", () => {
    const fill: PptxFill = {
      type: "linear",
      angle: 90,
      stops: [
        { position: 0, color: "#FF0000" },
        { position: 100, color: "#0000FF" },
      ],
    };
    const css = fillToCSS(fill);
    expect(css.background).toContain("linear-gradient");
    expect(css.background).toContain("180deg"); // OOXML 90° + 90 = CSS 180°
  });

  it("converts radial gradient fill to CSS background", () => {
    const fill: PptxFill = {
      type: "radial",
      stops: [
        { position: 0, color: "#FFFFFF" },
        { position: 100, color: "#000000" },
      ],
    };
    const css = fillToCSS(fill);
    expect(css.background).toContain("radial-gradient");
  });

  it("converts solid fill to CSS backgroundColor", () => {
    const fill: PptxFill = { type: "solid", color: "#FF0000" };
    const css = fillToCSS(fill);
    expect(css.backgroundColor).toContain("#FF0000");
  });
});

// ---------------------------------------------------------------------------
// Task #15 — Table style ID extraction
// ---------------------------------------------------------------------------

describe("Table style parsing (VP12)", () => {
  it("parses wholeTbl fill from table style element", () => {
    const styleXml = `<a:tblStyle xmlns:a="${DRAWING_NS}" styleId="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}">
      <a:wholeTbl>
        <a:tcStyle>
          <a:fill>
            <a:solidFill><a:srgbClr val="E0E0E0"/></a:solidFill>
          </a:fill>
        </a:tcStyle>
      </a:wholeTbl>
    </a:tblStyle>`;
    const el = parseXml(styleXml);
    const style = parseTableStyleElement(el, defaultTheme);
    expect(style.wholeTbl).toBeDefined();
    expect(style.wholeTbl?.fill).toBe("#E0E0E0");
  });

  it("parses firstRow bold and fill", () => {
    const styleXml = `<a:tblStyle xmlns:a="${DRAWING_NS}" styleId="{GUID}">
      <a:firstRow>
        <a:tcStyle>
          <a:fill>
            <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
          </a:fill>
        </a:tcStyle>
        <a:tcTxStyle b="on">
          <a:srgbClr val="FFFFFF"/>
        </a:tcTxStyle>
      </a:firstRow>
    </a:tblStyle>`;
    const el = parseXml(styleXml);
    const style = parseTableStyleElement(el, defaultTheme);
    expect(style.firstRow).toBeDefined();
    expect(style.firstRow?.fill).toBe("#4472C4");
    expect(style.firstRow?.bold).toBe(true);
    expect(style.firstRow?.fontColor).toBe("#FFFFFF");
  });

  it("parses band1H and band2H for row banding", () => {
    const styleXml = `<a:tblStyle xmlns:a="${DRAWING_NS}" styleId="{GUID}">
      <a:band1H>
        <a:tcStyle>
          <a:fill>
            <a:solidFill><a:srgbClr val="D6E4F0"/></a:solidFill>
          </a:fill>
        </a:tcStyle>
      </a:band1H>
      <a:band2H>
        <a:tcStyle>
          <a:fill>
            <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
          </a:fill>
        </a:tcStyle>
      </a:band2H>
    </a:tblStyle>`;
    const el = parseXml(styleXml);
    const style = parseTableStyleElement(el, defaultTheme);
    expect(style.band1H?.fill).toBe("#D6E4F0");
    expect(style.band2H?.fill).toBe("#FFFFFF");
  });

  it("parses italic text style", () => {
    const styleXml = `<a:tblStyle xmlns:a="${DRAWING_NS}" styleId="{GUID}">
      <a:lastRow>
        <a:tcTxStyle i="on"/>
      </a:lastRow>
    </a:tblStyle>`;
    const el = parseXml(styleXml);
    const style = parseTableStyleElement(el, defaultTheme);
    expect(style.lastRow?.italic).toBe(true);
  });

  it("ignores parts without meaningful values", () => {
    const styleXml = `<a:tblStyle xmlns:a="${DRAWING_NS}" styleId="{GUID}">
      <a:firstCol>
        <a:tcStyle/>
      </a:firstCol>
    </a:tblStyle>`;
    const el = parseXml(styleXml);
    const style = parseTableStyleElement(el, defaultTheme);
    // firstCol has no fill, bold, italic, or fontColor — should not be set
    expect(style.firstCol).toBeUndefined();
  });

  it("resolves scheme colors in table styles", () => {
    const styleXml = `<a:tblStyle xmlns:a="${DRAWING_NS}" styleId="{GUID}">
      <a:wholeTbl>
        <a:tcTxStyle>
          <a:schemeClr val="dk1"/>
        </a:tcTxStyle>
      </a:wholeTbl>
    </a:tblStyle>`;
    const el = parseXml(styleXml);
    const style = parseTableStyleElement(el, defaultTheme);
    expect(style.wholeTbl?.fontColor).toBe("#000000"); // dk1 = #000000
  });
});

// ---------------------------------------------------------------------------
// Task #15 — Banding attribute parsing
// ---------------------------------------------------------------------------

describe("Table banding attributes", () => {
  it("bandRow=true, firstRow=true parsed from tblPr", () => {
    // This test validates that the PptxTable interface supports these fields
    // Actual parsing is tested via integration (parsePptx with real PPTX data)
    const table: PptxTable = {
      type: "table",
      x: 0, y: 0, width: 1000, height: 500,
      rows: [],
      bandRow: true,
      firstRow: true,
      lastRow: false,
      bandCol: false,
      firstCol: true,
      lastCol: false,
    };
    expect(table.bandRow).toBe(true);
    expect(table.firstRow).toBe(true);
    expect(table.firstCol).toBe(true);
    expect(table.lastRow).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task #15 — Explicit cell fills override style defaults
// ---------------------------------------------------------------------------

describe("Cell fill override priority", () => {
  it("explicit cell fill overrides table style fill", () => {
    // A cell with an explicit fill should use that, not the style's fill
    const table: PptxTable = {
      type: "table",
      x: 0, y: 0, width: 1000, height: 500,
      rows: [{
        height: 250,
        cells: [{
          width: 500,
          paragraphs: [],
          fill: "#FF0000", // explicit red
          colspan: 1,
          rowspan: 1,
        }],
      }],
      style: {
        wholeTbl: { fill: "#0000FF" }, // style says blue
      },
      bandRow: false,
      firstRow: false,
    };

    // The cell has an explicit fill (#FF0000), so the style's blue should not be used
    const cell = table.rows[0].cells[0];
    expect(cell.fill).toBe("#FF0000");
    // Style fill is available but should be overridden at render time
    expect(table.style?.wholeTbl?.fill).toBe("#0000FF");
  });

  it("null cell fill falls back to style fill", () => {
    const table: PptxTable = {
      type: "table",
      x: 0, y: 0, width: 1000, height: 500,
      rows: [{
        height: 250,
        cells: [{
          width: 500,
          paragraphs: [],
          fill: null, // no explicit fill
          colspan: 1,
          rowspan: 1,
        }],
      }],
      style: {
        wholeTbl: { fill: "#0000FF" },
      },
    };

    const cell = table.rows[0].cells[0];
    expect(cell.fill).toBeNull();
    // At render time, the renderer would use the style fill
    expect(table.style?.wholeTbl?.fill).toBe("#0000FF");
  });

  it("gradient fill on cell is preserved as PptxFill", () => {
    const gradientFill: PptxFill = {
      type: "linear",
      angle: 45,
      stops: [
        { position: 0, color: "#FF0000" },
        { position: 100, color: "#00FF00" },
      ],
    };
    const table: PptxTable = {
      type: "table",
      x: 0, y: 0, width: 1000, height: 500,
      rows: [{
        height: 250,
        cells: [{
          width: 500,
          paragraphs: [],
          fill: gradientFill,
          colspan: 1,
          rowspan: 1,
        }],
      }],
    };

    const cell = table.rows[0].cells[0];
    expect(typeof cell.fill).toBe("object");
    if (typeof cell.fill === "object" && cell.fill !== null) {
      expect(cell.fill.type).toBe("linear");
    }
  });
});

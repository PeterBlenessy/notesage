// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { resolveColor, resolveColorWithAlpha, DEFAULT_CLR_MAP } from "../pptx-parser";
import type { PptxTheme } from "../pptx-types";

// ---------------------------------------------------------------------------
// Helper: create an XML element with a schemeClr child
// ---------------------------------------------------------------------------

function createSchemeClrElement(val: string): Element {
  const xml = `<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:solidFill><a:schemeClr val="${val}"/></a:solidFill></root>`;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  // Return the solidFill element (parent for resolveColor)
  return doc.getElementsByTagNameNS(
    "http://schemas.openxmlformats.org/drawingml/2006/main",
    "solidFill",
  )[0];
}

function createSchemeClrElementWithAlpha(val: string, alpha: number): Element {
  const xml = `<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:solidFill><a:schemeClr val="${val}"><a:alpha val="${alpha}"/></a:schemeClr></a:solidFill></root>`;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return doc.getElementsByTagNameNS(
    "http://schemas.openxmlformats.org/drawingml/2006/main",
    "solidFill",
  )[0];
}

// ---------------------------------------------------------------------------
// Theme fixtures
// ---------------------------------------------------------------------------

const baseTheme: PptxTheme = {
  colors: {
    dk1: "#000000",
    dk2: "#1F2D3D",
    lt1: "#FFFFFF",
    lt2: "#E8E8E8",
    accent1: "#FF0000",
    accent2: "#00FF00",
    accent3: "#0000FF",
    accent4: "#FFFF00",
    accent5: "#FF00FF",
    accent6: "#00FFFF",
    hlink: "#0563C1",
    folHlink: "#954F72",
  },
  fonts: { heading: "Calibri", body: "Calibri" },
};

// ---------------------------------------------------------------------------
// resolveColor with clrMap
// ---------------------------------------------------------------------------

describe("resolveColor with clrMap", () => {
  it("remaps bg1 to dk2 when clrMap says bg1->dk2", () => {
    const theme: PptxTheme = {
      ...baseTheme,
      clrMap: { bg1: "dk2", tx1: "lt1", bg2: "lt2", tx2: "dk2" },
    };
    const el = createSchemeClrElement("bg1");
    const result = resolveColor(el, theme);
    expect(result).toBe("#1F2D3D"); // dk2 value
  });

  it("uses default mapping (bg1->lt1) when no clrMap is set", () => {
    const theme: PptxTheme = { ...baseTheme }; // no clrMap
    const el = createSchemeClrElement("bg1");
    const result = resolveColor(el, theme);
    expect(result).toBe("#FFFFFF"); // lt1 value
  });

  it("remaps tx1 to lt1 when clrMap says tx1->lt1", () => {
    const theme: PptxTheme = {
      ...baseTheme,
      clrMap: { bg1: "dk2", tx1: "lt1", bg2: "lt2", tx2: "dk2" },
    };
    const el = createSchemeClrElement("tx1");
    const result = resolveColor(el, theme);
    expect(result).toBe("#FFFFFF"); // lt1 value
  });

  it("resolves dk1 directly without clrMap (direct theme color lookup)", () => {
    const theme: PptxTheme = {
      ...baseTheme,
      clrMap: { bg1: "dk2", tx1: "lt1" },
    };
    const el = createSchemeClrElement("dk1");
    const result = resolveColor(el, theme);
    expect(result).toBe("#000000");
  });

  it("accent colors pass through clrMap when mapped to themselves", () => {
    const theme: PptxTheme = {
      ...baseTheme,
      clrMap: {
        bg1: "dk2", tx1: "lt1", bg2: "lt2", tx2: "dk2",
        accent1: "accent1", accent2: "accent2", accent3: "accent3",
        accent4: "accent4", accent5: "accent5", accent6: "accent6",
        hlink: "hlink", folHlink: "folHlink",
      },
    };
    const el = createSchemeClrElement("accent1");
    const result = resolveColor(el, theme);
    // accent1 is directly in theme.colors, so it should resolve directly
    expect(result).toBe("#FF0000");
  });

  it("falls back to DEFAULT_CLR_MAP when clrMap doesn't have the key", () => {
    const theme: PptxTheme = {
      ...baseTheme,
      clrMap: { bg1: "dk2" }, // Only bg1, no tx1
    };
    const el = createSchemeClrElement("tx1");
    const result = resolveColor(el, theme);
    // clrMap doesn't have tx1, falls back to DEFAULT_CLR_MAP: tx1->dk1
    expect(result).toBe("#000000"); // dk1 value
  });
});

// ---------------------------------------------------------------------------
// resolveColorWithAlpha with clrMap
// ---------------------------------------------------------------------------

describe("resolveColorWithAlpha with clrMap", () => {
  it("remaps bg1 to dk2 with alpha when clrMap says bg1->dk2", () => {
    const theme: PptxTheme = {
      ...baseTheme,
      clrMap: { bg1: "dk2", tx1: "lt1" },
    };
    const el = createSchemeClrElementWithAlpha("bg1", 50000);
    const result = resolveColorWithAlpha(el, theme);
    expect(result).not.toBeNull();
    expect(result!.color).toBe("#1F2D3D"); // dk2 value
    expect(result!.alpha).toBeCloseTo(0.5, 2);
  });

  it("uses default mapping with alpha when no clrMap is set", () => {
    const theme: PptxTheme = { ...baseTheme };
    const el = createSchemeClrElementWithAlpha("bg1", 75000);
    const result = resolveColorWithAlpha(el, theme);
    expect(result).not.toBeNull();
    expect(result!.color).toBe("#FFFFFF"); // lt1 via default map
    expect(result!.alpha).toBeCloseTo(0.75, 2);
  });

  it("resolves direct theme color with alpha", () => {
    const theme: PptxTheme = {
      ...baseTheme,
      clrMap: { bg1: "dk2" },
    };
    const el = createSchemeClrElementWithAlpha("accent1", 30000);
    const result = resolveColorWithAlpha(el, theme);
    expect(result).not.toBeNull();
    expect(result!.color).toBe("#FF0000");
    expect(result!.alpha).toBeCloseTo(0.3, 2);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_CLR_MAP
// ---------------------------------------------------------------------------

describe("DEFAULT_CLR_MAP", () => {
  it("maps bg1->lt1, bg2->lt2, tx1->dk1, tx2->dk2", () => {
    expect(DEFAULT_CLR_MAP).toEqual({
      bg1: "lt1",
      bg2: "lt2",
      tx1: "dk1",
      tx2: "dk2",
    });
  });
});

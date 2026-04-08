// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  hexToHsl,
  hslToHex,
  applyColorTransforms,
  hexToRgbComponents,
  rgbComponentsToHex,
  srgbToLinear,
  linearToSrgb,
} from "../pptx-parser";

// ---------------------------------------------------------------------------
// Helper: create an XML element with DrawingML color transform children
// ---------------------------------------------------------------------------

function createColorElement(
  transforms: Record<string, number>,
): Element {
  const parts = Object.entries(transforms).map(
    ([name, val]) => `<a:${name} val="${val}"/>`,
  );
  const xml = `<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${parts.join("")}</root>`;
  return new DOMParser().parseFromString(xml, "application/xml")
    .documentElement;
}

/** Create element with mixed value/valueless children (e.g., gamma, invGamma) */
function createColorElementEx(
  transforms: (readonly [string, number] | readonly [string])[],
): Element {
  const parts = transforms.map(([name, val]) =>
    val !== undefined ? `<a:${name} val="${val}"/>` : `<a:${name}/>`
  );
  const xml = `<root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${parts.join("")}</root>`;
  return new DOMParser().parseFromString(xml, "application/xml")
    .documentElement;
}

// ---------------------------------------------------------------------------
// hexToHsl
// ---------------------------------------------------------------------------

describe("hexToHsl", () => {
  it("converts pure red", () => {
    const { h, s, l } = hexToHsl("#ff0000");
    expect(h).toBeCloseTo(0, 1);
    expect(s).toBeCloseTo(1, 3);
    expect(l).toBeCloseTo(0.5, 3);
  });

  it("converts pure green", () => {
    const { h, s, l } = hexToHsl("#00ff00");
    expect(h).toBeCloseTo(120, 1);
    expect(s).toBeCloseTo(1, 3);
    expect(l).toBeCloseTo(0.5, 3);
  });

  it("converts pure blue", () => {
    const { h, s, l } = hexToHsl("#0000ff");
    expect(h).toBeCloseTo(240, 1);
    expect(s).toBeCloseTo(1, 3);
    expect(l).toBeCloseTo(0.5, 3);
  });

  it("converts white", () => {
    const { h, s, l } = hexToHsl("#ffffff");
    expect(h).toBe(0);
    expect(s).toBe(0);
    expect(l).toBe(1);
  });

  it("converts black", () => {
    const { h, s, l } = hexToHsl("#000000");
    expect(h).toBe(0);
    expect(s).toBe(0);
    expect(l).toBe(0);
  });

  it("converts grey #808080", () => {
    const { h, s, l } = hexToHsl("#808080");
    expect(h).toBe(0);
    expect(s).toBe(0);
    // 128/255 ≈ 0.502
    expect(l).toBeCloseTo(0.502, 2);
  });

  it("converts a chromatic color #4a86c8", () => {
    const { h, s, l } = hexToHsl("#4a86c8");
    // Roughly: h≈213, s≈0.52, l≈0.54
    expect(h).toBeGreaterThan(200);
    expect(h).toBeLessThan(220);
    expect(s).toBeGreaterThan(0.4);
    expect(s).toBeLessThan(0.65);
    expect(l).toBeGreaterThan(0.45);
    expect(l).toBeLessThan(0.6);
  });

  it("accepts hex without # prefix", () => {
    const { h, s, l } = hexToHsl("ff0000");
    expect(h).toBeCloseTo(0, 1);
    expect(s).toBeCloseTo(1, 3);
    expect(l).toBeCloseTo(0.5, 3);
  });
});

// ---------------------------------------------------------------------------
// hslToHex
// ---------------------------------------------------------------------------

describe("hslToHex", () => {
  it("converts black (h=0, s=0, l=0)", () => {
    expect(hslToHex(0, 0, 0)).toBe("#000000");
  });

  it("converts white (h=0, s=0, l=1)", () => {
    expect(hslToHex(0, 0, 1)).toBe("#ffffff");
  });

  it("converts mid-grey (h=0, s=0, l=0.5)", () => {
    const hex = hslToHex(0, 0, 0.5);
    // 0.5 * 255 = 127.5 → round → 128 = 0x80
    expect(hex).toBe("#808080");
  });

  it("handles hue wrapping — h=360 equals h=0", () => {
    const a = hslToHex(360, 1, 0.5);
    const b = hslToHex(0, 1, 0.5);
    expect(a).toBe(b);
  });

  it("round-trips pure red", () => {
    const hsl = hexToHsl("#ff0000");
    expect(hslToHex(hsl.h, hsl.s, hsl.l)).toBe("#ff0000");
  });

  it("round-trips pure green", () => {
    const hsl = hexToHsl("#00ff00");
    expect(hslToHex(hsl.h, hsl.s, hsl.l)).toBe("#00ff00");
  });

  it("round-trips pure blue", () => {
    const hsl = hexToHsl("#0000ff");
    expect(hslToHex(hsl.h, hsl.s, hsl.l)).toBe("#0000ff");
  });

  it("round-trips a chromatic color within ±1 per channel", () => {
    const original = "#4a86c8";
    const hsl = hexToHsl(original);
    const result = hslToHex(hsl.h, hsl.s, hsl.l);
    // Allow ±1 per channel due to rounding
    const origR = parseInt(original.slice(1, 3), 16);
    const origG = parseInt(original.slice(3, 5), 16);
    const origB = parseInt(original.slice(5, 7), 16);
    const resR = parseInt(result.slice(1, 3), 16);
    const resG = parseInt(result.slice(3, 5), 16);
    const resB = parseInt(result.slice(5, 7), 16);
    expect(Math.abs(origR - resR)).toBeLessThanOrEqual(1);
    expect(Math.abs(origG - resG)).toBeLessThanOrEqual(1);
    expect(Math.abs(origB - resB)).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// applyColorTransforms
// ---------------------------------------------------------------------------

describe("applyColorTransforms", () => {
  it("returns base color when no transforms present", () => {
    const el = createColorElement({});
    expect(applyColorTransforms(el, "#4a86c8")).toBe("#4a86c8");
  });

  it("lumMod + lumOff lightens a dark color", () => {
    // lumMod=40000 (40%) + lumOff=60000 (60%) on a dark color
    const el = createColorElement({ lumMod: 40000, lumOff: 60000 });
    const result = applyColorTransforms(el, "#1a1a2e");
    const resultL = hexToHsl(result).l;
    const baseL = hexToHsl("#1a1a2e").l;
    expect(resultL).toBeGreaterThan(baseL);
  });

  it("tint=50000 makes color lighter", () => {
    const el = createColorElement({ tint: 50000 });
    const base = "#4a86c8";
    const result = applyColorTransforms(el, base);
    const resultL = hexToHsl(result).l;
    const baseL = hexToHsl(base).l;
    expect(resultL).toBeGreaterThan(baseL);
  });

  it("shade=75000 makes color darker", () => {
    const el = createColorElement({ shade: 75000 });
    const base = "#4a86c8";
    const result = applyColorTransforms(el, base);
    const resultL = hexToHsl(result).l;
    const baseL = hexToHsl(base).l;
    expect(resultL).toBeLessThan(baseL);
  });

  it("satMod=1 nearly fully desaturates", () => {
    // Note: satMod=0 would hit the intAttr(0 || fallback) path and be
    // treated as 100000 (no-op). satMod=1 means 0.001% saturation.
    const el = createColorElement({ satMod: 1 });
    const result = applyColorTransforms(el, "#4a86c8");
    const { s } = hexToHsl(result);
    expect(s).toBeLessThan(0.01);
  });

  it("combined lumMod + tint produces reasonable output", () => {
    const el = createColorElement({ lumMod: 50000, tint: 50000 });
    const result = applyColorTransforms(el, "#4a86c8");
    // Should be a valid hex color
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
    // The lightness should still be in [0, 1] range
    const { l } = hexToHsl(result);
    expect(l).toBeGreaterThanOrEqual(0);
    expect(l).toBeLessThanOrEqual(1);
  });

  it("transforms on white produce a valid lighter color", () => {
    const el = createColorElement({ lumMod: 85000 });
    const result = applyColorTransforms(el, "#ffffff");
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
    // White with lumMod < 100% should be slightly darker
    const { l } = hexToHsl(result);
    expect(l).toBeLessThanOrEqual(1);
  });

  it("transforms on black produce a valid color", () => {
    const el = createColorElement({ tint: 50000, lumOff: 30000 });
    const result = applyColorTransforms(el, "#000000");
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
    // Black with tint/lumOff should be brighter than pure black
    const { l } = hexToHsl(result);
    expect(l).toBeGreaterThan(0);
  });

  it("shade=100000 (100%) leaves color unchanged", () => {
    const el = createColorElement({ shade: 100000 });
    const base = "#4a86c8";
    const result = applyColorTransforms(el, base);
    // shade=100% means L * 1.0, no change
    const baseHsl = hexToHsl(base);
    const resultHsl = hexToHsl(result);
    expect(resultHsl.l).toBeCloseTo(baseHsl.l, 3);
  });

  it("lumMod=100000 with no offset leaves luminance unchanged", () => {
    const el = createColorElement({ lumMod: 100000 });
    const base = "#4a86c8";
    const result = applyColorTransforms(el, base);
    const baseHsl = hexToHsl(base);
    const resultHsl = hexToHsl(result);
    expect(resultHsl.l).toBeCloseTo(baseHsl.l, 3);
  });

  // --- RGB shade/tint tests ---

  it("shade=50000 on pure red produces #800000 (RGB multiplication)", () => {
    const el = createColorElement({ shade: 50000 });
    const result = applyColorTransforms(el, "#ff0000");
    // R=255*0.5=128, G=0*0.5=0, B=0*0.5=0 → #800000
    expect(result).toBe("#800000");
  });

  it("shade on a saturated color desaturates (unlike HSL shade)", () => {
    // In HSL, shade only changes luminance, not saturation.
    // In RGB, shade multiplies all channels, which can reduce saturation.
    const el = createColorElement({ shade: 50000 });
    const result = applyColorTransforms(el, "#4a86c8");
    // RGB: R=74*0.5=37, G=134*0.5=67, B=200*0.5=100 → #254364
    expect(result).toBe("#254364");
  });

  it("tint=50000 on pure red produces #ff8080 (RGB tint)", () => {
    const el = createColorElement({ tint: 50000 });
    const result = applyColorTransforms(el, "#ff0000");
    // R=255+(255-255)*0.5=255, G=0+(255-0)*0.5=128, B=0+(255-0)*0.5=128
    expect(result).toBe("#ff8080");
  });

  // --- gamma/invGamma tests ---

  it("gamma + shade + invGamma applies shade in linear RGB space", () => {
    const el = createColorElementEx([
      ["gamma"] as const,
      ["shade", 50000] as const,
      ["invGamma"] as const,
    ]);
    const result = applyColorTransforms(el, "#808080");
    // sRGB 0x80 = 128/255 ≈ 0.502
    // To linear: srgbToLinear(0.502) ≈ 0.2140
    // Shade 50%: 0.2140 * 0.5 = 0.1070
    // Back to sRGB: linearToSrgb(0.1070) ≈ 0.3510
    // 0.3510 * 255 ≈ 89.5 → 90 = 0x5a
    // Result should be around #5a5a5a
    const { r, g, b } = hexToRgbComponents(result);
    expect(r).toBe(g); // Grey stays grey
    expect(r).toBe(b);
    // Linear shade produces a darker result than sRGB shade would
    // sRGB shade would give 128*0.5=64 (#404040)
    // Linear shade gives ~90 (#5a5a5a) — lighter than sRGB shade on dark colors
    expect(r).toBeGreaterThan(80);
    expect(r).toBeLessThan(100);
  });

  it("gamma + tint + invGamma applies tint in linear RGB space", () => {
    const el = createColorElementEx([
      ["gamma"] as const,
      ["tint", 50000] as const,
      ["invGamma"] as const,
    ]);
    const result = applyColorTransforms(el, "#808080");
    const { r, g, b } = hexToRgbComponents(result);
    expect(r).toBe(g);
    expect(r).toBe(b);
    // Should be lighter than base
    expect(r).toBeGreaterThan(128);
  });

  it("gamma without invGamma converts to linear but does not convert back", () => {
    const el = createColorElementEx([
      ["gamma"] as const,
      ["shade", 100000] as const,
    ]);
    const result = applyColorTransforms(el, "#808080");
    // sRGB 128/255 ≈ 0.502 → linear ≈ 0.2140 → shade 100% stays → 0.2140 * 255 ≈ 54.6 → 55 = 0x37
    // Without invGamma, the linear value is written directly
    const { r, g, b } = hexToRgbComponents(result);
    expect(r).toBe(g);
    expect(r).toBe(b);
    expect(r).toBeLessThan(60);
    expect(r).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// hexToRgbComponents / rgbComponentsToHex
// ---------------------------------------------------------------------------

describe("hexToRgbComponents", () => {
  it("parses #ff0000 correctly", () => {
    expect(hexToRgbComponents("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("parses without # prefix", () => {
    expect(hexToRgbComponents("4a86c8")).toEqual({ r: 74, g: 134, b: 200 });
  });
});

describe("rgbComponentsToHex", () => {
  it("converts back to hex", () => {
    expect(rgbComponentsToHex(255, 0, 0)).toBe("#ff0000");
  });

  it("clamps out-of-range values", () => {
    expect(rgbComponentsToHex(300, -10, 128)).toBe("#ff0080");
  });

  it("rounds fractional values", () => {
    expect(rgbComponentsToHex(127.6, 0, 255.4)).toBe("#8000ff");
  });
});

// ---------------------------------------------------------------------------
// srgbToLinear / linearToSrgb
// ---------------------------------------------------------------------------

describe("srgbToLinear / linearToSrgb", () => {
  it("round-trips mid-grey", () => {
    const linear = srgbToLinear(0.5);
    const back = linearToSrgb(linear);
    expect(back).toBeCloseTo(0.5, 5);
  });

  it("round-trips black", () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(linearToSrgb(0)).toBe(0);
  });

  it("round-trips white", () => {
    expect(srgbToLinear(1)).toBeCloseTo(1, 5);
    expect(linearToSrgb(1)).toBeCloseTo(1, 5);
  });

  it("linear mid-grey is darker than sRGB mid-grey", () => {
    // sRGB 0.5 → linear should be < 0.5 (gamma compression makes midtones brighter)
    expect(srgbToLinear(0.5)).toBeLessThan(0.5);
  });
});

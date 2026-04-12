import type { PptxTheme } from "./pptx-types";
import { qs, intAttr, getAttr } from "./pptx-xml-utils";

// ---------------------------------------------------------------------------
// Color space conversions, theme color resolution, tint/shade/luminance transforms
// ---------------------------------------------------------------------------

/** Default clrMap mapping when no master clrMap is defined. */
export const DEFAULT_CLR_MAP: Record<string, string> = { bg1: "lt1", bg2: "lt2", tx1: "dk1", tx2: "dk2" };

export function resolveColor(parent: Element, theme: PptxTheme): string | null {
  // Look inside solidFill first (preferred), then search parent directly.
  // This prevents finding srgbClr inside unrelated nested elements (e.g., effectLst > outerShdw).
  const solidFill = qs(parent, "solidFill");
  const colorParent = solidFill ?? parent;

  const srgb = qs(colorParent, "srgbClr");
  if (srgb) return applyColorTransforms(srgb, `#${getAttr(srgb, "val") ?? "000000"}`);

  const schemeClr = qs(colorParent, "schemeClr");
  if (schemeClr) {
    const val = getAttr(schemeClr, "val");
    // Try direct lookup first (e.g., dk1, lt1, accent1)
    if (val && theme.colors[val]) {
      return applyColorTransforms(schemeClr, theme.colors[val]);
    }
    // Apply clrMap remapping (master's clrMap, or default mapping)
    const clrMap = theme.clrMap ?? DEFAULT_CLR_MAP;
    const remapped = val ? clrMap[val] : null;
    if (remapped && theme.colors[remapped]) {
      return applyColorTransforms(schemeClr, theme.colors[remapped]);
    }
    // Fallback to default mapping if clrMap doesn't have the key
    if (val && DEFAULT_CLR_MAP[val] && theme.colors[DEFAULT_CLR_MAP[val]]) {
      return applyColorTransforms(schemeClr, theme.colors[DEFAULT_CLR_MAP[val]]);
    }
  }

  return null;
}

/** Like resolveColor but also extracts alpha from the color element's children. */
export function resolveColorWithAlpha(parent: Element, theme: PptxTheme): { color: string; alpha?: number } | null {
  // Look inside solidFill first (preferred) to avoid finding srgbClr inside effectLst
  const solidFill = qs(parent, "solidFill");
  const colorParent = solidFill ?? parent;

  const srgb = qs(colorParent, "srgbClr");
  if (srgb) {
    const color = applyColorTransforms(srgb, `#${getAttr(srgb, "val") ?? "000000"}`);
    const alpha = extractAlpha(srgb);
    return { color, alpha };
  }

  const schemeClr = qs(colorParent, "schemeClr");
  if (schemeClr) {
    const val = getAttr(schemeClr, "val");
    // Try direct lookup, then clrMap remapping, then default mapping
    const clrMap = theme.clrMap ?? DEFAULT_CLR_MAP;
    const baseKey = (val && theme.colors[val])
      ? val
      : (val && clrMap[val] && theme.colors[clrMap[val]])
        ? clrMap[val]
        : (val && DEFAULT_CLR_MAP[val] && theme.colors[DEFAULT_CLR_MAP[val]])
          ? DEFAULT_CLR_MAP[val]
          : null;
    if (baseKey) {
      const color = applyColorTransforms(schemeClr, theme.colors[baseKey]);
      const alpha = extractAlpha(schemeClr);
      return { color, alpha };
    }
  }

  return null;
}

/** Extract alpha value from a color element's alpha child (values in 1/1000ths of percent). */
function extractAlpha(colorEl: Element): number | undefined {
  const alphaEl = qs(colorEl, "alpha");
  if (!alphaEl) return undefined;
  const val = intAttr(alphaEl, "val", 100000);
  if (val >= 100000) return undefined; // fully opaque, no need to set
  return val / 100000;
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const raw = hex.replace("#", "");
  const r = parseInt(raw.substring(0, 2), 16) / 255;
  const g = parseInt(raw.substring(2, 4), 16) / 255;
  const b = parseInt(raw.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6;
  } else {
    h = ((r - g) / d + 4) / 6;
  }

  return { h: h * 360, s, l };
}

export function hslToHex(h: number, s: number, l: number): string {
  // Clamp values
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));

  if (s === 0) {
    const v = Math.round(l * 255);
    return `#${v.toString(16).padStart(2, "0")}${v.toString(16).padStart(2, "0")}${v.toString(16).padStart(2, "0")}`;
  }

  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hNorm = h / 360;

  const r = Math.round(hue2rgb(p, q, hNorm + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, hNorm) * 255);
  const b = Math.round(hue2rgb(p, q, hNorm - 1 / 3) * 255);

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/** Parse hex color to RGB components (0-255) */
export function hexToRgbComponents(hex: string): { r: number; g: number; b: number } {
  const raw = hex.replace("#", "");
  return {
    r: parseInt(raw.substring(0, 2), 16),
    g: parseInt(raw.substring(2, 4), 16),
    b: parseInt(raw.substring(4, 6), 16),
  };
}

/** Convert RGB components (0-255) to hex string */
export function rgbComponentsToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g).toString(16).padStart(2, "0")}${clamp(b).toString(16).padStart(2, "0")}`;
}

/** Convert sRGB channel (0-1) to linear RGB */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Convert linear RGB channel to sRGB (0-1) */
export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function applyColorTransforms(parent: Element, baseColor: string): string {
  const hueMod = qs(parent, "hueMod");
  const hueOff = qs(parent, "hueOff");
  const satMod = qs(parent, "satMod");
  const satOff = qs(parent, "satOff");
  const lumMod = qs(parent, "lumMod");
  const lumOff = qs(parent, "lumOff");
  const tint = qs(parent, "tint");
  const shade = qs(parent, "shade");
  const gamma = qs(parent, "gamma");
  const invGamma = qs(parent, "invGamma");

  // Early return if no transforms present
  if (!hueMod && !hueOff && !satMod && !satOff && !lumMod && !lumOff && !tint && !shade) {
    return baseColor;
  }

  let color = baseColor;

  // 1. Hue/Sat/Lum modulation in HSL (correct per OOXML spec)
  if (hueMod || hueOff || satMod || satOff || lumMod || lumOff) {
    const hsl = hexToHsl(color);
    if (hueMod) hsl.h = hsl.h * (intAttr(hueMod, "val", 100000) / 100000);
    if (hueOff) hsl.h = hsl.h + intAttr(hueOff, "val", 0) / 60000;
    if (satMod) hsl.s = hsl.s * (intAttr(satMod, "val", 100000) / 100000);
    if (satOff) hsl.s = hsl.s + intAttr(satOff, "val", 0) / 100000;
    if (lumMod || lumOff) {
      const lm = lumMod ? intAttr(lumMod, "val", 100000) / 100000 : 1;
      const lo = lumOff ? intAttr(lumOff, "val", 0) / 100000 : 0;
      hsl.l = hsl.l * lm + lo;
    }
    color = hslToHex(hsl.h, hsl.s, hsl.l);
  }

  // 2. Tint and shade in sRGB (or linear RGB if gamma/invGamma present)
  if (tint || shade) {
    let { r, g, b } = hexToRgbComponents(color);

    // Convert to linear space if gamma element is present
    if (gamma) {
      r = srgbToLinear(r / 255) * 255;
      g = srgbToLinear(g / 255) * 255;
      b = srgbToLinear(b / 255) * 255;
    }

    // Tint: sRGB channel operation — c_new = c + (255 - c) * tint_fraction
    if (tint) {
      const t = intAttr(tint, "val", 100000) / 100000;
      r = r + (255 - r) * t;
      g = g + (255 - g) * t;
      b = b + (255 - b) * t;
    }

    // Shade: sRGB channel multiplication — c_new = c * shade_fraction
    if (shade) {
      const sh = intAttr(shade, "val", 100000) / 100000;
      r = r * sh;
      g = g * sh;
      b = b * sh;
    }

    // Convert back from linear if invGamma element is present
    if (invGamma) {
      r = linearToSrgb(r / 255) * 255;
      g = linearToSrgb(g / 255) * 255;
      b = linearToSrgb(b / 255) * 255;
    }

    color = rgbComponentsToHex(r, g, b);
  }

  return color;
}

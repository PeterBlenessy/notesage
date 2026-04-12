import type { PptxTheme, PptxFill, PptxGradientStop, PptxShadow, ArrowHead, PptxImage } from "./pptx-types";
import { qs, qsa, getAttr, intAttr } from "./pptx-xml-utils";
import { resolveColor, resolveColorWithAlpha } from "./pptx-colors";

// ---------------------------------------------------------------------------
// Shape effects: shadows, reflections, glow, soft-edge
// ---------------------------------------------------------------------------

export interface EffectsResult {
  shadow?: PptxShadow;
  glow?: { radius: number; color: string; alpha: number };
  softEdge?: number;
}

export function parseEffects(spPr: Element, theme: PptxTheme): EffectsResult {
  const effectLst = qs(spPr, "effectLst");
  if (!effectLst) return {};

  const result: EffectsResult = {};

  // Shadow (outerShdw)
  const outerShdw = qs(effectLst, "outerShdw");
  if (outerShdw) {
    const blurRad = intAttr(outerShdw, "blurRad", 0) / 12700;
    const dist = intAttr(outerShdw, "dist", 0) / 12700;
    const dir = intAttr(outerShdw, "dir", 0) / 60000;
    const dirRad = (dir * Math.PI) / 180;
    const offsetX = Math.round(dist * Math.sin(dirRad) * 10) / 10;
    const offsetY = Math.round(dist * Math.cos(dirRad) * 10) / 10;
    const colorResult = resolveColorWithAlpha(outerShdw, theme);
    result.shadow = {
      offsetX, offsetY, blur: blurRad,
      color: colorResult?.color ?? "#000000",
      alpha: colorResult?.alpha ?? 0.5,
    };
  }

  // Glow
  const glowEl = qs(effectLst, "glow");
  if (glowEl) {
    const rad = intAttr(glowEl, "rad", 0) / 12700;
    const colorResult = resolveColorWithAlpha(glowEl, theme);
    result.glow = {
      radius: rad,
      color: colorResult?.color ?? "#000000",
      alpha: colorResult?.alpha ?? 0.5,
    };
  }

  // Soft edge
  const softEdgeEl = qs(effectLst, "softEdge");
  if (softEdgeEl) {
    result.softEdge = intAttr(softEdgeEl, "rad", 0) / 12700;
  }

  return result;
}

/** @deprecated Use parseEffects instead. Kept for backward compat with picture shadow parsing. */
export function parseShadow(spPr: Element, theme: PptxTheme): PptxShadow | undefined {
  return parseEffects(spPr, theme).shadow;
}

export function parseReflection(spPr: Element): PptxImage['reflection'] | undefined {
  const effectLst = qs(spPr, "effectLst");
  if (!effectLst) return undefined;
  const reflEl = qs(effectLst, "reflection");
  if (!reflEl) return undefined;

  const blurRadius = intAttr(reflEl, "blurRad", 0) / 12700;        // EMU to pt
  const startOpacity = intAttr(reflEl, "stA", 100000) / 100000;    // start alpha
  const endOpacity = intAttr(reflEl, "endA", 0) / 100000;          // end alpha
  const distance = intAttr(reflEl, "dist", 0) / 12700;             // EMU to pt
  const direction = intAttr(reflEl, "dir", 5400000) / 60000;       // 60000ths of degree
  const sy = intAttr(reflEl, "sy", -100000);                       // scale Y (negative = flip)
  const size = Math.abs(sy) / 1000;                                // percentage

  return { blurRadius, startOpacity, endOpacity, distance, direction, size };
}

// ---------------------------------------------------------------------------
// Fill & stroke
// ---------------------------------------------------------------------------

/**
 * Parse fill from a <p:style> fillRef element.
 * fillRef idx determines the intensity: 1=subtle (20% alpha), 2=moderate (60%), 3=intense (full).
 */
export function parseStyleFillRef(el: Element, theme: PptxTheme): PptxFill | null {
  const pStyle = qs(el, "style");
  if (!pStyle) return null;
  const fillRef = qs(pStyle, "fillRef");
  if (!fillRef) return null;
  const idx = intAttr(fillRef, "idx", 0);
  if (idx <= 0) return null;
  const fillColor = resolveColor(fillRef, theme);
  if (!fillColor) return null;
  // fillRef idx maps to theme fillStyleLst entries.
  // idx=1 is typically a solid fill, idx=2/3 are gradients.
  // We render all as solid fills since we don't parse the full fillStyleLst.
  return { type: "solid", color: fillColor };
}

export function parseFill(spPr: Element, theme: PptxTheme): PptxFill | null {
  // Solid fill
  const solidFill = qs(spPr, "solidFill");
  if (solidFill) {
    const result = resolveColorWithAlpha(solidFill, theme);
    if (result) return { type: "solid", color: result.color, alpha: result.alpha };
  }

  // Gradient fill
  const gradFill = qs(spPr, "gradFill");
  if (gradFill) return parseGradientFill(gradFill, theme);

  // Pattern fill with preset, foreground and background colors
  const pattFill = qs(spPr, "pattFill");
  if (pattFill) {
    const preset = getAttr(pattFill, "prst") ?? "solid";
    const fgClr = qs(pattFill, "fgClr");
    const bgClr = qs(pattFill, "bgClr");
    const fg = fgClr ? resolveColor(fgClr, theme) ?? "#000000" : "#000000";
    const bg = bgClr ? resolveColor(bgClr, theme) ?? "#ffffff" : "#ffffff";
    return { type: "pattern", preset, foreground: fg, background: bg };
  }

  // No fill
  const noFill = qs(spPr, "noFill");
  if (noFill) return null;

  return null;
}

export function parseGradientFill(gradFill: Element, theme: PptxTheme): PptxFill {
  const stops: PptxGradientStop[] = [];
  const gsLst = qs(gradFill, "gsLst");
  if (gsLst) {
    const gsEls = qsa(gsLst, "gs");
    for (const gs of gsEls) {
      const pos = intAttr(gs, "pos", 0) / 1000; // 0–100000 → 0–100
      const result = resolveColorWithAlpha(gs, theme);
      stops.push({ position: pos, color: result?.color ?? "#000000", alpha: result?.alpha });
    }
  }

  // Check for linear
  const lin = qs(gradFill, "lin");
  if (lin) {
    const ang = intAttr(lin, "ang", 0) / 60000; // 60000ths of degree → degrees
    return { type: "linear", angle: ang, stops };
  }

  // Check for radial (path)
  const path = qs(gradFill, "path");
  if (path) {
    return { type: "radial", stops };
  }

  // Default to linear 0 degrees
  return { type: "linear", angle: 0, stops };
}

interface StrokeResult {
  stroke: string | null;
  strokeWidth: number;
  dashStyle?: string;
  headArrow?: ArrowHead;
  tailArrow?: ArrowHead;
}

export function parseStroke(spPr: Element, theme: PptxTheme): StrokeResult {
  const ln = qs(spPr, "ln");
  if (!ln) return { stroke: null, strokeWidth: 0 };

  const noFill = qs(ln, "noFill");
  if (noFill) return { stroke: null, strokeWidth: 0 };

  const width = intAttr(ln, "w", 12700) / 12700; // EMUs → pt (approx)
  const color = resolveColor(ln, theme);

  // Dash style
  const prstDash = qs(ln, "prstDash");
  const dashVal = prstDash ? getAttr(prstDash, "val") : null;

  const headArrow = parseArrowEnd(ln, "headEnd");
  const tailArrow = parseArrowEnd(ln, "tailEnd");

  return { stroke: color, strokeWidth: width, dashStyle: dashVal ?? undefined, headArrow, tailArrow };
}

const ARROW_TYPE_MAP: Record<string, ArrowHead["type"]> = {
  triangle: "triangle",
  stealth: "stealth",
  diamond: "diamond",
  oval: "oval",
  arrow: "arrow",
};

const ARROW_SIZE_MAP: Record<string, "sm" | "med" | "lg"> = {
  sm: "sm",
  med: "med",
  lg: "lg",
};

function parseArrowEnd(ln: Element, tagSuffix: string): ArrowHead | undefined {
  const el = qs(ln, tagSuffix);
  if (!el) return undefined;

  const rawType = getAttr(el, "type");
  if (!rawType || rawType === "none") return undefined;

  const type = ARROW_TYPE_MAP[rawType] ?? "triangle";
  const rawW = getAttr(el, "w");
  const rawLen = getAttr(el, "len");

  const arrow: ArrowHead = { type };
  if (rawW && ARROW_SIZE_MAP[rawW]) arrow.width = ARROW_SIZE_MAP[rawW];
  if (rawLen && ARROW_SIZE_MAP[rawLen]) arrow.length = ARROW_SIZE_MAP[rawLen];

  return arrow;
}


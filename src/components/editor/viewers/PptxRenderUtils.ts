/**
 * Shared rendering utilities for the PPTX slide renderer sub-components.
 *
 * This module contains pure helpers for converting PPTX data model values to
 * CSS, computing positions, and formatting bullet numbers. It has no React
 * component dependencies so it can be imported by any sub-renderer without
 * creating circular dependencies.
 */

import type { CSSProperties, ReactNode } from "react";
import React from "react";
import type {
  PptxFill,
  PptxShadow,
  BodyProperties,
} from "@/lib/pptx-types";
import { patternToCSS } from "@/lib/pptx-patterns";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const EMU_PER_PX = 9525; // 1 inch = 914400 EMU, 96 DPI

// ---------------------------------------------------------------------------
// Dash style maps
// ---------------------------------------------------------------------------

/** Map OOXML preset dash names to CSS border-style values */
export const DASH_TO_BORDER_STYLE: Record<string, string> = {
  solid: "solid",
  dash: "dashed",
  lgDash: "dashed",
  sysDash: "dashed",
  dot: "dotted",
  sysDot: "dotted",
  dashDot: "dashed",
  lgDashDot: "dashed",
  lgDashDotDot: "dashed",
  sysDashDot: "dashed",
  sysDashDotDot: "dashed",
};

/** Map OOXML preset dash names to SVG stroke-dasharray values */
export const SVG_DASH_MAP: Record<string, string | undefined> = {
  solid: undefined,
  dash: "8 4",
  lgDash: "12 4",
  sysDash: "4 2",
  dot: "2 2",
  sysDot: "1 2",
  dashDot: "8 4 2 4",
  lgDashDot: "12 4 2 4",
  lgDashDotDot: "12 4 2 4 2 4",
  sysDashDot: "4 2 1 2",
  sysDashDotDot: "4 2 1 2 1 2",
};

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

/** Convert hex (#rrggbb) to "r, g, b" string for use in rgba(). */
export function hexToRgb(hex: string): string {
  const raw = hex.replace("#", "");
  const r = parseInt(raw.substring(0, 2), 16);
  const g = parseInt(raw.substring(2, 4), 16);
  const b = parseInt(raw.substring(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

/** Convert a color + optional alpha into a CSS color string (hex or rgba). */
export function colorWithAlpha(color: string, alpha?: number): string {
  if (alpha == null || alpha >= 1) return color;
  return `rgba(${hexToRgb(color)}, ${alpha})`;
}

// ---------------------------------------------------------------------------
// Fill / shadow helpers
// ---------------------------------------------------------------------------

export function fillToCSS(fill: PptxFill): CSSProperties {
  switch (fill.type) {
    case "solid":
      return { backgroundColor: colorWithAlpha(fill.color, fill.alpha) };
    case "linear":
      return {
        background: `linear-gradient(${fill.angle + 90}deg, ${fill.stops.map((s) => `${colorWithAlpha(s.color, s.alpha)} ${s.position}%`).join(", ")})`,
      };
    case "radial":
      return {
        background: `radial-gradient(ellipse at center, ${fill.stops.map((s) => `${colorWithAlpha(s.color, s.alpha)} ${s.position}%`).join(", ")})`,
      };
    case "pattern":
      if (fill.preset && fill.background) {
        return patternToCSS(fill.preset, fill.foreground, fill.background);
      }
      return { backgroundColor: fill.foreground };
    case "picture":
      return {
        backgroundImage: `url(${fill.dataUrl})`,
        backgroundSize: fill.stretch ? "100% 100%" : fill.tile ? "auto" : "cover",
        backgroundRepeat: fill.tile ? "repeat" : "no-repeat",
        ...(fill.crop ? { backgroundPosition: `${-fill.crop.left}% ${-fill.crop.top}%` } : {}),
      };
    default:
      return {};
  }
}

/** Convert a PptxShadow to a CSS box-shadow string. */
export function shadowToCSS(shadow: PptxShadow | undefined): string | undefined {
  if (!shadow) return undefined;
  return `${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px rgba(${hexToRgb(shadow.color)}, ${shadow.alpha})`;
}

// ---------------------------------------------------------------------------
// Position helper
// ---------------------------------------------------------------------------

export function positionStyle(
  el: { x: number; y: number; width: number; height: number; rotation?: number; flipH?: boolean; flipV?: boolean },
  px: (emu: number) => number,
): CSSProperties {
  const transforms: string[] = [];
  if (el.rotation) transforms.push(`rotate(${el.rotation}deg)`);
  if (el.flipH) transforms.push("scaleX(-1)");
  if (el.flipV) transforms.push("scaleY(-1)");

  return {
    position: "absolute",
    left: px(el.x),
    top: px(el.y),
    width: px(el.width),
    height: px(el.height),
    transform: transforms.length > 0 ? transforms.join(" ") : undefined,
  };
}

// ---------------------------------------------------------------------------
// Body properties → CSS
// ---------------------------------------------------------------------------

export function bodyPropsToCSS(
  bodyProps: BodyProperties | undefined,
  px: (emu: number) => number,
): CSSProperties {
  if (!bodyProps) return { overflow: "visible", padding: 4 };

  const justifyMap: Record<BodyProperties["anchor"], string> = {
    top: "flex-start",
    center: "center",
    bottom: "flex-end",
  };

  return {
    display: "flex",
    flexDirection: "column",
    justifyContent: justifyMap[bodyProps.anchor],
    paddingLeft: px(bodyProps.marginLeft),
    paddingTop: px(bodyProps.marginTop),
    paddingRight: px(bodyProps.marginRight),
    paddingBottom: px(bodyProps.marginBottom),
    overflow: "visible",
    whiteSpace: bodyProps.wrap ? undefined : "nowrap",
  };
}

// ---------------------------------------------------------------------------
// Hyperlink wrapper
// ---------------------------------------------------------------------------

export function wrapWithHyperlink(
  content: ReactNode,
  hyperlink: string | undefined,
  onSlideNavigate?: (slideIndex: number) => void,
): ReactNode {
  if (!hyperlink) return content;

  if (hyperlink.startsWith("slide:")) {
    const slideNum = parseInt(hyperlink.substring(6), 10);
    return React.createElement(
      "a",
      {
        href: "#",
        onClick: (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          if (onSlideNavigate && !isNaN(slideNum)) onSlideNavigate(slideNum - 1);
        },
        style: { color: "#0563C1", textDecoration: "underline", cursor: "pointer" },
      },
      content,
    );
  }

  return React.createElement(
    "a",
    {
      href: hyperlink,
      target: "_blank",
      rel: "noopener noreferrer",
      style: { color: "#0563C1", textDecoration: "underline", cursor: "pointer" },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
    content,
  );
}

// ---------------------------------------------------------------------------
// Auto-numbered bullet formatting
// ---------------------------------------------------------------------------

export function formatBulletNumber(type: string, index: number): string {
  switch (type) {
    case "arabicPeriod":
      return `${index}.`;
    case "arabicParenR":
      return `${index})`;
    case "alphaLcPeriod":
      return `${toAlpha(index, false)}.`;
    case "alphaUcPeriod":
      return `${toAlpha(index, true)}.`;
    case "alphaLcParenR":
      return `${toAlpha(index, false)})`;
    case "alphaUcParenR":
      return `${toAlpha(index, true)})`;
    case "romanLcPeriod":
      return `${toRoman(index, false)}.`;
    case "romanUcPeriod":
      return `${toRoman(index, true)}.`;
    case "romanLcParenR":
      return `${toRoman(index, false)})`;
    case "romanUcParenR":
      return `${toRoman(index, true)})`;
    default:
      return `${index}.`;
  }
}

function toAlpha(n: number, upper: boolean): string {
  let result = "";
  let val = n;
  while (val > 0) {
    val--;
    result = String.fromCharCode((upper ? 65 : 97) + (val % 26)) + result;
    val = Math.floor(val / 26);
  }
  return result;
}

function toRoman(n: number, upper: boolean): string {
  const values = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const symbols = ["m", "cm", "d", "cd", "c", "xc", "l", "xl", "x", "ix", "v", "iv", "i"];
  let result = "";
  let val = n;
  for (let i = 0; i < values.length; i++) {
    while (val >= values[i]) {
      result += symbols[i];
      val -= values[i];
    }
  }
  return upper ? result.toUpperCase() : result;
}

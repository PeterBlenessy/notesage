/**
 * Text rendering components for the PPTX slide viewer.
 *
 * Covers text box rendering, paragraph/run formatting, bullet handling,
 * and tab stop processing.
 */

import React, { type CSSProperties } from "react";
import type {
  PptxTextBox,
  PptxParagraph,
  PptxTextRun,
} from "@/lib/pptx-types";
import {
  bodyPropsToCSS,
  shadowToCSS,
  positionStyle,
  wrapWithHyperlink,
  hexToRgb,
  formatBulletNumber,
} from "./PptxRenderUtils";

// ---------------------------------------------------------------------------
// Tab stop constant
// ---------------------------------------------------------------------------

const DEFAULT_TAB_WIDTH = 48; // px

// ---------------------------------------------------------------------------
// Bullet counter computation
// ---------------------------------------------------------------------------

function computeBulletCounters(paragraphs: PptxParagraph[]): Record<number, string> {
  const result: Record<number, string> = {};

  let counter = 0;
  let prevLevel = -1;
  let prevType = "";

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    if (!p.bulletAutoNum) {
      counter = 0;
      prevLevel = -1;
      prevType = "";
      continue;
    }

    const { type, startAt } = p.bulletAutoNum;
    const level = p.bulletLevel;

    if (level !== prevLevel || type !== prevType) {
      counter = startAt;
    } else {
      counter++;
    }

    result[i] = formatBulletNumber(type, counter);
    prevLevel = level;
    prevType = type;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Paragraphs renderer (shared between text boxes, shapes, and table cells)
// ---------------------------------------------------------------------------

export function ParagraphsRenderer({
  paragraphs,
  onSlideNavigate,
}: {
  paragraphs: PptxParagraph[];
  onSlideNavigate?: (slideIndex: number) => void;
}) {
  const bulletCounters = computeBulletCounters(paragraphs);

  return (
    <>
      {paragraphs.map((p, i) => {
        const bulletLabel = p.bulletChar
          ?? (p.bulletAutoNum ? bulletCounters[i] ?? "" : null);

        const textFontSize = p.runs.length > 0 ? p.runs[0].fontSize : undefined;
        const bulletFontSize = (p.bulletSizePercent != null && textFontSize != null)
          ? textFontSize * (p.bulletSizePercent / 100)
          : textFontSize;

        const bulletStyle: CSSProperties | undefined =
          (p.bulletFont || p.bulletColor || bulletFontSize != null) ? {
            flexShrink: 0,
            fontFamily: p.bulletFont ?? undefined,
            color: p.bulletColor ?? undefined,
            fontSize: bulletFontSize != null ? bulletFontSize : undefined,
          } : { flexShrink: 0 };

        const basePaddingLeft = p.bulletLevel ? p.bulletLevel * 20 : 0;
        const extraMarginLeft = p.marginLeft ?? 0;

        return (
          <div
            key={i}
            style={{
              textAlign: p.alignment,
              paddingLeft: basePaddingLeft + extraMarginLeft || undefined,
              ...(bulletLabel ? {
                display: "flex",
                alignItems: "baseline",
                gap: 4,
              } : {}),
              lineHeight: p.lineSpacing != null ? p.lineSpacing : undefined,
              marginTop: p.spaceBefore != null ? p.spaceBefore : undefined,
              marginBottom: p.spaceAfter != null ? p.spaceAfter : undefined,
              textIndent: p.indent != null ? p.indent : undefined,
            }}
          >
            {bulletLabel && (
              <span style={bulletStyle}>{bulletLabel}</span>
            )}
            <span>
              {p.runs.map((r, j) => (
                <RunRenderer key={j} run={r} onSlideNavigate={onSlideNavigate} tabStops={p.tabStops} />
              ))}
            </span>
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Run renderer
// ---------------------------------------------------------------------------

function RunRenderer({
  run: r,
  onSlideNavigate,
  tabStops,
}: {
  run: PptxTextRun;
  onSlideNavigate?: (slideIndex: number) => void;
  tabStops?: { pos: number; align: string }[];
}) {
  const textDecorations: string[] = [];
  if (r.underline) textDecorations.push("underline");
  if (r.strikethrough) textDecorations.push("line-through");

  let textDecorationStyle: CSSProperties["textDecorationStyle"];
  let textDecorationThickness: string | undefined;
  if (r.underline && r.underlineStyle) {
    switch (r.underlineStyle) {
      case "dbl":
        textDecorationStyle = "double";
        break;
      case "dotted":
        textDecorationStyle = "dotted";
        break;
      case "dash":
      case "dashLong":
        textDecorationStyle = "dashed";
        break;
      case "wavy":
      case "wavyHeavy":
        textDecorationStyle = "wavy";
        break;
    }
    if (r.underlineStyle === "heavy" || r.underlineStyle === "dottedHeavy" || r.underlineStyle === "dashHeavy") {
      textDecorationThickness = "2px";
      if (r.underlineStyle === "dottedHeavy") textDecorationStyle = "dotted";
      if (r.underlineStyle === "dashHeavy") textDecorationStyle = "dashed";
    }
    if (r.underlineStyle === "wavyHeavy") {
      textDecorationThickness = "2px";
    }
  }

  // Build font-family chain with CJK/complex script fallbacks
  const fontFamilyParts = [r.fontFamily];
  if (r.eaFont && r.eaFont !== r.fontFamily) fontFamilyParts.push(r.eaFont);
  if (r.csFont && r.csFont !== r.fontFamily) fontFamilyParts.push(r.csFont);
  fontFamilyParts.push("sans-serif");
  const fontFamily = fontFamilyParts.join(", ");

  const style: CSSProperties = {
    fontWeight: r.bold ? 700 : 400,
    fontStyle: r.italic ? "italic" : "normal",
    textDecoration: textDecorations.length > 0 ? textDecorations.join(" ") : "none",
    ...(textDecorationStyle ? { textDecorationStyle } : {}),
    ...(textDecorationThickness ? { textDecorationThickness } : {}),
    ...(r.underlineColor ? { textDecorationColor: r.underlineColor } : {}),
    fontSize: r.fontSize,
    fontFamily,
    color: r.color,
    ...(r.letterSpacing != null ? { letterSpacing: `${r.letterSpacing}pt` } : {}),
    ...(r.caps === "all" ? { textTransform: "uppercase" as const } : {}),
    ...(r.caps === "small" ? { fontVariant: "small-caps" as const } : {}),
    ...(r.highlight ? { backgroundColor: r.highlight } : {}),
    ...(r.kern != null && r.fontSize * 100 >= r.kern ? { fontKerning: "normal" as const } : {}),
    ...(r.shadow ? { textShadow: `${r.shadow.offsetX}px ${r.shadow.offsetY}px ${r.shadow.blur}px rgba(${hexToRgb(r.shadow.color)}, ${r.shadow.alpha})` } : {}),
    whiteSpace: "pre-wrap",
  };

  // Superscript / subscript
  if (r.baseline && r.baseline > 0) {
    style.verticalAlign = "super";
    style.fontSize = r.fontSize * 0.65;
  } else if (r.baseline && r.baseline < 0) {
    style.verticalAlign = "sub";
    style.fontSize = r.fontSize * 0.65;
  }

  // Handle tab characters by splitting text and inserting tab-width spans
  const hasTab = r.text.includes("\t");
  let content: React.ReactNode;

  if (hasTab) {
    const segments = r.text.split("\t");
    content = (
      <>
        {segments.map((seg, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 && (
              <span style={{
                display: "inline-block",
                minWidth: tabStops && tabStops[idx - 1]
                  ? tabStops[idx - 1].pos
                  : DEFAULT_TAB_WIDTH,
              }} />
            )}
            {seg}
          </React.Fragment>
        ))}
      </>
    );
  } else {
    content = r.text;
  }

  const span = <span style={style}>{content}</span>;

  if (r.hyperlink) {
    return <>{wrapWithHyperlink(span, r.hyperlink, onSlideNavigate)}</>;
  }

  return span;
}

// ---------------------------------------------------------------------------
// Text box renderer
// ---------------------------------------------------------------------------

export function TextBoxRenderer({
  el,
  px,
  onSlideNavigate,
}: {
  el: PptxTextBox;
  px: (n: number) => number;
  onSlideNavigate?: (slideIndex: number) => void;
}) {
  const bodyStyle = bodyPropsToCSS(el.bodyProps, px);
  const content = (
    <ParagraphsRenderer paragraphs={el.paragraphs} onSlideNavigate={onSlideNavigate} />
  );

  const pos = positionStyle(el, px);
  // spAutoFit: grow shape to fit text content
  if (el.bodyProps?.autoFit) {
    pos.height = "auto";
    pos.minHeight = px(el.height);
  }

  const inner = (
    <div style={{ ...pos, ...bodyStyle, boxShadow: shadowToCSS(el.shadow) }}>
      {el.bodyProps && el.bodyProps.fontScale < 1 ? (
        <div style={{ fontSize: `${el.bodyProps.fontScale * 100}%` }}>{content}</div>
      ) : content}
    </div>
  );

  return <>{wrapWithHyperlink(inner, el.hyperlink, onSlideNavigate)}</>;
}

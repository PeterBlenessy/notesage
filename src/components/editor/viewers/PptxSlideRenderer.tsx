import React, { useState, type CSSProperties, type ReactNode } from "react";
import { Play, BarChart3, Box } from "lucide-react";
import type {
  PptxSlide,
  PptxElement,
  PptxTextBox,
  PptxImage,
  PptxShape,
  PptxTable,
  PptxGroup,
  PptxFill,
  PptxParagraph,
  PptxBackground,
  PptxPresentation,
  BodyProperties,
  PptxTextRun,
  PptxShadow,
  ArrowHead,
  PptxTableStylePart,
} from "@/lib/pptx-types";
import { ChartRenderer } from "./PptxChartRenderer";
import { PRESET_GEOMETRIES } from "@/lib/pptx-preset-geometries";
import { patternToCSS } from "@/lib/pptx-patterns";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMU_PER_PX = 9525; // 1 inch = 914400 EMU, 96 DPI

// ---------------------------------------------------------------------------
// Dash style maps (#9+#10)
// ---------------------------------------------------------------------------

/** Map OOXML preset dash names to CSS border-style values */
const DASH_TO_BORDER_STYLE: Record<string, string> = {
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
const SVG_DASH_MAP: Record<string, string | undefined> = {
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
// Slide renderer
// ---------------------------------------------------------------------------

interface SlideRendererProps {
  slide: PptxSlide;
  theme: PptxPresentation["theme"];
  onSlideNavigate?: (slideIndex: number) => void;
}

export function SlideRenderer({ slide, theme, onSlideNavigate }: SlideRendererProps) {
  const hf = slide.headerFooter;

  // Build placeholder key sets for deduplication. Higher layers override lower:
  // slide overrides layout overrides master.  When a placeholder type+idx is
  // present on a higher layer, the lower layer version must not render.
  const phKey = (el: PptxElement): string | null => {
    if ((el.type === "textbox" || el.type === "shape") && el.placeholderType) {
      return el.placeholderType + (el.placeholderIdx !== undefined ? `:${el.placeholderIdx}` : "");
    }
    return null;
  };

  // Filter chrome placeholder elements based on header/footer visibility.
  // When no <p:hf> element exists (headerFooter is undefined), all chrome
  // placeholders are hidden — preserving the safe default behavior.
  const isChromePlaceholderVisible = (el: PptxElement): boolean => {
    const phType = (el as { placeholderType?: string }).placeholderType;
    if (!phType) return true;

    if (phType === "sldNum") return hf?.showSlideNum === true;
    if (phType === "dt") return hf?.showDate === true;
    if (phType === "ftr") return hf?.showFooter === true;

    return true; // Other placeholder types (title, body, etc.) always show
  };

  // Placeholder keys on the slide itself
  const slidePHKeys = new Set<string>();
  for (const el of slide.elements) {
    const k = phKey(el);
    if (k) slidePHKeys.add(k);
  }

  // Placeholder keys on layout shapes (used to filter master)
  const layoutPHKeys = new Set<string>();
  if (slide.layoutShapes) {
    for (const el of slide.layoutShapes) {
      const k = phKey(el);
      if (k) layoutPHKeys.add(k);
    }
  }

  // Layout shapes are hidden when the slide overrides them
  const shouldRenderLayout = (el: PptxElement): boolean => {
    const k = phKey(el);
    return k === null || !slidePHKeys.has(k);
  };

  // Master shapes are hidden when either the slide or the layout overrides them
  const shouldRenderMaster = (el: PptxElement): boolean => {
    const k = phKey(el);
    return k === null || (!slidePHKeys.has(k) && !layoutPHKeys.has(k));
  };

  return (
    <div className="w-full h-full relative" style={backgroundStyle(slide.background)}>
      {/* Master shapes (bottom layer) — filtered to hide overridden placeholders */}
      {slide.masterShapes?.filter(el => shouldRenderMaster(el) && isChromePlaceholderVisible(el)).map((el, i) => (
        <ElementRenderer key={`m${i}`} element={el} theme={theme} onSlideNavigate={onSlideNavigate} />
      ))}
      {/* Layout shapes (middle layer) — filtered to hide overridden placeholders */}
      {slide.layoutShapes?.filter(el => shouldRenderLayout(el) && isChromePlaceholderVisible(el)).map((el, i) => (
        <ElementRenderer key={`l${i}`} element={el} theme={theme} onSlideNavigate={onSlideNavigate} />
      ))}
      {/* Slide shapes (top layer) — chrome placeholders filtered by headerFooter visibility */}
      {slide.elements.filter(isChromePlaceholderVisible).map((el, i) => (
        <ElementRenderer key={i} element={el} theme={theme} onSlideNavigate={onSlideNavigate} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Background & fill helpers
// ---------------------------------------------------------------------------

function backgroundStyle(bg: PptxBackground | null): CSSProperties {
  const base: CSSProperties = { backgroundColor: "#ffffff" };
  if (!bg) return base;
  if (bg.imageDataUrl) {
    return {
      ...base,
      backgroundImage: `url(${bg.imageDataUrl})`,
      backgroundSize: bg.tiled ? "auto" : "cover",
      ...(bg.tiled ? { backgroundRepeat: "repeat" } : {}),
    };
  }
  if (bg.fill) {
    return { ...base, ...fillToCSS(bg.fill) };
  }
  return base;
}

/** Convert hex (#rrggbb) to "r, g, b" string for use in rgba(). */
function hexToRgb(hex: string): string {
  const raw = hex.replace("#", "");
  const r = parseInt(raw.substring(0, 2), 16);
  const g = parseInt(raw.substring(2, 4), 16);
  const b = parseInt(raw.substring(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

/** Convert a color + optional alpha into a CSS color string (hex or rgba). */
function colorWithAlpha(color: string, alpha?: number): string {
  if (alpha == null || alpha >= 1) return color;
  return `rgba(${hexToRgb(color)}, ${alpha})`;
}

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
      // Backward compat: old format without preset/background
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
function shadowToCSS(shadow: PptxShadow | undefined): string | undefined {
  if (!shadow) return undefined;
  return `${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px rgba(${hexToRgb(shadow.color)}, ${shadow.alpha})`;
}

// ---------------------------------------------------------------------------
// Position helper (with flip transforms from #9+#10)
// ---------------------------------------------------------------------------

function positionStyle(
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
// Element dispatcher
// ---------------------------------------------------------------------------

function ElementRenderer({
  element,
  theme,
  onSlideNavigate,
}: {
  element: PptxElement;
  theme: PptxPresentation["theme"];
  onSlideNavigate?: (slideIndex: number) => void;
}) {
  const px = (emu: number) => emu / EMU_PER_PX;

  switch (element.type) {
    case "textbox":
      return <TextBoxRenderer el={element} px={px} onSlideNavigate={onSlideNavigate} />;
    case "image":
      return <ImageRenderer el={element} px={px} onSlideNavigate={onSlideNavigate} />;
    case "shape":
      return <ShapeRenderer el={element} px={px} onSlideNavigate={onSlideNavigate} />;
    case "table":
      return <TableRenderer el={element} px={px} onSlideNavigate={onSlideNavigate} />;
    case "chart":
      return <ChartRenderer el={element} px={px} />;
    case "group":
      return <GroupRenderer el={element} px={px} theme={theme} onSlideNavigate={onSlideNavigate} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Body properties -> CSS (#3+#4+#5)
// ---------------------------------------------------------------------------

function bodyPropsToCSS(
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
// Auto-numbered bullet formatting (#3+#4+#5)
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

// ---------------------------------------------------------------------------
// Hyperlink wrapper (#7+#8)
// ---------------------------------------------------------------------------

function wrapWithHyperlink(
  content: React.ReactNode,
  hyperlink: string | undefined,
  onSlideNavigate?: (slideIndex: number) => void,
): React.ReactNode {
  if (!hyperlink) return content;

  // Internal slide navigation
  if (hyperlink.startsWith("slide:")) {
    const slideNum = parseInt(hyperlink.substring(6), 10);
    return (
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (onSlideNavigate && !isNaN(slideNum)) onSlideNavigate(slideNum - 1);
        }}
        style={{ color: "#0563C1", textDecoration: "underline", cursor: "pointer" }}
      >
        {content}
      </a>
    );
  }

  // External URL
  return (
    <a
      href={hyperlink}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: "#0563C1", textDecoration: "underline", cursor: "pointer" }}
      onClick={(e) => e.stopPropagation()}
    >
      {content}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Text box
// ---------------------------------------------------------------------------

function TextBoxRenderer({
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

// ---------------------------------------------------------------------------
// Paragraphs (shared between text boxes, shapes, table cells)
// ---------------------------------------------------------------------------

export function ParagraphsRenderer({
  paragraphs,
  onSlideNavigate,
}: {
  paragraphs: PptxParagraph[];
  onSlideNavigate?: (slideIndex: number) => void;
}) {
  // Compute auto-numbered bullet counters
  const bulletCounters = computeBulletCounters(paragraphs);

  return (
    <>
      {paragraphs.map((p, i) => {
        const bulletLabel = p.bulletChar
          ?? (p.bulletAutoNum ? bulletCounters[i] ?? "" : null);

        // Compute bullet font size: bulletSizePercent is relative to the text run size
        const textFontSize = p.runs.length > 0 ? p.runs[0].fontSize : undefined;
        const bulletFontSize = (p.bulletSizePercent != null && textFontSize != null)
          ? textFontSize * (p.bulletSizePercent / 100)
          : textFontSize; // default to same size as text

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

const DEFAULT_TAB_WIDTH = 48; // px

/** Render a single text run with strikethrough, baseline, and hyperlink support */
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

  // Map OOXML underline styles to CSS text-decoration-style
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
      // sng and unrecognized styles fall through to default solid
    }
    // Heavy variants get thicker underline
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

/** Compute formatted bullet labels for auto-numbered paragraphs */
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
// Image
// ---------------------------------------------------------------------------

function ImageRenderer({
  el,
  px,
  onSlideNavigate,
}: {
  el: PptxImage;
  px: (n: number) => number;
  onSlideNavigate?: (slideIndex: number) => void;
}) {
  const [imgError, setImgError] = useState(false);

  const imgStyle: CSSProperties = {
    objectFit: "contain" as const,
    ...(el.opacity !== undefined && el.opacity < 1 ? { opacity: el.opacity } : {}),
    boxShadow: shadowToCSS(el.shadow),
    ...(el.crop ? { clipPath: `inset(${el.crop.top}% ${el.crop.right}% ${el.crop.bottom}% ${el.crop.left}%)` } : {}),
  };

  if (imgError) {
    const fallback = (
      <div
        style={{
          ...positionStyle(el, px),
          backgroundColor: "var(--color-muted, #f3f4f6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px dashed var(--color-border, #d1d5db)",
        }}
      >
        <span style={{ fontSize: 10, color: "var(--color-muted-foreground, #9ca3af)" }}>
          External image
        </span>
      </div>
    );
    return <>{wrapWithHyperlink(fallback, el.hyperlink, onSlideNavigate)}</>;
  }

  if (el.reflection) {
    const imgH = px(el.height);
    const reflHeight = imgH * (el.reflection.size / 100);
    const gap = el.reflection.distance;

    const container = (
      <div style={{ ...positionStyle(el, px), height: "auto", overflow: "visible" }}>
        <img src={el.dataUrl} alt="" style={{ ...imgStyle, width: "100%", height: imgH }} onError={() => setImgError(true)} />
        <div style={{
          marginTop: gap,
          height: reflHeight,
          overflow: "hidden",
          WebkitMaskImage: `linear-gradient(to bottom, rgba(0,0,0,${el.reflection.startOpacity}), rgba(0,0,0,${el.reflection.endOpacity}))`,
          maskImage: `linear-gradient(to bottom, rgba(0,0,0,${el.reflection.startOpacity}), rgba(0,0,0,${el.reflection.endOpacity}))`,
          filter: el.reflection.blurRadius > 0 ? `blur(${el.reflection.blurRadius}px)` : undefined,
        }}>
          <img src={el.dataUrl} alt="" style={{ width: "100%", height: imgH, objectFit: "contain", transform: "scaleY(-1)", transformOrigin: "top" }} />
        </div>
      </div>
    );
    return <>{wrapWithHyperlink(container, el.hyperlink, onSlideNavigate)}</>;
  }

  const style: CSSProperties = { ...positionStyle(el, px), ...imgStyle };
  const img = <img src={el.dataUrl} alt="" style={style} onError={() => setImgError(true)} />;
  return <>{wrapWithHyperlink(img, el.hyperlink, onSlideNavigate)}</>;
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

function ShapeRenderer({
  el,
  px,
  onSlideNavigate,
}: {
  el: PptxShape;
  px: (n: number) => number;
  onSlideNavigate?: (slideIndex: number) => void;
}) {
  if (el.shapeType === "line" || el.shapeType === "arrow") {
    return <LineRenderer el={el} px={px} />;
  }

  // Use SVG preset geometry for shapes that aren't already well-served by CSS
  // (rect, ellipse, roundRect already render correctly with border-radius)
  const CSS_SHAPES = new Set(["rect", "ellipse", "roundRect"]);
  const svgPath = el.presetGeometry && !CSS_SHAPES.has(el.shapeType)
    ? PRESET_GEOMETRIES[el.presetGeometry]
    : undefined;

  if (svgPath) {
    return <PresetShapeRenderer el={el} px={px} svgPath={svgPath} onSlideNavigate={onSlideNavigate} />;
  }

  const hasBodyProps = !!el.bodyProps;
  const bodyStyle = hasBodyProps ? bodyPropsToCSS(el.bodyProps, px) : {};

  // Dash style for border
  const borderStyle = el.dashStyle ? (DASH_TO_BORDER_STYLE[el.dashStyle] ?? "solid") : "solid";

  // Combine shadow and glow into boxShadow
  const shadows: string[] = [];
  if (el.shadow) {
    const s = shadowToCSS(el.shadow);
    if (s) shadows.push(s);
  }
  if (el.glow) {
    shadows.push(`0 0 ${el.glow.radius}px rgba(${hexToRgb(el.glow.color)}, ${el.glow.alpha})`);
  }

  // Soft edge via CSS filter blur
  const filters: string[] = [];
  if (el.softEdge && el.softEdge > 0) {
    filters.push(`blur(${el.softEdge}px)`);
  }

  const pos = positionStyle(el, px);
  // spAutoFit: grow shape to fit text content
  if (el.bodyProps?.autoFit) {
    pos.height = "auto";
    pos.minHeight = px(el.height);
  }

  const style: CSSProperties = {
    ...pos,
    ...(el.fill ? fillToCSS(el.fill) : {}),
    border: el.stroke ? `${Math.max(1, el.strokeWidth)}px ${borderStyle} ${el.stroke}` : undefined,
    borderRadius: el.shapeType === "ellipse" ? "50%" : el.shapeType === "roundRect" ? 8 : undefined,
    boxShadow: shadows.length > 0 ? shadows.join(", ") : undefined,
    filter: filters.length > 0 ? filters.join(" ") : undefined,
    ...(el.softEdge ? { overflow: "hidden" as const } : {}),
    ...(hasBodyProps ? bodyStyle : {
      overflow: "hidden",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 4,
    }),
  };

  // Placeholder-style shapes (SmartArt, embedded objects, media)
  const isPlaceholder = el.shapeType === "other" && !el.fill && el.stroke;

  const textContent = (
    el.text.length > 0 ? <ParagraphsRenderer paragraphs={el.text} onSlideNavigate={onSlideNavigate} /> : null
  );

  const wrappedContent = el.bodyProps && el.bodyProps.fontScale < 1
    ? <div style={{ fontSize: `${el.bodyProps.fontScale * 100}%` }}>{textContent}</div>
    : textContent;

  const shape = (
    <div style={style}>
      {isPlaceholder ? (
        <div className="flex flex-col items-center gap-1 text-center">
          <PlaceholderIcon text={el.text} />
          <ParagraphsRenderer paragraphs={el.text} onSlideNavigate={onSlideNavigate} />
        </div>
      ) : wrappedContent}
    </div>
  );

  return <>{wrapWithHyperlink(shape, el.hyperlink, onSlideNavigate)}</>;
}

// ---------------------------------------------------------------------------
// Preset geometry shape (SVG path-based rendering)
// ---------------------------------------------------------------------------

function PresetShapeRenderer({
  el,
  px,
  svgPath,
  onSlideNavigate,
}: {
  el: PptxShape;
  px: (n: number) => number;
  svgPath: string;
  onSlideNavigate?: (slideIndex: number) => void;
}) {
  const w = px(el.width);
  const h = px(el.height);
  const pos = positionStyle(el, px);
  // spAutoFit: grow shape wrapper to fit text content
  if (el.bodyProps?.autoFit) {
    pos.height = "auto";
    pos.minHeight = h;
  }

  // Resolve fill color for the SVG path
  const fillColor = el.fill
    ? el.fill.type === "solid"
      ? colorWithAlpha(el.fill.color, el.fill.alpha)
      : el.fill.type === "pattern"
        ? el.fill.foreground
        : undefined // gradient handled via SVG defs
    : "transparent";

  const hasGradient = el.fill?.type === "linear" || el.fill?.type === "radial";
  const gradientId = hasGradient ? `grad-${Math.random().toString(36).slice(2, 8)}` : undefined;

  // Stroke width normalized to the 0-1 viewBox coordinate space
  const strokeW = el.stroke && el.strokeWidth > 0
    ? Math.max(0.5, el.strokeWidth) / Math.max(w, h, 1)
    : 0;

  const textContent = el.text.length > 0
    ? <ParagraphsRenderer paragraphs={el.text} onSlideNavigate={onSlideNavigate} />
    : null;

  const wrappedText = el.bodyProps && el.bodyProps.fontScale < 1
    ? <div style={{ fontSize: `${el.bodyProps.fontScale * 100}%` }}>{textContent}</div>
    : textContent;

  // Build filter string combining shadow, glow, and soft edge
  const svgFilters: string[] = [];
  if (el.shadow) {
    svgFilters.push(`drop-shadow(${el.shadow.offsetX}px ${el.shadow.offsetY}px ${el.shadow.blur}px rgba(${hexToRgb(el.shadow.color)}, ${el.shadow.alpha}))`);
  }
  if (el.glow) {
    svgFilters.push(`drop-shadow(0px 0px ${el.glow.radius}px rgba(${hexToRgb(el.glow.color)}, ${el.glow.alpha}))`);
  }
  if (el.softEdge && el.softEdge > 0) {
    svgFilters.push(`blur(${el.softEdge}px)`);
  }

  const shape = (
    <div style={{ ...pos, overflow: "visible", filter: svgFilters.length > 0 ? svgFilters.join(" ") : undefined }}>
      <svg
        viewBox="0 0 1 1"
        width={w}
        height={h}
        style={{ position: "absolute", top: 0, left: 0 }}
        preserveAspectRatio="none"
      >
        {hasGradient && el.fill?.type === "linear" && gradientId && (
          <defs>
            <linearGradient id={gradientId} gradientTransform={`rotate(${el.fill.angle})`}>
              {el.fill.stops.map((s, i) => (
                <stop key={i} offset={`${s.position}%`} stopColor={s.color} stopOpacity={s.alpha ?? 1} />
              ))}
            </linearGradient>
          </defs>
        )}
        {hasGradient && el.fill?.type === "radial" && gradientId && (
          <defs>
            <radialGradient id={gradientId}>
              {el.fill.stops.map((s, i) => (
                <stop key={i} offset={`${s.position}%`} stopColor={s.color} stopOpacity={s.alpha ?? 1} />
              ))}
            </radialGradient>
          </defs>
        )}
        <path
          d={svgPath}
          fill={gradientId ? `url(#${gradientId})` : fillColor}
          stroke={el.stroke ?? "none"}
          strokeWidth={strokeW}
          fillRule="evenodd"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* Text overlay centered on the shape */}
      {wrappedText && (
        <div style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: w,
          ...(el.bodyProps?.autoFit ? { minHeight: h, height: "auto" } : { height: h }),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 4,
          overflow: el.bodyProps?.autoFit ? undefined : "hidden",
        }}>
          {wrappedText}
        </div>
      )}
    </div>
  );

  return <>{wrapWithHyperlink(shape, el.hyperlink, onSlideNavigate)}</>;
}

// ---------------------------------------------------------------------------
// Placeholder icon
// ---------------------------------------------------------------------------

function PlaceholderIcon({ text }: { text: PptxParagraph[] }) {
  const label = text[0]?.runs[0]?.text?.toLowerCase() ?? "";
  if (label.includes("media")) return <Play className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />;
  if (label.includes("chart")) return <BarChart3 className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />;
  return <Box className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />;
}

// ---------------------------------------------------------------------------
// Line / arrow (with dash style from #9+#10)
// ---------------------------------------------------------------------------

// Monotonically increasing counter for unique SVG marker IDs
let lineMarkerCounter = 0;

/** Map ArrowHead size fields to pixel dimensions */
function arrowSize(size: "sm" | "med" | "lg" | undefined): number {
  switch (size) {
    case "sm": return 6;
    case "lg": return 12;
    default: return 8; // "med" or undefined
  }
}

/** Build SVG marker content for a given ArrowHead type */
function arrowMarkerShape(
  arrow: ArrowHead,
  color: string,
  markerW: number,
  markerH: number,
): ReactNode {
  const midY = markerH / 2;
  switch (arrow.type) {
    case "triangle":
      return <polygon points={`0 0, ${markerW} ${midY}, 0 ${markerH}`} fill={color} />;
    case "stealth":
      return (
        <polygon
          points={`0 0, ${markerW} ${midY}, 0 ${markerH}, ${markerW * 0.3} ${midY}`}
          fill={color}
        />
      );
    case "diamond":
      return (
        <polygon
          points={`0 ${midY}, ${markerW / 2} 0, ${markerW} ${midY}, ${markerW / 2} ${markerH}`}
          fill={color}
        />
      );
    case "oval":
      return (
        <ellipse
          cx={markerW / 2}
          cy={midY}
          rx={markerW / 2}
          ry={midY}
          fill={color}
        />
      );
    case "arrow":
      return (
        <polyline
          points={`0 0, ${markerW} ${midY}, 0 ${markerH}`}
          fill="none"
          stroke={color}
          strokeWidth={1}
        />
      );
    default:
      return <polygon points={`0 0, ${markerW} ${midY}, 0 ${markerH}`} fill={color} />;
  }
}

function LineRenderer({ el, px }: { el: PptxShape; px: (n: number) => number }) {
  const w = px(el.width);
  const h = px(el.height);
  const strokeColor = el.stroke ?? "#000000";
  const sw = Math.max(1, el.strokeWidth);
  const dashArray = el.dashStyle ? SVG_DASH_MAP[el.dashStyle] : undefined;

  // Determine head/tail arrows — use parsed data, fall back to legacy shapeType
  const headArrow: ArrowHead | undefined = el.headArrow;
  const tailArrow: ArrowHead | undefined =
    el.tailArrow ?? (el.shapeType === "arrow" && !el.headArrow
      ? { type: "triangle" }
      : undefined);

  const hasHead = !!headArrow;
  const hasTail = !!tailArrow;

  // Generate unique IDs to avoid marker collisions on the same slide
  const idSuffix = ++lineMarkerCounter;
  const headMarkerId = `arrow-head-${idSuffix}`;
  const tailMarkerId = `arrow-tail-${idSuffix}`;

  // Compute marker dimensions
  const headW = hasHead ? arrowSize(headArrow!.width) : 0;
  const headH = hasHead ? arrowSize(headArrow!.length) : 0;
  const tailW = hasTail ? arrowSize(tailArrow!.width) : 0;
  const tailH = hasTail ? arrowSize(tailArrow!.length) : 0;

  return (
    <svg
      style={{
        position: "absolute",
        left: px(el.x),
        top: px(el.y),
        width: Math.max(w, 2),
        height: Math.max(h, 2),
        overflow: "visible",
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
      }}
    >
      {(hasHead || hasTail) && (
        <defs>
          {hasHead && (
            <marker
              id={headMarkerId}
              markerWidth={headW}
              markerHeight={headH}
              refX={0}
              refY={headH / 2}
              orient="auto-start-reverse"
            >
              {arrowMarkerShape(headArrow!, strokeColor, headW, headH)}
            </marker>
          )}
          {hasTail && (
            <marker
              id={tailMarkerId}
              markerWidth={tailW}
              markerHeight={tailH}
              refX={tailW}
              refY={tailH / 2}
              orient="auto"
            >
              {arrowMarkerShape(tailArrow!, strokeColor, tailW, tailH)}
            </marker>
          )}
        </defs>
      )}
      <line
        x1={0}
        y1={0}
        x2={w || 1}
        y2={h || 0}
        stroke={strokeColor}
        strokeWidth={sw}
        strokeDasharray={dashArray}
        markerStart={hasHead ? `url(#${headMarkerId})` : undefined}
        markerEnd={hasTail ? `url(#${tailMarkerId})` : undefined}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

/** Convert a cell fill (string hex, PptxFill, or null) to CSS properties */
function cellFillStyle(fill: string | PptxFill | null): CSSProperties {
  if (!fill) return {};
  if (typeof fill === "string") return { backgroundColor: fill };
  return fillToCSS(fill);
}

/** Resolve the applicable table style part for a cell based on its position.
 *  Priority: firstRow/lastRow/firstCol/lastCol > band > wholeTbl */
function resolveTableStylePart(
  el: PptxTable,
  ri: number,
  ci: number,
  rowCount: number,
): PptxTableStylePart | null {
  const style = el.style;
  if (!style) return null;

  if (ri === 0 && el.firstRow && style.firstRow) return style.firstRow;
  if (ri === rowCount - 1 && el.lastRow && style.lastRow) return style.lastRow;
  if (ci === 0 && el.firstCol && style.firstCol) return style.firstCol;

  if (el.bandRow) {
    const bandIndex = el.firstRow ? ri - 1 : ri;
    if (bandIndex >= 0) {
      if (bandIndex % 2 === 0 && style.band1H) return style.band1H;
      if (bandIndex % 2 === 1 && style.band2H) return style.band2H;
    }
  }
  if (el.bandCol) {
    const bandIndex = el.firstCol ? ci - 1 : ci;
    if (bandIndex >= 0) {
      if (bandIndex % 2 === 0 && style.band1V) return style.band1V;
      if (bandIndex % 2 === 1 && style.band2V) return style.band2V;
    }
  }

  if (style.wholeTbl) return style.wholeTbl;
  return null;
}

function TableRenderer({
  el,
  px,
  onSlideNavigate,
}: {
  el: PptxTable;
  px: (n: number) => number;
  onSlideNavigate?: (slideIndex: number) => void;
}) {
  const rowCount = el.rows.length;

  return (
    <div style={{ ...positionStyle(el, px), overflow: "visible" }}>
      <table
        style={{
          width: px(el.width),
          height: px(el.height),
          borderCollapse: "collapse",
          tableLayout: "fixed",
        }}
      >
        <tbody>
          {el.rows.map((row, ri) => (
            <tr key={ri} style={{ height: px(row.height) }}>
              {row.cells.map((cell, ci) => {
                // Skip merged-away cells
                if (cell.colspan === 0 || cell.rowspan === 0) return null;

                // Resolve style part from table style
                const stylePart = resolveTableStylePart(el, ri, ci, rowCount);

                // Cell-level fill overrides style fill
                const hasCellFill = cell.fill !== null;
                let fallbackFill: CSSProperties = {};
                if (!hasCellFill && !stylePart?.fill) {
                  // Generic banding fallback when no table style provides fills
                  if (el.bandRow && !el.style) {
                    const bandIndex = el.firstRow ? ri - 1 : ri;
                    if (bandIndex >= 0 && bandIndex % 2 === 1) fallbackFill = { backgroundColor: "#f3f4f6" };
                  }
                  if (el.bandCol && !el.style) {
                    const bandIndex = el.firstCol ? ci - 1 : ci;
                    if (bandIndex >= 0 && bandIndex % 2 === 1) fallbackFill = { backgroundColor: "#f3f4f6" };
                  }
                }
                const fillStyle = hasCellFill
                  ? cellFillStyle(cell.fill)
                  : stylePart?.fill
                    ? { backgroundColor: stylePart.fill }
                    : fallbackFill;

                // Text style from table style
                const textStyle: CSSProperties = {};
                if (stylePart?.bold) textStyle.fontWeight = "bold";
                if (stylePart?.italic) textStyle.fontStyle = "italic";
                if (stylePart?.fontColor) textStyle.color = stylePart.fontColor;

                return (
                  <td
                    key={ci}
                    colSpan={cell.colspan > 1 ? cell.colspan : undefined}
                    rowSpan={cell.rowspan > 1 ? cell.rowspan : undefined}
                    style={{
                      ...fillStyle,
                      borderLeft: cell.borders?.left
                        ? cell.borders.left.none ? 'none' : `${cell.borders.left.width}px ${cell.borders.left.dash ?? 'solid'} ${cell.borders.left.color}`
                        : cell.borders ? undefined : '1px solid #d1d5db',
                      borderRight: cell.borders?.right
                        ? cell.borders.right.none ? 'none' : `${cell.borders.right.width}px ${cell.borders.right.dash ?? 'solid'} ${cell.borders.right.color}`
                        : cell.borders ? undefined : '1px solid #d1d5db',
                      borderTop: cell.borders?.top
                        ? cell.borders.top.none ? 'none' : `${cell.borders.top.width}px ${cell.borders.top.dash ?? 'solid'} ${cell.borders.top.color}`
                        : cell.borders ? undefined : '1px solid #d1d5db',
                      borderBottom: cell.borders?.bottom
                        ? cell.borders.bottom.none ? 'none' : `${cell.borders.bottom.width}px ${cell.borders.bottom.dash ?? 'solid'} ${cell.borders.bottom.color}`
                        : cell.borders ? undefined : '1px solid #d1d5db',
                      padding: cell.margins
                        ? `${cell.margins.top}px ${cell.margins.right}px ${cell.margins.bottom}px ${cell.margins.left}px`
                        : '4px 6px',
                      verticalAlign: cell.verticalAlign ?? 'top',
                      fontSize: 12,
                      overflow: "hidden",
                      ...textStyle,
                    }}
                  >
                    <ParagraphsRenderer paragraphs={cell.paragraphs} onSlideNavigate={onSlideNavigate} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

function GroupRenderer({
  el,
  px,
  theme,
  onSlideNavigate,
}: {
  el: PptxGroup;
  px: (n: number) => number;
  theme: PptxPresentation["theme"];
  onSlideNavigate?: (slideIndex: number) => void;
}) {
  return (
    <div style={positionStyle(el, px)}>
      {el.children.map((child, i) => (
        <ElementRenderer key={i} element={child} theme={theme} onSlideNavigate={onSlideNavigate} />
      ))}
    </div>
  );
}

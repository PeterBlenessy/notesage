/**
 * Slide renderer orchestrator for the PPTX slide viewer.
 *
 * This file is intentionally lean — it handles slide-level concerns
 * (background, placeholder deduplication, master/layout/slide layer ordering)
 * and delegates element rendering to type-specific sub-renderers:
 *
 *   PptxTextRenderer  — TextBoxRenderer, ParagraphsRenderer
 *   PptxShapeRenderer — ShapeRenderer (rect/ellipse/preset/line/arrow)
 *   PptxTableRenderer — TableRenderer
 *   PptxChartRenderer — ChartRenderer
 *
 * Shared pure helpers (fillToCSS, positionStyle, etc.) live in PptxRenderUtils.
 *
 * Backward-compat re-exports: fillToCSS and formatBulletNumber are re-exported
 * here so existing test imports (`from "./PptxSlideRenderer"`) continue to work.
 */

import React, { useState, type CSSProperties } from "react";
import type {
  PptxSlide,
  PptxElement,
  PptxImage,
  PptxGroup,
  PptxBackground,
  PptxPresentation,
} from "@/lib/pptx-types";
import { ChartRenderer } from "./PptxChartRenderer";
import {
  fillToCSS,
  shadowToCSS,
  positionStyle,
  EMU_PER_PX,
} from "./PptxRenderUtils";
import { TextBoxRenderer } from "./PptxTextRenderer";
import { ShapeRenderer } from "./PptxShapeRenderer";
import { TableRenderer } from "./PptxTableRenderer";

// ---------------------------------------------------------------------------
// Re-exports for backward compatibility (tests import from this file)
// ---------------------------------------------------------------------------

export { fillToCSS, formatBulletNumber } from "./PptxRenderUtils";

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
// Background helper
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
// Image renderer
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

  // Inline import of wrapWithHyperlink to avoid circular dep (image is small enough)
  function wrapLink(content: React.ReactNode, hyperlink: string | undefined) {
    if (!hyperlink) return content;
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
    return <>{wrapLink(fallback, el.hyperlink)}</>;
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
    return <>{wrapLink(container, el.hyperlink)}</>;
  }

  const style: CSSProperties = { ...positionStyle(el, px), ...imgStyle };
  const img = <img src={el.dataUrl} alt="" style={style} onError={() => setImgError(true)} />;
  return <>{wrapLink(img, el.hyperlink)}</>;
}

// ---------------------------------------------------------------------------
// Group renderer
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


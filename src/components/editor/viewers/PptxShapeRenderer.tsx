/**
 * Shape rendering components for the PPTX slide viewer.
 *
 * Covers: rect, ellipse, roundRect, preset geometries (44 shapes), lines, and
 * arrows. Uses SVG path rendering for preset shapes and CSS for simple shapes.
 */

import type { CSSProperties, ReactNode } from "react";
import { Play, BarChart3, Box } from "lucide-react";
import type {
  PptxShape,
  PptxParagraph,
  ArrowHead,
} from "@/lib/pptx-types";
import { PRESET_GEOMETRIES } from "@/lib/pptx-preset-geometries";
import {
  bodyPropsToCSS,
  fillToCSS,
  shadowToCSS,
  positionStyle,
  wrapWithHyperlink,
  hexToRgb,
  colorWithAlpha,
  DASH_TO_BORDER_STYLE,
  SVG_DASH_MAP,
} from "./PptxRenderUtils";
import { ParagraphsRenderer } from "./PptxTextRenderer";

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
// Arrow helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Line / arrow renderer
// ---------------------------------------------------------------------------

// Monotonically increasing counter for unique SVG marker IDs
let lineMarkerCounter = 0;

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
// Shape renderer (main entry point for type === "shape")
// ---------------------------------------------------------------------------

export function ShapeRenderer({
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

import type { CSSProperties } from "react";
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
} from "@/lib/pptx-types";
import { ChartRenderer } from "./PptxChartRenderer";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMU_PER_PX = 9525; // 1 inch = 914400 EMU, 96 DPI

// ---------------------------------------------------------------------------
// Slide renderer
// ---------------------------------------------------------------------------

interface SlideRendererProps {
  slide: PptxSlide;
  theme: PptxPresentation["theme"];
}

export function SlideRenderer({ slide, theme }: SlideRendererProps) {
  return (
    <div className="w-full h-full relative" style={backgroundStyle(slide.background)}>
      {slide.elements.map((el, i) => (
        <ElementRenderer key={i} element={el} theme={theme} />
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
    return { ...base, backgroundImage: `url(${bg.imageDataUrl})`, backgroundSize: "cover" };
  }
  if (bg.fill) {
    return { ...base, ...fillToCSS(bg.fill) };
  }
  return base;
}

export function fillToCSS(fill: PptxFill): CSSProperties {
  switch (fill.type) {
    case "solid":
      return { backgroundColor: fill.color };
    case "linear":
      return {
        background: `linear-gradient(${fill.angle}deg, ${fill.stops.map((s) => `${s.color} ${s.position}%`).join(", ")})`,
      };
    case "radial":
      return {
        background: `radial-gradient(ellipse at center, ${fill.stops.map((s) => `${s.color} ${s.position}%`).join(", ")})`,
      };
    case "pattern":
      return { backgroundColor: fill.foreground };
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// Position helper
// ---------------------------------------------------------------------------

function positionStyle(
  el: { x: number; y: number; width: number; height: number; rotation?: number },
  px: (emu: number) => number,
): CSSProperties {
  return {
    position: "absolute",
    left: px(el.x),
    top: px(el.y),
    width: px(el.width),
    height: px(el.height),
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
  };
}

// ---------------------------------------------------------------------------
// Element dispatcher
// ---------------------------------------------------------------------------

function ElementRenderer({ element, theme }: { element: PptxElement; theme: PptxPresentation["theme"] }) {
  const px = (emu: number) => emu / EMU_PER_PX;

  switch (element.type) {
    case "textbox":
      return <TextBoxRenderer el={element} px={px} />;
    case "image":
      return <ImageRenderer el={element} px={px} />;
    case "shape":
      return <ShapeRenderer el={element} px={px} />;
    case "table":
      return <TableRenderer el={element} px={px} />;
    case "chart":
      return <ChartRenderer el={element} px={px} />;
    case "group":
      return <GroupRenderer el={element} px={px} theme={theme} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Text box
// ---------------------------------------------------------------------------

function TextBoxRenderer({ el, px }: { el: PptxTextBox; px: (n: number) => number }) {
  return (
    <div style={{ ...positionStyle(el, px), overflow: "hidden", padding: 4 }}>
      <ParagraphsRenderer paragraphs={el.paragraphs} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paragraphs (shared between text boxes, shapes, table cells)
// ---------------------------------------------------------------------------

export function ParagraphsRenderer({ paragraphs }: { paragraphs: PptxParagraph[] }) {
  return (
    <>
      {paragraphs.map((p, i) => (
        <div
          key={i}
          style={{
            textAlign: p.alignment,
            paddingLeft: p.bulletLevel ? p.bulletLevel * 20 : undefined,
            display: "flex",
            gap: p.bulletChar ? 4 : undefined,
          }}
        >
          {p.bulletChar && (
            <span style={{ flexShrink: 0 }}>{p.bulletChar}</span>
          )}
          <span>
            {p.runs.map((r, j) => (
              <span
                key={j}
                style={{
                  fontWeight: r.bold ? 700 : 400,
                  fontStyle: r.italic ? "italic" : "normal",
                  textDecoration: r.underline ? "underline" : "none",
                  fontSize: r.fontSize,
                  fontFamily: r.fontFamily,
                  color: r.color,
                  whiteSpace: "pre-wrap",
                }}
              >
                {r.text}
              </span>
            ))}
          </span>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

function ImageRenderer({ el, px }: { el: PptxImage; px: (n: number) => number }) {
  return (
    <img
      src={el.dataUrl}
      alt=""
      style={{
        ...positionStyle(el, px),
        objectFit: "contain",
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

function ShapeRenderer({ el, px }: { el: PptxShape; px: (n: number) => number }) {
  if (el.shapeType === "line" || el.shapeType === "arrow") {
    return <LineRenderer el={el} px={px} />;
  }

  const style: CSSProperties = {
    ...positionStyle(el, px),
    ...(el.fill ? fillToCSS(el.fill) : {}),
    border: el.stroke ? `${Math.max(1, el.strokeWidth)}px solid ${el.stroke}` : undefined,
    borderRadius: el.shapeType === "ellipse" ? "50%" : el.shapeType === "roundRect" ? 8 : undefined,
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
  };

  // Placeholder-style shapes (SmartArt, embedded objects, media)
  const isPlaceholder = el.shapeType === "other" && !el.fill && el.stroke;

  return (
    <div style={style}>
      {isPlaceholder ? (
        <div className="flex flex-col items-center gap-1 text-center">
          <PlaceholderIcon text={el.text} />
          <ParagraphsRenderer paragraphs={el.text} />
        </div>
      ) : (
        el.text.length > 0 && <ParagraphsRenderer paragraphs={el.text} />
      )}
    </div>
  );
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
// Line / arrow
// ---------------------------------------------------------------------------

function LineRenderer({ el, px }: { el: PptxShape; px: (n: number) => number }) {
  const w = px(el.width);
  const h = px(el.height);
  const strokeColor = el.stroke ?? "#000000";
  const sw = Math.max(1, el.strokeWidth);

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
      {el.shapeType === "arrow" && (
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill={strokeColor} />
          </marker>
        </defs>
      )}
      <line
        x1={0}
        y1={0}
        x2={w || 1}
        y2={h || 0}
        stroke={strokeColor}
        strokeWidth={sw}
        markerEnd={el.shapeType === "arrow" ? "url(#arrowhead)" : undefined}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function TableRenderer({ el, px }: { el: PptxTable; px: (n: number) => number }) {
  return (
    <div style={{ ...positionStyle(el, px), overflow: "hidden" }}>
      <table
        style={{
          width: "100%",
          height: "100%",
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
                return (
                  <td
                    key={ci}
                    colSpan={cell.colspan > 1 ? cell.colspan : undefined}
                    rowSpan={cell.rowspan > 1 ? cell.rowspan : undefined}
                    style={{
                      backgroundColor: cell.fill ?? undefined,
                      border: "1px solid #d1d5db",
                      padding: "4px 6px",
                      verticalAlign: "top",
                      fontSize: 12,
                      overflow: "hidden",
                    }}
                  >
                    <ParagraphsRenderer paragraphs={cell.paragraphs} />
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
}: {
  el: PptxGroup;
  px: (n: number) => number;
  theme: PptxPresentation["theme"];
}) {
  return (
    <div style={positionStyle(el, px)}>
      {el.children.map((child, i) => (
        <ElementRenderer key={i} element={child} theme={theme} />
      ))}
    </div>
  );
}

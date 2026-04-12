/**
 * Table rendering component for the PPTX slide viewer.
 *
 * Covers: table layout, cell styling (fills, borders, margins, vertical
 * alignment), colspan/rowspan, table style inheritance (firstRow, lastRow,
 * firstCol, band rows/columns), and paragraph rendering within cells.
 */

import type { CSSProperties } from "react";
import type {
  PptxTable,
  PptxFill,
  PptxTableStylePart,
} from "@/lib/pptx-types";
import { fillToCSS, positionStyle } from "./PptxRenderUtils";
import { ParagraphsRenderer } from "./PptxTextRenderer";

// ---------------------------------------------------------------------------
// Cell fill helper
// ---------------------------------------------------------------------------

/** Convert a cell fill (string hex, PptxFill, or null) to CSS properties */
function cellFillStyle(fill: string | PptxFill | null): CSSProperties {
  if (!fill) return {};
  if (typeof fill === "string") return { backgroundColor: fill };
  return fillToCSS(fill);
}

// ---------------------------------------------------------------------------
// Table style resolution
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Table renderer
// ---------------------------------------------------------------------------

export function TableRenderer({
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

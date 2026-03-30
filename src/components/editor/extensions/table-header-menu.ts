/**
 * Table Header Menu Extension — ProseMirror plugin for column configuration
 * context menu and type badge decorations on header cells.
 *
 * This extension:
 * 1. Intercepts right-click (contextmenu) events on `<th>` elements
 * 2. Dispatches a custom DOM event with cell position and attribute data
 *    so a React component can render a shadcn ContextMenu
 * 3. Renders type badge widget decorations at the end of header cell content
 *    (e.g., `#` for number, `$` for currency, `%` for percentage, calendar for date)
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { ColumnType } from "./table-column-types";

export const TableHeaderMenuPluginKey = new PluginKey("tableHeaderMenu");

// ---------------------------------------------------------------------------
// Custom event payload — consumed by the React <TableHeaderMenu> component
// ---------------------------------------------------------------------------

export interface TableHeaderMenuEventDetail {
  /** Absolute ProseMirror position of the tableHeader node */
  cellPos: number;
  /** Mouse X coordinate for positioning */
  x: number;
  /** Mouse Y coordinate for positioning */
  y: number;
  /** Current column attributes */
  colType: ColumnType;
  colCurrency: string | null;
  colAggregation: string | null;
}

export const TABLE_HEADER_MENU_EVENT = "notesage:table-header-menu";

// ---------------------------------------------------------------------------
// Type badge labels
// ---------------------------------------------------------------------------

const TYPE_BADGE_LABELS: Record<string, string> = {
  number: "#",
  currency: "$",
  percentage: "%",
  date: "\u2630", // ☰ → using a small calendar-like symbol (trigram for heaven)
};

/** Map currency code to a display symbol for the badge. */
function currencySymbol(code: string | null): string {
  if (!code) return "$";
  const symbols: Record<string, string> = {
    USD: "$",
    EUR: "\u20AC",
    GBP: "\u00A3",
    SEK: "kr",
    JPY: "\u00A5",
    CNY: "\u00A5",
    KRW: "\u20A9",
    INR: "\u20B9",
    CAD: "C$",
    AUD: "A$",
    CHF: "Fr",
    NOK: "kr",
    DKK: "kr",
    BRL: "R$",
    MXN: "Mex$",
    THB: "\u0E3F",
    TRY: "\u20BA",
    RUB: "\u20BD",
  };
  return symbols[code] ?? code;
}

// ---------------------------------------------------------------------------
// Build type badge decorations for all header cells with non-text types
// ---------------------------------------------------------------------------

function buildTypeBadgeDecorations(state: EditorState): DecorationSet {
  const decorations: Decoration[] = [];
  const { doc } = state;

  doc.descendants((node, pos) => {
    if (node.type.name !== "table") return true;

    // Walk table rows looking for the header row
    node.forEach((row, rowOffset) => {
      row.forEach((cell, cellOffset) => {
        if (cell.type.name !== "tableHeader") return;

        const colType = (cell.attrs.colType as ColumnType) || "text";
        if (colType === "text") return;

        const cellPos = pos + 1 + rowOffset + 1 + cellOffset + 1;
        // Place the widget at the end of the cell's content
        const widgetPos = cellPos + cell.content.size;

        let badgeText: string;
        if (colType === "currency") {
          badgeText = currencySymbol(cell.attrs.colCurrency as string | null);
        } else {
          badgeText = TYPE_BADGE_LABELS[colType] ?? "";
        }

        if (!badgeText) return;

        const widget = Decoration.widget(widgetPos, () => {
          const span = document.createElement("span");
          span.className = "th-type-badge";
          span.setAttribute("data-col-type", colType);
          span.textContent = badgeText;
          span.contentEditable = "false";
          return span;
        }, { side: 1, key: `type-badge-${cellPos}` });

        decorations.push(widget);
      });
    });

    return false; // don't descend into table children (we already walked them)
  });

  return DecorationSet.create(doc, decorations);
}

// ---------------------------------------------------------------------------
// Context menu handler — find the header cell position from a right-click
// ---------------------------------------------------------------------------

function findHeaderCellPos(
  view: EditorView,
  target: HTMLElement,
): { cellPos: number; node: ReturnType<typeof view.state.doc.nodeAt> } | null {
  // Walk up to find the <th> element
  let th: HTMLElement | null = target;
  while (th && th.tagName !== "TH") {
    th = th.parentElement;
    // Don't walk outside the editor
    if (th === view.dom || !th) return null;
  }
  if (!th) return null;

  // Get the ProseMirror position from the DOM node
  const pos = view.posAtDOM(th, 0);
  if (pos == null) return null;

  // Resolve to find the tableHeader node
  const $pos = view.state.doc.resolve(pos);
  // Walk up to find the tableHeader node position
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === "tableHeader") {
      return { cellPos: $pos.before(depth), node };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tiptap extension
// ---------------------------------------------------------------------------

export const TableHeaderMenu = Extension.create({
  name: "tableHeaderMenu",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: TableHeaderMenuPluginKey,

        state: {
          init(_, state) {
            return { decorations: buildTypeBadgeDecorations(state) };
          },
          apply(tr, value, _oldState, newState) {
            if (tr.docChanged) {
              return { decorations: buildTypeBadgeDecorations(newState) };
            }
            // Also rebuild if metadata was set via setMeta
            if (tr.getMeta(TableHeaderMenuPluginKey)?.rebuildBadges) {
              return { decorations: buildTypeBadgeDecorations(newState) };
            }
            return { decorations: value.decorations.map(tr.mapping, tr.doc) };
          },
        },

        props: {
          decorations(state) {
            return this.getState(state)?.decorations ?? DecorationSet.empty;
          },

          handleDOMEvents: {
            contextmenu(view: EditorView, event: Event) {
              const mouseEvent = event as MouseEvent;
              const target = mouseEvent.target as HTMLElement;
              if (!target) return false;

              const result = findHeaderCellPos(view, target);
              if (!result) return false;

              const { cellPos, node } = result;
              if (!node) return false;

              // Prevent the default browser context menu
              mouseEvent.preventDefault();
              mouseEvent.stopPropagation();

              // Dispatch custom event for the React component to pick up
              const detail: TableHeaderMenuEventDetail = {
                cellPos,
                x: mouseEvent.clientX,
                y: mouseEvent.clientY,
                colType: (node.attrs.colType as ColumnType) || "text",
                colCurrency: (node.attrs.colCurrency as string) || null,
                colAggregation: (node.attrs.colAggregation as string) || null,
              };

              window.dispatchEvent(
                new CustomEvent(TABLE_HEADER_MENU_EVENT, { detail }),
              );

              return true;
            },
          },
        },
      }),
    ];
  },
});

/**
 * Table Sort Extension — visual sort indicators and click-to-sort on header cells.
 *
 * Adds ▲/▼ widget decorations to tableHeader nodes based on a transient
 * `colSortDirection` attribute (not persisted to markdown). Clicking on the
 * sort indicator cycles through: null → 'asc' → 'desc' → null.
 *
 * The sort operation reorders table body rows by comparing cell text content
 * in the target column, using locale-aware natural sorting.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";

export const TableSortPluginKey = new PluginKey("tableSort");

type SortDirection = "asc" | "desc" | null;

/** Plugin state: tracks which header cell position the mouse is hovering over. */
interface TableSortState {
  hoveredHeaderPos: number | null;
  decorations: DecorationSet;
}

// ── Sort logic ───────────────────────────────────────────────────────

/**
 * Sort a table by a column index. Sets `colSortDirection` on the clicked
 * header cell and reorders body rows accordingly.
 *
 * Exported for external use (e.g. context menu sort actions).
 */
export function sortTableByColumn(
  view: EditorView,
  tablePos: number,
  columnIndex: number,
  direction: SortDirection,
): void {
  const { state } = view;
  const tableNode = state.doc.nodeAt(tablePos);
  if (!tableNode || tableNode.type.name !== "table") return;

  // Phase 1: Update header cell attributes
  let tr = state.tr;
  const headerRow = tableNode.child(0);
  const headerRowStart = tablePos + 1 + 1; // past table open + row open

  headerRow.forEach((cell, offset, index) => {
    const cellPos = headerRowStart + offset;
    const newDir = index === columnIndex ? direction : null;
    const currentDir = (cell.attrs.colSortDirection as string | null) ?? null;
    if (currentDir !== newDir) {
      tr.setNodeMarkup(cellPos, undefined, {
        ...cell.attrs,
        colSortDirection: newDir,
      });
    }
  });

  // If clearing sort, just dispatch attribute changes
  if (direction === null || tableNode.childCount < 3) {
    view.dispatch(tr);
    return;
  }

  // Phase 2: Collect and sort body rows
  const bodyRowNodes: PMNode[] = [];
  const sortKeys: string[] = [];
  for (let i = 1; i < tableNode.childCount; i++) {
    const row = tableNode.child(i);
    bodyRowNodes.push(row);
    const cell =
      columnIndex < row.childCount ? row.child(columnIndex) : null;
    sortKeys.push(cell ? cell.textContent.trim() : "");
  }

  // Build sorted index array
  const indices = bodyRowNodes.map((_, i) => i);
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  const multiplier = direction === "asc" ? 1 : -1;
  indices.sort(
    (a, b) => multiplier * collator.compare(sortKeys[a], sortKeys[b]),
  );

  // Skip reordering if already in the right order
  if (indices.every((val, i) => val === i)) {
    view.dispatch(tr);
    return;
  }

  // Dispatch attribute changes first so positions are stable
  view.dispatch(tr);

  // Phase 3: Reorder body rows in a second transaction
  const newState = view.state;
  const newTableNode = newState.doc.nodeAt(tablePos);
  if (!newTableNode || newTableNode.type.name !== "table") return;

  tr = newState.tr;

  // Calculate the range covering all body rows
  let bodyStart = tablePos + 1; // past table open
  bodyStart += newTableNode.child(0).nodeSize; // past header row

  let bodyEnd = bodyStart;
  for (let i = 1; i < newTableNode.childCount; i++) {
    bodyEnd += newTableNode.child(i).nodeSize;
  }

  // Build sorted row fragment and replace
  const sortedRows = indices.map((idx) => bodyRowNodes[idx]);
  tr.replaceWith(bodyStart, bodyEnd, Fragment.from(sortedRows));

  view.dispatch(tr);
}

// ── Decoration builder ───────────────────────────────────────────────

function buildSortDecorations(
  state: EditorState,
  hoveredHeaderPos: number | null,
): DecorationSet {
  const decorations: Decoration[] = [];

  state.doc.descendants((node, pos) => {
    if (node.type.name !== "table") return;

    // Only examine the first row (header row)
    const headerRow = node.child(0);
    const headerRowStart = pos + 1 + 1; // table open + row open

    headerRow.forEach((cell, offset) => {
      if (cell.type.name !== "tableHeader") return;

      const cellPos = headerRowStart + offset;
      const cellEndPos = cellPos + cell.nodeSize;
      const direction = (cell.attrs.colSortDirection as SortDirection) ?? null;

      // Always render an indicator to reserve space and prevent layout shift
      if (direction === "asc" || direction === "desc") {
        const arrow = direction === "asc" ? "\u25B2" : "\u25BC";
        decorations.push(
          Decoration.widget(
            cellEndPos - 1,
            () => createIndicatorSpan(arrow, direction, false),
            { side: 1, key: `sort-${cellPos}-${direction}` },
          ),
        );
      } else {
        // Placeholder arrow — always present, visible only on hover
        const isHovered = hoveredHeaderPos !== null && cellPos === hoveredHeaderPos;
        decorations.push(
          Decoration.widget(
            cellEndPos - 1,
            () => createIndicatorSpan("\u25B2", "placeholder", !isHovered),
            { side: 1, key: `sort-placeholder-${cellPos}` },
          ),
        );
      }
    });

    return false; // don't descend into table children
  });

  return decorations.length > 0
    ? DecorationSet.create(state.doc, decorations)
    : DecorationSet.empty;
}

function createIndicatorSpan(
  arrow: string,
  direction: string,
  _isHint: boolean,
): HTMLElement {
  const span = document.createElement("span");
  span.className = "table-sort-indicator";
  span.dataset.direction = direction;
  span.textContent = arrow;
  span.setAttribute("contenteditable", "false");
  return span;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Find the table node that contains a given position. */
function findTableAround(
  state: EditorState,
  pos: number,
): { tablePos: number } | null {
  const $pos = state.doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 0; depth--) {
    if ($pos.node(depth).type.name === "table") {
      return { tablePos: $pos.before(depth) };
    }
  }
  return null;
}

/** Get the column index of a header cell within its parent row. */
function getColumnIndex(state: EditorState, cellPos: number): number {
  const $pos = state.doc.resolve(cellPos);
  const row = $pos.parent;
  const rowStart = $pos.start($pos.depth);
  let offset = 0;
  for (let i = 0; i < row.childCount; i++) {
    if (rowStart + offset === cellPos) return i;
    offset += row.child(i).nodeSize;
  }
  return 0;
}

/** Find the header cell ProseMirror position from a DOM event target. */
function findHeaderCellAtEvent(
  view: EditorView,
  event: Event,
): number | null {
  const target = event.target as HTMLElement;
  const th = target.closest("th");
  if (!th) return null;

  const pos = view.posAtDOM(th, 0);
  if (pos < 0) return null;

  const $pos = view.state.doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 0; depth--) {
    if ($pos.node(depth).type.name === "tableHeader") {
      return $pos.before(depth);
    }
  }
  return null;
}

// ── Extension ────────────────────────────────────────────────────────

export const TableSort = Extension.create({
  name: "tableSort",

  addGlobalAttributes() {
    return [
      {
        types: ["tableHeader"],
        attributes: {
          colSortDirection: {
            default: null,
            // Transient — not rendered to DOM or serialized
            renderHTML: () => ({}),
            parseHTML: () => null,
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: TableSortPluginKey,

        state: {
          init(_, state): TableSortState {
            return {
              hoveredHeaderPos: null,
              decorations: buildSortDecorations(state, null),
            };
          },
          apply(tr, value, _oldState, newState): TableSortState {
            const meta = tr.getMeta(TableSortPluginKey) as
              | { hoveredHeaderPos?: number | null }
              | undefined;

            const hoveredHeaderPos =
              meta?.hoveredHeaderPos !== undefined
                ? meta.hoveredHeaderPos
                : value.hoveredHeaderPos;

            if (tr.docChanged || meta?.hoveredHeaderPos !== undefined) {
              return {
                hoveredHeaderPos,
                decorations: buildSortDecorations(newState, hoveredHeaderPos),
              };
            }

            return value;
          },
        },

        props: {
          decorations(state) {
            const pluginState = this.getState(state) as
              | TableSortState
              | undefined;
            return pluginState?.decorations ?? DecorationSet.empty;
          },

          handleDOMEvents: {
            mouseover(view, event) {
              const target = (event as Event).target as HTMLElement;
              const th = target.closest("th");

              if (!th) {
                // Mouse left header area — clear hover
                const current = TableSortPluginKey.getState(
                  view.state,
                ) as TableSortState | undefined;
                if (current?.hoveredHeaderPos !== null) {
                  view.dispatch(
                    view.state.tr.setMeta(TableSortPluginKey, {
                      hoveredHeaderPos: null,
                    }),
                  );
                }
                return false;
              }

              const cellPos = findHeaderCellAtEvent(view, event);
              if (cellPos === null) return false;

              const current = TableSortPluginKey.getState(
                view.state,
              ) as TableSortState | undefined;
              if (current?.hoveredHeaderPos !== cellPos) {
                view.dispatch(
                  view.state.tr.setMeta(TableSortPluginKey, {
                    hoveredHeaderPos: cellPos,
                  }),
                );
              }
              return false;
            },

            mouseout(view, event) {
              const related = (event as MouseEvent).relatedTarget as
                | HTMLElement
                | null;
              if (related?.closest("th")) return false;

              const current = TableSortPluginKey.getState(
                view.state,
              ) as TableSortState | undefined;
              if (current?.hoveredHeaderPos !== null) {
                view.dispatch(
                  view.state.tr.setMeta(TableSortPluginKey, {
                    hoveredHeaderPos: null,
                  }),
                );
              }
              return false;
            },
          },

          handleClickOn(view, _pos, _node, _nodePos, event) {
            // Only respond to clicks on the sort indicator itself
            const target = event.target as HTMLElement;
            if (!target.classList.contains("table-sort-indicator")) {
              return false;
            }

            event.preventDefault();

            const cellPos = findHeaderCellAtEvent(view, event);
            if (cellPos === null) return false;

            const cellNode = view.state.doc.nodeAt(cellPos);
            if (!cellNode || cellNode.type.name !== "tableHeader") return false;

            // Cycle: null → asc → desc → null
            const currentDir =
              (cellNode.attrs.colSortDirection as SortDirection) ?? null;
            const newDir: SortDirection =
              currentDir === null
                ? "asc"
                : currentDir === "asc"
                  ? "desc"
                  : null;

            const colIndex = getColumnIndex(view.state, cellPos);
            const tableInfo = findTableAround(view.state, cellPos);
            if (!tableInfo) return false;

            sortTableByColumn(view, tableInfo.tablePos, colIndex, newDir);
            return true;
          },
        },
      }),
    ];
  },
});

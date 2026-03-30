import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Transaction, EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/core";

export const tableFilterPluginKey = new PluginKey("tableFilter");

interface TableFilterState {
  active: boolean;
  query: string;
  tablePos: number | null;
}

const EMPTY_STATE: TableFilterState = {
  active: false,
  query: "",
  tablePos: null,
};

interface PluginState {
  filter: TableFilterState;
  decorations: DecorationSet;
}

/**
 * Find the table node at or containing the given resolved position.
 * Returns the position of the table node, or null if not inside a table.
 */
function findTablePos(state: EditorState): number | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth >= 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "table") {
      return $from.before(depth);
    }
  }
  return null;
}

/**
 * Build decorations for the table filter:
 * 1. A widget decoration for the filter input row (after the header row)
 * 2. Node decorations to hide non-matching data rows
 */
function buildDecorations(
  doc: EditorState["doc"],
  filter: TableFilterState
): DecorationSet {
  if (!filter.active || filter.tablePos === null) {
    return DecorationSet.empty;
  }

  const tableNode = doc.nodeAt(filter.tablePos);
  if (!tableNode || tableNode.type.name !== "table") {
    return DecorationSet.empty;
  }

  const decorations: Decoration[] = [];
  const query = filter.query.toLowerCase();

  // Walk table rows — first row is header, rest are data rows
  let rowIndex = 0;
  let offsetInTable = 0;

  tableNode.forEach((rowNode, rowOffset) => {
    const rowAbsPos = filter.tablePos! + 1 + rowOffset;

    if (rowIndex === 0) {
      // After the header row, insert the filter input widget
      const widgetPos = rowAbsPos + rowNode.nodeSize;
      const currentQuery = filter.query;
      decorations.push(
        Decoration.widget(
          widgetPos,
          (view: EditorView) => {
            const wrapper = document.createElement("div");
            wrapper.className = "table-filter-row";
            const input = document.createElement("input");
            input.className = "table-filter-input";
            input.placeholder = "Filter rows...";
            input.value = currentQuery;
            input.addEventListener("input", (e) => {
              const newQuery = (e.target as HTMLInputElement).value;
              view.dispatch(
                view.state.tr.setMeta(tableFilterPluginKey, {
                  type: "setQuery",
                  query: newQuery,
                })
              );
            });
            input.addEventListener("keydown", (e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                view.dispatch(
                  view.state.tr.setMeta(tableFilterPluginKey, {
                    type: "clear",
                  })
                );
                view.focus();
              }
            });
            // Prevent ProseMirror from handling events in the input
            input.addEventListener("mousedown", (e) => e.stopPropagation());
            wrapper.appendChild(input);

            // Auto-focus the input when it appears
            requestAnimationFrame(() => input.focus());

            return wrapper;
          },
          { side: 1 }
        )
      );
    } else if (query) {
      // Data row — check if any cell text matches the query
      let rowMatches = false;
      rowNode.forEach((cellNode) => {
        if (rowMatches) return;
        const cellText = cellNode.textContent.toLowerCase();
        if (cellText.includes(query)) {
          rowMatches = true;
        }
      });

      if (!rowMatches) {
        const rowEnd = rowAbsPos + rowNode.nodeSize;
        decorations.push(
          Decoration.node(rowAbsPos, rowEnd, {
            style: "display: none",
          })
        );
      }
    }

    rowIndex++;
    offsetInTable += rowNode.nodeSize;
  });

  if (decorations.length === 0) return DecorationSet.empty;
  return DecorationSet.create(doc, decorations);
}

export const TableFilter = Extension.create({
  name: "tableFilter",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: tableFilterPluginKey,
        state: {
          init(): PluginState {
            return { filter: EMPTY_STATE, decorations: DecorationSet.empty };
          },
          apply(tr: Transaction, value: PluginState): PluginState {
            const meta = tr.getMeta(tableFilterPluginKey);

            if (meta?.type === "clear") {
              return {
                filter: EMPTY_STATE,
                decorations: DecorationSet.empty,
              };
            }

            if (meta?.type === "toggle") {
              const tablePos = meta.tablePos as number | null;
              if (value.filter.active && value.filter.tablePos === tablePos) {
                // Deactivate
                return {
                  filter: EMPTY_STATE,
                  decorations: DecorationSet.empty,
                };
              }
              // Activate for this table
              const filter: TableFilterState = {
                active: true,
                query: "",
                tablePos,
              };
              return {
                filter,
                decorations: buildDecorations(tr.doc, filter),
              };
            }

            if (meta?.type === "setQuery") {
              const filter: TableFilterState = {
                ...value.filter,
                query: meta.query as string,
              };
              return {
                filter,
                decorations: buildDecorations(tr.doc, filter),
              };
            }

            // On document change, rebuild decorations if filter is active
            if (tr.docChanged && value.filter.active) {
              // Remap the table position through the transaction mapping
              let newTablePos = value.filter.tablePos;
              if (newTablePos !== null) {
                newTablePos = tr.mapping.map(newTablePos);
                // Verify the node at the new position is still a table
                const node = tr.doc.nodeAt(newTablePos);
                if (!node || node.type.name !== "table") {
                  return {
                    filter: EMPTY_STATE,
                    decorations: DecorationSet.empty,
                  };
                }
              }
              const filter: TableFilterState = {
                ...value.filter,
                tablePos: newTablePos,
              };
              return {
                filter,
                decorations: buildDecorations(tr.doc, filter),
              };
            }

            return value;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

/**
 * Toggle the table filter for the table at the current cursor position.
 */
export function toggleTableFilter(editor: Editor): void {
  const tablePos = findTablePos(editor.state);
  if (tablePos === null) return;

  const { tr } = editor.state;
  tr.setMeta(tableFilterPluginKey, { type: "toggle", tablePos });
  editor.view.dispatch(tr);
}

/**
 * Clear the table filter and hide the filter row.
 */
export function clearTableFilter(editor: Editor): void {
  const { tr } = editor.state;
  tr.setMeta(tableFilterPluginKey, { type: "clear" });
  editor.view.dispatch(tr);
}

/**
 * Read the current table filter state from the editor state.
 */
export function getTableFilterState(
  state: EditorState
): TableFilterState | null {
  const pluginState = tableFilterPluginKey.getState(state) as
    | PluginState
    | undefined;
  if (!pluginState) return null;
  return pluginState.filter;
}

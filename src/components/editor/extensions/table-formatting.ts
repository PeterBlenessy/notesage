/**
 * Table Formatting Plugin — STUB
 *
 * ProseMirror plugin that decorates typed table cells with formatted display values.
 * The document stores raw values; the decoration layer shows formatted text
 * (e.g., `42000` → `$42,000.00` for currency columns).
 *
 * When the user focuses a cell to edit, the decoration is removed so the raw value
 * is shown for editing.
 *
 * Full decoration logic will be implemented after column metadata attributes (#1)
 * are integrated and tested end-to-end.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";

export const TableFormattingPluginKey = new PluginKey("tableFormatting");

/**
 * Tiptap extension wrapping the table formatting ProseMirror plugin.
 *
 * Currently a stub — registers the plugin key and an empty decoration set.
 * The decoration logic (reading column types from TableHeader attrs,
 * formatting cell text via number-format utilities, and removing decorations
 * on cell focus) will be added in a follow-up task.
 */
export const TableFormatting = Extension.create({
  name: "tableFormatting",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: TableFormattingPluginKey,

        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(_tr, decorations) {
            // TODO: Rebuild decorations when document changes or selection moves
            // 1. Find all tables in the document
            // 2. Read colType/colCurrency from TableHeader attrs for each column
            // 3. For each data cell in a typed column:
            //    - Parse the raw text with parseNumericValue / formatDateValue
            //    - Create an inline decoration with the formatted display text
            // 4. Skip the currently focused cell (show raw value for editing)
            return decorations;
          },
        },

        props: {
          decorations(state) {
            return TableFormattingPluginKey.getState(state) as DecorationSet;
          },
        },
      }),
    ];
  },
});

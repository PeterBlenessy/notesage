/**
 * Table Aggregation Extension
 *
 * Computes column aggregations (sum, avg, count, min, max) for tables and
 * renders a non-editable footer row via ProseMirror widget decorations.
 *
 * Column aggregation types are read from the `colAggregation`, `colType`,
 * and `colCurrency` attributes on TableHeader cells (defined in
 * `table-header-attrs.ts`).
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  parseNumericValue,
  parseDateValue,
  formatValue as formatNumericValue,
} from "@/lib/number-format";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AggregationType = "sum" | "avg" | "count" | "min" | "max" | "none";

export interface AggregationResult {
  colIndex: number;
  type: AggregationType;
  value: number;
  formattedValue: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Aggregation Engine
// ---------------------------------------------------------------------------

const AGGREGATION_LABELS: Record<Exclude<AggregationType, "none">, string> = {
  sum: "Sum:",
  avg: "Avg:",
  count: "Count:",
  min: "Min:",
  max: "Max:",
};

/**
 * Extract numeric values from a column of data rows (skipping header rows).
 * Uses `parseNumericValue` from `number-format` for robust parsing.
 */
function extractColumnValues(
  table: PMNode,
  colIndex: number,
  colType?: string,
): number[] {
  const values: number[] = [];

  for (let i = 0; i < table.childCount; i++) {
    const row = table.child(i);

    // Skip header rows (rows whose first cell is a tableHeader)
    const firstCell = row.childCount > 0 ? row.child(0) : null;
    if (firstCell && firstCell.type.name === "tableHeader") {
      continue;
    }

    if (colIndex >= row.childCount) continue;

    const cell = row.child(colIndex);
    const text = cell.textContent.trim();

    const num =
      colType === "date" ? parseDateValue(text) : parseNumericValue(text, colType);
    if (!isNaN(num) && isFinite(num)) {
      values.push(num);
    }
  }

  return values;
}

/**
 * Count non-empty cells in a column of data rows (skipping header rows).
 * Used for the "count" aggregation — counts all non-empty cells regardless
 * of whether they contain numeric values.
 */
function countNonEmptyCells(table: PMNode, colIndex: number): number {
  let count = 0;

  for (let i = 0; i < table.childCount; i++) {
    const row = table.child(i);

    // Skip header rows
    const firstCell = row.childCount > 0 ? row.child(0) : null;
    if (firstCell && firstCell.type.name === "tableHeader") {
      continue;
    }

    if (colIndex >= row.childCount) continue;

    const cell = row.child(colIndex);
    const text = cell.textContent.trim();
    if (text !== "") {
      count++;
    }
  }

  return count;
}

/**
 * Compute aggregation results for all columns in a table that have a
 * `colAggregation` attribute set on their header cell.
 */
export function computeAggregations(table: PMNode): AggregationResult[] {
  if (table.childCount === 0) return [];

  // Walk the first row to find header cells with aggregation config
  const headerRow = table.child(0);
  const results: AggregationResult[] = [];

  headerRow.forEach((cell, _offset, index) => {
    if (cell.type.name !== "tableHeader") return;

    const aggType = (cell.attrs.colAggregation as AggregationType | null) ?? null;
    if (!aggType || aggType === "none") return;

    const colType = (cell.attrs.colType as string) ?? "text";
    const colCurrency = (cell.attrs.colCurrency as string | null) ?? null;

    let value: number;

    if (aggType === "count") {
      // Count all non-empty cells (not just numeric ones)
      value = countNonEmptyCells(table, index);
    } else {
      const values = extractColumnValues(table, index, colType);

      switch (aggType) {
        case "sum":
          value = values.length > 0 ? values.reduce((a, b) => a + b, 0) : 0;
          break;
        case "avg":
          value = values.length > 0
            ? values.reduce((a, b) => a + b, 0) / values.length
            : NaN;
          break;
        case "min":
          value = values.length > 0 ? Math.min(...values) : NaN;
          break;
        case "max":
          value = values.length > 0 ? Math.max(...values) : NaN;
          break;
        default:
          return;
      }
    }

    // Format based on column type — "count" always uses plain number
    const displayType = aggType === "count" ? "number" : colType;
    const formattedValue = formatNumericValue(value, displayType, colCurrency);

    results.push({
      colIndex: index,
      type: aggType,
      value,
      formattedValue: formattedValue || String(value),
      label: AGGREGATION_LABELS[aggType],
    });
  });

  return results;
}

// ---------------------------------------------------------------------------
// ProseMirror Plugin — Footer Decoration
// ---------------------------------------------------------------------------

export const TableAggregationPluginKey = new PluginKey("tableAggregation");

/**
 * Get the total number of columns from the first row of the table.
 */
function getColumnCount(table: PMNode): number {
  if (table.childCount === 0) return 0;
  return table.child(0).childCount;
}

/**
 * Build a footer `<tr>` DOM element for the aggregation results.
 */
function buildFooterRow(
  results: AggregationResult[],
  colCount: number,
): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.className = "table-aggregation-footer";
  tr.contentEditable = "false";

  // Build a lookup from colIndex to result
  const resultMap = new Map<number, AggregationResult>();
  for (const r of results) {
    resultMap.set(r.colIndex, r);
  }

  for (let i = 0; i < colCount; i++) {
    const td = document.createElement("td");
    td.className = "table-aggregation-cell";

    const result = resultMap.get(i);
    if (result) {
      td.textContent = `${result.label} ${result.formattedValue}`;
    }

    tr.appendChild(td);
  }

  return tr;
}

/**
 * Build decorations for all tables in the document that have aggregations.
 */
function buildAggregationDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== "table") return;

    const results = computeAggregations(node);
    if (results.length === 0) return;

    const colCount = getColumnCount(node);
    if (colCount === 0) return;

    // Place the widget decoration at the end of the table node content.
    // The table node spans from `pos` to `pos + node.nodeSize`.
    // The content ends at `pos + node.nodeSize - 1` (before the closing token).
    const endOfTableContent = pos + node.nodeSize - 1;

    decorations.push(
      Decoration.widget(endOfTableContent, () => buildFooterRow(results, colCount), {
        side: 1,
        key: `table-agg-${pos}`,
        // Prevent ProseMirror from treating this as editable content
        ignoreSelection: true,
      }),
    );
  });

  if (decorations.length === 0) return DecorationSet.empty;
  return DecorationSet.create(doc, decorations);
}

// ---------------------------------------------------------------------------
// Tiptap Extension
// ---------------------------------------------------------------------------

export const TableAggregation = Extension.create({
  name: "tableAggregation",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: TableAggregationPluginKey,
        state: {
          init(_, state) {
            return buildAggregationDecorations(state.doc);
          },
          apply(tr, value) {
            // Only recompute when the document changes
            if (!tr.docChanged) return value;
            return buildAggregationDecorations(tr.doc);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

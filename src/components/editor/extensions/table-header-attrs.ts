/**
 * Extended TableHeader with column metadata attributes.
 *
 * Adds `colType`, `colCurrency`, `colAggregation`, and `colSortDirection`
 * attributes to the standard Tiptap TableHeader node. These are persisted
 * as `data-col-*` HTML attributes and serialized to markdown as HTML
 * comments in the header cell text (see `table-markdown.ts`).
 *
 * - `colType`: 'text' | 'number' | 'currency' | 'percent' | 'date'
 *   (default: 'text')
 * - `colCurrency`: ISO 4217 code (e.g. 'USD', 'EUR') or null
 * - `colAggregation`: 'sum' | 'avg' | 'min' | 'max' | 'count' or null
 * - `colSortDirection`: 'asc' | 'desc' or null — transient, NOT serialized
 */

import { TableHeader } from "@tiptap/extension-table-header";

export const TableHeaderWithAttrs = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      colType: {
        default: "text",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-col-type") || "text",
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.colType || attributes.colType === "text") return {};
          return { "data-col-type": attributes.colType };
        },
      },
      colCurrency: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-col-currency") || null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.colCurrency) return {};
          return { "data-col-currency": attributes.colCurrency };
        },
      },
      colAggregation: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-col-aggregation") || null,
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.colAggregation) return {};
          return { "data-col-aggregation": attributes.colAggregation };
        },
      },
      colSortDirection: {
        default: null,
        // Transient — not persisted to HTML or markdown
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
    };
  },
});

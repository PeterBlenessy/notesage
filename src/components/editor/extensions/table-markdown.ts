/**
 * Custom table markdown serializer override.
 *
 * The default tiptap-markdown table serializer falls back to HTML
 * serialization when any cell has more than one child (e.g. a paragraph
 * followed by a bullet list). This HTML output often fails to round-trip
 * correctly, corrupting the table on reload.
 *
 * This override keeps tables in GFM pipe syntax by flattening multi-block
 * cell content into inline text with <br> separators. List items are
 * prefixed with "•" for bullet lists and sequential numbers for ordered lists.
 *
 * Trade-off: list/block structure within cells is flattened to text in the
 * serialized markdown, but the table structure is preserved and round-trips
 * correctly. The editor still renders lists in cells while editing.
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

// ---------------------------------------------------------------------------
// Column metadata serialization
// ---------------------------------------------------------------------------

/** Attribute name → comment key mapping. */
const ATTR_TO_KEY: Record<string, string> = {
  colType: "type",
  colCurrency: "currency",
  colAggregation: "summary",
};

/** Default values for column metadata attrs. */
const ATTR_DEFAULTS: Record<string, unknown> = {
  colType: "text",
  colCurrency: null,
  colAggregation: null,
};

/**
 * Build a `<!-- key:value,key:value -->` comment string for a header cell's
 * non-default column metadata attributes. Returns an empty string if all
 * attributes are at their defaults.
 */
export function buildColumnMetadataComment(
  cell: ProseMirrorNode,
): string {
  const parts: string[] = [];

  for (const [attr, key] of Object.entries(ATTR_TO_KEY)) {
    const value = cell.attrs[attr] as unknown;
    const defaultValue = ATTR_DEFAULTS[attr];
    if (value !== defaultValue && value !== undefined && value !== null && value !== "") {
      parts.push(`${key}:${String(value)}`);
    }
  }

  if (parts.length === 0) return "";
  return ` <!-- ${parts.join(",")} -->`;
}

/**
 * Parse a `<!-- key:value,key:value -->` comment string into a map of
 * ProseMirror attribute names to values.
 */
export function parseColumnMetadataComment(
  comment: string,
): Record<string, string> {
  const KEY_TO_ATTR: Record<string, string> = {
    type: "colType",
    currency: "colCurrency",
    summary: "colAggregation",
  };

  const attrs: Record<string, string> = {};
  const pairs = comment.split(",");

  for (const pair of pairs) {
    const colonIdx = pair.indexOf(":");
    if (colonIdx < 0) continue;
    const key = pair.slice(0, colonIdx).trim();
    const value = pair.slice(colonIdx + 1).trim();
    const attrName = KEY_TO_ATTR[key];
    if (attrName && value) {
      attrs[attrName] = value;
    }
  }

  return attrs;
}

// ---------------------------------------------------------------------------
// Cell text collection
// ---------------------------------------------------------------------------

/**
 * Collect text content from a ProseMirror node, preserving block
 * structure as <br> separators and list items as bullet/numbered prefixes.
 */
function collectCellText(cell: ProseMirrorNode): string {
  const parts: string[] = [];

  cell.forEach((child) => {
    if (child.type.name === "paragraph") {
      const text = child.textContent.trim();
      if (text) parts.push(text);
    } else if (
      child.type.name === "bulletList" ||
      child.type.name === "taskList"
    ) {
      let idx = 0;
      child.forEach((item) => {
        const prefix =
          child.type.name === "taskList"
            ? item.attrs.checked
              ? "☑ "
              : "☐ "
            : "• ";
        const text = collectListItemText(item);
        if (text) parts.push(`${prefix}${text}`);
        idx++;
      });
    } else if (child.type.name === "orderedList") {
      let idx = 1;
      child.forEach((item) => {
        const text = collectListItemText(item);
        if (text) parts.push(`${idx}. ${text}`);
        idx++;
      });
    } else if (child.type.name === "blockquote") {
      parts.push(`> ${child.textContent.trim()}`);
    } else if (child.type.name === "codeBlock") {
      parts.push(`\`${child.textContent.trim()}\``);
    } else {
      const text = child.textContent.trim();
      if (text) parts.push(text);
    }
  });

  return parts.join("<br>");
}

function collectListItemText(item: ProseMirrorNode): string {
  const texts: string[] = [];
  item.forEach((child) => {
    const text = child.textContent.trim();
    if (text) texts.push(text);
  });
  return texts.join(" ");
}

function hasSpan(node: ProseMirrorNode): boolean {
  return (
    (node.attrs.colspan as number) > 1 || (node.attrs.rowspan as number) > 1
  );
}

/**
 * Check if a table can be serialized as simple GFM (single-paragraph cells,
 * no spans). If not, we use the enhanced serializer with <br> flattening.
 */
function isSimpleTable(node: ProseMirrorNode): boolean {
  let simple = true;
  node.forEach((row) => {
    row.forEach((cell) => {
      if (hasSpan(cell) || cell.childCount > 1) {
        simple = false;
      }
    });
  });
  return simple;
}

/**
 * Minimal view of tiptap-markdown's serializer state — only the members
 * `serializeTable` actually uses. tiptap-markdown exposes no public type
 * for it, so we type the surface we touch instead of `any`.
 */
interface SerializerState {
  inTable: boolean;
  write(content: string): void;
  renderInline(node: ProseMirrorNode): void;
  ensureNewLine(): void;
  closeBlock(node: ProseMirrorNode): void;
}

/**
 * Table markdown serializer — override for tiptap-markdown.
 *
 * Placed in `Table.extend({ addStorage })` so `getMarkdownSpec` picks it up
 * with higher priority than the default tiptap-markdown table serializer.
 */
export function serializeTable(
  state: SerializerState,
  node: ProseMirrorNode,
): void {
  state.inTable = true;

  if (isSimpleTable(node)) {
    // Simple table: use standard GFM pipe syntax (original behavior)
    node.forEach((row: ProseMirrorNode, _p: number, i: number) => {
      state.write("| ");
      row.forEach((col: ProseMirrorNode, _cp: number, j: number) => {
        if (j) state.write(" | ");
        const cellContent = col.firstChild;
        if (cellContent && cellContent.textContent.trim()) {
          state.renderInline(cellContent);
        }
        // Append column metadata comment for header cells (first row)
        if (i === 0 && col.type.name === "tableHeader") {
          const comment = buildColumnMetadataComment(col);
          if (comment) state.write(comment);
        }
      });
      state.write(" |");
      state.ensureNewLine();
      if (!i) {
        const delimiterRow = Array.from({ length: row.childCount })
          .map(() => "---")
          .join(" | ");
        state.write(`| ${delimiterRow} |`);
        state.ensureNewLine();
      }
    });
  } else {
    // Complex table: flatten multi-block cells to inline text with <br>
    node.forEach((row: ProseMirrorNode, _p: number, i: number) => {
      state.write("| ");
      row.forEach((col: ProseMirrorNode, _cp: number, j: number) => {
        if (j) state.write(" | ");
        if (col.childCount <= 1) {
          // Single-child cell: render inline as usual
          const cellContent = col.firstChild;
          if (cellContent && cellContent.textContent.trim()) {
            state.renderInline(cellContent);
          }
        } else {
          // Multi-block cell: flatten to text with <br> separators
          const text = collectCellText(col);
          // Escape pipe characters within cell content
          state.write(text.replace(/\|/g, "\\|"));
        }
        // Append column metadata comment for header cells (first row)
        if (i === 0 && col.type.name === "tableHeader") {
          const comment = buildColumnMetadataComment(col);
          if (comment) state.write(comment);
        }
      });
      state.write(" |");
      state.ensureNewLine();
      if (!i) {
        const delimiterRow = Array.from({ length: row.childCount })
          .map(() => "---")
          .join(" | ");
        state.write(`| ${delimiterRow} |`);
        state.ensureNewLine();
      }
    });
  }

  state.closeBlock(node);
  state.inTable = false;
}

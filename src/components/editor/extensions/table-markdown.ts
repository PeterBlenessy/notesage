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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SerializerState = any;

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

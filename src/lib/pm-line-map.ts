import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { getMarkdownFromEditor } from './markdown';

/**
 * A mapping from a markdown line to its corresponding ProseMirror node position range.
 */
export interface LineMapping {
  /** Start position of the block node in the PM document */
  pmFrom: number;
  /** End position of the block node in the PM document */
  pmTo: number;
}

/**
 * Internal representation of a block-level node collected from the PM document tree.
 */
export interface BlockEntry {
  pmFrom: number;
  pmTo: number;
  type: string;
  textContent: string;
}

/**
 * Build a mapping from 1-indexed markdown line numbers to ProseMirror document positions.
 *
 * Line numbers are 1-indexed to match git diff convention.
 * Empty lines and table separator lines are not mapped (they have no PM node).
 *
 * Note: This maps lines from the editor's serialized markdown (no frontmatter).
 * If comparing against a file that includes frontmatter, the caller must offset
 * line numbers by the number of frontmatter lines.
 */
export function buildLineMap(editor: Editor): Map<number, LineMapping> {
  const markdown = getMarkdownFromEditor(editor);
  const doc = editor.state.doc;
  return buildLineMapFromDoc(doc, markdown);
}

/**
 * Lower-level: build line map from a PM doc node and its markdown serialization.
 * Useful for testing without a full editor instance.
 */
export function buildLineMapFromDoc(doc: Node, markdown: string): Map<number, LineMapping> {
  const blocks = collectBlocks(doc);
  const lines = markdown.split('\n');
  return matchBlocksToLines(blocks, lines);
}

/**
 * Collect leaf-level block nodes from the PM document tree in document order.
 *
 * "Leaf blocks" are the nodes that directly correspond to markdown lines:
 * - paragraph (when direct child of doc or blockquote)
 * - heading (H1-H6)
 * - codeBlock (multi-line, maps to fence + content + fence)
 * - horizontalRule
 * - image
 * - listItem / taskItem (captured as a whole unit, not their inner paragraphs)
 * - tableRow (captured as a whole unit)
 *
 * Wrapper nodes (doc, lists, blockquotes, tables) are traversed but not captured.
 */
export function collectBlocks(doc: Node): BlockEntry[] {
  const blocks: BlockEntry[] = [];

  doc.descendants((node, pos) => {
    const name = node.type.name;

    // Headings: one markdown line each
    if (name === 'heading') {
      blocks.push({
        pmFrom: pos,
        pmTo: pos + node.nodeSize,
        type: name,
        textContent: node.textContent,
      });
      return false;
    }

    // Code blocks: multi-line (opening fence + content + closing fence)
    if (name === 'codeBlock') {
      blocks.push({
        pmFrom: pos,
        pmTo: pos + node.nodeSize,
        type: name,
        textContent: node.textContent,
      });
      return false;
    }

    // Leaf blocks without text content
    if (name === 'horizontalRule' || name === 'image') {
      blocks.push({
        pmFrom: pos,
        pmTo: pos + node.nodeSize,
        type: name,
        textContent: '',
      });
      return false;
    }

    // List items: capture the whole item (don't descend into inner paragraphs)
    if (name === 'listItem' || name === 'taskItem') {
      blocks.push({
        pmFrom: pos,
        pmTo: pos + node.nodeSize,
        type: name,
        textContent: node.textContent,
      });
      return false;
    }

    // Table rows: capture the whole row
    if (name === 'tableRow') {
      blocks.push({
        pmFrom: pos,
        pmTo: pos + node.nodeSize,
        type: name,
        textContent: node.textContent,
      });
      return false;
    }

    // Paragraphs: only reached when NOT inside a listItem/taskItem (those return false above)
    // This means we capture paragraphs that are direct children of doc, blockquote, etc.
    if (name === 'paragraph') {
      blocks.push({
        pmFrom: pos,
        pmTo: pos + node.nodeSize,
        type: name,
        textContent: node.textContent,
      });
      return false;
    }

    // Wrapper nodes: descend into children
    // (doc, bulletList, orderedList, taskList, blockquote, table)
    return true;
  });

  return blocks;
}

/**
 * Check if a markdown line is a non-content line that should be skipped during matching.
 * Non-content lines: empty lines, blockquote-only lines (e.g., ">"), table separator lines.
 */
export function isNonContentLine(line: string): boolean {
  const trimmed = line.trim();

  // Empty lines
  if (trimmed === '') return true;

  // Empty blockquote continuation lines: ">", "> >", ">>", etc.
  if (/^(>\s*)+$/.test(trimmed)) return true;

  // Table separator lines: | --- | --- | or |:---|---:| etc.
  if (/^\|[\s\-:]+(\|[\s\-:]+)*\|?\s*$/.test(trimmed)) return true;

  return false;
}

/**
 * Match an ordered list of PM block entries to markdown lines.
 *
 * Walks both lists in parallel:
 * - Skips non-content lines (empty, blockquote-only, table separators)
 * - For code blocks, consumes opening fence + content lines + closing fence
 * - For all other blocks, consumes one line per block
 *
 * Returns a Map from 1-indexed line number to the PM position range of the block.
 */
export function matchBlocksToLines(
  blocks: BlockEntry[],
  lines: string[]
): Map<number, LineMapping> {
  const map = new Map<number, LineMapping>();
  let blockIdx = 0;
  let lineIdx = 0;

  while (lineIdx < lines.length && blockIdx < blocks.length) {
    const line = lines[lineIdx];

    // Skip non-content lines
    if (isNonContentLine(line)) {
      lineIdx++;
      continue;
    }

    const block = blocks[blockIdx];
    const mapping: LineMapping = { pmFrom: block.pmFrom, pmTo: block.pmTo };

    if (block.type === 'codeBlock') {
      // Code block: opening fence (```lang), content lines, closing fence (```)
      // All lines map to the same PM node

      // Opening fence
      map.set(lineIdx + 1, mapping);
      lineIdx++;

      // Content lines: count from the node's text content
      const contentLineCount =
        block.textContent === '' ? 0 : block.textContent.split('\n').length;
      for (let i = 0; i < contentLineCount && lineIdx < lines.length; i++) {
        map.set(lineIdx + 1, mapping);
        lineIdx++;
      }

      // Closing fence
      if (lineIdx < lines.length) {
        map.set(lineIdx + 1, mapping);
        lineIdx++;
      }
    } else {
      // Single-line blocks: paragraph, heading, listItem, taskItem,
      // horizontalRule, image, tableRow
      map.set(lineIdx + 1, mapping);
      lineIdx++;
    }

    blockIdx++;
  }

  return map;
}

/**
 * Get the PM position range for a set of markdown line numbers.
 * Returns the union of all matched line ranges (min pmFrom, max pmTo).
 * Useful for mapping a diff hunk's line range to a single PM decoration range.
 *
 * @param lineMap - Map from buildLineMap
 * @param startLine - First line number (1-indexed, inclusive)
 * @param endLine - Last line number (1-indexed, inclusive)
 * @returns Combined position range, or null if no lines in range are mapped
 */
export function getPositionRangeForLines(
  lineMap: Map<number, LineMapping>,
  startLine: number,
  endLine: number
): LineMapping | null {
  let pmFrom = Infinity;
  let pmTo = -Infinity;
  let found = false;

  for (let line = startLine; line <= endLine; line++) {
    const mapping = lineMap.get(line);
    if (mapping) {
      pmFrom = Math.min(pmFrom, mapping.pmFrom);
      pmTo = Math.max(pmTo, mapping.pmTo);
      found = true;
    }
  }

  return found ? { pmFrom, pmTo } : null;
}

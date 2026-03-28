import DiffMatchPatch from "diff-match-patch";
import DOMPurify from "dompurify";
import type { Editor } from "@tiptap/core";
import { DOMParser as PMDOMParser, type Node as PMNode } from "@tiptap/pm/model";
import type { InlineDiffHunk } from "@/components/editor/extensions/inline-diff";

/**
 * A diff hunk with character offsets in the old text.
 * Used as an intermediate representation before mapping to ProseMirror positions.
 */
export interface ExternalDiffHunk {
  /** Unique identifier (e.g., "ext-hunk-0") */
  id: string;
  /** Start character offset in the old text (inclusive) */
  charFrom: number;
  /** End character offset in the old text (exclusive) */
  charTo: number;
  /** Text deleted from old (empty for pure insertions) */
  deleteText: string;
  /** Text inserted in new (empty for pure deletions) */
  insertText: string;
}

/**
 * Compute a word-level diff between two text strings.
 *
 * Uses diff-match-patch for character-level diffing, then applies
 * semantic cleanup to produce human-readable word-level hunks.
 * Returns hunks with character offsets relative to the old text.
 *
 * @param oldText - The original text content
 * @param newText - The new text content from disk
 * @returns Array of diff hunks, empty if texts are identical
 */
export function computeExternalDiff(
  oldText: string,
  newText: string,
): ExternalDiffHunk[] {
  if (oldText === newText) return [];

  const dmp = new DiffMatchPatch();
  const diffs = dmp.diff_main(oldText, newText);
  dmp.diff_cleanupSemantic(diffs);

  const hunks: ExternalDiffHunk[] = [];
  let oldPos = 0;
  let i = 0;

  while (i < diffs.length) {
    const [op, text] = diffs[i];

    if (op === 0) {
      // Equal segment: advance old-text position
      oldPos += text.length;
      i++;
      continue;
    }

    // Collect contiguous delete (-1) and insert (+1) segments as a single hunk.
    // A replacement shows up as a delete followed by an insert.
    let deleteText = "";
    let insertText = "";
    const hunkStart = oldPos;

    while (i < diffs.length && diffs[i][0] !== 0) {
      if (diffs[i][0] === -1) {
        deleteText += diffs[i][1];
        oldPos += diffs[i][1].length;
      } else {
        insertText += diffs[i][1];
      }
      i++;
    }

    hunks.push({
      id: `ext-hunk-${hunks.length}`,
      charFrom: hunkStart,
      charTo: hunkStart + deleteText.length,
      deleteText,
      insertText,
    });
  }

  return hunks;
}

// ---------------------------------------------------------------------------
// PM position mapping
// ---------------------------------------------------------------------------

interface TextWithPositions {
  /** Plain text extracted from the PM document, with '\n' between blocks. */
  text: string;
  /**
   * PM position for each character in `text`.
   * Block separator newlines get -1 (no single PM position).
   */
  pmPositions: number[];
}

/**
 * Walk a PM document and extract its text content with a position mapping.
 * Inserts '\n' between text blocks so diffs don't merge unrelated paragraphs.
 */
function buildTextWithPositions(doc: PMNode): TextWithPositions {
  const chars: string[] = [];
  const positions: number[] = [];
  let needSeparator = false;

  doc.descendants((node, pos) => {
    // Textblocks (paragraph, heading, codeBlock): add separator before the second+ block
    if (node.isTextblock) {
      if (needSeparator) {
        chars.push("\n");
        positions.push(-1);
      }
      needSeparator = true;
      return true; // descend to collect text nodes
    }

    // Text nodes: record each character's PM position
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        chars.push(node.text[i]);
        positions.push(pos + i);
      }
    }

    return true;
  });

  return { text: chars.join(""), pmPositions: positions };
}

/**
 * Parse a markdown string into a PM document using the editor's markdown parser.
 *
 * tiptap-markdown's parser.parse() returns an HTML string, not a PM Node.
 * We feed that HTML through ProseMirror's DOMParser to get a proper document.
 * Falls back to null if the parser is not available.
 */
function parseMarkdownToDoc(editor: Editor, markdown: string): PMNode | null {
  try {
    // tiptap-markdown stores the parser in editor.storage.markdown.parser
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mdStorage = (editor.storage as any).markdown as Record<string, unknown> | undefined;
    const parser = mdStorage?.parser as { parse: (content: string) => string } | undefined;
    if (parser) {
      const html = parser.parse(markdown);
      if (typeof html !== "string") return null;
      // Parse the HTML into a DOM element, then into a PM document
      const wrapper = document.createElement("div");
      wrapper.innerHTML = DOMPurify.sanitize(html);
      return PMDOMParser.fromSchema(editor.schema).parse(wrapper);
    }
  } catch {
    // Expected: markdown parser may be unavailable or fail on malformed content
  }
  return null;
}

/**
 * Map a single ExternalDiffHunk (character offsets) to an InlineDiffHunk (PM positions).
 * Returns null if the hunk can't be mapped (e.g., falls on a separator).
 */
function mapSingleHunk(
  hunk: ExternalDiffHunk,
  positions: number[],
): InlineDiffHunk | null {
  const len = positions.length;
  if (len === 0) return null;

  let pmFrom: number;
  let pmTo: number;

  if (hunk.charFrom === hunk.charTo) {
    // Pure insertion: anchor at the position of the character at charFrom,
    // or end of doc if at the very end.
    if (hunk.charFrom < len) {
      const pos = positions[hunk.charFrom];
      if (pos === -1) return null; // insertion at a separator — skip
      pmFrom = pos;
      pmTo = pos;
    } else {
      // Insertion at the very end of the text
      const lastPos = positions[len - 1];
      if (lastPos === -1) return null;
      pmFrom = lastPos + 1;
      pmTo = lastPos + 1;
    }
  } else {
    // Deletion or replacement: find the PM range for charFrom..charTo
    // Skip separator positions (-1) at the edges
    let fromIdx = hunk.charFrom;
    while (fromIdx < hunk.charTo && positions[fromIdx] === -1) fromIdx++;
    let toIdx = hunk.charTo - 1;
    while (toIdx > fromIdx && positions[toIdx] === -1) toIdx--;

    if (fromIdx > toIdx || positions[fromIdx] === -1) return null;

    pmFrom = positions[fromIdx];
    pmTo = positions[toIdx] + 1; // +1 because PM ranges are end-exclusive
  }

  return {
    id: hunk.id,
    from: pmFrom,
    to: pmTo,
    deleteText: hunk.deleteText,
    insertText: hunk.insertText,
  };
}

/**
 * Compute an external change diff and map it to ProseMirror positions.
 *
 * Works by extracting plain text (with block separators) from the old PM doc
 * (currently in the editor) and from the new content (parsed via the editor's
 * markdown parser), then diffing the two texts and mapping character offsets
 * back to PM positions.
 *
 * @param editor - The Tiptap editor instance (holds the old/current content)
 * @param newContent - New markdown content from disk
 * @returns InlineDiffHunk[] ready for showInlineDiff(), or empty if no diff
 */
export function mapExternalChangeToPM(
  editor: Editor,
  newContent: string,
): InlineDiffHunk[] {
  // Extract text and position mapping from the old (current) document
  const { text: oldText, pmPositions } = buildTextWithPositions(editor.state.doc);

  // Parse new markdown to PM doc and extract its text
  const newDoc = parseMarkdownToDoc(editor, newContent);
  if (!newDoc) {
    // Fallback: can't parse, return empty (caller should auto-accept)
    return [];
  }
  const { text: newText } = buildTextWithPositions(newDoc);

  // Diff the plain texts
  const textHunks = computeExternalDiff(oldText, newText);
  if (textHunks.length === 0) return [];

  // Map character offsets to PM positions
  const pmHunks: InlineDiffHunk[] = [];
  for (const hunk of textHunks) {
    const mapped = mapSingleHunk(hunk, pmPositions);
    if (mapped) {
      pmHunks.push(mapped);
    }
  }

  return pmHunks;
}

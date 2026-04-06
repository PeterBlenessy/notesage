import type { Node as PMNode } from '@tiptap/pm/model';

/**
 * Normalize whitespace: collapse runs of whitespace to a single space, trim.
 */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Build a mapping from normalized-string offsets to ProseMirror document positions.
 * Walks all text nodes in the document, concatenating their text with whitespace
 * normalization at node boundaries, and records the PM position for each character.
 */
function buildTextMap(doc: PMNode): { text: string; positions: number[] } {
  const chars: string[] = [];
  const positions: number[] = [];

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        chars.push(node.text[i]);
        positions.push(pos + i);
      }
    }
    return true;
  });

  // Normalize: collapse whitespace runs, tracking which original positions survive
  const normalizedChars: string[] = [];
  const normalizedPositions: number[] = [];
  let lastWasSpace = true; // treat start as "after space" to trim leading

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const isSpace = /\s/.test(ch);

    if (isSpace) {
      if (!lastWasSpace) {
        normalizedChars.push(' ');
        normalizedPositions.push(positions[i]);
      }
      lastWasSpace = true;
    } else {
      normalizedChars.push(ch);
      normalizedPositions.push(positions[i]);
      lastWasSpace = false;
    }
  }

  // Trim trailing space
  if (normalizedChars.length > 0 && normalizedChars[normalizedChars.length - 1] === ' ') {
    normalizedChars.pop();
    normalizedPositions.pop();
  }

  return { text: normalizedChars.join(''), positions: normalizedPositions };
}

/**
 * Find a text substring in a ProseMirror document, returning { from, to } positions.
 *
 * Handles text that spans multiple inline nodes (e.g., bold + plain),
 * normalizes whitespace for matching, and supports selecting the Nth occurrence.
 *
 * @param doc - ProseMirror document node
 * @param searchText - The text to find (exact substring, case-sensitive)
 * @param occurrence - Which occurrence to return (1-based, defaults to 1)
 * @returns Position range or null if not found
 */
export function findTextInDoc(
  doc: PMNode,
  searchText: string,
  occurrence = 1,
): { from: number; to: number } | null {
  if (!searchText || occurrence < 1) return null;

  const needle = normalizeWhitespace(searchText);
  if (!needle) return null;

  const { text, positions } = buildTextMap(doc);

  let found = 0;
  let startIdx = 0;

  while (startIdx <= text.length - needle.length) {
    const idx = text.indexOf(needle, startIdx);
    if (idx === -1) break;

    found++;
    if (found === occurrence) {
      const from = positions[idx];
      // 'to' is one past the last character of the match
      const lastCharIdx = idx + needle.length - 1;
      const to = positions[lastCharIdx] + 1;
      return { from, to };
    }

    startIdx = idx + 1;
  }

  return null;
}

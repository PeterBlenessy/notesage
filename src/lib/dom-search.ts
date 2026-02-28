/**
 * Shared DOM text search utility for read-only viewers (DOCX, plain text).
 *
 * Walks all text nodes in a container, finds case-insensitive matches,
 * and wraps them in <mark> elements for visual highlighting + navigation.
 */

interface CharMapping {
  nodeIdx: number;
  offset: number;
}

/**
 * Walk all text nodes in `container`, find case-insensitive occurrences of
 * `query`, and wrap each match in `<mark class="dom-find-highlight">`.
 *
 * Returns one `<mark>` element per match (the first segment when a match
 * spans multiple text nodes) for navigation purposes.
 */
export function highlightDomMatches(
  container: HTMLElement,
  query: string,
): HTMLElement[] {
  if (!query) return [];

  // 1. Collect all text nodes via TreeWalker
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
  );
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    textNodes.push(node);
  }
  if (textNodes.length === 0) return [];

  // 2. Build concatenated text + character mapping
  const charMap: CharMapping[] = [];
  let fullText = "";
  for (let i = 0; i < textNodes.length; i++) {
    const text = textNodes[i].textContent ?? "";
    for (let j = 0; j < text.length; j++) {
      charMap.push({ nodeIdx: i, offset: j });
    }
    fullText += text;
  }

  // 3. Find all case-insensitive matches
  const lowerFull = fullText.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchPositions: Array<{ start: number; end: number }> = [];
  let searchFrom = 0;
  while (searchFrom <= lowerFull.length - lowerQuery.length) {
    const idx = lowerFull.indexOf(lowerQuery, searchFrom);
    if (idx === -1) break;
    matchPositions.push({ start: idx, end: idx + lowerQuery.length });
    searchFrom = idx + 1;
  }
  if (matchPositions.length === 0) return [];

  // 4. Group match positions into per-node segments
  //    Each segment: { nodeIdx, startOffset, endOffset }
  interface Segment {
    nodeIdx: number;
    startOffset: number;
    endOffset: number;
    matchIdx: number;
    isFirst: boolean; // first segment of its match (used for navigation marks)
  }

  const segments: Segment[] = [];
  for (let mi = 0; mi < matchPositions.length; mi++) {
    const { start, end } = matchPositions[mi];
    let isFirst = true;
    let prevNodeIdx = -1;
    for (let ci = start; ci < end; ci++) {
      const { nodeIdx, offset } = charMap[ci];
      if (nodeIdx !== prevNodeIdx) {
        segments.push({
          nodeIdx,
          startOffset: offset,
          endOffset: offset + 1,
          matchIdx: mi,
          isFirst,
        });
        isFirst = false;
        prevNodeIdx = nodeIdx;
      } else {
        // Extend the current segment
        segments[segments.length - 1].endOffset = offset + 1;
      }
    }
  }

  // 5. Group segments by node (processed in reverse node order so offsets stay valid)
  const segmentsByNode = new Map<number, Segment[]>();
  for (const seg of segments) {
    const arr = segmentsByNode.get(seg.nodeIdx) ?? [];
    arr.push(seg);
    segmentsByNode.set(seg.nodeIdx, arr);
  }

  // 6. Split text nodes and wrap matched portions in <mark>
  const primaryMarks: Array<{ matchIdx: number; mark: HTMLElement }> = [];

  // Process nodes in reverse order so earlier node indices aren't invalidated
  const sortedNodeIndices = Array.from(segmentsByNode.keys()).sort(
    (a, b) => b - a,
  );

  for (const nodeIdx of sortedNodeIndices) {
    const nodeSegments = segmentsByNode.get(nodeIdx)!;
    const textNode = textNodes[nodeIdx];
    const parent = textNode.parentNode;
    if (!parent) continue;

    const text = textNode.textContent ?? "";

    // Sort segments by startOffset ascending, then process in reverse
    nodeSegments.sort((a, b) => a.startOffset - b.startOffset);

    // Build replacement fragment
    const frag = document.createDocumentFragment();
    let cursor = 0;

    for (const seg of nodeSegments) {
      // Text before this segment
      if (seg.startOffset > cursor) {
        frag.appendChild(
          document.createTextNode(text.slice(cursor, seg.startOffset)),
        );
      }

      // Wrapped match portion
      const mark = document.createElement("mark");
      mark.className = "dom-find-highlight";
      mark.textContent = text.slice(seg.startOffset, seg.endOffset);
      frag.appendChild(mark);

      if (seg.isFirst) {
        primaryMarks.push({ matchIdx: seg.matchIdx, mark });
      }

      cursor = seg.endOffset;
    }

    // Text after last segment
    if (cursor < text.length) {
      frag.appendChild(document.createTextNode(text.slice(cursor)));
    }

    parent.replaceChild(frag, textNode);
  }

  // Sort primary marks by matchIdx and return
  primaryMarks.sort((a, b) => a.matchIdx - b.matchIdx);
  return primaryMarks.map((pm) => pm.mark);
}

/**
 * Remove all `<mark class="dom-find-highlight">` elements from `container`,
 * restoring the original text node structure.
 */
export function clearDomHighlights(container: HTMLElement): void {
  const marks = container.querySelectorAll("mark.dom-find-highlight");
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    const textNode = document.createTextNode(mark.textContent ?? "");
    parent.replaceChild(textNode, mark);
  }
  // Merge adjacent text nodes
  container.normalize();
}

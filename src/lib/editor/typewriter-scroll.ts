import type { Transaction } from '@tiptap/pm/state';

/**
 * Pure logic for typewriter scrolling (Settings > Writing > "Typewriter
 * scrolling"). The hook (`src/hooks/useTypewriterScroll.ts`) does the DOM
 * wiring; everything decision-shaped lives here so it can be unit-tested
 * without a ProseMirror view or layout.
 */

/** Comfort band, as fractions of the viewport height. While the caret's
 *  vertical center sits inside [bandStart, bandEnd] no scrolling happens —
 *  this prevents per-keystroke jitter around the exact midpoint. */
export const TYPEWRITER_BAND_START = 0.4;
export const TYPEWRITER_BAND_END = 0.6;

/**
 * Maximum number of characters a transaction may insert and still count as
 * "typing". Filters out content loads (`setContent` replaces the whole doc)
 * and large pastes while letting through single keystrokes, Enter splits,
 * and IME commits.
 */
export const MAX_TYPING_INSERT = 64;

/** How close (in ProseMirror positions) the selection head must be to a
 *  changed range for the transaction to count as typing-driven. */
const CARET_PROXIMITY = 2;

export interface TypewriterMeasure {
  /** Caret rect top, in viewport (client) coordinates. */
  caretTop: number;
  /** Caret rect bottom, in viewport (client) coordinates. */
  caretBottom: number;
  /** Scroll container rect top, in viewport (client) coordinates. */
  viewportTop: number;
  /** Scroll container visible height in px. */
  viewportHeight: number;
  /** Band start as a fraction of viewport height (default 0.4). */
  bandStart?: number;
  /** Band end as a fraction of viewport height (default 0.6). */
  bandEnd?: number;
}

/**
 * Decide whether (and how far) to scroll so the caret returns to the
 * vertical center of the viewport.
 *
 * Returns `null` when no scroll is needed — caret inside the comfort band,
 * degenerate viewport, or a rounded delta of zero. Otherwise returns the
 * signed `scrollBy` delta in px (positive scrolls down).
 */
export function computeTypewriterScrollDelta(measure: TypewriterMeasure): number | null {
  const {
    caretTop,
    caretBottom,
    viewportTop,
    viewportHeight,
    bandStart = TYPEWRITER_BAND_START,
    bandEnd = TYPEWRITER_BAND_END,
  } = measure;

  if (!(viewportHeight > 0)) return null;

  const caretCenter = (caretTop + caretBottom) / 2;
  const relative = (caretCenter - viewportTop) / viewportHeight;

  // Comfortable — leave the scroll position alone.
  if (relative >= bandStart && relative <= bandEnd) return null;

  const target = viewportTop + viewportHeight / 2;
  const delta = Math.round(caretCenter - target);
  return delta === 0 ? null : delta;
}

/**
 * True when a transaction looks like the user typing at the caret:
 *
 * - the document changed (plain selection moves / decorations don't count),
 * - the selection is a collapsed caret,
 * - it wasn't a paste / drop (`uiEvent` meta) or a history-suppressed
 *   programmatic rewrite (`addToHistory: false` — comment position sync,
 *   decoration bookkeeping, external reloads),
 * - the total inserted size is small (filters whole-document loads), and
 * - the caret ended up adjacent to one of the changed ranges.
 *
 * Deliberately conservative: manual scrolling, arrow-key navigation, and
 * programmatic content swaps must never trigger a typewriter re-center.
 */
export function isTypingTransaction(tr: Transaction): boolean {
  if (!tr.docChanged) return false;
  if (!tr.selection.empty) return false;

  const uiEvent = tr.getMeta('uiEvent') as string | undefined;
  if (uiEvent === 'paste' || uiEvent === 'drop' || uiEvent === 'cut') return false;
  if (tr.getMeta('addToHistory') === false) return false;

  let inserted = 0;
  let caretNearChange = false;
  const head = tr.selection.head;
  const maps = tr.mapping.maps;

  for (let i = 0; i < maps.length; i++) {
    maps[i].forEach((_fromA, _toA, fromB, toB) => {
      inserted += toB - fromB;
      // Map the changed range (in step-i output coords) through the
      // remaining steps into final-doc coords, then compare to the caret.
      const from = tr.mapping.slice(i + 1).map(fromB, -1);
      const to = tr.mapping.slice(i + 1).map(toB, 1);
      if (head >= from - CARET_PROXIMITY && head <= to + CARET_PROXIMITY) {
        caretNearChange = true;
      }
    });
  }

  if (inserted > MAX_TYPING_INSERT) return false;
  return caretNearChange;
}

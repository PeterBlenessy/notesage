/**
 * Unit tests for the typewriter-scrolling decision logic
 * (`src/lib/editor/typewriter-scroll.ts`).
 *
 * `computeTypewriterScrollDelta` is pure math; `isTypingTransaction` is
 * exercised against real ProseMirror transactions built on a minimal schema
 * so the mapping/selection semantics match production exactly.
 */

import { describe, it, expect } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import {
  computeTypewriterScrollDelta,
  isTypingTransaction,
  MAX_TYPING_INSERT,
} from '../typewriter-scroll';

// ---------------------------------------------------------------------------
// computeTypewriterScrollDelta
// ---------------------------------------------------------------------------

describe('computeTypewriterScrollDelta', () => {
  const viewport = { viewportTop: 100, viewportHeight: 600 };
  // Band: [100 + 240, 100 + 360] = [340, 460]; center = 400.

  function caretAt(center: number) {
    return { caretTop: center - 10, caretBottom: center + 10, ...viewport };
  }

  it('returns null while the caret center sits inside the 40-60% band', () => {
    expect(computeTypewriterScrollDelta(caretAt(400))).toBeNull(); // dead center
    expect(computeTypewriterScrollDelta(caretAt(345))).toBeNull(); // just inside top
    expect(computeTypewriterScrollDelta(caretAt(455))).toBeNull(); // just inside bottom
  });

  it('returns null exactly at the band edges (inclusive)', () => {
    expect(computeTypewriterScrollDelta(caretAt(340))).toBeNull(); // 40%
    expect(computeTypewriterScrollDelta(caretAt(460))).toBeNull(); // 60%
  });

  it('scrolls down (positive delta) when the caret drifts below the band', () => {
    // Caret center at 550 → delta = 550 - 400 = +150
    expect(computeTypewriterScrollDelta(caretAt(550))).toBe(150);
  });

  it('scrolls up (negative delta) when the caret drifts above the band', () => {
    // Caret center at 200 → delta = 200 - 400 = -200
    expect(computeTypewriterScrollDelta(caretAt(200))).toBe(-200);
  });

  it('returns null for a degenerate viewport (zero or negative height)', () => {
    expect(
      computeTypewriterScrollDelta({ caretTop: 10, caretBottom: 20, viewportTop: 0, viewportHeight: 0 }),
    ).toBeNull();
    expect(
      computeTypewriterScrollDelta({ caretTop: 10, caretBottom: 20, viewportTop: 0, viewportHeight: -5 }),
    ).toBeNull();
  });

  it('honours a custom band', () => {
    // With a full-width band nothing ever scrolls.
    expect(
      computeTypewriterScrollDelta({ ...caretAt(590), bandStart: 0, bandEnd: 1 }),
    ).toBeNull();
    // With a zero-width band at the center, a slightly offset caret scrolls.
    expect(
      computeTypewriterScrollDelta({ ...caretAt(430), bandStart: 0.5, bandEnd: 0.5 }),
    ).toBe(30);
  });

  it('returns null when the rounded delta is zero', () => {
    // Caret center 400.4 → rel ≈ 0.5007, outside a zero-width band, but
    // rounds to 0 → treated as "no scroll needed".
    expect(
      computeTypewriterScrollDelta({
        caretTop: 400.4,
        caretBottom: 400.4,
        ...viewport,
        bandStart: 0.5,
        bandEnd: 0.5,
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isTypingTransaction — against real ProseMirror transactions
// ---------------------------------------------------------------------------

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
  },
});

function stateWithText(text: string): EditorState {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, text ? [schema.text(text)] : []),
  ]);
  return EditorState.create({ schema, doc });
}

describe('isTypingTransaction', () => {
  it('accepts a single typed character with the caret after the insert', () => {
    const state = stateWithText('hello');
    const tr = state.tr.insertText('a', 6); // append after "hello"
    tr.setSelection(TextSelection.create(tr.doc, 7));
    expect(isTypingTransaction(tr)).toBe(true);
  });

  it('accepts a backspace deletion at the caret', () => {
    const state = stateWithText('hello');
    const tr = state.tr.delete(5, 6); // delete the "o"
    tr.setSelection(TextSelection.create(tr.doc, 5));
    expect(isTypingTransaction(tr)).toBe(true);
  });

  it('rejects a transaction that only moves the selection', () => {
    const state = stateWithText('hello');
    const tr = state.tr.setSelection(TextSelection.create(state.doc, 3));
    expect(isTypingTransaction(tr)).toBe(false);
  });

  it('rejects paste / drop / cut uiEvent transactions', () => {
    for (const uiEvent of ['paste', 'drop', 'cut']) {
      const state = stateWithText('hello');
      const tr = state.tr.insertText('abc', 6);
      tr.setSelection(TextSelection.create(tr.doc, 9));
      tr.setMeta('uiEvent', uiEvent);
      expect(isTypingTransaction(tr)).toBe(false);
    }
  });

  it('rejects history-suppressed programmatic transactions', () => {
    const state = stateWithText('hello');
    const tr = state.tr.insertText('a', 6);
    tr.setSelection(TextSelection.create(tr.doc, 7));
    tr.setMeta('addToHistory', false);
    expect(isTypingTransaction(tr)).toBe(false);
  });

  it('rejects transactions with a non-empty selection', () => {
    const state = stateWithText('hello');
    const tr = state.tr.insertText('a', 6);
    tr.setSelection(TextSelection.create(tr.doc, 1, 4));
    expect(isTypingTransaction(tr)).toBe(false);
  });

  it('rejects large inserts (content loads, big pastes without uiEvent meta)', () => {
    const state = stateWithText('hello');
    const big = 'x'.repeat(MAX_TYPING_INSERT + 1);
    const tr = state.tr.insertText(big, 6);
    tr.setSelection(TextSelection.create(tr.doc, 6 + big.length));
    expect(isTypingTransaction(tr)).toBe(false);
  });

  it('rejects changes far away from the caret', () => {
    const state = stateWithText('a'.repeat(80));
    // Change at the end, caret parked at the start.
    const tr = state.tr.insertText('z', 81);
    tr.setSelection(TextSelection.create(tr.doc, 1));
    expect(isTypingTransaction(tr)).toBe(false);
  });
});

// @vitest-environment jsdom

/**
 * Unit tests for useTypewriterScroll.
 *
 * jsdom has no layout, so caret coordinates (editor.view.coordsAtPos) and the
 * scroll container rect are mocked. The typing-transaction classifier is
 * covered separately by `src/lib/editor/__tests__/typewriter-scroll.test.ts`;
 * here it is mocked so the hook's wiring can be driven directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSettings: { typewriterScrolling: boolean } = { typewriterScrolling: true };

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: Object.assign(
    vi.fn((selector: (s: typeof mockSettings) => unknown) => selector(mockSettings)),
    { getState: () => mockSettings },
  ),
}));

let mockReducedMotion = false;
vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockReducedMotion,
}));

const isTypingTransactionMock = vi.fn((_tr: Transaction) => true);
vi.mock('@/lib/editor/typewriter-scroll', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/editor/typewriter-scroll')>();
  return {
    ...actual,
    isTypingTransaction: (tr: Transaction) => isTypingTransactionMock(tr),
  };
});

import { useTypewriterScroll } from '../useTypewriterScroll';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type TransactionHandler = (props: { transaction: Transaction }) => void;

interface FakeEditorHarness {
  editor: Editor;
  emitTransaction: () => void;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  coordsAtPos: ReturnType<typeof vi.fn>;
}

function makeFakeEditor(caret: { top: number; bottom: number }): FakeEditorHarness {
  const handlers = new Set<TransactionHandler>();
  const on = vi.fn((event: string, handler: TransactionHandler) => {
    if (event === 'transaction') handlers.add(handler);
  });
  const off = vi.fn((event: string, handler: TransactionHandler) => {
    if (event === 'transaction') handlers.delete(handler);
  });
  const coordsAtPos = vi.fn(() => ({ top: caret.top, bottom: caret.bottom, left: 0, right: 0 }));
  const editor = {
    on,
    off,
    state: { selection: { head: 5 } },
    view: { coordsAtPos },
  } as unknown as Editor;
  const emitTransaction = () => {
    const fakeTr = {} as Transaction;
    handlers.forEach((h) => h({ transaction: fakeTr }));
  };
  return { editor, emitTransaction, on, off, coordsAtPos };
}

function makeContainer(rect: { top: number; height: number }) {
  const el = document.createElement('div');
  el.getBoundingClientRect = vi.fn(() => ({
    top: rect.top,
    bottom: rect.top + rect.height,
    height: rect.height,
    left: 0,
    right: 800,
    width: 800,
    x: 0,
    y: rect.top,
    toJSON: () => ({}),
  }));
  const scrollBy = vi.fn();
  el.scrollBy = scrollBy;
  document.body.appendChild(el);
  return { el, scrollBy };
}

// ---------------------------------------------------------------------------

describe('useTypewriterScroll', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockSettings.typewriterScrolling = true;
    mockReducedMotion = false;
    isTypingTransactionMock.mockReset();
    isTypingTransactionMock.mockReturnValue(true);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('smooth-scrolls the container toward centering when the caret drifts below the band', () => {
    // Viewport [100, 700], center 400, band [340, 460]. Caret center 550 → +150.
    const { el, scrollBy } = makeContainer({ top: 100, height: 600 });
    const harness = makeFakeEditor({ top: 540, bottom: 560 });

    renderHook(() => useTypewriterScroll(harness.editor, { current: el }));
    act(() => { harness.emitTransaction(); });

    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenCalledWith({ top: 150, behavior: 'smooth' });
  });

  it('does not scroll while the caret sits inside the comfort band', () => {
    const { el, scrollBy } = makeContainer({ top: 100, height: 600 });
    const harness = makeFakeEditor({ top: 390, bottom: 410 }); // center 400

    renderHook(() => useTypewriterScroll(harness.editor, { current: el }));
    act(() => { harness.emitTransaction(); });

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('ignores non-typing transactions', () => {
    isTypingTransactionMock.mockReturnValue(false);
    const { el, scrollBy } = makeContainer({ top: 100, height: 600 });
    const harness = makeFakeEditor({ top: 540, bottom: 560 });

    renderHook(() => useTypewriterScroll(harness.editor, { current: el }));
    act(() => { harness.emitTransaction(); });

    expect(scrollBy).not.toHaveBeenCalled();
    // The caret was never measured — the classifier gates first.
    expect(harness.coordsAtPos).not.toHaveBeenCalled();
  });

  it('does nothing when the setting is off (no listener installed)', () => {
    mockSettings.typewriterScrolling = false;
    const { el, scrollBy } = makeContainer({ top: 100, height: 600 });
    const harness = makeFakeEditor({ top: 540, bottom: 560 });

    renderHook(() => useTypewriterScroll(harness.editor, { current: el }));
    act(() => { harness.emitTransaction(); });

    expect(harness.on).not.toHaveBeenCalled();
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('uses instant scrolling under prefers-reduced-motion', () => {
    mockReducedMotion = true;
    const { el, scrollBy } = makeContainer({ top: 100, height: 600 });
    const harness = makeFakeEditor({ top: 540, bottom: 560 });

    renderHook(() => useTypewriterScroll(harness.editor, { current: el }));
    act(() => { harness.emitTransaction(); });

    expect(scrollBy).toHaveBeenCalledWith({ top: 150, behavior: 'auto' });
  });

  it('is a no-op when the scroll container ref is empty', () => {
    const harness = makeFakeEditor({ top: 540, bottom: 560 });
    expect(() => {
      renderHook(() => useTypewriterScroll(harness.editor, { current: null }));
      act(() => { harness.emitTransaction(); });
    }).not.toThrow();
  });

  it('swallows coordsAtPos throws (position outside the rendered view)', () => {
    const { el, scrollBy } = makeContainer({ top: 100, height: 600 });
    const harness = makeFakeEditor({ top: 540, bottom: 560 });
    harness.coordsAtPos.mockImplementation(() => {
      throw new Error('Position outside of fragment');
    });

    renderHook(() => useTypewriterScroll(harness.editor, { current: el }));
    expect(() => { act(() => { harness.emitTransaction(); }); }).not.toThrow();
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('unbinds the transaction listener on unmount', () => {
    const { el, scrollBy } = makeContainer({ top: 100, height: 600 });
    const harness = makeFakeEditor({ top: 540, bottom: 560 });

    const { unmount } = renderHook(() => useTypewriterScroll(harness.editor, { current: el }));
    unmount();

    expect(harness.off).toHaveBeenCalledWith('transaction', expect.any(Function));
    act(() => { harness.emitTransaction(); });
    expect(scrollBy).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom

/**
 * Unit tests for useCursorScrollGuard.
 *
 * The hook listens for keydown events, reads the cursor's screen position via
 * window.getSelection(), compares it to the floating command bar's top edge,
 * and scrolls the editor container up if the cursor row would be hidden.
 *
 * jsdom does not implement layout (getBoundingClientRect always returns zeros),
 * so we mock the relevant APIs on a test-by-test basis.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Settings-store mock — controls `cmdBarPinned`
// ---------------------------------------------------------------------------

const mockSettings: { cmdBarPinned: boolean } = { cmdBarPinned: false };

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: Object.assign(
    vi.fn((selector: (s: typeof mockSettings) => unknown) => selector(mockSettings)),
    { getState: () => mockSettings },
  ),
}));

import { useCursorScrollGuard } from '../useCursorScrollGuard';

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

/** Create a scroll container with a mocked scrollBy and attach it to body. */
function mountScrollContainer(): { el: HTMLElement; scrollBy: ReturnType<typeof vi.fn> } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const scrollBy = vi.fn();
  el.scrollBy = scrollBy;
  return { el, scrollBy };
}

/** Mount a floating (non-pinned) command bar and give it a fixed top edge. */
function mountCmdBar(topEdge: number): HTMLElement {
  const bar = document.createElement('div');
  bar.setAttribute('data-cmd-bar', '');
  bar.setAttribute('data-cmd-bar-pinned', 'false');
  bar.getBoundingClientRect = vi.fn(() => ({
    top: topEdge,
    bottom: topEdge + 480,
    left: 0,
    right: 640,
    width: 640,
    height: 480,
    x: 0,
    y: topEdge,
    toJSON: () => ({}),
  }));
  document.body.appendChild(bar);
  return bar;
}

/** Mount a command bar with pinned="true". */
function mountPinnedCmdBar(): HTMLElement {
  const bar = document.createElement('div');
  bar.setAttribute('data-cmd-bar', '');
  bar.setAttribute('data-cmd-bar-pinned', 'true');
  document.body.appendChild(bar);
  return bar;
}

/** Mock window.getSelection to return a cursor whose bottom edge is at `cursorBottom`. */
function mockCursorAt(cursorBottom: number): void {
  const range = {
    collapse: vi.fn(),
    getBoundingClientRect: vi.fn(() => ({
      top: cursorBottom - 20,
      bottom: cursorBottom,
      height: 20,
      width: 2,
      left: 100,
      right: 102,
      x: 100,
      y: cursorBottom - 20,
      toJSON: () => ({}),
    })),
  };
  const selection = {
    rangeCount: 1,
    getRangeAt: vi.fn(() => range),
  };
  vi.spyOn(window, 'getSelection').mockReturnValue(selection as unknown as Selection);
}

/** Mock window.getSelection to return no selection. */
function mockNoSelection(): void {
  vi.spyOn(window, 'getSelection').mockReturnValue(null);
}

/** Dispatch a keydown event on the document. */
function fireKeydown(): void {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }),
  );
}

// ---------------------------------------------------------------------------

describe('useCursorScrollGuard', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockSettings.cmdBarPinned = false;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Core scroll behavior
  // -------------------------------------------------------------------------

  it('scrolls the container by the overlap amount when cursor bottom is below the safe zone', () => {
    const { el, scrollBy } = mountScrollContainer();
    const cmdBarTopEdge = 500;
    mountCmdBar(cmdBarTopEdge);
    // Cursor bottom at 480 — safe zone bottom is 500 - 60 = 440, so overlap = 40
    mockCursorAt(480);

    const scrollContainerRef = { current: el };
    renderHook(() => useCursorScrollGuard(scrollContainerRef));

    act(() => { fireKeydown(); });

    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenCalledWith(
      expect.objectContaining({ top: 40 }),
    );
  });

  it('does not scroll when cursor is already above the safe zone', () => {
    const { el, scrollBy } = mountScrollContainer();
    const cmdBarTopEdge = 600;
    mountCmdBar(cmdBarTopEdge);
    // Cursor bottom at 400 — safe zone bottom is 600 - 60 = 540, no overlap
    mockCursorAt(400);

    const scrollContainerRef = { current: el };
    renderHook(() => useCursorScrollGuard(scrollContainerRef));

    act(() => { fireKeydown(); });

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('does not scroll when cursor bottom exactly equals the safe zone boundary', () => {
    const { el, scrollBy } = mountScrollContainer();
    const cmdBarTopEdge = 500;
    mountCmdBar(cmdBarTopEdge);
    // Safe zone bottom = 500 - 60 = 440. Cursor bottom = 440 (equal, not below)
    mockCursorAt(440);

    const scrollContainerRef = { current: el };
    renderHook(() => useCursorScrollGuard(scrollContainerRef));

    act(() => { fireKeydown(); });

    expect(scrollBy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Pinned mode — no effect
  // -------------------------------------------------------------------------

  it('does nothing when cmdBarPinned is true in the settings store', () => {
    mockSettings.cmdBarPinned = true;
    const { el, scrollBy } = mountScrollContainer();
    mountCmdBar(500);
    mockCursorAt(480);

    const scrollContainerRef = { current: el };
    renderHook(() => useCursorScrollGuard(scrollContainerRef));

    act(() => { fireKeydown(); });

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('does not scroll when the cmd bar DOM element has data-cmd-bar-pinned="true"', () => {
    const { el, scrollBy } = mountScrollContainer();
    mountPinnedCmdBar();
    mockCursorAt(480);

    const scrollContainerRef = { current: el };
    renderHook(() => useCursorScrollGuard(scrollContainerRef));

    act(() => { fireKeydown(); });

    expect(scrollBy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Missing elements — graceful no-op
  // -------------------------------------------------------------------------

  it('is a no-op when no [data-cmd-bar] element is in the DOM', () => {
    const { el, scrollBy } = mountScrollContainer();
    // No cmd bar mounted
    mockCursorAt(480);

    const scrollContainerRef = { current: el };
    renderHook(() => useCursorScrollGuard(scrollContainerRef));

    act(() => { fireKeydown(); });

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('is a no-op when window.getSelection returns null', () => {
    const { el, scrollBy } = mountScrollContainer();
    mountCmdBar(500);
    mockNoSelection();

    const scrollContainerRef = { current: el };
    renderHook(() => useCursorScrollGuard(scrollContainerRef));

    act(() => { fireKeydown(); });

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('is a no-op when the scrollContainerRef is null', () => {
    mountCmdBar(500);
    mockCursorAt(480);

    const scrollContainerRef = { current: null };
    // Should not throw
    expect(() => {
      renderHook(() => useCursorScrollGuard(scrollContainerRef));
      act(() => { fireKeydown(); });
    }).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Throttling
  // -------------------------------------------------------------------------

  it('throttles scroll calls so rapid keydowns within 16 ms fire at most once', () => {
    vi.useFakeTimers();
    const { el, scrollBy } = mountScrollContainer();
    mountCmdBar(500);
    mockCursorAt(480);

    const scrollContainerRef = { current: el };
    renderHook(() => useCursorScrollGuard(scrollContainerRef));

    act(() => {
      fireKeydown();
      fireKeydown();
      fireKeydown();
    });

    // Only one scroll should fire despite three rapid keydowns
    expect(scrollBy).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('fires again after the throttle window has elapsed', () => {
    vi.useFakeTimers();
    const { el, scrollBy } = mountScrollContainer();
    mountCmdBar(500);
    mockCursorAt(480);

    const scrollContainerRef = { current: el };
    renderHook(() => useCursorScrollGuard(scrollContainerRef));

    act(() => { fireKeydown(); });
    expect(scrollBy).toHaveBeenCalledTimes(1);

    // Advance past the 16 ms throttle window
    act(() => { vi.advanceTimersByTime(20); });
    act(() => { fireKeydown(); });
    expect(scrollBy).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  it('removes the keydown listener on unmount and stops scrolling', () => {
    const { el, scrollBy } = mountScrollContainer();
    mountCmdBar(500);
    mockCursorAt(480);

    const scrollContainerRef = { current: el };
    const { unmount } = renderHook(() => useCursorScrollGuard(scrollContainerRef));

    act(() => { fireKeydown(); });
    expect(scrollBy).toHaveBeenCalledTimes(1);

    unmount();
    scrollBy.mockClear();

    act(() => { fireKeydown(); });
    expect(scrollBy).not.toHaveBeenCalled();
  });
});

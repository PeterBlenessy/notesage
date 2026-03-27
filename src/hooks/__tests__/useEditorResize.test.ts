// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEditorResize } from '@/hooks/useEditorResize';
import type { RefObject, MutableRefObject } from 'react';

// ---------------------------------------------------------------------------
// ResizeObserver mock
// ---------------------------------------------------------------------------

type ResizeObserverCallback = (entries: ResizeObserverEntry[]) => void;

let resizeObserverInstances: Array<{
  callback: ResizeObserverCallback;
  elements: Set<Element>;
  disconnect: ReturnType<typeof vi.fn>;
  observe: ReturnType<typeof vi.fn>;
}> = [];

class MockResizeObserver {
  private _callback: ResizeObserverCallback;
  private _elements = new Set<Element>();
  disconnect = vi.fn(() => {
    this._elements.clear();
  });
  observe = vi.fn((el: Element) => {
    this._elements.add(el);
  });
  unobserve = vi.fn((el: Element) => {
    this._elements.delete(el);
  });

  constructor(callback: ResizeObserverCallback) {
    this._callback = callback;
    resizeObserverInstances.push({
      callback,
      elements: this._elements,
      disconnect: this.disconnect,
      observe: this.observe,
    });
  }

  // Test helper: trigger the callback with a given width
  _trigger(width: number) {
    this._callback([
      { contentRect: { width } } as unknown as ResizeObserverEntry,
    ]);
  }
}

// ---------------------------------------------------------------------------
// requestAnimationFrame mock
// ---------------------------------------------------------------------------

let rafCallbacks: Array<FrameRequestCallback> = [];
let rafId = 0;

function mockRaf(callback: FrameRequestCallback): number {
  rafCallbacks.push(callback);
  return ++rafId;
}

// Flush one round of rAF callbacks
function flushRaf() {
  const cbs = rafCallbacks.splice(0);
  cbs.forEach((cb) => cb(performance.now()));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRef<T>(value: T): RefObject<T> {
  return { current: value } as RefObject<T>;
}

function makeMutableRef<T>(value: T): MutableRefObject<T> {
  return { current: value };
}

function createDefaultOptions(overrides: Record<string, unknown> = {}) {
  const contentEl = document.createElement('div');
  const scrollEl = document.createElement('div');

  return {
    contentRef: makeRef(contentEl),
    scrollAreaRef: makeRef(scrollEl),
    isProgrammaticScroll: makeMutableRef(false),
    isResizing: makeMutableRef(false),
    activeTabId: 'tab-1' as string | null | undefined,
    activeTabFilePath: '/path/to/file.md' as string | undefined,
    restoreScrollRatio: vi.fn(),
    // Expose the elements for triggering ResizeObserver callbacks
    _contentEl: contentEl,
    _scrollEl: scrollEl,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  resizeObserverInstances = [];
  rafCallbacks = [];
  rafId = 0;
  vi.useFakeTimers();
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  globalThis.requestAnimationFrame = mockRaf as unknown as typeof requestAnimationFrame;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useEditorResize', () => {
  // ---- Lifecycle: observers created on mount ----

  describe('lifecycle', () => {
    it('creates two ResizeObservers on mount (content + scroll)', () => {
      const opts = createDefaultOptions();
      renderHook(() => useEditorResize(opts));

      // Two observers: one for content width, one for scroll container
      expect(resizeObserverInstances).toHaveLength(2);
      expect(resizeObserverInstances[0].observe).toHaveBeenCalledWith(opts._contentEl);
      expect(resizeObserverInstances[1].observe).toHaveBeenCalledWith(opts._scrollEl);
    });

    it('disconnects both observers on unmount', () => {
      const opts = createDefaultOptions();
      const { unmount } = renderHook(() => useEditorResize(opts));

      const contentObserver = resizeObserverInstances[0];
      const scrollObserver = resizeObserverInstances[1];

      unmount();

      expect(contentObserver.disconnect).toHaveBeenCalled();
      expect(scrollObserver.disconnect).toHaveBeenCalled();
    });

    it('does not create content observer when contentRef is null', () => {
      const opts = createDefaultOptions({
        contentRef: makeRef<HTMLDivElement | null>(null),
      });
      renderHook(() => useEditorResize(opts));

      // Only the scroll observer should be created
      expect(resizeObserverInstances).toHaveLength(1);
    });

    it('does not create scroll observer when scrollAreaRef is null', () => {
      const opts = createDefaultOptions({
        scrollAreaRef: makeRef<HTMLDivElement | null>(null),
      });
      renderHook(() => useEditorResize(opts));

      // Only the content observer should be created
      expect(resizeObserverInstances).toHaveLength(1);
    });

    it('does not create scroll observer when activeTabId is null', () => {
      const opts = createDefaultOptions({ activeTabId: null });
      renderHook(() => useEditorResize(opts));

      // Only the content observer
      expect(resizeObserverInstances).toHaveLength(1);
    });

    it('does not create scroll observer when activeTabFilePath is undefined', () => {
      const opts = createDefaultOptions({ activeTabFilePath: undefined });
      renderHook(() => useEditorResize(opts));

      // Only the content observer
      expect(resizeObserverInstances).toHaveLength(1);
    });
  });

  // ---- renderedWidth state updates ----

  describe('renderedWidth', () => {
    it('starts as null', () => {
      const opts = createDefaultOptions();
      const { result } = renderHook(() => useEditorResize(opts));
      expect(result.current.renderedWidth).toBeNull();
    });

    it('updates when the content ResizeObserver fires', () => {
      const opts = createDefaultOptions();
      const { result } = renderHook(() => useEditorResize(opts));

      // The content observer is the first one created
      const contentInstance = resizeObserverInstances[0];

      act(() => {
        contentInstance.callback([
          { contentRect: { width: 720 } } as unknown as ResizeObserverEntry,
        ]);
      });

      expect(result.current.renderedWidth).toBe(720);
    });

    it('updates on subsequent width changes', () => {
      const opts = createDefaultOptions();
      const { result } = renderHook(() => useEditorResize(opts));

      const contentInstance = resizeObserverInstances[0];

      act(() => {
        contentInstance.callback([
          { contentRect: { width: 600 } } as unknown as ResizeObserverEntry,
        ]);
      });
      expect(result.current.renderedWidth).toBe(600);

      act(() => {
        contentInstance.callback([
          { contentRect: { width: 800 } } as unknown as ResizeObserverEntry,
        ]);
      });
      expect(result.current.renderedWidth).toBe(800);
    });
  });

  // ---- Scroll resize debounce and restore ----

  describe('scroll resize debounce and restore', () => {
    it('sets isResizing to true during resize and calls restoreScrollRatio after 100ms', () => {
      const opts = createDefaultOptions();
      renderHook(() => useEditorResize(opts));

      const scrollInstance = resizeObserverInstances[1];

      // Trigger a scroll container resize
      act(() => {
        scrollInstance.callback([
          { contentRect: { width: 500 } } as unknown as ResizeObserverEntry,
        ]);
      });

      expect(opts.isResizing.current).toBe(true);
      expect(opts.restoreScrollRatio).not.toHaveBeenCalled();

      // Advance 100ms for debounce
      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(opts.restoreScrollRatio).toHaveBeenCalledWith('/path/to/file.md');
    });

    it('resets isResizing to false after double-rAF following restore', () => {
      const opts = createDefaultOptions();
      renderHook(() => useEditorResize(opts));

      const scrollInstance = resizeObserverInstances[1];

      act(() => {
        scrollInstance.callback([
          { contentRect: { width: 500 } } as unknown as ResizeObserverEntry,
        ]);
      });

      // After debounce
      act(() => {
        vi.advanceTimersByTime(100);
      });

      // isResizing still true — waiting for double-rAF
      expect(opts.isResizing.current).toBe(true);

      // First rAF
      act(() => {
        flushRaf();
      });
      expect(opts.isResizing.current).toBe(true);

      // Second rAF
      act(() => {
        flushRaf();
      });
      expect(opts.isResizing.current).toBe(false);
    });

    it('debounces rapid resize events (only the last triggers restore)', () => {
      const opts = createDefaultOptions();
      renderHook(() => useEditorResize(opts));

      const scrollInstance = resizeObserverInstances[1];

      // Fire several resizes in rapid succession
      act(() => {
        scrollInstance.callback([{ contentRect: { width: 400 } } as unknown as ResizeObserverEntry]);
      });
      act(() => {
        vi.advanceTimersByTime(50);
      });
      act(() => {
        scrollInstance.callback([{ contentRect: { width: 450 } } as unknown as ResizeObserverEntry]);
      });
      act(() => {
        vi.advanceTimersByTime(50);
      });
      act(() => {
        scrollInstance.callback([{ contentRect: { width: 500 } } as unknown as ResizeObserverEntry]);
      });

      // Only 50ms since last event — should not have restored yet
      expect(opts.restoreScrollRatio).not.toHaveBeenCalled();

      // Wait the full 100ms debounce
      act(() => {
        vi.advanceTimersByTime(100);
      });

      // Should only be called once (the debounced trailing call)
      expect(opts.restoreScrollRatio).toHaveBeenCalledTimes(1);
    });
  });

  // ---- Programmatic scroll guard ----

  describe('programmatic scroll guard', () => {
    it('skips resize handling when isProgrammaticScroll is true', () => {
      const opts = createDefaultOptions();
      opts.isProgrammaticScroll.current = true;
      renderHook(() => useEditorResize(opts));

      const scrollInstance = resizeObserverInstances[1];

      act(() => {
        scrollInstance.callback([{ contentRect: { width: 500 } } as unknown as ResizeObserverEntry]);
      });

      // isResizing should NOT be set because early return
      expect(opts.isResizing.current).toBe(false);

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(opts.restoreScrollRatio).not.toHaveBeenCalled();
    });

    it('skips restoreScrollRatio if isProgrammaticScroll becomes true during debounce', () => {
      const opts = createDefaultOptions();
      renderHook(() => useEditorResize(opts));

      const scrollInstance = resizeObserverInstances[1];

      // Trigger resize while not programmatic
      act(() => {
        scrollInstance.callback([{ contentRect: { width: 500 } } as unknown as ResizeObserverEntry]);
      });

      expect(opts.isResizing.current).toBe(true);

      // Set programmatic scroll during the debounce window
      opts.isProgrammaticScroll.current = true;

      act(() => {
        vi.advanceTimersByTime(100);
      });

      // restoreScrollRatio should NOT be called
      expect(opts.restoreScrollRatio).not.toHaveBeenCalled();
      // isResizing should be reset to false
      expect(opts.isResizing.current).toBe(false);
    });
  });

  // ---- Tab change re-creates observers ----

  describe('tab change re-creates observers', () => {
    it('disconnects old observers and creates new ones when activeTabId changes', () => {
      const opts = createDefaultOptions();
      const { rerender } = renderHook(
        (props) => useEditorResize(props),
        { initialProps: opts }
      );

      expect(resizeObserverInstances).toHaveLength(2);
      const oldContentObs = resizeObserverInstances[0];
      const oldScrollObs = resizeObserverInstances[1];

      // Change tab
      rerender({ ...opts, activeTabId: 'tab-2', activeTabFilePath: '/path/to/other.md' });

      // Old observers should be disconnected
      expect(oldContentObs.disconnect).toHaveBeenCalled();
      expect(oldScrollObs.disconnect).toHaveBeenCalled();

      // New observers should be created (4 total: 2 old + 2 new)
      expect(resizeObserverInstances).toHaveLength(4);
    });

    it('uses the new filePath for restoreScrollRatio after tab change', () => {
      const opts = createDefaultOptions();
      const { rerender } = renderHook(
        (props) => useEditorResize(props),
        { initialProps: opts }
      );

      // Switch to new tab
      rerender({ ...opts, activeTabId: 'tab-2', activeTabFilePath: '/path/to/other.md' });

      // Trigger a resize on the new scroll observer (last created)
      const newScrollInstance = resizeObserverInstances[resizeObserverInstances.length - 1];

      act(() => {
        newScrollInstance.callback([{ contentRect: { width: 500 } } as unknown as ResizeObserverEntry]);
      });

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(opts.restoreScrollRatio).toHaveBeenCalledWith('/path/to/other.md');
    });
  });

  // ---- Cleanup clears pending timers ----

  describe('cleanup clears pending timers', () => {
    it('does not call restoreScrollRatio after unmount even if timer is pending', () => {
      const opts = createDefaultOptions();
      const { unmount } = renderHook(() => useEditorResize(opts));

      const scrollInstance = resizeObserverInstances[1];

      // Trigger resize to start the debounce timer
      act(() => {
        scrollInstance.callback([{ contentRect: { width: 500 } } as unknown as ResizeObserverEntry]);
      });

      // Unmount before debounce fires
      unmount();

      // Advance past debounce
      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(opts.restoreScrollRatio).not.toHaveBeenCalled();
    });

    it('does not call restoreScrollRatio after tab change even if timer was pending', () => {
      const opts = createDefaultOptions();
      const { rerender } = renderHook(
        (props) => useEditorResize(props),
        { initialProps: opts }
      );

      const scrollInstance = resizeObserverInstances[1];

      // Start a resize on the old tab
      act(() => {
        scrollInstance.callback([{ contentRect: { width: 500 } } as unknown as ResizeObserverEntry]);
      });

      // Switch tabs before debounce fires — this triggers cleanup of old effect
      rerender({ ...opts, activeTabId: 'tab-2', activeTabFilePath: '/path/to/other.md' });

      // Advance timers — the old timer should have been cleared
      act(() => {
        vi.advanceTimersByTime(200);
      });

      // restoreScrollRatio should NOT have been called with the old file path
      expect(opts.restoreScrollRatio).not.toHaveBeenCalledWith('/path/to/file.md');
    });
  });
});

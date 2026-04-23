// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import type { KeyboardEvent } from 'react';
import { useRovingTabindex } from '../useRovingTabindex';

/**
 * Build a synthetic React.KeyboardEvent shape for the hook's handler. The
 * hook reads `event.key`, `event.preventDefault`, and `event.stopPropagation`
 * — anything else can be a stub.
 */
function buildKey(key: string): KeyboardEvent<HTMLElement> {
  let prevented = false;
  return {
    key,
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {},
    get defaultPrevented() {
      return prevented;
    },
  } as unknown as KeyboardEvent<HTMLElement>;
}

describe('useRovingTabindex', () => {
  it('returns the first row as active before any focus event lands', () => {
    const { result } = renderHook(() =>
      useRovingTabindex({ rowIds: ['a', 'b', 'c'] }),
    );
    expect(result.current.activeId).toBe('a');
    expect(result.current.getTabIndex('a')).toBe(0);
    expect(result.current.getTabIndex('b')).toBe(-1);
    expect(result.current.getTabIndex('c')).toBe(-1);
  });

  it('handleFocus updates the active row id', () => {
    const { result } = renderHook(() =>
      useRovingTabindex({ rowIds: ['a', 'b', 'c'] }),
    );
    act(() => {
      result.current.handleFocus('b');
    });
    expect(result.current.activeId).toBe('b');
    expect(result.current.getTabIndex('b')).toBe(0);
    expect(result.current.getTabIndex('a')).toBe(-1);
  });

  it('ArrowDown moves the active row to the next id and wraps at the end', () => {
    const refs: Record<string, HTMLElement> = {
      a: document.createElement('div'),
      b: document.createElement('div'),
      c: document.createElement('div'),
    };
    const { result } = renderHook(() =>
      useRovingTabindex({ rowIds: ['a', 'b', 'c'] }),
    );
    act(() => {
      result.current.registerRef('a', refs.a);
      result.current.registerRef('b', refs.b);
      result.current.registerRef('c', refs.c);
    });

    act(() => {
      result.current.handleKeyDown(buildKey('ArrowDown'), 'a');
    });
    expect(result.current.activeId).toBe('b');

    act(() => {
      result.current.handleKeyDown(buildKey('ArrowDown'), 'c');
    });
    expect(result.current.activeId).toBe('a'); // wrapped
  });

  it('ArrowUp moves the active row to the previous id and wraps at the start', () => {
    const refs: Record<string, HTMLElement> = {
      a: document.createElement('div'),
      b: document.createElement('div'),
      c: document.createElement('div'),
    };
    const { result } = renderHook(() =>
      useRovingTabindex({ rowIds: ['a', 'b', 'c'] }),
    );
    act(() => {
      result.current.registerRef('a', refs.a);
      result.current.registerRef('b', refs.b);
      result.current.registerRef('c', refs.c);
    });

    act(() => {
      result.current.handleKeyDown(buildKey('ArrowUp'), 'a');
    });
    expect(result.current.activeId).toBe('c'); // wrapped
  });

  it('non-arrow keys pass through without preventDefault', () => {
    const { result } = renderHook(() =>
      useRovingTabindex({ rowIds: ['a', 'b'] }),
    );
    const ev = buildKey('Enter');
    act(() => {
      result.current.handleKeyDown(ev, 'a');
    });
    expect(ev.defaultPrevented).toBe(false);
  });

  it('drops the active id when it disappears from the row list', () => {
    let rowIds = ['a', 'b', 'c'];
    const { result, rerender } = renderHook(
      ({ rowIds }: { rowIds: string[] }) => useRovingTabindex({ rowIds }),
      { initialProps: { rowIds } },
    );
    act(() => {
      result.current.handleFocus('b');
    });
    expect(result.current.activeId).toBe('b');

    rowIds = ['a', 'c'];
    rerender({ rowIds });
    // Falls back to the first row when the previous active id is gone.
    expect(result.current.activeId).toBe('a');
  });

  it('focusRow moves DOM focus and updates active state', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    a.tabIndex = 0;
    b.tabIndex = -1;
    document.body.appendChild(a);
    document.body.appendChild(b);

    const { result } = renderHook(() =>
      useRovingTabindex({ rowIds: ['a', 'b'] }),
    );
    act(() => {
      result.current.registerRef('a', a);
      result.current.registerRef('b', b);
    });

    act(() => {
      result.current.focusRow('b');
    });
    expect(result.current.activeId).toBe('b');
    expect(document.activeElement).toBe(b);

    document.body.removeChild(a);
    document.body.removeChild(b);
  });
});

// Anti-aliased fireEvent import to avoid unused-symbol warnings if a future
// edit drops the live tests above.
void fireEvent;

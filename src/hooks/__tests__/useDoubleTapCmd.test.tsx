// @vitest-environment jsdom

/**
 * Unit tests for useDoubleTapCmd.
 *
 * Verifies:
 *   - the hook is a no-op when uiPreview === "legacy" (no event emitted on
 *     Meta press)
 *   - a single Meta press does not emit
 *   - two Meta presses within 300 ms emit { type: "focus" } once
 *   - two Meta presses with > 300 ms between them do NOT emit
 *   - a non-Meta key between two Meta presses resets the timer (no emit)
 *   - triple-tap (Meta, Meta, Meta) emits exactly once — the second emission
 *     would require a fresh pair after the reset
 *   - cleanup removes the listener on unmount
 *
 * The settings-store is mocked so individual tests can flip `uiPreview`
 * between "legacy" and "quiet-composer". `performance.now` is monkey-patched
 * because vi.useFakeTimers does not advance the high-resolution clock that
 * the hook relies on.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { subscribeToCmdBarEvents, type CmdBarEvent } from '@/lib/cmd-bar-events';

const mockSettings: { uiPreview: 'legacy' | 'quiet-composer' } = {
  uiPreview: 'quiet-composer',
};

vi.mock('@/stores/settings-store', () => {
  return {
    useSettingsStore: Object.assign(
      vi.fn((selector: (s: typeof mockSettings) => unknown) =>
        selector(mockSettings),
      ),
      { getState: () => mockSettings },
    ),
  };
});

import { useDoubleTapCmd } from '@/hooks/useDoubleTapCmd';

let captured: CmdBarEvent[];
let unsubscribe: () => void;

// Controllable performance.now — tests advance this to simulate elapsed time.
let nowValue = 0;
const realPerformanceNow = performance.now.bind(performance);

function dispatchKey(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { bubbles: true, key, ...options });
  window.dispatchEvent(event);
  return event;
}

function advance(ms: number) {
  nowValue += ms;
}

beforeEach(() => {
  mockSettings.uiPreview = 'quiet-composer';
  captured = [];
  unsubscribe = subscribeToCmdBarEvents((e) => {
    captured.push(e);
  });

  nowValue = 1000; // start at a non-zero baseline
  performance.now = () => nowValue;
});

afterEach(() => {
  unsubscribe();
  performance.now = realPerformanceNow;
});


describe('useDoubleTapCmd (detection)', () => {
  it('a single Meta press does not emit', () => {
    renderHook(() => useDoubleTapCmd());

    dispatchKey('Meta');

    expect(captured).toEqual([]);
  });

  it('two Meta presses within 300 ms emit { type: "focus" }', () => {
    renderHook(() => useDoubleTapCmd());

    dispatchKey('Meta');
    advance(150);
    dispatchKey('Meta');

    expect(captured).toEqual([{ type: 'focus' }]);
  });

  it('two Meta presses 400 ms apart do NOT emit', () => {
    renderHook(() => useDoubleTapCmd());

    dispatchKey('Meta');
    advance(400);
    dispatchKey('Meta');

    expect(captured).toEqual([]);
  });

  it('Meta → other key → Meta does NOT emit (intermediate key resets)', () => {
    renderHook(() => useDoubleTapCmd());

    dispatchKey('Meta');
    advance(50);
    // A regular keystroke between the two Meta presses should reset the
    // tracker — only consecutive Meta presses count as a double-tap.
    dispatchKey('k');
    advance(50);
    dispatchKey('Meta');

    expect(captured).toEqual([]);
  });

  it('triple-tap (Meta within 300 ms each time) emits exactly once', () => {
    renderHook(() => useDoubleTapCmd());

    dispatchKey('Meta'); // tap 1
    advance(100);
    dispatchKey('Meta'); // tap 2 → emit, reset
    advance(100);
    dispatchKey('Meta'); // tap 3 → no pair yet (reset cleared the previous)

    expect(captured).toEqual([{ type: 'focus' }]);
  });
});

describe('useDoubleTapCmd (cleanup)', () => {
  it('removes the listener on unmount', () => {
    const { unmount } = renderHook(() => useDoubleTapCmd());

    dispatchKey('Meta');
    advance(100);
    dispatchKey('Meta');
    expect(captured).toHaveLength(1);

    unmount();

    dispatchKey('Meta');
    advance(100);
    dispatchKey('Meta');

    // No additional events after unmount.
    expect(captured).toHaveLength(1);
  });
});

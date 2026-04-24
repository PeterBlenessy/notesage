// @vitest-environment jsdom

/**
 * Unit tests for useCommandBarShortcuts.
 *
 * Verifies:
 *   - the hook is a no-op when uiPreview === "legacy" (zero listeners,
 *     zero events emitted on shortcut presses)
 *   - the full prefix mapping (⌘K, ⌘1/⌘⇧1, ⌘2/⌘⇧2, ⌘3/⌘⇧3, ⌘4/⌘⇧4, ⌘⇧P, Esc)
 *   - the input-skip rule (don't fire while typing in a non-cmd-bar input)
 *     EXCEPT for ⌘K which is a universal "open command bar" gesture
 *   - cleanup removes the listener on unmount
 *
 * The settings-store is mocked at the module level so individual tests can
 * flip `uiPreview` between "legacy" and "quiet-composer".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { subscribeToCmdBarEvents, type CmdBarEvent } from '@/lib/cmd-bar-events';

// Mutable mock state — tests flip this to test the legacy short-circuit.
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

import { useCommandBarShortcuts } from '@/hooks/useCommandBarShortcuts';

let captured: CmdBarEvent[];
let unsubscribe: () => void;

function dispatchKey(
  key: string,
  options: KeyboardEventInit & { target?: EventTarget } = {},
) {
  const { target, ...init } = options;
  const event = new KeyboardEvent('keydown', { bubbles: true, key, ...init });
  if (target) {
    // jsdom respects dispatchEvent on the actual element; bubbling will reach
    // the window listener registered by the hook.
    target.dispatchEvent(event);
  } else {
    window.dispatchEvent(event);
  }
  return event;
}

beforeEach(() => {
  mockSettings.uiPreview = 'quiet-composer';
  captured = [];
  unsubscribe = subscribeToCmdBarEvents((e) => {
    captured.push(e);
  });
  // Clear any leftover DOM from prior tests.
  document.body.innerHTML = '';
});

afterEach(() => {
  unsubscribe();
});

describe('useCommandBarShortcuts (legacy gating)', () => {
  it('is a no-op when uiPreview === "legacy"', () => {
    mockSettings.uiPreview = 'legacy';
    renderHook(() => useCommandBarShortcuts());

    dispatchKey('k', { metaKey: true });
    dispatchKey('1', { metaKey: true });
    dispatchKey('Escape', {});

    expect(captured).toEqual([]);
  });
});

describe('useCommandBarShortcuts (focus shortcuts)', () => {
  it('⌘K emits { type: "focus" } with no prefix', () => {
    renderHook(() => useCommandBarShortcuts());

    dispatchKey('k', { metaKey: true });

    expect(captured).toEqual([{ type: 'focus' }]);
  });

  it('⌘1 emits { type: "focus", prefix: "!" }', () => {
    renderHook(() => useCommandBarShortcuts());

    dispatchKey('1', { metaKey: true });

    expect(captured).toEqual([{ type: 'focus', prefix: '!' }]);
  });

  it('⌘⇧1 emits the same { type: "focus", prefix: "!" } as ⌘1', () => {
    renderHook(() => useCommandBarShortcuts());

    dispatchKey('1', { metaKey: true, shiftKey: true });

    expect(captured).toEqual([{ type: 'focus', prefix: '!' }]);
  });

  it.each([
    ['2', '@'],
    ['3', '#'],
    ['4', '?'],
  ])('⌘%s emits prefix "%s"', (key, prefix) => {
    renderHook(() => useCommandBarShortcuts());

    dispatchKey(key, { metaKey: true });

    expect(captured).toEqual([{ type: 'focus', prefix }]);
  });

  it('⌘⇧P emits { type: "focus", prefix: ">" }', () => {
    renderHook(() => useCommandBarShortcuts());

    // shifted "p" arrives as "P" on most platforms; the hook should be
    // case-insensitive.
    dispatchKey('P', { metaKey: true, shiftKey: true });

    expect(captured).toEqual([{ type: 'focus', prefix: '>' }]);
  });
});

describe('useCommandBarShortcuts (Esc + input-skip rule)', () => {
  // #114 — Esc emits `{ type: 'dismiss' }` unconditionally, regardless of
  // focus location. The FloatingCommandBar's bus subscriber decides whether
  // to act based on the bar's expanded state; the hook never preventDefaults
  // Esc, so the keydown continues to propagate to the editor / popover /
  // focus-mode fall-through chain.
  it('Esc inside a regular text <input> outside the cmd bar still emits dismiss (#114)', () => {
    renderHook(() => useCommandBarShortcuts());

    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();

    dispatchKey('Escape', { target: input });

    expect(captured).toEqual([{ type: 'dismiss' }]);
  });

  it('Esc inside an <input> WITHIN [data-cmd-bar] DOES emit { type: "dismiss" }', () => {
    renderHook(() => useCommandBarShortcuts());

    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-cmd-bar', '');
    const input = document.createElement('input');
    input.type = 'text';
    wrapper.appendChild(input);
    document.body.appendChild(wrapper);
    input.focus();

    dispatchKey('Escape', { target: input });

    expect(captured).toEqual([{ type: 'dismiss' }]);
  });

  it('⌘K inside a non-cmd-bar input still emits (universal gesture)', () => {
    renderHook(() => useCommandBarShortcuts());

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    dispatchKey('k', { metaKey: true, target: textarea });

    expect(captured).toEqual([{ type: 'focus' }]);
  });

  it('⌘1 inside a non-cmd-bar input DOES fire (2026-04-24 — ⌘-chord, not raw typing)', () => {
    renderHook(() => useCommandBarShortcuts());

    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();

    dispatchKey('1', { metaKey: true, target: input });

    expect(captured).toEqual([{ type: 'focus', prefix: '!' }]);
  });
});

describe('useCommandBarShortcuts (cleanup)', () => {
  it('removes the listener on unmount', () => {
    const { unmount } = renderHook(() => useCommandBarShortcuts());

    dispatchKey('k', { metaKey: true });
    expect(captured).toHaveLength(1);

    unmount();

    dispatchKey('k', { metaKey: true });
    dispatchKey('1', { metaKey: true });
    dispatchKey('2', { metaKey: true });

    // No additional events after unmount.
    expect(captured).toHaveLength(1);
  });
});

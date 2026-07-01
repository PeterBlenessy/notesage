// @vitest-environment jsdom

/**
 * Regression lock for the "StatusTray popover always opened on the far-left
 * of the status bar" bug. Root cause: `QuietStatusBar` passed a ref to the
 * whole status-strip div into `StatusTray.anchor`, so Radix anchored the
 * popover to the strip's full bounding rect (left edge, regardless of
 * where the user clicked). The fix: feed `StatusTray` a virtual ref whose
 * `getBoundingClientRect()` returns a zero-size rect at the click point.
 *
 * These tests mock `StatusTray` with a thin pass-through so we can capture
 * the `anchor` ref directly and assert on its `getBoundingClientRect()` —
 * no Radix positioning / ResizeObserver needed. Tests live in a separate
 * file so the module-level `vi.mock` doesn't affect the sibling
 * `StatusTray.test.tsx` suite (which imports the real component).
 */

import '@/test/tauri-mock';
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  renderWithProviders,
  registerDefaultHandlers,
  fireEvent,
  act,
} from '@/test/component-harness';
import { StatusBar } from '@/components/editor/StatusBar';
import { useEditorStore } from '@/stores/editor-store';

// ---------------------------------------------------------------------------
// Module-level mock — replaces the real StatusTray with a capturing stub so
// we can inspect the `anchor` ref without mounting Radix.
// ---------------------------------------------------------------------------

interface TrayCapture {
  lastAnchor: React.RefObject<
    { getBoundingClientRect(): DOMRect } | null
  > | null;
  lastOpen: boolean;
}

function getCapture(): TrayCapture {
  return (
    globalThis as unknown as { __statusTrayCapture: TrayCapture }
  ).__statusTrayCapture;
}

function resetCapture() {
  (
    globalThis as unknown as { __statusTrayCapture: TrayCapture }
  ).__statusTrayCapture = { lastAnchor: null, lastOpen: false };
}

vi.mock('@/components/editor/StatusTray', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/components/editor/StatusTray')
  >();
  return {
    ...actual,
    StatusTray(props: React.ComponentProps<typeof actual.StatusTray>) {
      const cap = (
        globalThis as unknown as { __statusTrayCapture?: TrayCapture }
      ).__statusTrayCapture;
      if (cap) {
        cap.lastAnchor = props.anchor as TrayCapture['lastAnchor'];
        cap.lastOpen = props.open;
      }
      return null;
    },
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StatusTray — popover anchors to click coordinates', () => {
  beforeEach(() => {
    registerDefaultHandlers();
    resetCapture();
    useEditorStore.setState({
      openDocuments: [],
      activeTabId: null,
      recentFiles: [],
      scrollPositions: {},
      externalChanges: {},
      pendingCloseTabId: null,
      persistedTabs: [],
      persistedActiveFilePath: null,
    });
  });

  it('clicking at (clientX, clientY) makes anchor.getBoundingClientRect return that point', () => {
    renderWithProviders(<StatusBar editor={null} />);
    const strip = document.querySelector('[data-quiet-status]') as HTMLElement;
    expect(strip).toBeTruthy();

    act(() => {
      fireEvent.click(strip, { clientX: 512, clientY: 720 });
    });

    const capture = getCapture();
    expect(capture.lastOpen).toBe(true);
    const rect = capture.lastAnchor?.current?.getBoundingClientRect();
    expect(rect).toBeTruthy();
    expect(rect!.left).toBe(512);
    expect(rect!.top).toBe(720);
    // Zero-size rect at the click point — Radix uses this with
    // `side="top" align="start"` to place the popover just above the
    // click, left-aligned to the click's X.
    expect(rect!.width).toBe(0);
    expect(rect!.height).toBe(0);
  });

  it('a second click at a different position updates the anchor for the next open', () => {
    renderWithProviders(<StatusBar editor={null} />);
    const strip = document.querySelector('[data-quiet-status]') as HTMLElement;

    act(() => {
      fireEvent.click(strip, { clientX: 100, clientY: 50 });
    });
    const capture = getCapture();
    let rect = capture.lastAnchor?.current?.getBoundingClientRect();
    expect(rect?.left).toBe(100);
    expect(rect?.top).toBe(50);

    // Same strip, different click location — the anchor must reflect
    // the new click, not cling to the first one.
    act(() => {
      fireEvent.click(strip, { clientX: 900, clientY: 300 });
    });
    rect = capture.lastAnchor?.current?.getBoundingClientRect();
    expect(rect?.left).toBe(900);
    expect(rect?.top).toBe(300);
  });

  it('keyboard activation (Enter) falls back to the strip rect, not the stale click rect', () => {
    renderWithProviders(<StatusBar editor={null} />);
    const strip = document.querySelector('[data-quiet-status]') as HTMLElement;

    // Stub the strip's own rect so we can tell the fallback branch was
    // taken (the keyboard path has no clientX/Y, so the anchor must fall
    // back to the strip itself).
    const fallbackRect = new DOMRect(42, 84, 640, 32);
    strip.getBoundingClientRect = () => fallbackRect;

    act(() => {
      fireEvent.keyDown(strip, { key: 'Enter' });
    });

    const capture = getCapture();
    expect(capture.lastOpen).toBe(true);
    const rect = capture.lastAnchor?.current?.getBoundingClientRect();
    expect(rect?.left).toBe(42);
    expect(rect?.top).toBe(84);
  });
});

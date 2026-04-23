/**
 * Unit tests for tree-overlay-store — the open/closed signal that drives the
 * TreeOverlay slide-in (PRD `2026-04-21-ui-refresh`, task #38).
 *
 * The store is intentionally tiny. These tests lock in:
 *   - initial state (closed, no focused path);
 *   - `openOverlay()` without arguments;
 *   - `openOverlay(path)` with the optional focused path;
 *   - `closeOverlay()` resetting both fields.
 *
 * No persistence, no async, no Tauri. Plain Zustand state machine.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { useTreeOverlayStore } from '@/stores/tree-overlay-store';

beforeEach(() => {
  // Ensure each test starts from a closed overlay.
  useTreeOverlayStore.setState({ open: false, focusedPath: null });
});

describe('tree-overlay-store', () => {
  it('starts closed with no focused path', () => {
    const state = useTreeOverlayStore.getState();
    expect(state.open).toBe(false);
    expect(state.focusedPath).toBeNull();
  });

  it('openOverlay() without a path opens the overlay and leaves focusedPath null', () => {
    useTreeOverlayStore.getState().openOverlay();
    const state = useTreeOverlayStore.getState();
    expect(state.open).toBe(true);
    expect(state.focusedPath).toBeNull();
  });

  it('openOverlay(path) opens the overlay and records the focused path', () => {
    useTreeOverlayStore.getState().openOverlay('/Users/me/projects/alpha');
    const state = useTreeOverlayStore.getState();
    expect(state.open).toBe(true);
    expect(state.focusedPath).toBe('/Users/me/projects/alpha');
  });

  it('closeOverlay() resets both open and focusedPath', () => {
    useTreeOverlayStore.getState().openOverlay('/some/path');
    expect(useTreeOverlayStore.getState().open).toBe(true);
    expect(useTreeOverlayStore.getState().focusedPath).toBe('/some/path');

    useTreeOverlayStore.getState().closeOverlay();
    const state = useTreeOverlayStore.getState();
    expect(state.open).toBe(false);
    expect(state.focusedPath).toBeNull();
  });

  it('re-opening with a different path updates focusedPath', () => {
    useTreeOverlayStore.getState().openOverlay('/first');
    useTreeOverlayStore.getState().openOverlay('/second');
    expect(useTreeOverlayStore.getState().focusedPath).toBe('/second');
  });

  it('re-opening without a path after a focused open clears focusedPath', () => {
    useTreeOverlayStore.getState().openOverlay('/first');
    useTreeOverlayStore.getState().openOverlay();
    expect(useTreeOverlayStore.getState().open).toBe(true);
    expect(useTreeOverlayStore.getState().focusedPath).toBeNull();
  });
});

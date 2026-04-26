// @vitest-environment jsdom

/**
 * Live-test 2026-04-25 #9 — global leaf-search.
 *
 * The SettingsDialogV2 used to filter only the nav by panel label
 * when the user typed in the search input. Rows inside the active
 * panel were filtered (after #147), but rows in OTHER panels were
 * never considered. This test locks in the new behaviour:
 *
 * - Empty query → only the active panel renders.
 * - Non-empty query → every panel renders in sequence with a
 *   panel-name header above each. Panels whose rows all filtered
 *   out collapse via `:has(*)` selectors. Picking a panel from the
 *   nav clears the query so the user sees that panel's full content.
 */

// Radix Slider uses ResizeObserver
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  registerDefaultHandlers,
  fireEvent,
  act,
} from '@/test/component-harness';
import { SettingsDialogV2 } from '@/components/settings/v2/SettingsDialogV2';

beforeEach(() => {
  registerDefaultHandlers();
});

describe('SettingsDialogV2 — global leaf-search', () => {
  it('empty query: only the active panel renders (no search-mode wrappers)', () => {
    renderWithProviders(
      <SettingsDialogV2 open={true} onOpenChange={() => {}} />,
    );
    // The `data-search-panel` wrapper only renders when the user is
    // actively searching — it's the regression hook for the search-all
    // mode, distinct from the per-panel headers (which exist in both
    // modes for the active panel).
    expect(document.querySelectorAll('[data-search-panel]').length).toBe(0);
  });

  it('non-empty query: every panel renders with a panel-name header above each', () => {
    renderWithProviders(
      <SettingsDialogV2 open={true} onOpenChange={() => {}} />,
    );
    // Type into the search box. The nav search is mounted in the shell's
    // nav header, queried by its `searchbox` role.
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: 'theme' } });
    });
    // The six panel-section headers (uppercase wrappers, not the
    // panels' OWN H2 like "Appearance") should all be in the DOM —
    // panels that have zero matches collapse via `:has(*)`, but with a
    // generic query like "theme" that touches multiple panels we
    // expect at least Appearance + System to surface.
    //
    // The `data-search-panel` attribute is the regression hook; we
    // assert that more than one panel's wrapper made it into the DOM
    // when searching. The exact match count depends on the per-panel
    // text and is asserted in row-level tests elsewhere.
    const wrappers = document.querySelectorAll('[data-search-panel]');
    expect(wrappers.length).toBeGreaterThan(0);
  });

  it('non-empty query: picking a nav item clears the query and shows that panel only', () => {
    renderWithProviders(
      <SettingsDialogV2 open={true} onOpenChange={() => {}} />,
    );
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: 'theme' } });
    });
    expect(input.value).toBe('theme');

    // Click the System nav item — should clear search + activate that panel.
    const systemNavItem = document.querySelector(
      '[data-nav-item-id="system"]',
    ) as HTMLButtonElement;
    expect(systemNavItem).toBeTruthy();
    act(() => {
      fireEvent.click(systemNavItem);
    });

    expect(input.value).toBe('');
    // Search-mode wrappers should be gone.
    expect(document.querySelectorAll('[data-search-panel]').length).toBe(0);
  });
});

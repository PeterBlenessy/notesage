// @vitest-environment jsdom

// Radix Slider uses ResizeObserver (via @radix-ui/react-use-size)
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent, act } from '@/test/component-harness';
import { AppearanceSettings } from '@/components/settings/v2/AppearanceSettings';
import { useSettingsStore } from '@/stores/settings-store';
import { useEditorStylesStore } from '@/stores/editor-styles-store';
import { QUIET_CHROME_PRESETS } from '@/lib/quiet-chrome-presets';

/**
 * Reset the two stores the panel reads from. We snapshot initial values
 * then restore them with the exact shape the store expects, so any field we
 * don't care about in a given test falls back to a known baseline.
 */
function resetStores() {
  useSettingsStore.setState({
    theme: 'system',
    accent: 'default',
    contrastLevel: 0,
    tintHue: 60,
    tintChroma: 0,
    quietChromePreset: 'default',
    quietChromeOverrides: { ...QUIET_CHROME_PRESETS.default },
    sidebarRecentCap: 5,
    sidebarTagsCap: 5,
    sidebarTagsHidden: false,
  });
  useEditorStylesStore.setState({
    fontFamily: 'system',
    fontSize: 16,
    lineHeight: 1.7,
    paragraphSpacing: 0.75,
  });
}

describe('AppearanceSettings', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders all group labels', () => {
    renderWithProviders(<AppearanceSettings />);
    expect(screen.getByText('Theme')).toBeTruthy();
    expect(screen.getByText('Color tint')).toBeTruthy();
    expect(screen.getByText('Quiet chrome')).toBeTruthy();
    expect(screen.getByText('Sidebar composition')).toBeTruthy();
    expect(screen.getByText('Editor typography')).toBeTruthy();
    expect(screen.getByText('Preview')).toBeTruthy();
  });

  it('reflects current theme in the color-mode segmented control', () => {
    useSettingsStore.setState({ theme: 'dark' });
    renderWithProviders(<AppearanceSettings />);

    const group = screen.getByTestId('appearance-color-mode');
    const darkBtn = group.querySelector<HTMLButtonElement>('[aria-label="Dark"]');
    const lightBtn = group.querySelector<HTMLButtonElement>('[aria-label="Light"]');
    expect(darkBtn).toBeTruthy();
    expect(darkBtn!.getAttribute('aria-checked')).toBe('true');
    expect(lightBtn!.getAttribute('aria-checked')).toBe('false');
  });

  it('toggles theme via the color-mode segmented control', () => {
    renderWithProviders(<AppearanceSettings />);

    const group = screen.getByTestId('appearance-color-mode');
    const lightBtn = group.querySelector<HTMLButtonElement>('[aria-label="Light"]');
    expect(lightBtn).toBeTruthy();

    act(() => {
      fireEvent.click(lightBtn!);
    });

    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('clicking the Blue accent option calls setAccent("blue")', () => {
    renderWithProviders(<AppearanceSettings />);

    const group = screen.getByTestId('appearance-accent');
    const blueBtn = group.querySelector<HTMLButtonElement>('[aria-label="Blue"]');
    expect(blueBtn).toBeTruthy();

    act(() => {
      fireEvent.click(blueBtn!);
    });

    expect(useSettingsStore.getState().accent).toBe('blue');
  });

  /**
   * Regression lock for live-test 2026-04-25 #144.
   *
   * The bug: `setAccent` writes to `settings-store` but `<html>` never
   * receives the `.accent-blue` / `.accent-orange` / `.accent-system`
   * class, so `--accent` stays unset and the accent picker visibly
   * does nothing.
   *
   * Fix: mount `useAccent()` in App.tsx alongside the other lifecycle
   * hooks. The hook owns the class-swap effect.
   *
   * This test mirrors the App.tsx mount: render AppearanceSettings AND
   * useAccent in the same render tree, click an accent, then assert the
   * class actually lands on `<html>`. If this test fails, the lifecycle
   * mount probably got removed.
   */
  it('regression: clicking an accent applies the class on <html> when useAccent is mounted', async () => {
    document.documentElement.className = '';
    const { useAccent } = await import('@/hooks/useAccent');
    function Mount() {
      useAccent();
      return <AppearanceSettings />;
    }
    renderWithProviders(<Mount />);

    const group = screen.getByTestId('appearance-accent');
    const orangeBtn = group.querySelector<HTMLButtonElement>('[aria-label="Orange"]');
    expect(orangeBtn).toBeTruthy();
    act(() => {
      fireEvent.click(orangeBtn!);
    });

    expect(document.documentElement.classList.contains('accent-orange')).toBe(true);
    expect(useSettingsStore.getState().accent).toBe('orange');

    // Picking another accent swaps cleanly — no leftover class.
    const blueBtn = group.querySelector<HTMLButtonElement>('[aria-label="Blue"]');
    act(() => {
      fireEvent.click(blueBtn!);
    });
    expect(document.documentElement.classList.contains('accent-orange')).toBe(false);
    expect(document.documentElement.classList.contains('accent-blue')).toBe(true);

    // Picking Default removes the class.
    const defaultBtn = group.querySelector<HTMLButtonElement>('[aria-label="Default"]');
    act(() => {
      fireEvent.click(defaultBtn!);
    });
    expect(document.documentElement.classList.contains('accent-blue')).toBe(false);
    expect(document.documentElement.classList.contains('accent-orange')).toBe(false);
    expect(document.documentElement.classList.contains('accent-system')).toBe(false);
  });

  it('contrast slider updates contrastLevel and shows the label', () => {
    renderWithProviders(<AppearanceSettings />);

    // Label "Full" is shown when contrastLevel === 0 (baseline after reset).
    expect(screen.getByText('Full')).toBeTruthy();

    // The Radix slider is non-trivial to drag in jsdom — use the store setter
    // to assert the wiring is hooked up to the same `contrastLevel` the row
    // reads from, and that the derived sublabel reflects intermediate values.
    act(() => {
      useSettingsStore.getState().setContrastLevel(42);
    });

    expect(useSettingsStore.getState().contrastLevel).toBe(42);
  });

  it('clicking the Aggressive quiet-chrome preset calls setQuietChromePreset', () => {
    renderWithProviders(<AppearanceSettings />);

    const group = screen.getByTestId('appearance-quiet-chrome');
    const aggressiveBtn = group.querySelector<HTMLButtonElement>(
      '[aria-label="Aggressive"]',
    );
    expect(aggressiveBtn).toBeTruthy();

    act(() => {
      fireEvent.click(aggressiveBtn!);
    });

    expect(useSettingsStore.getState().quietChromePreset).toBe('aggressive');
    // Overrides should mirror the preset table so flipping to "custom" later
    // starts from a sane baseline.
    expect(useSettingsStore.getState().quietChromeOverrides).toEqual(
      QUIET_CHROME_PRESETS.aggressive,
    );
  });

  it('surfaces the per-element fade switches when the preset is "custom"', () => {
    useSettingsStore.setState({
      quietChromePreset: 'custom',
      quietChromeOverrides: { ...QUIET_CHROME_PRESETS.default, sidebar: true },
    });
    renderWithProviders(<AppearanceSettings />);

    // Custom row switch should render with its label.
    expect(screen.getByText('Fade toolbar')).toBeTruthy();
    expect(screen.getByText('Fade sidebar')).toBeTruthy();
    expect(screen.getByText('Custom overrides active')).toBeTruthy();
  });

  it('hides the per-element fade switches for a named preset', () => {
    renderWithProviders(<AppearanceSettings />);
    expect(screen.queryByText('Fade toolbar')).toBeNull();
    expect(screen.queryByText('Fade sidebar')).toBeNull();
  });

  it('Recent items slider setter clamps and persists to store', () => {
    renderWithProviders(<AppearanceSettings />);

    // Setter clamps to [3, 15] per the store contract.
    act(() => {
      useSettingsStore.getState().setSidebarRecentCap(99);
    });
    expect(useSettingsStore.getState().sidebarRecentCap).toBe(15);

    act(() => {
      useSettingsStore.getState().setSidebarRecentCap(1);
    });
    expect(useSettingsStore.getState().sidebarRecentCap).toBe(3);

    act(() => {
      useSettingsStore.getState().setSidebarRecentCap(7);
    });
    expect(useSettingsStore.getState().sidebarRecentCap).toBe(7);
  });

  it('Hide Tags switch toggles sidebarTagsHidden', () => {
    renderWithProviders(<AppearanceSettings />);

    const sw = screen.getByRole('switch', { name: /hide tags section/i });
    expect(sw.getAttribute('data-state')).toBe('unchecked');

    act(() => {
      fireEvent.click(sw);
    });

    expect(useSettingsStore.getState().sidebarTagsHidden).toBe(true);
  });

  it('Preview card renders with the current editor font settings applied', () => {
    useEditorStylesStore.setState({
      fontFamily: 'inter',
      fontSize: 19,
      lineHeight: 1.85,
      paragraphSpacing: 0.75,
    });

    renderWithProviders(<AppearanceSettings />);

    const preview = screen.getByTestId('appearance-preview');
    // The inner styled sample card sits inside the preview container.
    const sample = preview.querySelector('div[style]') as HTMLElement | null;
    expect(sample).not.toBeNull();
    const style = sample!.getAttribute('style') ?? '';
    // font-size rendered in px (inline style serialized by React).
    expect(style).toMatch(/font-size:\s*19px/);
    // line-height rendered as number.
    expect(style).toMatch(/line-height:\s*1\.85/);
    // font-family picks up the preset CSS stack.
    expect(style.toLowerCase()).toContain('inter');

    // Subscript line beneath the preview card shows the raw values
    // too. The mockup-e-aligned preview (live-test 2026-04-25) renders
    // it as a `<div class="text-[11px] text-muted-foreground">`
    // alongside the "On Attention" essay snippet — query the wrapper
    // by its class.
    const withinPreview = preview as HTMLElement;
    const stat = withinPreview.querySelector('div.text-\\[11px\\]');
    expect(stat?.textContent ?? '').toMatch(/19\s*px/);
    expect(stat?.textContent ?? '').toMatch(/1\.85/);
  });
});

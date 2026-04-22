// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderWithProviders } from '@/test/component-harness';
import { act } from '@testing-library/react';
import { ThemeProvider } from '@/components/ThemeProvider';
import { useSettingsStore } from '@/stores/settings-store';

// Why: ThemeProvider asks `window.matchMedia` only when theme === "system".
// jsdom does not implement matchMedia, so each test installs a fresh stub
// before rendering. We restore the original after each test to avoid leaking
// the stub between cases (the dark/light cases never call matchMedia, but a
// stale stub would mask regressions if those code paths started using it).
type MatchMediaFn = (query: string) => MediaQueryList;
const originalMatchMedia = window.matchMedia as MatchMediaFn | undefined;

function installMatchMedia(prefersDark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('dark') ? prefersDark : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as MatchMediaFn;
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('light', 'dark');
    useSettingsStore.setState({
      theme: 'system',
      contrastLevel: 0,
      tintHue: 60,
      tintChroma: 0,
    });
  });

  afterEach(() => {
    document.documentElement.classList.remove('light', 'dark');
    if (originalMatchMedia) {
      window.matchMedia = originalMatchMedia;
    } else {
      // @ts-expect-error - jsdom may not define matchMedia by default
      delete window.matchMedia;
    }
  });

  it('adds the "light" class on documentElement when theme is "light"', () => {
    useSettingsStore.setState({ theme: 'light' });
    renderWithProviders(<ThemeProvider>{null}</ThemeProvider>);
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('adds the "dark" class on documentElement when theme is "dark"', () => {
    useSettingsStore.setState({ theme: 'dark' });
    renderWithProviders(<ThemeProvider>{null}</ThemeProvider>);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  it('resolves "system" theme via matchMedia (prefers dark)', () => {
    installMatchMedia(true);
    useSettingsStore.setState({ theme: 'system' });
    renderWithProviders(<ThemeProvider>{null}</ThemeProvider>);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  // Why: jsdom does not load real CSS, so getComputedStyle cannot resolve
  // CSS variables defined in globals.css. The contract this test locks in is
  // narrower but still load-bearing: the JS class setter and the CSS selector
  // strategy must agree. We assert the class flips on theme change — the
  // .dark / .light selectors in globals.css are the documented hook for every
  // CSS variable, so a class flip implies a variable resolution change at
  // runtime. Any future drift to data-theme attributes would break this test.
  it('flips documentElement class when theme changes from light to dark', () => {
    useSettingsStore.setState({ theme: 'light' });
    renderWithProviders(<ThemeProvider>{null}</ThemeProvider>);
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    act(() => {
      useSettingsStore.getState().setTheme('dark');
    });

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

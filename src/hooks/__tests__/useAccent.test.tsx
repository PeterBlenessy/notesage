// @vitest-environment jsdom

/**
 * Unit tests for useAccent hook.
 *
 * Covers: default accent value from settings-store, class swap on
 * setAccentName, system accent fetch via Tauri command + property write,
 * graceful fallback when the Tauri command returns null.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { useAccent } from '@/hooks/useAccent';
import { useSettingsStore } from '@/stores/settings-store';

beforeEach(() => {
  // Reset documentElement state
  document.documentElement.className = '';
  document.documentElement.style.removeProperty('--accent-system-value');
  // Reset settings-store accent to default
  useSettingsStore.setState({ accent: 'default' });
});

describe('useAccent', () => {
  it('default accent value is "default"', () => {
    const { result } = renderHook(() => useAccent());
    expect(result.current.accent).toBe('default');
    expect(document.documentElement.classList.contains('accent-orange')).toBe(false);
    expect(document.documentElement.classList.contains('accent-blue')).toBe(false);
    expect(document.documentElement.classList.contains('accent-system')).toBe(false);
  });

  it('setAccentName("orange") triggers accent-orange class on documentElement', async () => {
    const { result } = renderHook(() => useAccent());

    act(() => {
      result.current.setAccentName('orange');
    });

    await waitFor(() => {
      expect(document.documentElement.classList.contains('accent-orange')).toBe(true);
    });
    expect(result.current.accent).toBe('orange');
  });

  it('setAccentName("system") invokes Tauri command and sets --accent-system-value', async () => {
    setMockInvokeHandler('get_system_accent_color', () => 'oklch(58% 0.18 50)');

    const { result } = renderHook(() => useAccent());

    act(() => {
      result.current.setAccentName('system');
    });

    await waitFor(() => {
      expect(document.documentElement.classList.contains('accent-system')).toBe(true);
    });
    await waitFor(() => {
      expect(
        document.documentElement.style.getPropertyValue('--accent-system-value'),
      ).toBe('oklch(58% 0.18 50)');
    });
  });

  it('setAccentName("system") with null Tauri response leaves --accent-system-value unset', async () => {
    setMockInvokeHandler('get_system_accent_color', () => null);

    const { result } = renderHook(() => useAccent());

    act(() => {
      result.current.setAccentName('system');
    });

    await waitFor(() => {
      expect(document.documentElement.classList.contains('accent-system')).toBe(true);
    });
    // Give the async command a tick to resolve
    await new Promise((r) => setTimeout(r, 0));
    expect(
      document.documentElement.style.getPropertyValue('--accent-system-value'),
    ).toBe('');
  });

  /**
   * Live-test 2026-04-25 — the System swatch in the AppearanceSettings
   * picker showed the orange fallback even when the user's actual
   * macOS accent was blue, because the fetch only ran when the user
   * had ALREADY picked System. The hook now fetches on mount
   * unconditionally so `--accent-system-value` is always populated.
   */
  it('fetches the system accent on mount regardless of the currently-picked accent', async () => {
    setMockInvokeHandler('get_system_accent_color', () => 'oklch(56% 0.16 253)');
    // Default accent (no override) — the fetch should still run.
    useSettingsStore.setState({ accent: 'default' });

    renderHook(() => useAccent());

    await waitFor(() => {
      expect(
        document.documentElement.style.getPropertyValue('--accent-system-value'),
      ).toBe('oklch(56% 0.16 253)');
    });
    // The user hasn't picked System, so no `.accent-system` class.
    expect(
      document.documentElement.classList.contains('accent-system'),
    ).toBe(false);
  });

  /**
   * Live-test 2026-04-25 — when the user changes the accent in macOS
   * System Settings while the app is running, they almost always
   * switch back to Notesage. The window-focus event triggers a
   * re-fetch so the System swatch reflects the new colour without
   * a manual app refresh. Until a native
   * `NSDistributedNotificationCenter` observer lands, this is the
   * pragmatic catch-it-on-foreground approach.
   */
  it('re-fetches the system accent when the window regains focus', async () => {
    let currentValue: string | null = 'oklch(68% 0.21 37)'; // start orange
    setMockInvokeHandler('get_system_accent_color', () => currentValue);
    useSettingsStore.setState({ accent: 'system' });

    renderHook(() => useAccent());

    await waitFor(() => {
      expect(
        document.documentElement.style.getPropertyValue('--accent-system-value'),
      ).toBe('oklch(68% 0.21 37)');
    });

    // User changes the system accent to blue while the app is in the
    // background. macOS doesn't push that into the foreground process,
    // so the value the hook holds is stale.
    currentValue = 'oklch(56% 0.16 253)';

    // User switches back to the app → window focus event fires.
    act(() => {
      window.dispatchEvent(new FocusEvent('focus'));
    });

    await waitFor(() => {
      expect(
        document.documentElement.style.getPropertyValue('--accent-system-value'),
      ).toBe('oklch(56% 0.16 253)');
    });
  });
});

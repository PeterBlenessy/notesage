/**
 * useAccent — applies the current accent class to `<html>` and pulls the macOS
 * system accent color into `--accent-system-value` when accent is "system".
 *
 * State: read from settings-store. The class swap happens in an effect so the
 * DOM stays in sync with the persisted setting (including after restart).
 *
 * The `get_system_accent_color` Tauri command is added in ui-refresh task #4 —
 * on macOS it returns an oklch string, on other platforms it returns null
 * (and we fall back to the default `--accent-system-value` baked into globals.css).
 * The invoke is wrapped in try/catch so the hook works even before #4 lands.
 */
import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '@/stores/settings-store';
import { setAccent, setSystemAccentValue, type AccentName } from '@/lib/accent';
import { log } from '@/lib/logger';

export interface UseAccentResult {
  accent: AccentName;
  setAccentName: (name: AccentName) => void;
}

export function useAccent(): UseAccentResult {
  const accent = useSettingsStore((s) => s.accent);
  const setAccentName = useSettingsStore((s) => s.setAccent);

  // Live-test 2026-04-25 — fetch the macOS system accent eagerly on mount
  // (regardless of which accent the user has currently picked) so the
  // "System" swatch in the AppearanceSettings picker shows the actual
  // system colour from the start. Previously the fetch only ran when
  // `accent === 'system'`, so the picker dot rendered the orange
  // fallback (`var(--accent-system-value, oklch(68% 0.21 37))`) until
  // the user picked System — confusing if their actual system accent
  // was blue.
  //
  // Real-time changes: macOS doesn't push accent changes into a
  // running window's foreground process unless we register an
  // `NSDistributedNotificationCenter` observer for
  // `AppleAccentColorPreferencesNotification`. That's a Rust-side
  // change. Until then, we re-fetch on window focus — when the user
  // changes the accent in System Settings they almost always switch
  // back to Notesage, and the focus event catches the change without
  // any native plumbing. Visibility-change is also wired so iPad-
  // style background-foreground transitions work too.
  useEffect(() => {
    let cancelled = false;

    const fetchAndApply = async () => {
      try {
        const value = await invoke<string | null>('get_system_accent_color');
        if (cancelled) return;
        setSystemAccentValue(value ?? null);
      } catch (err) {
        if (!cancelled) {
          setSystemAccentValue(null);
          log.debug('useAccent', 'get_system_accent_color unavailable, using default', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    };

    void fetchAndApply();

    const onFocusOrVisible = () => {
      if (document.visibilityState === 'hidden') return;
      void fetchAndApply();
    };

    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
    };
  }, []);

  // Apply the chosen accent class to <html>. This is its own effect so
  // the system-value fetch above doesn't re-run on every accent change.
  useEffect(() => {
    setAccent(accent);
  }, [accent]);

  return { accent, setAccentName };
}

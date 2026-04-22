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

  useEffect(() => {
    setAccent(accent);

    if (accent === 'system') {
      let cancelled = false;
      void (async () => {
        try {
          const value = await invoke<string | null>('get_system_accent_color');
          if (cancelled) return;
          setSystemAccentValue(value ?? null);
        } catch (err) {
          // Command may not exist yet (task #4 lands separately) or fail on
          // non-macOS — fall back to the default oklch baked into globals.css.
          if (!cancelled) {
            setSystemAccentValue(null);
            log.debug('useAccent', 'get_system_accent_color unavailable, using default', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    } else {
      // Clear any stale system value when the user picks a different accent.
      setSystemAccentValue(null);
    }
  }, [accent]);

  return { accent, setAccentName };
}

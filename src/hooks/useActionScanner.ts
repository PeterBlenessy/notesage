import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useSettingsStore } from '@/stores/settings-store';
import { useActionStore } from '@/stores/action-store';

/**
 * Orchestrates action scanning. Triggers fullScan on startup and
 * incremental updates on file change events.
 *
 * Must be mounted in App.tsx.
 */
export function useActionScanner() {
  const startupReady = useSettingsStore((s) => s.startupReady);
  const hasScanned = useRef(false);

  // Full scan once on startup
  useEffect(() => {
    if (!startupReady || hasScanned.current) return;
    hasScanned.current = true;
    useActionStore.getState().fullScan();
  }, [startupReady]);

  // Listen for file-changed events and trigger incremental update (debounced)
  useEffect(() => {
    if (!startupReady) return;

    let mounted = true;
    let unlistenFn: (() => void) | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const pendingPaths = new Set<string>();

    listen<{ path: string; kind: string }[]>('file-changed-batch', (event) => {
      if (!mounted) return;

      const batch = event.payload;
      if (!batch || batch.length === 0) return;

      for (const { path } of batch) {
        // Only care about markdown files and comment files
        if (!path.endsWith('.md') && !path.endsWith('.json')) continue;
        pendingPaths.add(path);
      }

      if (pendingPaths.size === 0) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const store = useActionStore.getState();
        // If multiple files changed, just do a full rescan
        if (pendingPaths.size > 5) {
          store.fullScan();
        } else {
          for (const p of pendingPaths) {
            store.incrementalUpdate(p);
          }
        }
        pendingPaths.clear();
      }, 500);
    }).then((fn) => {
      if (mounted) {
        unlistenFn = fn;
      } else {
        // Already unmounted — clean up immediately
        fn();
      }
    });

    return () => {
      mounted = false;
      unlistenFn?.();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [startupReady]);
}

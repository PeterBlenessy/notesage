import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useSettingsStore } from '@/stores/settings-store';
import { useActionStore } from '@/stores/action-store';

/**
 * Orchestrates action scanning. Triggers fullScan once the startup index pass
 * has settled and reports changed files to the store afterwards.
 *
 * Gated on `indexReady`, not `startupReady`: tasks and goals are read from the
 * SQLite index, and the UI no longer waits for that to be built. Until it is,
 * the Actions view shows the actions persisted from the last session.
 *
 * Must be mounted in App.tsx.
 */
export function useActionScanner() {
  const indexReady = useSettingsStore((s) => s.indexReady);
  const hasScanned = useRef(false);

  // Full scan once, when the index can answer in full
  useEffect(() => {
    if (!indexReady || hasScanned.current) return;
    hasScanned.current = true;
    useActionStore.getState().fullScan();
  }, [indexReady]);

  // Listen for changed files and report them to the store. The store does
  // the coalescing (one scan per project per debounce window, shared with the
  // save path) and drops paths that cannot hold actions, so nothing is
  // debounced or filtered a second time here.
  //
  // Two events for changed files, because neither covers everything:
  //  - `file-changed-batch` is every external change, comment sidecars
  //    included, but leaves out the app's own saves;
  //  - `links-reindexed` fires once the index has actually taken a change in,
  //    own saves included. Tasks and goals are read from the index, so this is
  //    the one that makes the Actions view reflect a save: the scan the save
  //    itself requests can run before the backend has reindexed the file.
  useEffect(() => {
    if (!indexReady) return;

    let mounted = true;
    const unlistenFns: Array<() => void> = [];
    const keep = (fn: () => void) => {
      if (mounted) {
        unlistenFns.push(fn);
      } else {
        // Already unmounted — clean up immediately
        fn();
      }
    };
    const report = (paths: string[]) => {
      const store = useActionStore.getState();
      for (const path of paths) {
        void store.incrementalUpdate(path);
      }
    };

    listen<{ path: string; kind: string }[]>('file-changed-batch', (event) => {
      if (!mounted) return;
      const batch = event.payload;
      if (!batch || batch.length === 0) return;
      report(batch.map((change) => change.path));
    }).then(keep);

    listen<string[]>('links-reindexed', (event) => {
      if (!mounted) return;
      const paths = event.payload;
      if (!Array.isArray(paths) || paths.length === 0) return;
      report(paths);
    }).then(keep);

    // A project's index pass finished after startup: a project that was added,
    // renamed or moved mid-session (`useProjectIndexSync`), or one whose index
    // was rebuilt. Its tasks and goals are in the index only now, and no file
    // changed to say so. The startup pass's own `index-ready` events come
    // before this listener exists; the full scan above covers those.
    listen<{ project_path?: string | null }>('index-ready', (event) => {
      if (!mounted) return;
      const root = event.payload?.project_path;
      if (typeof root !== 'string' || root === '') return;
      void useActionStore.getState().refreshRoot(root);
    }).then(keep);

    return () => {
      mounted = false;
      for (const fn of unlistenFns) fn();
    };
  }, [indexReady]);
}

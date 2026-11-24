import { useEffect } from "react";
import { tauriApi } from "@/lib/tauri";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";

/** Separates root paths in an effect key. Cannot occur in a path. */
const KEY_SEPARATOR = "\n";

/** The paths in an effect key (none for the empty key). */
function splitKey(key: string): string[] {
  return key === "" ? [] : key.split(KEY_SEPARATOR);
}

/** `path` lies strictly beneath `root`. */
function isUnder(path: string, root: string): boolean {
  return path.startsWith(root.endsWith("/") ? root : `${root}/`);
}

/**
 * The roots that need a watch of their own: every root that does not lie
 * under another root in the list. A watch is recursive, so events for a
 * project inside the library already arrive through the library's watch;
 * registering it again only makes the backend walk the same files once more.
 *
 * Each kept root is paired with the roots it stands in for, so they can be
 * watched directly if the covering watch cannot be started.
 */
export function coveringWatchRoots(roots: readonly string[]): Array<{ root: string; covers: string[] }> {
  const unique = [...new Set(roots)];
  const kept = unique.filter((root) => !unique.some((other) => other !== root && isUnder(root, other)));
  return kept.map((root) => ({
    root,
    covers: unique.filter((other) => other !== root && isUnder(other, root)),
  }));
}

/** Watch each covering root; fall back to what it covered if it cannot be watched. */
function watchRoots(roots: readonly string[]): void {
  for (const { root, covers } of coveringWatchRoots(roots)) {
    tauriApi.watchDirectory(root).catch((err) => {
      console.error(`Failed to watch ${root}:`, err);
      // The roots beneath it were relying on this watch for their events.
      if (covers.length > 0) watchRoots(covers);
    });
  }
}

/**
 * Start filesystem watchers for all relevant directories.
 * Called once at startup, re-runs when the SET of roots changes (a project
 * or folder added, removed, renamed or moved) — not when a tree's contents
 * change, which replaces `projects` on every file event.
 */
export function useStartWatchers() {
  const startupReady = useSettingsStore((s) => s.startupReady);
  const notesRootPath = useSettingsStore((s) => s.notesRootPath);
  const icloudNotesagePath = useSettingsStore((s) => s.icloudNotesagePath);
  // Joined strings, so the selectors return the same value (and the effects
  // below keep their dependencies) for as long as the paths are the same.
  const projectPathsKey = useWorkspaceStore((s) =>
    s.projects.map((p) => p.path).join(KEY_SEPARATOR),
  );
  const explorerPathsKey = useWorkspaceStore((s) =>
    s.explorerFolders.map((f) => f.path).join(KEY_SEPARATOR),
  );

  useEffect(() => {
    // Wait until reloadTrees() has finished validating/cleaning up paths
    if (!startupReady) return;

    const paths: string[] = [];

    // Notes root (~/Notesage)
    if (notesRootPath) {
      paths.push(notesRootPath);
    }

    // iCloud Notesage folder (when iCloud Drive is detected). Watching
    // it lets useFileWatcher.ts pick up newly-arrived projects from
    // other devices and add them to the workspace.
    if (icloudNotesagePath) {
      paths.push(icloudNotesagePath);
    }

    // All open project directories and explorer folders
    paths.push(...splitKey(projectPathsKey));
    paths.push(...splitKey(explorerPathsKey));

    // Start watching, skipping every root that sits under another one here
    // (the Rust side deduplicates identical paths, not nested ones). The
    // whole set is evaluated again whenever a root is added or removed, so a
    // project whose covering root goes away gets its own watch then.
    watchRoots(paths);

    // Watch ~/.notesage/ for skill/agent changes (created by agents or manually)
    tauriApi.getHomeDir().then((home) => {
      const notesageDir = `${home}/.notesage`;
      if (paths.some((root) => root === notesageDir || isUnder(notesageDir, root))) return;
      tauriApi.watchDirectory(notesageDir).catch((err) => {
        console.error(`Failed to watch ${notesageDir}:`, err);
      });
    });
  }, [startupReady, notesRootPath, icloudNotesagePath, projectPathsKey, explorerPathsKey]);

  // Grant the WebView asset-protocol read access to user-opened roots so images /
  // drawing SVGs / viewer files render. Deliberately NOT gated on `startupReady`:
  // granting is a cheap in-memory path-glob add with zero disk I/O (see
  // `allow_asset_dir`/`validate_asset_dir` in commands/file.rs), and gating it on
  // tree validation — which is slow over iCloud — was the root cause of document
  // images rendering as broken placeholders until a manual refresh on a fresh
  // restart (the editor painted `asset.localhost` <img> before the scope existed).
  // Firing it as soon as the workspace paths appear in the stores wins that race
  // without adding anything to the paint path. Idempotent on the Rust side; only
  // user-opened roots become asset-readable (security H1), unchanged.
  useEffect(() => {
    const paths: string[] = [];
    if (notesRootPath) paths.push(notesRootPath);
    if (icloudNotesagePath) paths.push(icloudNotesagePath);
    paths.push(...splitKey(projectPathsKey));
    paths.push(...splitKey(explorerPathsKey));
    for (const path of paths) {
      tauriApi.allowAssetDir(path).catch((err) => {
        console.error(`Failed to allow asset dir ${path}:`, err);
      });
    }
  }, [notesRootPath, icloudNotesagePath, projectPathsKey, explorerPathsKey]);
}

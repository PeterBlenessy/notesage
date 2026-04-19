/**
 * Compute the tray "Recent Files" lists from open tabs.
 *
 * Two lists are produced:
 * - `scoped`: filtered to the active chat's `selectedProjectPaths` plus the
 *   notes root. When no project is selected, this equals `all` (matches the
 *   "no selection = show everything" pattern from tasks #25, #26).
 * - `all`: the unfiltered list, surfaced via the tray's "All recent" submenu
 *   as an opt-in escape hatch.
 */

export interface TrayRecentFile {
  name: string;
  path: string;
}

interface TabLike {
  filePath: string;
}

interface BuildTrayRecentsOptions {
  tabs: TabLike[];
  selectedProjectPaths: string[];
  notesRootPath: string;
  limit: number;
}

export interface TrayRecentsResult {
  scoped: TrayRecentFile[];
  all: TrayRecentFile[];
}

function isUnderRoot(filePath: string, root: string): boolean {
  if (!root) return false;
  // Exact match or filePath lives under `root/`. Use `/` separator — Notesage
  // stores absolute POSIX paths (macOS primary target).
  return filePath === root || filePath.startsWith(root + "/");
}

export function buildTrayRecents({
  tabs,
  selectedProjectPaths,
  notesRootPath,
  limit,
}: BuildTrayRecentsOptions): TrayRecentsResult {
  const toEntry = (filePath: string): TrayRecentFile => ({
    name: filePath.split("/").pop() ?? filePath,
    path: filePath,
  });

  const all = tabs
    .filter((t) => t.filePath)
    .slice(-limit)
    .reverse()
    .map((t) => toEntry(t.filePath));

  // Empty selection → no filter; scoped mirrors `all`. Prevents the surprising
  // "nothing recent" state when the user hasn't picked a project.
  if (selectedProjectPaths.length === 0) {
    return { scoped: all, all };
  }

  const roots = [...selectedProjectPaths];
  if (notesRootPath) roots.push(notesRootPath);

  const scoped = tabs
    .filter((t) => t.filePath && roots.some((root) => isUnderRoot(t.filePath, root)))
    .slice(-limit)
    .reverse()
    .map((t) => toEntry(t.filePath));

  return { scoped, all };
}

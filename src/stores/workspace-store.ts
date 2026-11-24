import { create } from "zustand";
import { persist } from "zustand/middleware";
import { FileEntry, tauriApi } from "@/lib/tauri";
import { canonicalizeMacPath } from "@/lib/path-utils";
import { useSettingsStore } from "@/stores/settings-store";
import {
  pinsFilePath,
  isInsideLibraryRoot,
  derivePinsFilePaths,
  parsePinsFileContent,
  serializePinsFileContent,
  mergePinsFromFile,
} from "@/lib/pins-file";
import { handleRehydrateResult } from "@/lib/persist-rehydrate";


export interface WorkspaceProject {
  path: string;
  fileTree: FileEntry[];
}

export interface ExplorerFolder {
  path: string;
  fileTree: FileEntry[];
}

export interface RecentProject {
  path: string;
  name: string;
}

const MAX_RECENT_PROJECTS = 5;

/** Everything a row renders from, except `children` (compared by the walk). */
function sameEntryFields(a: FileEntry, b: FileEntry): boolean {
  return (
    a.path === b.path &&
    a.name === b.name &&
    a.is_directory === b.is_directory &&
    a.hidden === b.hidden &&
    a.modified === b.modified &&
    a.child_count === b.child_count &&
    a.unreadable === b.unreadable &&
    a.truncated === b.truncated
  );
}

/**
 * Structural sharing for a fresh listing: returns `next` with every unchanged
 * subtree replaced by the object already in the store, and `prev` itself when
 * nothing changed at all.
 *
 * A tree refresh relists a whole root, so `next` is all-new objects even when
 * one file was added. Handing those to the store gave every memoised sidebar
 * row a new `entry` prop and every `projects` subscriber a new array, for a
 * change that touched one folder. After this, only the entries on the path to
 * a real change get a new identity.
 *
 * One pass over `next`: entries are matched by position first (a listing is
 * ordered, so that almost always hits) and by path through a per-level map
 * only where the positions disagree.
 */
export function shareFileTree(prev: FileEntry[], next: FileEntry[]): FileEntry[];
export function shareFileTree(
  prev: FileEntry[] | null | undefined,
  next: FileEntry[] | null | undefined,
): FileEntry[] | null | undefined;
export function shareFileTree(
  prev: FileEntry[] | null | undefined,
  next: FileEntry[] | null | undefined,
): FileEntry[] | null | undefined {
  if (!prev || !next || prev === next) return next;
  let byPath: Map<string, FileEntry> | null = null;
  let unchanged = prev.length === next.length;
  const out: FileEntry[] = new Array(next.length);
  for (let i = 0; i < next.length; i++) {
    const fresh = next[i];
    let old: FileEntry | undefined = prev[i];
    if (!old || old.path !== fresh.path) {
      if (!byPath) {
        byPath = new Map();
        for (const entry of prev) byPath.set(entry.path, entry);
      }
      old = byPath.get(fresh.path);
    }
    let shared = fresh;
    if (old) {
      const children = shareFileTree(old.children, fresh.children);
      const sameChildren =
        children === old.children || (old.children == null && fresh.children == null);
      if (sameChildren && sameEntryFields(old, fresh)) {
        shared = old;
      } else if (children !== fresh.children) {
        // The entry itself changed, but what is below it may not have.
        shared = { ...fresh, children: children ?? undefined };
      }
    }
    out[i] = shared;
    if (shared !== prev[i]) unchanged = false;
  }
  return unchanged ? prev : out;
}

/**
 * Put a fresh listing into the root at `path`, sharing structure with the
 * tree already there. Returns `roots` itself when the listing changed nothing,
 * so the caller can skip the store update altogether.
 */
function withSharedTree<T extends { path: string; fileTree: FileEntry[] }>(
  roots: T[],
  path: string,
  tree: FileEntry[],
): T[] {
  let changed = false;
  const next = roots.map((root) => {
    if (root.path !== path) return root;
    const fileTree = shareFileTree(root.fileTree, tree);
    if (fileTree === root.fileTree) return root;
    changed = true;
    return { ...root, fileTree };
  });
  return changed ? next : roots;
}

interface WorkspaceStore {
  // Explorer section (multiple folders)
  explorerFolders: ExplorerFolder[];

  // Projects section
  projects: WorkspaceProject[];

  // Recent closed projects
  recentProjects: RecentProject[];

  // Notes section
  notesTree: FileEntry[];

  // Pinned files (quiet-composer sidebar) — absolute file paths, user-ordered
  pinnedFiles: string[];
  /**
   * Library projects the person removed from the sidebar ON THIS MAC.
   * The cross-device scan and the file watcher add every project they find
   * in the synced library; without this list a removal lasted until the next
   * launch, and every Mac converged on whatever the library held. Cleared
   * for a path by `addProject`, so re-adding a project by hand restores it.
   */
  dismissedLibraryProjects: string[];

  // Shared
  expandedFolders: Set<string>;

  // Section collapse state
  explorerCollapsed: boolean;
  projectsCollapsed: boolean;
  notesCollapsed: boolean;

  // Explorer actions
  addExplorerFolder: (path: string, tree: FileEntry[]) => void;
  removeExplorerFolder: (path: string) => void;
  updateExplorerTree: (path: string, tree: FileEntry[]) => void;
  findOwningExplorerFolder: (filePath: string) => ExplorerFolder | undefined;
  /**
   * Exact-match lookup for an already-open explorer folder. Sidebar
   * #8 — used by `App.tsx::handleOpenFolder` to decide whether `⌘O`
   * is opening a fresh folder (no entry returned) or re-opening an
   * existing one (entry returned, caller fires a "Folder already in
   * sidebar" toast). Caller does NOT need to canonicalise — the
   * lookup applies `canonicalizeMacPath` on input.
   */
  getExplorerFolder: (path: string) => ExplorerFolder | undefined;

  // Project actions
  addProject: (path: string, tree: FileEntry[]) => void;
  removeProject: (path: string, name?: string) => void;
  /** Remember that the person removed this project, so discovery skips it. */
  dismissLibraryProject: (path: string) => void;
  updateProjectTree: (path: string, tree: FileEntry[]) => void;

  // Recent project actions
  addRecentProject: (path: string, name: string) => void;
  removeRecentProject: (path: string) => void;

  // Notes actions
  setNotesTree: (tree: FileEntry[]) => void;

  // Pinned file actions
  pinFile: (path: string) => void;
  unpinFile: (path: string) => void;
  /**
   * Follow a rename or a move. Rewrites the exact path and, for a folder,
   * every pin beneath it — the same prefix rule `deletePath` already uses
   * to clean pins, applied to the other half of the pair.
   */
  renamePinnedPath: (oldPath: string, newPath: string) => void;
  reorderPinnedFiles: (from: number, to: number) => void;
  /**
   * Read-only merge (#652): pulls remote-only pins from the shared
   * `library-root/.notesage/pins.json` into local `pinnedFiles` — additive,
   * never drops an existing local pin. Safe to call against a library root
   * that has no pins.json yet (treated as an empty remote set).
   */
  syncPinsFromLibraryRoot: (libraryRoot: string) => Promise<void>;

  // Folder expansion
  toggleFolder: (path: string) => void;
  isExpanded: (path: string) => boolean;

  // Section collapse
  setExplorerCollapsed: (collapsed: boolean) => void;
  setProjectsCollapsed: (collapsed: boolean) => void;
  setNotesCollapsed: (collapsed: boolean) => void;

  // Path migration (used by iCloud sync)
  updateProjectPath: (oldPath: string, newPath: string, newTree: FileEntry[]) => void;
  /** Rewrite any pinned paths that start with oldPrefix to use newPrefix. */
  updateFilePaths: (oldPrefix: string, newPrefix: string) => void;
  /** Re-point an explorer folder at a new location, keeping its place. */
  updateExplorerFolderPath: (oldPath: string, newPath: string, newTree: FileEntry[]) => void;
  /**
   * Follow a moved folder in the stored path lists that are not projects or
   * folders themselves: pins, recent projects, dismissed library projects.
   * Matches at a path boundary only.
   */
  rebaseStoredPaths: (oldPrefix: string, newPrefix: string) => void;

  // Utility: find which section a file path belongs to
  findOwningProject: (filePath: string) => WorkspaceProject | undefined;
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      explorerFolders: [],
      projects: [],
      recentProjects: [],
      notesTree: [],
      pinnedFiles: [],
      dismissedLibraryProjects: [],
      expandedFolders: new Set<string>(),
      explorerCollapsed: false,
      projectsCollapsed: false,
      notesCollapsed: false,

      addExplorerFolder: (path, tree) => {
        // Sidebar #8 — store the canonical form so two surface paths
        // pointing at the same on-disk folder (`/var/foo` vs the
        // macOS-canonical `/private/var/foo`) dedup. App.tsx's
        // `handleOpenFolder` separately checks `getExplorerFolder`
        // before calling us so it can fire a "Folder already in
        // sidebar" toast on the dedup case.
        const canonical = canonicalizeMacPath(path);
        set((state) => {
          // If already open, refresh its tree
          if (state.explorerFolders.some((f) => f.path === canonical)) {
            return {
              explorerFolders: state.explorerFolders.map((f) =>
                f.path === canonical ? { ...f, fileTree: tree } : f
              ),
            };
          }
          return {
            explorerFolders: [
              ...state.explorerFolders,
              { path: canonical, fileTree: tree },
            ],
          };
        });
      },

      removeExplorerFolder: (path) => {
        const canonical = canonicalizeMacPath(path);
        set((state) => ({
          explorerFolders: state.explorerFolders.filter((f) => f.path !== canonical),
        }));
      },

      updateExplorerTree: (path, tree) => {
        const canonical = canonicalizeMacPath(path);
        const current = get().explorerFolders;
        const explorerFolders = withSharedTree(current, canonical, tree);
        // An identical listing is not a change: no new array, no notification.
        if (explorerFolders !== current) set({ explorerFolders });
      },

      findOwningExplorerFolder: (filePath) => {
        const canonical = canonicalizeMacPath(filePath);
        return get().explorerFolders.find((f) => canonical.startsWith(f.path + "/"));
      },

      getExplorerFolder: (path) => {
        const canonical = canonicalizeMacPath(path);
        return get().explorerFolders.find((f) => f.path === canonical);
      },

      addProject: (path, tree) => {
        set((state) => {
          // Remove from recent if re-opening
          const newRecent = state.recentProjects.filter((r) => r.path !== path);
          // Adding a project is the person's say-so, overriding an earlier removal.
          const dismissedLibraryProjects = state.dismissedLibraryProjects.includes(path)
            ? state.dismissedLibraryProjects.filter((d) => d !== path)
            : state.dismissedLibraryProjects;

          // Also remove from explorer folders if it's being promoted to a project
          const newExplorerFolders = state.explorerFolders.filter((f) => f.path !== path);

          // Don't add duplicates
          if (state.projects.some((p) => p.path === path)) {
            return {
              projects: state.projects.map((p) =>
                p.path === path ? { ...p, fileTree: tree } : p
              ),
              recentProjects: newRecent,
              explorerFolders: newExplorerFolders,
              dismissedLibraryProjects,
            };
          }
          return {
            projects: [...state.projects, { path, fileTree: tree }],
            recentProjects: newRecent,
            explorerFolders: newExplorerFolders,
            dismissedLibraryProjects,
          };
        });
      },

      removeProject: (path, name) => {
        set((state) => {
          // Derive name from path if not provided
          const projectName = name || path.split("/").pop() || path;
          // Add to recent projects (deduplicate, cap at max)
          const filtered = state.recentProjects.filter((r) => r.path !== path);
          const newRecent = [{ path, name: projectName }, ...filtered].slice(0, MAX_RECENT_PROJECTS);

          return {
            projects: state.projects.filter((p) => p.path !== path),
            recentProjects: newRecent,
          };
        });
      },

      dismissLibraryProject: (path) => {
        set((state) =>
          state.dismissedLibraryProjects.includes(path)
            ? state
            : { dismissedLibraryProjects: [...state.dismissedLibraryProjects, path] },
        );
      },

      addRecentProject: (path, name) => {
        set((state) => {
          const filtered = state.recentProjects.filter((r) => r.path !== path);
          return {
            recentProjects: [{ path, name }, ...filtered].slice(0, MAX_RECENT_PROJECTS),
          };
        });
      },

      removeRecentProject: (path) => {
        set((state) => ({
          recentProjects: state.recentProjects.filter((r) => r.path !== path),
        }));
      },

      updateProjectTree: (path, tree) => {
        const current = get().projects;
        const projects = withSharedTree(current, path, tree);
        // An identical listing is not a change: no new array, no notification.
        // Everything keyed on `projects` (and every memoised row keyed on an
        // entry) would otherwise re-run for a refresh that found nothing new.
        if (projects !== current) set({ projects });
      },

      setNotesTree: (tree) => {
        const current = get().notesTree;
        const notesTree = shareFileTree(current, tree);
        if (notesTree !== current) set({ notesTree });
      },

      pinFile: (path) => {
        const before = get().pinnedFiles;
        if (before.includes(path)) return;
        set({ pinnedFiles: [...before, path] });
        void writeThroughPinsFile(get().pinnedFiles, path);
      },

      unpinFile: (path) => {
        const before = get().pinnedFiles;
        if (!before.includes(path)) return;
        set({ pinnedFiles: before.filter((p) => p !== path) });
        void writeThroughPinsFile(get().pinnedFiles, path);
      },

      /**
       * A pin is a path, so a rename or a move invalidates it. Without this the
       * row survives in the sidebar pointing at a file that is no longer there
       * and 404s on click — exactly the state `deletePath` goes out of its way
       * to prevent, reached by the other route. Order matters on the way out:
       * the pins file is keyed on the library root, so it is written once, from
       * the NEW path, after the whole list is rewritten.
       */
      renamePinnedPath: (oldPath, newPath) => {
        const before = get().pinnedFiles;
        const prefix = `${oldPath}/`;
        let touched = false;
        const after = before.map((p) => {
          if (p === oldPath) {
            touched = true;
            return newPath;
          }
          // A folder move takes its contents with it.
          if (p.startsWith(prefix)) {
            touched = true;
            return `${newPath}/${p.slice(prefix.length)}`;
          }
          return p;
        });
        if (!touched) return;
        set({ pinnedFiles: after });
        void writeThroughPinsFile(after, newPath);
      },

      syncPinsFromLibraryRoot: async (libraryRoot) => {
        let remoteRel: string[] = [];
        try {
          const raw = await tauriApi.readFile(pinsFilePath(libraryRoot));
          remoteRel = parsePinsFileContent(raw);
        } catch {
          // No pins.json yet (fresh library, or a library never opened by a
          // build with this feature) — treat as an empty remote pin set.
          remoteRel = [];
        }
        set((state) => {
          const merged = mergePinsFromFile(state.pinnedFiles, remoteRel, libraryRoot);
          if (merged.length === state.pinnedFiles.length) return state;
          return { pinnedFiles: merged };
        });
      },

      reorderPinnedFiles: (from, to) => {
        set((state) => {
          const len = state.pinnedFiles.length;
          if (
            from === to ||
            from < 0 ||
            from >= len ||
            to < 0 ||
            to >= len
          ) {
            return state;
          }
          const next = [...state.pinnedFiles];
          const [moved] = next.splice(from, 1);
          if (moved === undefined) return state;
          next.splice(to, 0, moved);
          return { pinnedFiles: next };
        });
      },

      toggleFolder: (path) => {
        set((state) => {
          const newExpanded = new Set(state.expandedFolders);
          if (newExpanded.has(path)) {
            newExpanded.delete(path);
          } else {
            newExpanded.add(path);
          }
          return { expandedFolders: newExpanded };
        });
      },

      isExpanded: (path) => {
        return get().expandedFolders.has(path);
      },

      setExplorerCollapsed: (collapsed) => set({ explorerCollapsed: collapsed }),
      setProjectsCollapsed: (collapsed) => set({ projectsCollapsed: collapsed }),
      setNotesCollapsed: (collapsed) => set({ notesCollapsed: collapsed }),

      updateProjectPath: (oldPath, newPath, newTree) => {
        set((state) => {
          const rewrite = (p: string) =>
            p === oldPath || p.startsWith(oldPath + "/")
              ? newPath + p.slice(oldPath.length)
              : p;
          return {
            projects: state.projects.map((p) =>
              p.path === oldPath ? { path: newPath, fileTree: newTree } : p
            ),
            pinnedFiles: state.pinnedFiles.map(rewrite),
          };
        });
      },

      updateFilePaths: (oldPrefix, newPrefix) => {
        set((state) => {
          const rewrite = (p: string) =>
            p === oldPrefix || p.startsWith(oldPrefix + "/")
              ? newPrefix + p.slice(oldPrefix.length)
              : p;
          return {
            pinnedFiles: state.pinnedFiles.map(rewrite),
          };
        });
      },

      updateExplorerFolderPath: (oldPath, newPath, newTree) => {
        const from = canonicalizeMacPath(oldPath);
        const to = canonicalizeMacPath(newPath);
        set((state) => ({
          explorerFolders: state.explorerFolders.map((f) =>
            f.path === from ? { path: to, fileTree: newTree } : f
          ),
        }));
      },

      rebaseStoredPaths: (oldPrefix, newPrefix) => {
        const rewrite = (p: string) =>
          p === oldPrefix || p.startsWith(oldPrefix + "/")
            ? newPrefix + p.slice(oldPrefix.length)
            : p;
        set((state) => ({
          pinnedFiles: state.pinnedFiles.map(rewrite),
          recentProjects: state.recentProjects.map((r) => {
            const path = rewrite(r.path);
            if (path === r.path) return r;
            return { path, name: path === newPrefix ? path.split("/").pop() || r.name : r.name };
          }),
          dismissedLibraryProjects: state.dismissedLibraryProjects.map(rewrite),
        }));
      },

      findOwningProject: (filePath) => {
        return get().projects.find((p) => filePath.startsWith(p.path + "/"));
      },
    }),
    {
      name: "notesage-workspace",
      onRehydrateStorage: () => (_state, error) => handleRehydrateResult("notesage-workspace", error),

      partialize: (state) => ({
        explorerFolders: state.explorerFolders.map((f) => ({ path: f.path })),
        projects: state.projects.map((p) => ({ path: p.path, fileTree: [] })),
        recentProjects: state.recentProjects,
        pinnedFiles: state.pinnedFiles,
        dismissedLibraryProjects: state.dismissedLibraryProjects,
        expandedFolders: Array.from(state.expandedFolders),
        explorerCollapsed: state.explorerCollapsed,
        projectsCollapsed: state.projectsCollapsed,
        notesCollapsed: state.notesCollapsed,
      }),
      merge: (persisted, current) => {
        // `persisted` is `undefined` when nothing is stored yet (first
        // launch). Dereferencing it threw, zustand swallowed that, and
        // `hasHydrated` never became true on a fresh install.
        const p = (persisted ?? {}) as Record<string, unknown>;
        const hasPath = (v: unknown): v is { path: string } =>
          typeof v === "object" && v !== null && typeof (v as { path?: unknown }).path === "string";

        // Migrate old single explorerPath to explorerFolders array
        let explorerFolders: ExplorerFolder[] = [];
        if (Array.isArray(p.explorerFolders)) {
          explorerFolders = p.explorerFolders
            .filter(hasPath)
            .map((f) => ({ path: f.path, fileTree: [] }));
        } else if (typeof p.explorerPath === "string" && p.explorerPath) {
          // v1 migration: single explorerPath → array
          explorerFolders = [{ path: p.explorerPath as string, fileTree: [] }];
        }

        const rawPinned = Array.isArray(p.pinnedFiles) ? p.pinnedFiles : [];
        const pinnedFiles = rawPinned.filter(
          (v): v is string => typeof v === "string"
        );

        return {
          ...current,
          explorerFolders,
          projects: Array.isArray(p.projects)
            ? p.projects.filter(hasPath).map((proj) => {
                const tree = (proj as { fileTree?: unknown }).fileTree;
                return { ...proj, fileTree: Array.isArray(tree) ? (tree as FileEntry[]) : [] };
              })
            : [],
          recentProjects: Array.isArray(p.recentProjects)
            ? p.recentProjects.filter(
                (r): r is RecentProject =>
                  hasPath(r) && typeof (r as { name?: unknown }).name === "string"
              )
            : [],
          pinnedFiles,
          dismissedLibraryProjects: Array.isArray(p.dismissedLibraryProjects)
            ? (p.dismissedLibraryProjects as unknown[]).filter(
                (v): v is string => typeof v === "string"
              )
            : [],
          expandedFolders: new Set(
            Array.isArray(p.expandedFolders)
              ? p.expandedFolders.filter((v): v is string => typeof v === "string")
              : []
          ),
          explorerCollapsed: (p.explorerCollapsed as boolean) ?? false,
          projectsCollapsed: (p.projectsCollapsed as boolean) ?? false,
          notesCollapsed: (p.notesCollapsed as boolean) ?? false,
        };
      },
    }
  )
);

/**
 * Push the subset of `pinnedFiles` that lives inside the synced library
 * root (#652) to the shared `library-root/.notesage/pins.json` — the file
 * iOS reads to populate its Pinned group. No-ops when no library root is
 * known yet (iCloud unavailable, or not yet detected at startup).
 *
 * The skip decision is gated on whether `changedPath` — the path the
 * pin/unpin action that triggered this call actually touched — is inside
 * the library root, NOT on whether the resulting relative-paths array is
 * empty. Gating on the resulting count was the original (buggy) approach:
 * it meant unpinning the LAST pinned in-root file produced an empty
 * `relPaths` array and the write was skipped entirely, so pins.json kept
 * its stale content forever and iOS never learned the note was unpinned
 * (aw-review gap on PR #660, #652 retry). Gating on `changedPath` instead
 * still skips the I/O for actions that never touched the root (an
 * outside-root pin/unpin), while still writing the now-empty file for the
 * 1-pinned -> 0-pinned transition.
 */
async function writeThroughPinsFile(pinnedFiles: string[], changedPath: string): Promise<void> {
  const libraryRoot = useSettingsStore.getState().icloudNotesagePath;
  if (!libraryRoot) return;
  if (!isInsideLibraryRoot(changedPath, libraryRoot)) return;

  const relPaths = derivePinsFilePaths(pinnedFiles, libraryRoot);
  const filePath = pinsFilePath(libraryRoot);
  try {
    // `.notesage/` may not exist yet at the library root (it isn't
    // necessarily a project itself) — create_directory is a no-op when it
    // already does, avoiding a Rust-side change just to bootstrap it.
    await tauriApi.createDirectory(`${libraryRoot}/.notesage`);
    await tauriApi.markSelfWrite(filePath);
    await tauriApi.writeFile(filePath, serializePinsFileContent(relPaths));
  } catch {
    // Best-effort — a write failure (permissions, iCloud not ready) must
    // never break local pin/unpin.
  }
}

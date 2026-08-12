import { create } from "zustand";
import { persist } from "zustand/middleware";
import { FileEntry, tauriApi } from "@/lib/tauri";
import { canonicalizeMacPath } from "@/lib/path-utils";
import { useSettingsStore } from "@/stores/settings-store";
import {
  pinsFilePath,
  derivePinsFilePaths,
  parsePinsFileContent,
  serializePinsFileContent,
  mergePinsFromFile,
} from "@/lib/pins-file";


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
  updateProjectTree: (path: string, tree: FileEntry[]) => void;

  // Recent project actions
  addRecentProject: (path: string, name: string) => void;
  removeRecentProject: (path: string) => void;

  // Notes actions
  setNotesTree: (tree: FileEntry[]) => void;

  // Pinned file actions
  pinFile: (path: string) => void;
  unpinFile: (path: string) => void;
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
        set((state) => ({
          explorerFolders: state.explorerFolders.map((f) =>
            f.path === canonical ? { ...f, fileTree: tree } : f
          ),
        }));
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
            };
          }
          return {
            projects: [...state.projects, { path, fileTree: tree }],
            recentProjects: newRecent,
            explorerFolders: newExplorerFolders,
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
        set((state) => ({
          projects: state.projects.map((p) =>
            p.path === path ? { ...p, fileTree: tree } : p
          ),
        }));
      },

      setNotesTree: (tree) => {
        set({ notesTree: tree });
      },

      pinFile: (path) => {
        const before = get().pinnedFiles;
        if (before.includes(path)) return;
        set({ pinnedFiles: [...before, path] });
        void writeThroughPinsFile(get().pinnedFiles);
      },

      unpinFile: (path) => {
        const before = get().pinnedFiles;
        if (!before.includes(path)) return;
        set({ pinnedFiles: before.filter((p) => p !== path) });
        void writeThroughPinsFile(get().pinnedFiles);
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

      findOwningProject: (filePath) => {
        return get().projects.find((p) => filePath.startsWith(p.path + "/"));
      },
    }),
    {
      name: "notesage-workspace",

      partialize: (state) => ({
        explorerFolders: state.explorerFolders.map((f) => ({ path: f.path })),
        projects: state.projects.map((p) => ({ path: p.path, fileTree: [] })),
        recentProjects: state.recentProjects,
        pinnedFiles: state.pinnedFiles,
        expandedFolders: Array.from(state.expandedFolders),
        explorerCollapsed: state.explorerCollapsed,
        projectsCollapsed: state.projectsCollapsed,
        notesCollapsed: state.notesCollapsed,
      }),
      merge: (persisted, current) => {
        const p = persisted as Record<string, unknown>;

        // Migrate old single explorerPath to explorerFolders array
        let explorerFolders: ExplorerFolder[] = [];
        if (Array.isArray(p.explorerFolders)) {
          explorerFolders = (p.explorerFolders as Array<{ path: string }>).map(
            (f) => ({ path: f.path, fileTree: [] })
          );
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
          projects: (p.projects as WorkspaceProject[]) ?? [],
          recentProjects: (p.recentProjects as RecentProject[]) ?? [],
          pinnedFiles,
          expandedFolders: new Set(
            (p.expandedFolders as string[]) ?? []
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
 * known yet (iCloud unavailable, or not yet detected at startup). Local-
 * authoritative: writes exactly what the desktop currently has pinned
 * inside the root, so an unpin is never silently undone by a stale remote
 * read. Best-effort — a write failure (permissions, iCloud not ready) must
 * never break local pin/unpin.
 */
async function writeThroughPinsFile(pinnedFiles: string[]): Promise<void> {
  const libraryRoot = useSettingsStore.getState().icloudNotesagePath;
  if (!libraryRoot) return;
  const relPaths = derivePinsFilePaths(pinnedFiles, libraryRoot);
  if (relPaths.length === 0) {
    // Nothing pinned inside the library root — skip the I/O rather than
    // writing an empty file for a pin/unpin that never touched the root.
    return;
  }
  const filePath = pinsFilePath(libraryRoot);
  try {
    // `.notesage/` may not exist yet at the library root (it isn't
    // necessarily a project itself) — create_directory is a no-op when it
    // already does, avoiding a Rust-side change just to bootstrap it.
    await tauriApi.createDirectory(`${libraryRoot}/.notesage`);
    await tauriApi.markSelfWrite(filePath);
    await tauriApi.writeFile(filePath, serializePinsFileContent(relPaths));
  } catch {
    // Best-effort — see doc comment above.
  }
}

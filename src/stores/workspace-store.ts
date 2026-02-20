import { create } from "zustand";
import { persist } from "zustand/middleware";
import { FileEntry } from "@/lib/tauri";

export interface WorkspaceProject {
  path: string;
  fileTree: FileEntry[];
}

export interface RecentProject {
  path: string;
  name: string;
}

const MAX_RECENT_PROJECTS = 5;

interface WorkspaceStore {
  // Explorer section
  explorerPath: string | null;
  explorerTree: FileEntry[];

  // Projects section
  projects: WorkspaceProject[];

  // Recent closed projects
  recentProjects: RecentProject[];

  // Notes section
  notesTree: FileEntry[];

  // Shared
  expandedFolders: Set<string>;

  // Section collapse state
  explorerCollapsed: boolean;
  projectsCollapsed: boolean;
  notesCollapsed: boolean;

  // Explorer actions
  setExplorerPath: (path: string | null) => void;
  setExplorerTree: (tree: FileEntry[]) => void;

  // Project actions
  addProject: (path: string, tree: FileEntry[]) => void;
  removeProject: (path: string, name?: string) => void;
  updateProjectTree: (path: string, tree: FileEntry[]) => void;

  // Recent project actions
  addRecentProject: (path: string, name: string) => void;
  removeRecentProject: (path: string) => void;

  // Notes actions
  setNotesTree: (tree: FileEntry[]) => void;

  // Folder expansion
  toggleFolder: (path: string) => void;
  isExpanded: (path: string) => boolean;

  // Section collapse
  setExplorerCollapsed: (collapsed: boolean) => void;
  setProjectsCollapsed: (collapsed: boolean) => void;
  setNotesCollapsed: (collapsed: boolean) => void;

  // Path migration (used by iCloud sync)
  updateProjectPath: (oldPath: string, newPath: string, newTree: FileEntry[]) => void;

  // Utility: find which section a file path belongs to
  findOwningProject: (filePath: string) => WorkspaceProject | undefined;
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      explorerPath: null,
      explorerTree: [],
      projects: [],
      recentProjects: [],
      notesTree: [],
      expandedFolders: new Set<string>(),
      explorerCollapsed: false,
      projectsCollapsed: false,
      notesCollapsed: false,

      setExplorerPath: (path) => {
        set({ explorerPath: path });
      },

      setExplorerTree: (tree) => {
        set({ explorerTree: tree });
      },

      addProject: (path, tree) => {
        set((state) => {
          // Remove from recent if re-opening
          const newRecent = state.recentProjects.filter((r) => r.path !== path);

          // Don't add duplicates
          if (state.projects.some((p) => p.path === path)) {
            return {
              projects: state.projects.map((p) =>
                p.path === path ? { ...p, fileTree: tree } : p
              ),
              recentProjects: newRecent,
            };
          }
          return {
            projects: [...state.projects, { path, fileTree: tree }],
            recentProjects: newRecent,
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
        set((state) => ({
          projects: state.projects.map((p) =>
            p.path === oldPath ? { path: newPath, fileTree: newTree } : p
          ),
        }));
      },

      findOwningProject: (filePath) => {
        return get().projects.find((p) => filePath.startsWith(p.path + "/"));
      },
    }),
    {
      name: "notesage-workspace",
      partialize: (state) => ({
        explorerPath: state.explorerPath,
        projects: state.projects.map((p) => ({ path: p.path, fileTree: [] })),
        recentProjects: state.recentProjects,
        expandedFolders: Array.from(state.expandedFolders),
        explorerCollapsed: state.explorerCollapsed,
        projectsCollapsed: state.projectsCollapsed,
        notesCollapsed: state.notesCollapsed,
      }),
      merge: (persisted, current) => {
        const p = persisted as Record<string, unknown>;
        return {
          ...current,
          explorerPath: (p.explorerPath as string | null) ?? null,
          projects: (p.projects as WorkspaceProject[]) ?? [],
          recentProjects: (p.recentProjects as RecentProject[]) ?? [],
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

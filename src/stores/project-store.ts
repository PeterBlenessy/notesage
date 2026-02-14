import { create } from "zustand";
import { FileEntry } from "@/lib/tauri";

interface ProjectStore {
  rootPath: string | null;
  fileTree: FileEntry[];
  expandedFolders: Set<string>;

  setRootPath: (path: string) => void;
  setFileTree: (tree: FileEntry[]) => void;
  toggleFolder: (path: string) => void;
  isExpanded: (path: string) => boolean;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  rootPath: null,
  fileTree: [],
  expandedFolders: new Set<string>(),

  setRootPath: (path: string) => {
    set({ rootPath: path });
  },

  setFileTree: (tree: FileEntry[]) => {
    set({ fileTree: tree });
  },

  toggleFolder: (path: string) => {
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

  isExpanded: (path: string) => {
    return get().expandedFolders.has(path);
  },
}));

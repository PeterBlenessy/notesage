import { create } from "zustand";
import { tauriApi, type SyncSettings } from "@/lib/tauri";

interface SyncStore {
  // State
  icloudEnabled: boolean;
  syncQuickNotes: boolean;
  syncedProjectPaths: string[];
  migrating: string | null;
  loaded: boolean;

  // Settings persistence (disk-based, not localStorage)
  loadSettings: (notesagePath: string) => Promise<void>;
  saveSettings: (notesagePath: string) => Promise<void>;

  // Actions
  setICloudEnabled: (enabled: boolean) => void;
  setSyncQuickNotes: (enabled: boolean) => void;
  addSyncedProject: (path: string) => void;
  removeSyncedProject: (path: string) => void;
  setMigrating: (path: string | null) => void;

  // Queries
  isProjectSynced: (path: string) => boolean;
  isMigrating: () => boolean;

  // Batch update
  setSyncedProjectPaths: (paths: string[]) => void;

  // Path update after migration
  updateProjectPath: (oldPath: string, newPath: string) => void;
}

export const useSyncStore = create<SyncStore>()((set, get) => ({
  icloudEnabled: false,
  syncQuickNotes: true,
  syncedProjectPaths: [],
  migrating: null,
  loaded: false,

  loadSettings: async (notesagePath: string) => {
    try {
      const settings = await tauriApi.readSyncSettings(notesagePath);
      if (settings) {
        set({
          icloudEnabled: settings.icloudEnabled,
          syncQuickNotes: settings.syncQuickNotes,
          syncedProjectPaths: settings.syncedProjects,
          loaded: true,
        });
      } else {
        set({ loaded: true });
      }
    } catch {
      console.error("Failed to load sync settings");
      set({ loaded: true });
    }
  },

  saveSettings: async (notesagePath: string) => {
    const state = get();
    const settings: SyncSettings = {
      version: 1,
      icloudEnabled: state.icloudEnabled,
      syncQuickNotes: state.syncQuickNotes,
      syncedProjects: state.syncedProjectPaths,
    };
    try {
      await tauriApi.writeSyncSettings(notesagePath, settings);
    } catch {
      console.error("Failed to save sync settings");
    }
  },

  setICloudEnabled: (enabled: boolean) => {
    set({ icloudEnabled: enabled });
  },

  setSyncQuickNotes: (enabled: boolean) => {
    set({ syncQuickNotes: enabled });
  },

  addSyncedProject: (path: string) => {
    set((state) => {
      if (state.syncedProjectPaths.includes(path)) return state;
      return { syncedProjectPaths: [...state.syncedProjectPaths, path] };
    });
  },

  removeSyncedProject: (path: string) => {
    set((state) => ({
      syncedProjectPaths: state.syncedProjectPaths.filter((p) => p !== path),
    }));
  },

  setMigrating: (path: string | null) => {
    set({ migrating: path });
  },

  isProjectSynced: (path: string) => {
    return get().syncedProjectPaths.includes(path);
  },

  isMigrating: () => {
    return get().migrating !== null;
  },

  setSyncedProjectPaths: (paths: string[]) => {
    set({ syncedProjectPaths: paths });
  },

  updateProjectPath: (oldPath: string, newPath: string) => {
    set((state) => ({
      syncedProjectPaths: state.syncedProjectPaths.map((p) =>
        p === oldPath ? newPath : p
      ),
    }));
  },
}));

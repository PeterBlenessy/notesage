/**
 * folder-appearance-store.ts — Global path-keyed registry for folder appearance.
 *
 * Issue #140: Per-folder icon and color customization.
 *
 * This store handles custom icon + color for external/explorer folders that are
 * NOT Notesage project folders. Project folders store their appearance in
 * `.notesage/project.json` via project-metadata-store instead.
 *
 * The registry is keyed by absolute folder path. Appearance is optional on both
 * fields — the user may set only an icon, only a color, or both.
 *
 * Note: This store is intentionally NOT persisted via localStorage because
 * external folder paths are ephemeral (they change when users open different
 * folders). Persistence would accumulate stale entries over time. If future
 * requirements need persistence, add it then.
 */

import { create } from 'zustand';
import type { FolderAppearance } from '@/lib/folder-icon';

// Re-export FolderAppearance so consumers can import from this module
export type { FolderAppearance };

interface FolderAppearanceStoreState {
  /** Registry of path → custom appearance. */
  registry: Record<string, FolderAppearance>;
}

interface FolderAppearanceStoreActions {
  /** Store or overwrite a custom appearance for a folder path. */
  setAppearance: (path: string, appearance: FolderAppearance) => void;
  /** Remove the custom appearance for a folder path. No-op if not set. */
  clearAppearance: (path: string) => void;
  /** Get the stored appearance for a path, or undefined if not set. */
  getAppearance: (path: string) => FolderAppearance | undefined;
  /** Clear all stored appearances (used for testing and resets). */
  reset: () => void;
}

type FolderAppearanceStore = FolderAppearanceStoreState & FolderAppearanceStoreActions;

export const useFolderAppearanceStore = create<FolderAppearanceStore>((set, get) => ({
  registry: {},

  setAppearance: (path, appearance) =>
    set((state) => ({
      registry: { ...state.registry, [path]: appearance },
    })),

  clearAppearance: (path) =>
    set((state) => {
      const { [path]: _, ...rest } = state.registry;
      return { registry: rest };
    }),

  getAppearance: (path) => {
    return get().registry[path];
  },

  reset: () => set({ registry: {} }),
}));

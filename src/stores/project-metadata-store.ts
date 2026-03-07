import { create } from 'zustand';

export interface ProjectMetadata {
  version: 1;
  name: string;
  description: string;
  ai: {
    provider: string | null; // Connection ID (v2) or legacy provider name
    /** @deprecated Use agentName instead. Kept for migration compatibility. */
    personaId?: string | null;
    agentName: string | null;
    projectContext: string;
  };
}

export function createDefaultMetadata(folderName: string): ProjectMetadata {
  return {
    version: 1,
    name: folderName,
    description: '',
    ai: {
      provider: null,
      agentName: null,
      projectContext: '',
    },
  };
}

interface ProjectMetadataStore {
  metadataMap: Record<string, ProjectMetadata>;
  dirtyPaths: Set<string>;

  setMetadata: (projectPath: string, metadata: ProjectMetadata) => void;
  updateMetadata: (projectPath: string, updates: Partial<Pick<ProjectMetadata, 'name' | 'description'>>) => void;
  updateAI: (projectPath: string, updates: Partial<ProjectMetadata['ai']>) => void;
  removeMetadata: (projectPath: string) => void;
  getMetadata: (projectPath: string) => ProjectMetadata | undefined;
  isDirty: (projectPath: string) => boolean;
  setClean: (projectPath: string) => void;
}

export const useProjectMetadataStore = create<ProjectMetadataStore>((set, get) => ({
  metadataMap: {},
  dirtyPaths: new Set<string>(),

  setMetadata: (projectPath, metadata) =>
    set((state) => {
      const newDirty = new Set(state.dirtyPaths);
      newDirty.delete(projectPath);
      return {
        metadataMap: { ...state.metadataMap, [projectPath]: metadata },
        dirtyPaths: newDirty,
      };
    }),

  updateMetadata: (projectPath, updates) =>
    set((state) => {
      const existing = state.metadataMap[projectPath];
      if (!existing) return state;
      const newDirty = new Set(state.dirtyPaths);
      newDirty.add(projectPath);
      return {
        metadataMap: {
          ...state.metadataMap,
          [projectPath]: { ...existing, ...updates },
        },
        dirtyPaths: newDirty,
      };
    }),

  updateAI: (projectPath, updates) =>
    set((state) => {
      const existing = state.metadataMap[projectPath];
      if (!existing) return state;
      const newDirty = new Set(state.dirtyPaths);
      newDirty.add(projectPath);
      return {
        metadataMap: {
          ...state.metadataMap,
          [projectPath]: {
            ...existing,
            ai: { ...existing.ai, ...updates },
          },
        },
        dirtyPaths: newDirty,
      };
    }),

  removeMetadata: (projectPath) =>
    set((state) => {
      const { [projectPath]: _, ...rest } = state.metadataMap;
      const newDirty = new Set(state.dirtyPaths);
      newDirty.delete(projectPath);
      return {
        metadataMap: rest,
        dirtyPaths: newDirty,
      };
    }),

  getMetadata: (projectPath) => {
    return get().metadataMap[projectPath];
  },

  isDirty: (projectPath) => {
    return get().dirtyPaths.has(projectPath);
  },

  setClean: (projectPath) =>
    set((state) => {
      const newDirty = new Set(state.dirtyPaths);
      newDirty.delete(projectPath);
      return { dirtyPaths: newDirty };
    }),
}));

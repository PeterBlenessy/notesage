import { create } from 'zustand';
import type { AIProviderType } from '@/lib/ai/types';

export interface ProjectMetadata {
  version: 1;
  name: string;
  description: string;
  ai: {
    provider: AIProviderType | null;
    personaId: string | null;
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
      personaId: null,
      projectContext: '',
    },
  };
}

interface ProjectMetadataStore {
  metadata: ProjectMetadata | null;
  isLoaded: boolean;
  isDirty: boolean;

  setMetadata: (metadata: ProjectMetadata) => void;
  updateMetadata: (updates: Partial<Pick<ProjectMetadata, 'name' | 'description'>>) => void;
  updateAI: (updates: Partial<ProjectMetadata['ai']>) => void;
  setDirty: (dirty: boolean) => void;
  reset: () => void;
}

export const useProjectMetadataStore = create<ProjectMetadataStore>((set) => ({
  metadata: null,
  isLoaded: false,
  isDirty: false,

  setMetadata: (metadata) => set({ metadata, isLoaded: true, isDirty: false }),

  updateMetadata: (updates) =>
    set((state) => {
      if (!state.metadata) return state;
      return {
        metadata: { ...state.metadata, ...updates },
        isDirty: true,
      };
    }),

  updateAI: (updates) =>
    set((state) => {
      if (!state.metadata) return state;
      return {
        metadata: {
          ...state.metadata,
          ai: { ...state.metadata.ai, ...updates },
        },
        isDirty: true,
      };
    }),

  setDirty: (dirty) => set({ isDirty: dirty }),

  reset: () => set({ metadata: null, isLoaded: false, isDirty: false }),
}));

import { create } from 'zustand';
import type { FolderAppearance } from '@/lib/folder-icon';

export interface ProjectMetadata {
  version: 1;
  name: string;
  description: string;
  citationFormat?: 'links' | 'footnotes' | 'academic';
  citationStyle?: 'apa' | 'mla' | 'chicago';
  ai: {
    // Soft default for this project — the initial connection selected in the
    // command bar when a conversation opens here. Overridable per chat. For
    // hard enforcement that refuses to send to any other connection, see
    // `aiLock` below (added in the project-data-isolation PRD).
    provider: string | null; // Connection ID (v2) or legacy provider name
    /** @deprecated Use agentName instead. Kept for migration compatibility. */
    personaId?: string | null;
    agentName: string | null;
    projectContext: string;
  };
  /**
   * Hard lock to a specific connection. When set, every send path
   * (new message, resend, edit, delegation, inline action) must route to
   * this connection or be refused. Enforcement is wired up by later tasks
   * in the project-data-isolation PRD; this field is pure data for now.
   */
  aiLock?: {
    connectionId: string;
    lockedAt: number;
    reason?: string;
  };
  /**
   * Optional custom appearance for this project's folder icon.
   * Issue #140: Per-folder icon and color customization.
   * Both fields are independently nullable — the user may set only an icon,
   * only a color, or both. Omitted entirely when neither is set (backward compat).
   */
  appearance?: FolderAppearance;
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
  updateMetadata: (projectPath: string, updates: Partial<Pick<ProjectMetadata, 'name' | 'description' | 'citationFormat' | 'citationStyle'>>) => void;
  updateAI: (projectPath: string, updates: Partial<ProjectMetadata['ai']>) => void;
  setAiLock: (projectPath: string, connectionId: string, reason?: string) => void;
  clearAiLock: (projectPath: string) => void;
  /**
   * Set or replace the custom folder appearance for a project.
   * Marks the project dirty so it will be saved to project.json.
   * No-op if the project path has no loaded metadata.
   */
  setAppearance: (projectPath: string, appearance: FolderAppearance) => void;
  /**
   * Remove the custom folder appearance from a project.
   * Marks the project dirty only if appearance was previously set.
   * No-op if the project path has no loaded metadata or has no appearance.
   */
  clearAppearance: (projectPath: string) => void;
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

  setAiLock: (projectPath, connectionId, reason) =>
    set((state) => {
      const existing = state.metadataMap[projectPath];
      if (!existing) return state;
      const newDirty = new Set(state.dirtyPaths);
      newDirty.add(projectPath);
      const aiLock: ProjectMetadata['aiLock'] = {
        connectionId,
        lockedAt: Date.now(),
        ...(reason && reason.trim().length > 0 ? { reason: reason.trim() } : {}),
      };
      return {
        metadataMap: {
          ...state.metadataMap,
          [projectPath]: { ...existing, aiLock },
        },
        dirtyPaths: newDirty,
      };
    }),

  clearAiLock: (projectPath) =>
    set((state) => {
      const existing = state.metadataMap[projectPath];
      if (!existing || !existing.aiLock) return state;
      const newDirty = new Set(state.dirtyPaths);
      newDirty.add(projectPath);
      const { aiLock: _aiLock, ...rest } = existing;
      return {
        metadataMap: {
          ...state.metadataMap,
          [projectPath]: rest as ProjectMetadata,
        },
        dirtyPaths: newDirty,
      };
    }),

  setAppearance: (projectPath, appearance) =>
    set((state) => {
      const existing = state.metadataMap[projectPath];
      if (!existing) return state;
      const newDirty = new Set(state.dirtyPaths);
      newDirty.add(projectPath);
      return {
        metadataMap: {
          ...state.metadataMap,
          [projectPath]: { ...existing, appearance },
        },
        dirtyPaths: newDirty,
      };
    }),

  clearAppearance: (projectPath) =>
    set((state) => {
      const existing = state.metadataMap[projectPath];
      if (!existing || !existing.appearance) return state;
      const newDirty = new Set(state.dirtyPaths);
      newDirty.add(projectPath);
      const { appearance: _appearance, ...rest } = existing;
      return {
        metadataMap: {
          ...state.metadataMap,
          [projectPath]: rest as ProjectMetadata,
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

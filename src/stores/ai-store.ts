import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AIProviderType } from '@/lib/ai/types';

/** Kept for persona→agent migration compatibility (useSkillOperations). */
export interface AIPersona {
  id: string;
  name: string;
  icon: string;
  systemMessage: string;
  builtIn?: boolean;
}

export interface CustomPrompt {
  id: string;
  name: string;
  icon: string;
  template: string;
}

interface AIStore {
  provider: AIProviderType | null;
  apiKeys: Record<string, string | undefined>;
  ollamaUrl: string;
  suggestionsEnabled: boolean;

  /** Kept for persona→agent migration. */
  activePersonaId: string;
  /** Kept for persona→agent migration. */
  customPersonas: AIPersona[];

  customPrompts: CustomPrompt[];

  setProvider: (provider: AIProviderType | null) => void;
  setApiKey: (provider: 'anthropic' | 'openai', key: string) => void;
  setOllamaUrl: (url: string) => void;
  toggleSuggestions: () => void;

  addCustomPrompt: (prompt: Omit<CustomPrompt, 'id'>) => void;
  updateCustomPrompt: (id: string, prompt: Partial<CustomPrompt>) => void;
  deleteCustomPrompt: (id: string) => void;
}

export const useAIStore = create<AIStore>()(
  persist(
    (set) => ({
      provider: null,
      apiKeys: {},
      ollamaUrl: 'http://localhost:11434',
      suggestionsEnabled: false,
      activePersonaId: 'general',
      customPersonas: [],
      customPrompts: [],

      setProvider: (provider) => set({ provider }),
      setApiKey: (provider, key) =>
        set((state) => ({
          apiKeys: { ...state.apiKeys, [provider]: key },
        })),
      setOllamaUrl: (url) => set({ ollamaUrl: url }),
      toggleSuggestions: () =>
        set((state) => ({ suggestionsEnabled: !state.suggestionsEnabled })),

      addCustomPrompt: (prompt) =>
        set((state) => ({
          customPrompts: [
            ...state.customPrompts,
            { ...prompt, id: Date.now().toString() },
          ],
        })),
      updateCustomPrompt: (id, updates) =>
        set((state) => ({
          customPrompts: state.customPrompts.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        })),
      deleteCustomPrompt: (id) =>
        set((state) => ({
          customPrompts: state.customPrompts.filter((p) => p.id !== id),
        })),
    }),
    { name: 'notesage-ai-settings' }
  )
);

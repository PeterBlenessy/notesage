import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AIProviderType } from '@/lib/ai/types';

interface AIStore {
  provider: AIProviderType | null;
  apiKeys: {
    anthropic?: string;
    openai?: string;
  };
  ollamaUrl: string;
  suggestionsEnabled: boolean;

  setProvider: (provider: AIProviderType | null) => void;
  setApiKey: (provider: 'anthropic' | 'openai', key: string) => void;
  setOllamaUrl: (url: string) => void;
  toggleSuggestions: () => void;
}

export const useAIStore = create<AIStore>()(
  persist(
    (set) => ({
      provider: null,
      apiKeys: {},
      ollamaUrl: 'http://localhost:11434',
      suggestionsEnabled: false,

      setProvider: (provider) => set({ provider }),
      setApiKey: (provider, key) =>
        set((state) => ({
          apiKeys: { ...state.apiKeys, [provider]: key },
        })),
      setOllamaUrl: (url) => set({ ollamaUrl: url }),
      toggleSuggestions: () =>
        set((state) => ({ suggestionsEnabled: !state.suggestionsEnabled })),
    }),
    { name: 'notesage-ai-settings' }
  )
);

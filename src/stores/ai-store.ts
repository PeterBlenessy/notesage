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

/** Default custom prompts seeded on first launch. */
const DEFAULT_CUSTOM_PROMPTS: Omit<CustomPrompt, 'id'>[] = [
  { name: 'Academic Tone', icon: '🎓', template: 'Rewrite this text in formal academic style with precise language and structured argumentation.' },
  { name: 'Creative Rewrite', icon: '✨', template: 'Rewrite this text with vivid, engaging language. Use metaphors, varied sentence structures, and evocative descriptions.' },
  { name: 'Proofread', icon: '📝', template: 'Check this text for grammar, spelling, punctuation, and style issues. Fix all errors and improve clarity.' },
  { name: 'Marketing Copy', icon: '📣', template: 'Rewrite this text as compelling marketing copy. Make it concise, persuasive, and action-oriented.' },
  { name: 'Technical Edit', icon: '🔧', template: 'Edit this text for technical accuracy, clarity, and consistency. Improve structure and remove ambiguity.' },
];

interface AIStore {
  provider: AIProviderType | null;
  apiKeys: Record<string, string | undefined>;
  ollamaUrl: string;

  /** Kept for persona→agent migration. */
  activePersonaId: string;
  /** Kept for persona→agent migration. */
  customPersonas: AIPersona[];

  customPrompts: CustomPrompt[];
  /** Whether default prompts have been seeded. Prevents re-seeding on upgrade. */
  defaultPromptsBundled: boolean;

  setProvider: (provider: AIProviderType | null) => void;
  setApiKey: (provider: 'anthropic' | 'openai', key: string) => void;
  setOllamaUrl: (url: string) => void;

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
      activePersonaId: 'general',
      customPersonas: [],
      customPrompts: [],
      defaultPromptsBundled: false,

      setProvider: (provider) => set({ provider }),
      setApiKey: (provider, key) =>
        set((state) => ({
          apiKeys: { ...state.apiKeys, [provider]: key },
        })),
      setOllamaUrl: (url) => set({ ollamaUrl: url }),

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
    {
      name: 'notesage-ai-settings',
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.defaultPromptsBundled) return;
        // Seed default custom prompts once — never overwrite existing user prompts
        const existing = state.customPrompts;
        const newPrompts = DEFAULT_CUSTOM_PROMPTS
          .filter((dp) => !existing.some((ep) => ep.name === dp.name))
          .map((dp) => ({ ...dp, id: `default-${dp.name.toLowerCase().replace(/\s+/g, '-')}` }));
        useAIStore.setState({
          customPrompts: [...existing, ...newPrompts],
          defaultPromptsBundled: true,
        });
      },
    }
  )
);

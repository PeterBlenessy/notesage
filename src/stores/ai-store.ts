import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AIProviderType } from '@/lib/ai/types';

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

// Built-in AI personas
export const BUILT_IN_PERSONAS: AIPersona[] = [
  {
    id: 'general',
    name: 'General Assistant',
    icon: '🤖',
    systemMessage: 'You are a helpful writing assistant. Provide clear, concise, and accurate assistance with writing tasks.',
    builtIn: true,
  },
  {
    id: 'creative',
    name: 'Creative Writer',
    icon: '✨',
    systemMessage: 'You are a creative writing assistant. Help with imaginative expression, storytelling, vivid descriptions, and engaging narratives. Use metaphors, varied sentence structures, and evocative language.',
    builtIn: true,
  },
  {
    id: 'technical',
    name: 'Technical Editor',
    icon: '⚙️',
    systemMessage: 'You are a technical writing editor. Focus on clarity, precision, and accuracy. Explain complex concepts simply, define jargon, and ensure logical flow. Prefer active voice and concrete examples.',
    builtIn: true,
  },
  {
    id: 'fact-checker',
    name: 'Fact Checker',
    icon: '🔍',
    systemMessage: 'You are a fact checker. Verify claims, ask for sources, identify unsupported statements, and suggest evidence-based improvements. Be skeptical but constructive.',
    builtIn: true,
  },
  {
    id: 'academic',
    name: 'Academic Writer',
    icon: '🎓',
    systemMessage: 'You are an academic writing assistant. Use formal, scholarly language. Focus on logical argumentation, proper citations, objective tone, and structured presentation of ideas.',
    builtIn: true,
  },
  {
    id: 'copywriter',
    name: 'Copywriter',
    icon: '💼',
    systemMessage: 'You are a marketing copywriter. Create persuasive, engaging content that drives action. Focus on benefits, emotional appeal, clear calls-to-action, and audience connection.',
    builtIn: true,
  },
  {
    id: 'proofreader',
    name: 'Proofreader',
    icon: '📝',
    systemMessage: 'You are a meticulous proofreader. Check grammar, spelling, punctuation, and consistency. Suggest corrections while preserving the author\'s voice and intent.',
    builtIn: true,
  },
];

interface AIStore {
  provider: AIProviderType | null;
  apiKeys: Record<string, string | undefined>;
  ollamaUrl: string;
  suggestionsEnabled: boolean;

  // Personas
  activePersonaId: string;
  customPersonas: AIPersona[];

  // Custom Prompts
  customPrompts: CustomPrompt[];

  setProvider: (provider: AIProviderType | null) => void;
  setApiKey: (provider: 'anthropic' | 'openai', key: string) => void;
  setOllamaUrl: (url: string) => void;
  toggleSuggestions: () => void;

  // Persona actions
  setActivePersona: (personaId: string) => void;
  addCustomPersona: (persona: Omit<AIPersona, 'id' | 'builtIn'>) => void;
  updateCustomPersona: (id: string, persona: Partial<AIPersona>) => void;
  deleteCustomPersona: (id: string) => void;

  // Custom prompt actions
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

      // Persona actions
      setActivePersona: (personaId) => set({ activePersonaId: personaId }),
      addCustomPersona: (persona) =>
        set((state) => ({
          customPersonas: [
            ...state.customPersonas,
            { ...persona, id: Date.now().toString(), builtIn: false },
          ],
        })),
      updateCustomPersona: (id, updates) =>
        set((state) => ({
          customPersonas: state.customPersonas.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        })),
      deleteCustomPersona: (id) =>
        set((state) => ({
          customPersonas: state.customPersonas.filter((p) => p.id !== id),
        })),

      // Custom prompt actions
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

// Helper to get all personas (built-in + custom)
export const getAllPersonas = (store: AIStore): AIPersona[] => [
  ...BUILT_IN_PERSONAS,
  ...store.customPersonas,
];

// Helper to get active persona
export const getActivePersona = (store: AIStore): AIPersona => {
  const allPersonas = getAllPersonas(store);
  return allPersonas.find((p) => p.id === store.activePersonaId) || BUILT_IN_PERSONAS[0];
};

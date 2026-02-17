import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatMessage } from '@/lib/ai/types';

interface ChatStore {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  activeTool: string | null;
  /** Selected project paths for AI context. Empty array = no project context. */
  selectedProjectPaths: string[];

  addMessage: (message: ChatMessage) => void;
  updateMessage: (timestamp: number, content: string) => void;
  clearMessages: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setActiveTool: (tool: string | null) => void;
  setSelectedProjectPaths: (paths: string[]) => void;
  toggleProjectPath: (path: string) => void;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set) => ({
      messages: [],
      isLoading: false,
      error: null,
      activeTool: null,
      selectedProjectPaths: [],

      addMessage: (message) =>
        set((state) => ({
          messages: [...state.messages, { ...message, timestamp: message.timestamp || Date.now() }],
        })),

      updateMessage: (timestamp, content) =>
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.timestamp === timestamp ? { ...msg, content } : msg
          ),
        })),

      clearMessages: () => set({ messages: [] }),
      setLoading: (loading) => set({ isLoading: loading }),
      setError: (error) => set({ error }),
      setActiveTool: (tool) => set({ activeTool: tool }),
      setSelectedProjectPaths: (paths) => set({ selectedProjectPaths: paths }),
      toggleProjectPath: (path) =>
        set((state) => {
          const has = state.selectedProjectPaths.includes(path);
          return {
            selectedProjectPaths: has
              ? state.selectedProjectPaths.filter((p) => p !== path)
              : [...state.selectedProjectPaths, path],
          };
        }),
    }),
    { name: 'notesage-chat-history' }
  )
);

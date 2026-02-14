import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatMessage } from '@/lib/ai/types';

interface ChatStore {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;

  addMessage: (message: ChatMessage) => void;
  clearMessages: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set) => ({
      messages: [],
      isLoading: false,
      error: null,

      addMessage: (message) =>
        set((state) => ({
          messages: [...state.messages, { ...message, timestamp: Date.now() }],
        })),

      clearMessages: () => set({ messages: [] }),
      setLoading: (loading) => set({ isLoading: loading }),
      setError: (error) => set({ error }),
    }),
    { name: 'notesage-chat-history' }
  )
);

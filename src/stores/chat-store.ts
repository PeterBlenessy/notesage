import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatMessage } from '@/lib/ai/types';

interface ChatStore {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  activeTool: string | null;

  addMessage: (message: ChatMessage) => void;
  updateMessage: (timestamp: number, content: string) => void;
  clearMessages: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setActiveTool: (tool: string | null) => void;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set) => ({
      messages: [],
      isLoading: false,
      error: null,
      activeTool: null,

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
    }),
    { name: 'notesage-chat-history' }
  )
);

import { useEffect, useRef } from 'react';
import { X, Trash2, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useChatStore } from '@/stores/chat-store';
import { useAIStore, getActivePersona } from '@/stores/ai-store';
import { useAIOperations } from '@/hooks/useAIOperations';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';

interface ChatPanelProps {
  onClose: () => void;
}

export function ChatPanel({ onClose }: ChatPanelProps) {
  const { messages, isLoading, error, activeTool, clearMessages } = useChatStore();
  const aiStore = useAIStore();
  const { provider } = aiStore;
  const activePersona = getActivePersona(aiStore);
  const { sendChatMessage } = useAIOperations();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (content: string) => {
    if (!provider) {
      return;
    }

    await sendChatMessage(content, messages);
  };

  const handleClear = () => {
    if (confirm('Clear all chat history?')) {
      clearMessages();
    }
  };

  return (
    <div className="h-full w-full border-l border-border bg-card flex flex-col">
      <div className="p-4 border-b border-border bg-card">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-lg">AI Chat</h2>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClear}
              title="Clear chat history"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} title="Close chat">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2 px-2 py-1.5 bg-accent/50 rounded-md border border-border/50">
          <span className="text-base">{activePersona.icon}</span>
          <span className="text-xs text-muted-foreground font-medium">
            {activePersona.name}
          </span>
        </div>
      </div>

      {!provider && (
        <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border-b">
          <p className="text-sm text-yellow-800 dark:text-yellow-200">
            Please configure an AI provider in Settings (Cmd+,) before using chat.
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm text-center">
            <p>
              Start a conversation with AI.
              <br />
              Ask questions about your writing or get suggestions.
            </p>
          </div>
        ) : (
          <>
            {messages.map((message, index) => (
              <ChatMessage key={index} message={message} />
            ))}
            {isLoading && !activeTool && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">AI is thinking...</span>
              </div>
            )}
            {activeTool && (
              <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 rounded-lg px-3 py-2">
                <Search className="h-4 w-4 animate-pulse" />
                <span className="text-sm font-medium">
                  {activeTool === 'web_search' && 'Searching the web...'}
                  {activeTool !== 'web_search' && `Using ${activeTool}...`}
                </span>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="px-4 py-2 bg-destructive/10 border-t border-destructive/20">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <Separator />

      <div className="p-4">
        <ChatInput onSend={handleSend} disabled={isLoading || !provider} />
      </div>
    </div>
  );
}

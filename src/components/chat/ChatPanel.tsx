import { useEffect, useRef } from 'react';
import { X, Trash2, Loader2, Search, FileText } from 'lucide-react';
import { useChatStore } from '@/stores/chat-store';
import { useAIStore, getActivePersona } from '@/stores/ai-store';
import { useActiveProject } from '@/hooks/useActiveProject';
import { useAIOperations } from '@/hooks/useAIOperations';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface ChatPanelProps {
  onClose: () => void;
}

export function ChatPanel({ onClose }: ChatPanelProps) {
  const { messages, isLoading, error, activeTool, clearMessages } = useChatStore();
  const aiStore = useAIStore();
  const { provider } = aiStore;
  const activePersona = getActivePersona(aiStore);
  const { metadata } = useActiveProject();
  const hasProjectContext = Boolean(metadata?.ai.projectContext);
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
    <div className="h-full w-full bg-card flex flex-col">
      <div className="h-11 px-3 border-b border-border flex items-center justify-between shrink-0" style={{ backgroundColor: 'var(--color-card)' }}>
        <div className="flex items-center gap-2">
          <span className="text-sm">{activePersona.icon}</span>
          <h2 className="text-sm font-semibold tracking-tight">AI Chat</h2>
          <span className="text-xs text-muted-foreground">· {activePersona.name}</span>
          {hasProjectContext && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-muted-foreground" style={{ backgroundColor: 'var(--color-accent)' }}>
                    <FileText className="h-3 w-3" />
                    CTX
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-64">
                  <p className="text-xs">Project context is active for this conversation</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleClear}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors text-muted-foreground hover:text-foreground"
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-accent)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
            title="Clear chat history"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onClose}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors text-muted-foreground hover:text-foreground"
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-accent)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
            title="Close chat"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {!provider && (
        <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border-b">
          <p className="text-sm text-yellow-800 dark:text-yellow-200">
            Please configure an AI provider in Settings (Cmd+,) before using chat.
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-4">
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

      <div className="border-t border-border px-3 py-3">
        <ChatInput onSend={handleSend} disabled={isLoading || !provider} />
      </div>
    </div>
  );
}

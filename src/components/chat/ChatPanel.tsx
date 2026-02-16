import { useEffect, useRef, useState } from 'react';
import { X, Trash2, Loader2, FileText, ChevronUp } from 'lucide-react';
import { PersonaIcon } from '@/components/PersonaIcon';
import { useChatStore } from '@/stores/chat-store';
import { useAIStore, getActivePersona, getAllPersonas } from '@/stores/ai-store';
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface ChatPanelProps {
  onClose: () => void;
}

export function ChatPanel({ onClose }: ChatPanelProps) {
  const { messages, isLoading, error, activeTool, clearMessages } = useChatStore();
  const aiStore = useAIStore();
  const { provider, setActivePersona } = aiStore;
  const activePersona = getActivePersona(aiStore);
  const allPersonas = getAllPersonas(aiStore);
  const { metadata } = useActiveProject();
  const hasProjectContext = Boolean(metadata?.ai.projectContext);
  const { sendChatMessage } = useAIOperations();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [personaOpen, setPersonaOpen] = useState(false);

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
      <div className="h-9 px-3 flex items-center justify-between shrink-0" style={{ backgroundColor: 'var(--color-card)' }}>
        <h2 className="text-sm font-semibold tracking-tight">AI Chat</h2>
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
              <div className="flex items-center gap-2 text-muted-foreground px-1 py-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span className="text-xs">
                  {activeTool === 'web_search' ? 'Searching the web...' : `Using ${activeTool}...`}
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
        <ChatInput
          onSend={handleSend}
          disabled={isLoading || !provider}
          footer={
            <>
              <Popover open={personaOpen} onOpenChange={setPersonaOpen}>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded px-1 py-0.5 hover:bg-accent/50">
                    <PersonaIcon persona={activePersona} size={14} />
                    <span>{activePersona.name}</span>
                    <ChevronUp className="h-3 w-3 opacity-50" />
                  </button>
                </PopoverTrigger>
                <PopoverContent side="top" align="start" className="w-48 p-1">
                  {allPersonas.map((persona) => (
                    <button
                      key={persona.id}
                      onClick={() => {
                        setActivePersona(persona.id);
                        setPersonaOpen(false);
                      }}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                        persona.id === activePersona.id
                          ? 'bg-accent text-accent-foreground'
                          : 'text-foreground hover:bg-accent/50'
                      }`}
                    >
                      <PersonaIcon persona={persona} size={14} />
                      <span>{persona.name}</span>
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
              {hasProjectContext && (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center gap-0.5 px-1 py-px rounded text-[10px] font-medium text-muted-foreground" style={{ backgroundColor: 'var(--color-accent)' }}>
                        <FileText className="h-2.5 w-2.5" />
                        CTX
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-64">
                      <p className="text-xs">Project context is active for this conversation</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </>
          }
        />
      </div>
    </div>
  );
}

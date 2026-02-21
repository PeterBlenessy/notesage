import { useEffect, useRef, useState, useMemo } from 'react';
import { Trash2, Loader2, Target, ChevronUp, FolderOpen, Check, Globe } from 'lucide-react';
import { toast } from 'sonner';
import { PersonaIcon } from '@/components/PersonaIcon';
import { useChatStore } from '@/stores/chat-store';
import { useAIStore, getActivePersona, getAllPersonas } from '@/stores/ai-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useProjectMetadataStore } from '@/stores/project-metadata-store';
import { useAIOperations } from '@/hooks/useAIOperations';
import { useGoalsDiscovery } from '@/hooks/useGoalsDiscovery';
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

export function ChatPanel() {
  const { messages, isLoading, error, activeTool, clearMessages, selectedProjectPaths, setSelectedProjectPaths, toggleProjectPath, webSearchEnabled, setWebSearchEnabled } = useChatStore();
  const aiStore = useAIStore();
  const { provider, setActivePersona } = aiStore;
  const activePersona = getActivePersona(aiStore);
  const allPersonas = getAllPersonas(aiStore);
  const projects = useWorkspaceStore((s) => s.projects);
  const metadataMap = useProjectMetadataStore((s) => s.metadataMap);

  // Goals discovery for single-project selection only
  const singleProjectPath = selectedProjectPaths.length === 1 ? selectedProjectPaths[0] : null;
  const { goalFiles } = useGoalsDiscovery(singleProjectPath);
  const { sendChatMessage, cancelChat } = useAIOperations();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);

  // Derive display label for the project selector trigger
  const projectLabel = useMemo(() => {
    if (selectedProjectPaths.length === 0) return 'No projects';
    if (selectedProjectPaths.length === 1) {
      const meta = metadataMap[selectedProjectPaths[0]];
      return meta?.name || selectedProjectPaths[0].split('/').pop() || 'Project';
    }
    const allSelected = projects.length > 0 && selectedProjectPaths.length === projects.length;
    if (allSelected) return 'All projects';
    return `${selectedProjectPaths.length} projects`;
  }, [selectedProjectPaths, metadataMap, projects.length]);

  const chatPlaceholder = useMemo(() => {
    if (goalFiles.length > 0) {
      return 'Ask about your project goals, or type a message...';
    }
    if (selectedProjectPaths.length > 0) {
      return 'Ask about your projects, or type a message...';
    }
    return 'Ask anything...';
  }, [goalFiles.length, selectedProjectPaths.length]);

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

  const allSelected = projects.length > 0 && selectedProjectPaths.length === projects.length;

  const handleToggleAll = () => {
    if (allSelected) {
      setSelectedProjectPaths([]);
    } else {
      setSelectedProjectPaths(projects.map((p) => p.path));
    }
  };

  return (
    <div className="h-full w-full bg-card flex flex-col">
      <div className="h-9 px-3 flex items-center justify-between shrink-0 bg-card">
        <h2 className="text-sm font-semibold tracking-tight">AI Chat</h2>
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleClear}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors duration-150 text-muted-foreground hover:text-foreground hover:bg-accent"
            title="Clear chat history"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
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
                  {activeTool === 'web_search' ? 'Searching the web...' : `${activeTool}...`}
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
          onStop={cancelChat}
          isLoading={isLoading}
          disabled={!provider}
          placeholder={chatPlaceholder}
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
              <Popover open={projectOpen} onOpenChange={setProjectOpen}>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded px-1 py-0.5 hover:bg-accent/50">
                    <FolderOpen className="h-3 w-3" strokeWidth={1.5} />
                    <span className="max-w-[100px] truncate">{projectLabel}</span>
                    <ChevronUp className="h-3 w-3 opacity-50" />
                  </button>
                </PopoverTrigger>
                <PopoverContent side="top" align="start" className="w-52 p-1">
                  {projects.length > 1 && (
                    <>
                      <button
                        onClick={handleToggleAll}
                        className="w-full flex items-center justify-between px-2 py-1.5 rounded text-xs transition-colors text-foreground hover:bg-accent/50"
                      >
                        <span>{allSelected ? 'Deselect all' : 'Select all'}</span>
                        {allSelected && <Check className="h-3 w-3 text-muted-foreground" />}
                      </button>
                      <div className="mx-2 my-1 border-t border-border" />
                    </>
                  )}
                  {projects.map((project) => {
                    const meta = metadataMap[project.path];
                    const name = meta?.name || project.path.split('/').pop() || 'Project';
                    const isChecked = selectedProjectPaths.includes(project.path);
                    return (
                      <button
                        key={project.path}
                        onClick={() => toggleProjectPath(project.path)}
                        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs transition-colors text-foreground hover:bg-accent/50"
                      >
                        <span className="truncate">{name}</span>
                        {isChecked && <Check className="h-3 w-3 shrink-0 text-muted-foreground" />}
                      </button>
                    );
                  })}
                  {projects.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      No projects open
                    </div>
                  )}
                </PopoverContent>
              </Popover>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => {
                        if (!provider) return;
                        if (provider === 'ollama') {
                          toast.info('Web search is not yet available for Ollama. Please use Anthropic or OpenAI for search.');
                          return;
                        }
                        setWebSearchEnabled(!webSearchEnabled);
                      }}
                      disabled={!provider}
                      className="flex items-center gap-1 text-xs transition-colors rounded px-1 py-0.5 hover:bg-accent/50 disabled:opacity-30 disabled:cursor-not-allowed"
                      style={{
                        color: webSearchEnabled && provider && provider !== 'ollama'
                          ? 'var(--color-foreground)'
                          : 'var(--color-muted-foreground)',
                      }}
                    >
                      <Globe className="h-3 w-3" strokeWidth={1.5} />
                      <span>Search</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-64">
                    <p className="text-xs">
                      {!provider
                        ? 'Configure an AI provider to use search'
                        : provider === 'ollama'
                          ? 'Web search is not available for Ollama'
                          : webSearchEnabled
                            ? 'Web search enabled — AI can search the internet'
                            : 'Click to enable web search'}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {goalFiles.length > 0 && (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center gap-0.5 px-1 py-px rounded text-[10px] font-medium text-muted-foreground bg-accent">
                        <Target className="h-2.5 w-2.5" />
                        {goalFiles.length} {goalFiles.length === 1 ? 'goal' : 'goals'}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-64">
                      <p className="text-xs">
                        {goalFiles.length} project {goalFiles.length === 1 ? 'goal is' : 'goals are'} included as AI context
                      </p>
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

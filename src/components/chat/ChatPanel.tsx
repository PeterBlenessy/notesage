import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Plus, MessageSquare, History } from 'lucide-react';
import { toast } from 'sonner';
import { useChatStore, selectMessages, selectProjectPaths, selectPendingProjectSwitch, selectPendingAgentSwitch } from '@/stores/chat-store';
import { useAIStore } from '@/stores/ai-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useRoutingStore } from '@/stores/routing-store';
import { useProjectMetadataStore } from '@/stores/project-metadata-store';
import { useSkillStore } from '@/stores/skill-store';
import { tauriApi } from '@/lib/tauri';
import { useAIOperations } from '@/hooks/useAIOperations';
import { useGoalsDiscovery } from '@/hooks/useGoalsDiscovery';
import { useChatContext } from '@/hooks/useChatContext';
import { ChatHistoryView } from './ChatHistoryView';
import { ChatMessageList } from './ChatMessageList';
import { ChatFooter } from './ChatFooter';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';



export interface EditContext {
  parentId: string | null;
  originalContent: string;
}

export function ChatPanel() {
  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const createConversation = useChatStore((s) => s.createConversation);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const setPendingProjectSwitch = useChatStore((s) => s.setPendingProjectSwitch);
  const setPendingAgentSwitch = useChatStore((s) => s.setPendingAgentSwitch);
  const messages = useChatStore(selectMessages);
  const rawProjectPaths = useChatStore(selectProjectPaths);
  const pendingProjectSwitch = useChatStore(selectPendingProjectSwitch);
  const pendingAgentSwitch = useChatStore(selectPendingAgentSwitch);

  const legacyProvider = useAIStore((s) => s.provider);
  const setActiveAgent = useSkillStore((s) => s.setActiveAgent);

  const metadataMap = useProjectMetadataStore((s) => s.metadataMap);
  const interactiveConnection = useRoutingStore((s) => s.getConnectionForUseCase('interactive'));
  const allConnections = useConnectionsStore((s) => s.connections);

  // Stabilize array identity — only update reference when values actually change
  const stableProjectPathsRef = useRef(rawProjectPaths);
  const selectedProjectPaths = useMemo(() => {
    const prev = stableProjectPathsRef.current;
    if (
      prev.length === rawProjectPaths.length &&
      prev.every((p, i) => p === rawProjectPaths[i])
    ) {
      return prev;
    }
    stableProjectPathsRef.current = rawProjectPaths;
    return rawProjectPaths;
  }, [rawProjectPaths]);

  // Resolve effective connection: project override takes priority over global routing
  const singleProjectPath = selectedProjectPaths.length === 1 ? selectedProjectPaths[0] : null;
  const singleMetadata = singleProjectPath ? metadataMap[singleProjectPath] ?? null : null;
  const projectProviderOverride = singleMetadata?.ai.provider ?? null;
  const projectOverrideConnection = useMemo(() => {
    if (!projectProviderOverride) return null;
    return allConnections.find((c) => c.id === projectProviderOverride) ?? null;
  }, [projectProviderOverride, allConnections]);
  const effectiveConnection = projectOverrideConnection ?? interactiveConnection;

  // AI availability: check v2 routing/connections first, fall back to v1 ai-store
  const hasAIProvider = !!effectiveConnection || !!legacyProvider;

  // Goals discovery for single-project selection only
  const { goalFiles } = useGoalsDiscovery(singleProjectPath);
  const { sendChatMessage } = useAIOperations();
  const { attachedFilePaths } = useChatContext();

  const [chatView, setChatView] = useState<'chat' | 'history'>('chat');
  const [editContext, setEditContext] = useState<EditContext | null>(null);
  const editContextRef = useRef<EditContext | null>(null);
  const updateEditContext = useCallback((ctx: EditContext | null) => {
    editContextRef.current = ctx;
    setEditContext(ctx);
  }, []);
  const clearEditContext = useCallback(() => updateEditContext(null), [updateEditContext]);

  // Detect project selection changes → trigger context isolation prompt
  const prevProjectPathsRef = useRef<string[]>(selectedProjectPaths);
  useEffect(() => {
    const prev = prevProjectPathsRef.current;
    const curr = selectedProjectPaths;
    prevProjectPathsRef.current = curr;

    // Skip on first render or if no messages yet (no context to isolate)
    if (messages.length === 0) return;

    // Check if the set actually changed
    const prevSet = new Set(prev);
    const currSet = new Set(curr);
    if (prevSet.size === currSet.size && [...prevSet].every((p) => currSet.has(p))) return;

    // Don't stack prompts — skip if already pending
    if (pendingProjectSwitch) return;

    setPendingProjectSwitch(curr, prev);
  }, [selectedProjectPaths, messages.length, pendingProjectSwitch, setPendingProjectSwitch]);

  // Detect provider connection changes → trigger context isolation prompt
  const prevConnectionRef = useRef<string | undefined>(effectiveConnection?.id);
  useEffect(() => {
    const prev = prevConnectionRef.current;
    const curr = effectiveConnection?.id;
    prevConnectionRef.current = curr;

    if (messages.length === 0) return;
    if (prev === curr) return;
    if (!prev || !curr) return;
    if (pendingAgentSwitch) return;

    // Look up labels for display
    const prevConn = allConnections.find((c) => c.id === prev);
    const currConn = allConnections.find((c) => c.id === curr);
    setPendingAgentSwitch(
      currConn?.label ?? 'Unknown provider',
      prevConn?.label ?? 'Unknown provider',
    );
  }, [effectiveConnection?.id, messages.length, pendingAgentSwitch, setPendingAgentSwitch, allConnections]);

  const chatPlaceholder = useMemo(() => {
    if (goalFiles.length > 0) {
      return 'Ask about your project goals, or type a message...';
    }
    if (selectedProjectPaths.length > 0) {
      return 'Ask about your projects, or type a message...';
    }
    return 'Ask anything...';
  }, [goalFiles.length, selectedProjectPaths.length]);

  // Auto-create a conversation when none exists (e.g. after deleting the last one)
  useEffect(() => {
    if (!activeConversationId && conversations.length === 0) {
      createConversation();
    }
  }, [activeConversationId, conversations.length, createConversation]);

  const handleSend = useCallback(async (content: string) => {
    if (!hasAIProvider) {
      return;
    }

    // Detect @agent-name prefix — switch active agent, strip prefix from message
    let expandedContent = content;
    const atMatch = content.match(/^@([a-z0-9][a-z0-9-]*)\s*(.*)/s);
    if (atMatch) {
      const agentName = atMatch[1];
      const restOfMessage = atMatch[2];
      const agent = useSkillStore.getState().getAgentByName(agentName);
      if (agent) {
        // Switch active agent — body will be injected as system message by useAIOperations
        setActiveAgent(agentName);
        if (!restOfMessage.trim()) {
          // Just "@agent-name" with no text — only switch, don't send
          return;
        }
        expandedContent = restOfMessage;
      }
    }

    // Detect /skill-name prefix and expand with skill body
    let skillName: string | undefined;
    const slashMatch = expandedContent.match(/^\/([a-z0-9][a-z0-9-]*)\s*(.*)/s);
    if (slashMatch) {
      const matchedName = slashMatch[1];
      const restOfMessage = slashMatch[2];
      const skill = useSkillStore.getState().skills.find((s) => s.name === matchedName);
      if (skill) {
        try {
          const skillContent = await tauriApi.readSkillContent(skill.path);
          skillName = matchedName;
          expandedContent = `[Using skill: ${matchedName}]\n\n${skillContent.body}\n\n---\n\nUser request: ${restOfMessage}`;
        } catch {
          toast.error(`Failed to load skill "${matchedName}"`);
          return;
        }
      }
    }

    // Comment-sourced conversations: restrict sandbox to the source project only
    const convs = useChatStore.getState().conversations;
    const activeId = useChatStore.getState().activeConversationId;
    const activeConv = convs.find((c) => c.id === activeId);
    const sandboxPaths = activeConv?.sourceCommentId && activeConv.projectPaths.length > 0
      ? activeConv.projectPaths
      : undefined; // undefined = all workspace folders (default)

    const sendOpts: Record<string, unknown> = { ...(skillName ? { displayContent: content, skillName } : {}), attachedFilePaths, sandboxPaths };
    if (editContextRef.current) {
      sendOpts.parentId = editContextRef.current.parentId;
      clearEditContext();
    }
    await sendChatMessage(expandedContent, messages, sendOpts as Parameters<typeof sendChatMessage>[2]);
  }, [hasAIProvider, setActiveAgent, sendChatMessage, messages, attachedFilePaths, clearEditContext]);

  const handleResend = useCallback((message: { parentId?: string | null; content: string }) => {
    if (!hasAIProvider) return;
    const parentId = message.parentId !== undefined ? message.parentId : null;
    updateEditContext({ parentId, originalContent: message.content });
    handleSend(message.content);
  }, [hasAIProvider, handleSend, updateEditContext]);

  const handleEdit = useCallback((message: { parentId?: string | null; content: string }) => {
    const parentId = message.parentId !== undefined ? message.parentId : null;
    updateEditContext({ parentId, originalContent: message.content });
  }, [updateEditContext]);

  const handleNewChat = useCallback(() => {
    createConversation();
  }, [createConversation]);

  const handleSelectConversation = useCallback((id: string) => {
    setActiveConversation(id);
    setChatView('chat');
  }, [setActiveConversation]);

  const activeConvTitle = useMemo(() => {
    if (!activeConversationId) return 'New Chat';
    const conv = conversations.find((c) => c.id === activeConversationId);
    return conv?.title || 'New Chat';
  }, [activeConversationId, conversations]);

  return (
    <div className="h-full w-full bg-card flex flex-col">
      <div className="h-9 px-2 flex items-center justify-between shrink-0 bg-card border-b border-border">
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setChatView('chat')}
            className={`h-7 px-2 flex items-center gap-1.5 rounded text-xs font-medium transition-colors ${
              chatView === 'chat'
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            }`}
          >
            <MessageSquare className="h-3 w-3" strokeWidth={1.5} />
            <span className="truncate max-w-[120px]">{activeConvTitle}</span>
          </button>
          <button
            onClick={() => setChatView('history')}
            className={`h-7 px-2 flex items-center gap-1.5 rounded text-xs font-medium transition-colors ${
              chatView === 'history'
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            }`}
          >
            <History className="h-3 w-3" strokeWidth={1.5} />
            History
          </button>
        </div>
        <div className="flex items-center gap-0.5">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => { handleNewChat(); setChatView('chat'); }}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors duration-150 text-muted-foreground hover:text-foreground hover:bg-accent active:opacity-75 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">New Chat</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {chatView === 'history' ? (
        <ChatHistoryView onSelectConversation={handleSelectConversation} />
      ) : (
      <>

      {!hasAIProvider && (
        <div className="p-4 bg-muted border-b border-border">
          <p className="text-sm text-muted-foreground">
            Please configure an AI provider in Settings (Cmd+,) before using chat.
          </p>
        </div>
      )}

      <ChatMessageList
        onSend={handleSend}
        selectedProjectPaths={selectedProjectPaths}
        onResend={handleResend}
        onEdit={handleEdit}
      />

      <ChatFooter
        onSend={handleSend}
        selectedProjectPaths={selectedProjectPaths}
        hasAIProvider={hasAIProvider}
        chatPlaceholder={chatPlaceholder}
        editContext={editContext}
        onCancelEdit={clearEditContext}
      />
      </>
      )}
    </div>
  );
}

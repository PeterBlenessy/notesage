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
import type { ChatInputHandle } from './ChatInput';
import type { ImageAttachment } from '@/lib/ai/types';
import { supportsVision as checkVision, type VisionCheckContext } from '@/lib/ai/vision';
import { useLocalAIStore } from '@/stores/local-ai-store';
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

  // Vision support check for image attachments
  const localAIModels = useLocalAIStore((s) => s.models);
  const localActiveModelId = useLocalAIStore((s) => s.activeModelId);
  const visionSupported = useMemo(() => {
    if (!effectiveConnection) return false;
    // Map ConnectionProvider to VisionCheckContext provider
    // ConnectionProvider uses 'local_ai' while AIProviderType uses 'local_bundled'
    const providerMap: Record<string, VisionCheckContext['provider']> = { local_ai: 'local_bundled' };
    const provider = (providerMap[effectiveConnection.provider] ?? effectiveConnection.provider) as VisionCheckContext['provider'];
    const ctx: VisionCheckContext = { provider };
    if (provider === 'local_bundled') {
      const activeModel = localAIModels.find((m) => m.id === localActiveModelId);
      ctx.localModelSupportsVision = activeModel?.supports_vision ?? false;
    }
    return checkVision(ctx);
  }, [effectiveConnection, localAIModels, localActiveModelId]);

  // Goals discovery for single-project selection only
  const { goalFiles } = useGoalsDiscovery(singleProjectPath);
  const { sendChatMessage } = useAIOperations();
  const { attachedFilePaths } = useChatContext();

  const chatInputRef = useRef<ChatInputHandle>(null);
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

    // Skip if prev was empty — this is initial rehydration, not a user-initiated change
    if (prev.length === 0) return;

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

  const handleSend = useCallback(async (content: string, attachments?: ImageAttachment[]) => {
    if (!hasAIProvider) {
      return;
    }

    // Detect @agent-name prefix — behavior depends on connection type
    let expandedContent = content;
    const atMatch = content.match(/^@([a-z0-9][a-z0-9-]*)\s*(.*)/s);
    if (atMatch) {
      const agentName = atMatch[1];
      const restOfMessage = atMatch[2];
      const isPassThrough = effectiveConnection?.authMethod === 'agent_managed';

      if (isPassThrough) {
        // ACP / Copilot LSP: pass @agent-name through verbatim — the provider handles delegation
        expandedContent = content;
      } else {
        // Direct API: intercept, strip prefix, swap system prompt
        const agent = useSkillStore.getState().getAgentByName(agentName);
        if (agent) {
          setActiveAgent(agentName);
          if (!restOfMessage.trim()) {
            // Just "@agent-name" with no text — only switch, don't send
            return;
          }
          expandedContent = restOfMessage;
        }
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
      : undefined; // undefined = default scope from getChatSandboxScope (selected projects only)

    const sendOpts: Record<string, unknown> = { ...(skillName ? { displayContent: content, skillName } : {}), attachedFilePaths, sandboxPaths, attachments };
    if (editContextRef.current) {
      sendOpts.parentId = editContextRef.current.parentId;
      clearEditContext();
    }

    // Read fresh messages from the store (not the stale closure) — critical for
    // handleResend which deletes messages then immediately calls handleSend.
    const freshMessages = selectMessages(useChatStore.getState());

    // Apply provider context isolation: if the active segment says "start fresh",
    // only include messages from the segment boundary onward.
    const segment = useChatStore.getState().getActiveSegment();
    let filteredMessages = freshMessages;
    if (segment && !segment.historyIncluded && segment.startMessageIndex > 0) {
      // startMessageIndex is based on conversation.messages array length at the time
      // of the switch. For branching threads, clamp to current thread length.
      const dropCount = Math.min(segment.startMessageIndex, freshMessages.length);
      filteredMessages = freshMessages.slice(dropCount);
    }

    await sendChatMessage(expandedContent, filteredMessages, sendOpts as Parameters<typeof sendChatMessage>[2]);
  }, [hasAIProvider, setActiveAgent, sendChatMessage, attachedFilePaths, clearEditContext]);

  const handleResend = useCallback((message: { id?: string; parentId?: string | null; content: string }) => {
    if (!hasAIProvider) return;
    // Delete the message and all responses after it, then resend the same text
    if (message.id) {
      useChatStore.getState().deleteMessageAndDescendants(message.id);
    }
    handleSend(message.content);
  }, [hasAIProvider, handleSend]);

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

  const handlePrefill = useCallback((text: string) => {
    chatInputRef.current?.prefill(text);
  }, []);

  const activeConvTitle = useMemo(() => {
    if (!activeConversationId) return 'New Chat';
    const conv = conversations.find((c) => c.id === activeConversationId);
    return conv?.title || 'New Chat';
  }, [activeConversationId, conversations]);

  return (
    <div className="chat-panel-root h-full w-full bg-card flex flex-col">
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
        </div>
        <div className="flex items-center gap-0.5">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setChatView(chatView === 'history' ? 'chat' : 'history')}
                  className={`h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors duration-150 active:opacity-75 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                    chatView === 'history'
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                >
                  <History className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">Chat History</TooltipContent>
            </Tooltip>
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
        onPrefill={handlePrefill}
      />

      <ChatFooter
        onSend={handleSend}
        selectedProjectPaths={selectedProjectPaths}
        hasAIProvider={hasAIProvider}
        chatPlaceholder={chatPlaceholder}
        editContext={editContext}
        onCancelEdit={clearEditContext}
        chatInputRef={chatInputRef}
        supportsVision={visionSupported}
      />
      </>
      )}
    </div>
  );
}

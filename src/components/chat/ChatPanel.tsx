import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Plus, MessageSquare, History } from 'lucide-react';
import { toast } from 'sonner';
import { useChatStore, selectMessages, selectProjectPaths, selectPendingProjectSwitch, selectPendingAgentSwitch, sliceThreadBySegment } from '@/stores/chat-store';
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
import type { ChatMessage as ChatMessageType, ImageAttachment } from '@/lib/ai/types';
import { supportsVision as checkVision, type VisionCheckContext } from '@/lib/ai/vision';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { getProjectLock } from '@/lib/ai/project-lock';
import { ResendProviderDialog, type ResendProviderOption, type ResendProviderChoice } from './ResendProviderDialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';



export interface EditContext {
  parentId: string | null;
  originalContent: string;
  /**
   * Connection ID the original message was routed to. Compared against the
   * current connection at send-time to catch cross-provider edit-sends — if
   * they differ, `<ResendProviderDialog>` gates the send. Undefined for legacy
   * messages that predate connectionId recording.
   */
  originalConnectionId?: string;
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

  // Mismatch dialog state — opens when the message's recorded connectionId
  // differs from the currently active connection, so the user can pick which
  // provider receives it. `mode` tracks whether this came from the resend or
  // edit-send path; the sent content may differ for edits.
  interface ResendDialogState {
    mode: 'resend' | 'edit';
    content: string;
    /** For resend: the message id to delete-and-resend. For edit: ignored. */
    messageIdToDelete?: string;
    originalConnectionId: string;
    currentConnectionId: string | null;
  }
  const [resendDialog, setResendDialog] = useState<ResendDialogState | null>(null);

  const setRouting = useRoutingStore((s) => s.setRouting);

  const singleLock = singleProjectPath ? getProjectLock(singleProjectPath, metadataMap) : null;

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

  // Core send — the previous `handleSend`. Renamed so we can gate the public
  // handler on provider-mismatch confirmation without duplicating the full
  // message-preparation pipeline.
  const doSend = useCallback(async (content: string, attachments?: ImageAttachment[]) => {
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
    // only include messages from the segment boundary onward. Slicing is
    // branch-aware (task #28) — uses the stable `startMessageId` anchor and
    // walks the active-leaf thread rather than positional indices.
    const segment = useChatStore.getState().getActiveSegment();
    const filteredMessages = sliceThreadBySegment(
      freshMessages,
      segment,
      activeConv?.messages ?? [],
    );

    await sendChatMessage(expandedContent, filteredMessages, sendOpts as Parameters<typeof sendChatMessage>[2]);
  }, [hasAIProvider, effectiveConnection, setActiveAgent, sendChatMessage, attachedFilePaths, clearEditContext]);

  // Keep a fresh ref to `doSend` so post-reroute sends (scheduled via
  // setTimeout after `setRouting`) pick up the new closure with the updated
  // `effectiveConnection`. If we called `doSend` directly after `setRouting`
  // it would still reference the pre-switch connection.
  const doSendRef = useRef(doSend);
  doSendRef.current = doSend;

  // Public send handler — the edit-send check lives here so keyboard Enter
  // inside an edit context goes through the dialog gate.
  const handleSend = useCallback(async (content: string, attachments?: ImageAttachment[]) => {
    const editCtx = editContextRef.current;
    const currentId = effectiveConnection?.id ?? null;
    if (editCtx?.originalConnectionId && editCtx.originalConnectionId !== currentId) {
      // Cross-provider edit — gate on dialog confirmation. Keep the edit
      // context until the user picks a provider so the dialog can re-fire
      // on confirm (the edit's parentId must survive through the dialog).
      setResendDialog({
        mode: 'edit',
        content,
        originalConnectionId: editCtx.originalConnectionId,
        currentConnectionId: currentId,
      });
      return;
    }
    await doSend(content, attachments);
  }, [doSend, effectiveConnection?.id]);

  const handleResend = useCallback((message: ChatMessageType) => {
    if (!hasAIProvider) return;
    const currentId = effectiveConnection?.id ?? null;
    const originalId = message.connectionId ?? null;

    // Only prompt when the recorded original differs from the currently active
    // connection. Unknown/legacy messages (no `connectionId`) fall through to
    // the existing silent-resend path — we can't ask about a provider we
    // weren't told about.
    if (originalId && originalId !== currentId) {
      setResendDialog({
        mode: 'resend',
        content: message.content,
        messageIdToDelete: message.id,
        originalConnectionId: originalId,
        currentConnectionId: currentId,
      });
      return;
    }

    // Same-provider resend: delete-then-send as before
    if (message.id) {
      useChatStore.getState().deleteMessageAndDescendants(message.id);
    }
    handleSend(message.content);
  }, [hasAIProvider, handleSend, effectiveConnection?.id]);

  const handleEdit = useCallback((message: ChatMessageType) => {
    const parentId = message.parentId !== undefined ? message.parentId : null;
    updateEditContext({
      parentId,
      originalContent: message.content,
      // Track which provider this message was originally sent to so the
      // edit-send path can detect cross-provider sends even after the user
      // types new content. Absent for legacy messages — those fall through.
      originalConnectionId: message.connectionId,
    });
  }, [updateEditContext]);

  // Dialog confirm handler. `setRouting` is synchronous (Zustand store write)
  // but `doSend` captures `effectiveConnection` via closure, so we switch the
  // routing and then schedule the send via `setTimeout(0)` — by the time the
  // timer fires React has flushed and `doSendRef.current` points at the
  // rebuilt closure with the new connection.
  const handleResendDialogConfirm = useCallback((choice: ResendProviderChoice) => {
    const dialog = resendDialog;
    if (!dialog) return;
    setResendDialog(null);

    const targetId =
      choice === 'original' ? dialog.originalConnectionId : dialog.currentConnectionId;

    // Delete the original response (and its tree) only for the resend path;
    // edit-send never deletes — it creates a new branch via `parentId`.
    if (dialog.mode === 'resend' && dialog.messageIdToDelete) {
      useChatStore.getState().deleteMessageAndDescendants(dialog.messageIdToDelete);
    }

    const runSend = () => {
      // Edit context was established on handleSend entry; it carries the
      // parentId the edit must branch from. Clear via doSend's internal
      // clearEditContext — same path as a regular edit-send.
      doSendRef.current(dialog.content);
    };

    if (targetId && targetId !== (effectiveConnection?.id ?? null)) {
      // Reroute first, then send after React flush so the underlying send
      // hooks pick up the rebuilt closure.
      setRouting('interactive', targetId);
      setTimeout(runSend, 0);
    } else {
      runSend();
    }
  }, [resendDialog, effectiveConnection?.id, setRouting]);

  const handleResendDialogCancel = useCallback(() => {
    setResendDialog(null);
    // Intentional: on cancel we leave editContext in place so the user can
    // adjust or abandon the edit themselves.
  }, []);

  // Derive the dialog's original/current options from the open dialog state.
  // Memoized so the child doesn't re-render when unrelated store state moves.
  const resendDialogOptions = useMemo<
    | { original: ResendProviderOption; current: ResendProviderOption; isEdit: boolean }
    | null
  >(() => {
    if (!resendDialog) return null;

    const originalConn = allConnections.find((c) => c.id === resendDialog.originalConnectionId) ?? null;
    const currentConn = resendDialog.currentConnectionId
      ? allConnections.find((c) => c.id === resendDialog.currentConnectionId) ?? null
      : null;

    // If the project is locked, only the option matching the lock is enabled.
    const lockedId = singleLock?.connectionId ?? null;

    const originalDisabled =
      !originalConn || (lockedId !== null && resendDialog.originalConnectionId !== lockedId);
    const currentDisabled =
      !currentConn || (lockedId !== null && resendDialog.currentConnectionId !== lockedId);

    const originalDisabledReason = !originalConn
      ? `Original provider (${resendDialog.originalConnectionId}) is no longer connected.`
      : lockedId !== null && resendDialog.originalConnectionId !== lockedId
      ? 'This project is locked to a different provider.'
      : undefined;
    const currentDisabledReason = !currentConn
      ? 'No provider is currently selected. Configure one in Settings.'
      : lockedId !== null && resendDialog.currentConnectionId !== lockedId
      ? 'This project is locked to a different provider.'
      : undefined;

    const original: ResendProviderOption = {
      id: resendDialog.originalConnectionId,
      // Fall back to a short connection-id hint when the snapshot is gone so
      // the user at least sees "which" provider is missing.
      label: originalConn?.label ?? `Removed connection (${resendDialog.originalConnectionId.slice(0, 8)}…)`,
      provider: originalConn?.provider ?? null,
      disabled: originalDisabled,
      disabledReason: originalDisabledReason,
    };
    const current: ResendProviderOption = {
      id: resendDialog.currentConnectionId,
      label: currentConn?.label ?? 'No provider selected',
      provider: currentConn?.provider ?? null,
      disabled: currentDisabled,
      disabledReason: currentDisabledReason,
    };

    return { original, current, isEdit: resendDialog.mode === 'edit' };
  }, [resendDialog, allConnections, singleLock?.connectionId]);

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
        <ChatHistoryView onSelectConversation={handleSelectConversation} selectedProjectPaths={selectedProjectPaths} />
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
      {resendDialogOptions && resendDialog && (
        <ResendProviderDialog
          open={!!resendDialog}
          onOpenChange={(next) => { if (!next) handleResendDialogCancel(); }}
          original={resendDialogOptions.original}
          current={resendDialogOptions.current}
          isEdit={resendDialogOptions.isEdit}
          onConfirm={handleResendDialogConfirm}
        />
      )}
    </div>
  );
}

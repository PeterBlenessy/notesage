import { memo, useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { Loader2, GitBranch } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { log } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { useChatStore, selectMessages, selectAllMessages, selectPendingProjectSwitch, selectPendingAgentSwitch, selectSegments, getSessionIdForLeaf } from '@/stores/chat-store';
import { getChildren } from '@/lib/chat-tree';
import { getAcpAgent } from '@/lib/ai/acp-agent-state';
import { hasSessionCapability } from '@/lib/ai/acp-utils';
import { tauriApi } from '@/lib/tauri';
import { useConnectionsStore } from '@/stores/connections-store';
import { LocalAgentSetupPrompt } from './LocalAgentSetupPrompt';
import { useRoutingStore } from '@/stores/routing-store';
import { useProjectMetadataStore } from '@/stores/project-metadata-store';
import { usePermissionStore } from '@/stores/permission-store';
import { PROVIDER_OPTIONS } from '@/lib/ai/connections';
import type { ChatMessage as ChatMessageType } from '@/lib/ai/types';
import { ChatMessage } from './ChatMessage';
import { LocalAISetupCard } from './LocalAISetupCard';
import { PermissionCard } from './PermissionCard';
import { DomainApprovalCard, type DomainApprovalRequest } from './DomainApprovalCard';
import { ToolCallPermissionCard } from './ToolCallPermissionCard';
import { AgentStatusBanner } from './AgentStatusBanner';
import { useToolPermissionStore, selectForegroundPending } from '@/stores/tool-permission-store';
import { useAgentStatusStore } from '@/stores/agent-status-store';
import { getRetryCallback, getKeepWaitingCallback } from '@/hooks/useAcpLifecycle';
import { useForegroundLoading } from '@/hooks/useSessionManager';
import { ProjectSwitchCard } from './ProjectSwitchCard';
import { AgentSwitchCard } from './AgentSwitchCard';
import { ContextDivider } from './ContextDivider';
import { QuickReplies, parseQuickReplies } from './QuickReplies';

const ONBOARDING_PROMPTS = [
  'Summarize my current note',
  'Help me brainstorm ideas',
  'Review this document',
];

interface ChatMessageListProps {
  onSend: (content: string, attachments?: import('@/lib/ai/types').ImageAttachment[]) => void;
  selectedProjectPaths: string[];
  /**
   * Resend signature takes the full `ChatMessageType` so the host can read
   * `message.connectionId` to gate cross-provider resends on the confirmation
   * dialog (#10 in project-data-isolation).
   */
  onResend?: (message: ChatMessageType) => void;
  /**
   * Edit signature mirrors resend: the full `ChatMessageType` so the host can
   * capture `message.connectionId` in the edit context and detect provider
   * mismatches at send time.
   */
  onEdit?: (message: ChatMessageType) => void;
  onPrefill?: (text: string) => void;
}

export const ChatMessageList = memo(function ChatMessageList({ onSend, selectedProjectPaths, onResend, onEdit, onPrefill }: ChatMessageListProps) {
  // Foreground-conversation loading (task #4) — the list renders the watched
  // conversation, so it reflects that conversation's run, not the global flag.
  const isLoading = useForegroundLoading();
  const activeTool = useChatStore((s) => s.activeTool);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const branchFromMessage = useChatStore((s) => s.branchFromMessage);
  const messages = useChatStore(selectMessages);
  const allMessages = useChatStore(selectAllMessages);
  const pendingProjectSwitch = useChatStore(selectPendingProjectSwitch);
  const pendingAgentSwitch = useChatStore(selectPendingAgentSwitch);
  const segments = useChatStore(selectSegments);
  const permissionRequests = usePermissionStore((s) => s.requests);
  // Only the foreground conversation's pending request renders here (review #4);
  // background conversations surface theirs in their history row instead.
  const toolPermission = useToolPermissionStore(selectForegroundPending(activeConversationId));

  // Detect if the user is at a branch point (last visible message has children in the full tree)
  const branchPointInfo = useMemo(() => {
    if (messages.length === 0 || allMessages.length === messages.length) return null;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg?.id) return null;
    const children = getChildren(allMessages, lastMsg.id);
    if (children.length === 0) return null;
    return { messageId: lastMsg.id, branchCount: children.length + 1 }; // +1 for the new branch being created
  }, [messages, allMessages]);

  const [domainRequests, setDomainRequests] = useState<DomainApprovalRequest[]>([]);

  // Resolve effective connection for domain auto-approval
  const singleProjectPath = selectedProjectPaths.length === 1 ? selectedProjectPaths[0] : null;
  const singleMetadata = useProjectMetadataStore((s) => singleProjectPath ? s.metadataMap[singleProjectPath] ?? null : null);
  const projectProviderOverride = singleMetadata?.ai.provider ?? null;
  const interactiveConnection = useRoutingStore((s) => s.getConnectionForUseCase('interactive'));
  const allConnections = useConnectionsStore((s) => s.connections);
  const projectOverrideConnection = projectProviderOverride
    ? allConnections.find((c) => c.id === projectProviderOverride) ?? null
    : null;
  const effectiveConnection = projectOverrideConnection ?? interactiveConnection;

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const scrollToEnd = useCallback(() => {
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  // MutationObserver: scroll when DOM content actually changes
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const observer = new MutationObserver(() => {
      if (autoScrollRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    });
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  // Scroll to bottom when conversation changes
  useEffect(() => {
    autoScrollRef.current = true;
    requestAnimationFrame(scrollToEnd);
  }, [activeConversationId, scrollToEnd]);

  // Force scroll when user sends a message
  const wasLoadingRef = useRef(false);
  useEffect(() => {
    if (isLoading && !wasLoadingRef.current) {
      autoScrollRef.current = true;
      requestAnimationFrame(scrollToEnd);
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading, scrollToEnd]);

  // Listen for network domain approval requests from the proxy
  useEffect(() => {
    const unlisten = listen<{
      instanceId: string;
      agentId: string;
      domain: string;
      port: number;
      requestId: string;
    }>('network-domain-request', (event) => {
      const { instanceId, agentId, domain, port, requestId } = event.payload;

      const connId = effectiveConnection?.id;
      if (connId) {
        const provOpt = PROVIDER_OPTIONS.find(
          (o) => o.agentBinary === agentId
        );
        const builtIn = provOpt?.installMeta?.allowedDomains ?? [];
        const permStore = usePermissionStore.getState();
        if (permStore.isDomainAllowed(connId, domain, builtIn, null)) {
          invoke('network_domain_respond', {
            instanceId,
            requestId,
            decision: 'allow_once',
          }).catch((err) => log.warn('ai', 'Failed to auto-approve domain', err));
          return;
        }
      }

      setDomainRequests((prev) => [
        ...prev,
        { instanceId, agentId, domain, port, requestId, connectionId: connId ?? '' },
      ]);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [effectiveConnection?.id]);

  const handleDomainResolved = (requestId: string) => {
    setDomainRequests((prev) => prev.filter((r) => r.requestId !== requestId));
  };

  // Stable callbacks for ChatMessage — prevent inline arrow functions from breaking React.memo
  const handleResend = useCallback((msg: ChatMessageType) => {
    onResend?.(msg);
  }, [onResend]);

  const handleEdit = useCallback((msg: ChatMessageType) => {
    onEdit?.(msg);
  }, [onEdit]);

  const handleRetry = useCallback((msg: ChatMessageType) => {
    const allMsgs = useChatStore.getState().conversations.find(
      (c) => c.id === useChatStore.getState().activeConversationId
    )?.messages;
    if (!allMsgs) return;
    const msgIndex = allMsgs.findIndex((m) => m.timestamp === msg.timestamp);
    const prevUser = allMsgs.slice(0, msgIndex).reverse().find((m) => m.role === 'user');
    if (prevUser) onResend?.(prevUser);
  }, [onResend]);

  const handleBranch = useCallback(async (timestamp: number) => {
    // Determine if this is a leaf branch (branching from the current thread's end) and
    // whether the agent supports session/fork. Leaf branches with fork capability get an
    // isolated agent-side session; everything else continues to share conv.acpSessionId.
    const state = useChatStore.getState();
    const conv = state.conversations.find((c) => c.id === state.activeConversationId);
    const branchPoint = conv?.messages.find((m) => m.timestamp === timestamp);
    const isLeafBranch = !!(conv && branchPoint?.id && branchPoint.id === conv.activeLeafId);

    // The active conversation's ACP agent (registry keyed by conversation id, task #2).
    const acpAgent = getAcpAgent(state.activeConversationId ?? undefined);
    let forkedSessionId: string | undefined;
    if (isLeafBranch && acpAgent?.capabilities && hasSessionCapability(acpAgent.capabilities, 'fork')) {
      const currentSessionId = conv ? getSessionIdForLeaf(conv, conv.activeLeafId) : undefined;
      if (currentSessionId && acpAgent.instanceId) {
        const cwd = selectedProjectPaths[0] || '/tmp';
        try {
          const result = await tauriApi.acpSessionFork(acpAgent.instanceId, currentSessionId, cwd);
          forkedSessionId = result.session_id;
        } catch (err) {
          log.info('ai', `ACP session/fork failed (falling back to shared session): ${String(err)}`);
          toast('Fork unavailable — branch will share the original session.');
        }
      }
    }

    branchFromMessage(timestamp, forkedSessionId);
    toast('Branched conversation', {
      description: 'Type a new message to continue on this branch.',
    });
    requestAnimationFrame(() => {
      autoScrollRef.current = true;
      scrollToEnd();
      const textarea = document.querySelector<HTMLTextAreaElement>('.chat-input-textarea');
      textarea?.focus();
    });
  }, [branchFromMessage, scrollToEnd, selectedProjectPaths]);

  return (
    <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-3 py-4">
      {messages.length === 0 ? (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm text-center">
          <div className="max-w-[260px]">
            <LocalAISetupCard />
            <p className="mt-4 text-sm font-medium text-foreground">Start a conversation</p>
            <div className="flex flex-wrap justify-center gap-1.5 mt-3">
              {ONBOARDING_PROMPTS.map((prompt) => (
                <Button
                  key={prompt}
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => onPrefill?.(prompt)}
                >
                  {prompt}
                </Button>
              ))}
            </div>
            {/* Local Agent setup entry (task #18) — only when no AI connection
                exists yet. Opens the agent setup dialog (#17). */}
            <LocalAgentSetupPrompt />
            <p className="mt-3 text-[10px] text-muted-foreground">
              Type <kbd className="px-1 py-px rounded bg-muted font-mono text-[10px]">/</kbd> for skills, <kbd className="px-1 py-px rounded bg-muted font-mono text-[10px]">@</kbd> for agents
            </p>
          </div>
        </div>
      ) : (
        <>
          {messages.map((message, index) => {
            const isLast = index === messages.length - 1;
            const isLastAssistant = !isLoading && message.role === 'assistant' && isLast;
            const isAssistant = message.role === 'assistant';
            const parsed = isAssistant && message.content ? parseQuickReplies(message.content) : null;
            const displayMessage = parsed && parsed.strippedContent !== message.content
              ? { ...message, content: parsed.strippedContent }
              : message;

            // Segment dividers: match by message identity, not flat array index.
            // Only show if the segment's start message is in the current thread.
            const segmentAtIndex = message.id
              ? segments.findIndex((s, si) => {
                  if (si === 0) return false;
                  const segMsg = allMessages[s.startMessageIndex];
                  return segMsg?.id === message.id;
                })
              : -1;
            const segment = segmentAtIndex >= 0 ? segments[segmentAtIndex] : null;
            const prevSegment = segmentAtIndex >= 1 ? segments[segmentAtIndex - 1] : undefined;

            const branchChildren = message.id ? getChildren(allMessages, message.id) : [];
            const branchCount = branchChildren.length;

            return (
              <div key={index}>
                {segment && (
                  <ContextDivider segment={segment} previousSegment={prevSegment} />
                )}
                <ChatMessage
                  message={displayMessage}
                  isLast={isLast}
                  branchCount={branchCount}
                  onResend={onResend && message.role === 'user' ? handleResend : undefined}
                  onEdit={onEdit && message.role === 'user' ? handleEdit : undefined}
                  onRetry={onResend && message.role === 'assistant' && message.isError ? handleRetry : undefined}
                  onBranch={message.timestamp ? handleBranch : undefined}
                />
                {isLastAssistant && parsed && parsed.replies.length > 0 && (
                  <QuickReplies replies={parsed.replies} onSelect={onSend} />
                )}
              </div>
            );
          })}
          {/* Branch-ready separator — shown when at a branch point waiting for new input */}
          {branchPointInfo && !isLoading && (
            <div className="flex items-center gap-2.5 py-3 px-1">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                <GitBranch className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span className="font-medium">{branchPointInfo.branchCount} branches</span>
              </span>
              <div className="flex-1 border-t border-border" />
            </div>
          )}
          {/* Context divider for the latest segment — only if the segment start message
              is on the current thread (not on a sibling branch) */}
          {segments.length > 1 && !branchPointInfo && (() => {
            const lastSeg = segments[segments.length - 1];
            if (lastSeg.startMessageIndex >= messages.length && !pendingProjectSwitch) {
              // Verify the segment's start message is a descendant of the current thread's leaf
              const segStartMsg = allMessages[lastSeg.startMessageIndex];
              if (segStartMsg?.parentId) {
                const parentInThread = messages.some((m) => m.id === segStartMsg.parentId);
                if (!parentInThread) return null;
              }
              return <ContextDivider segment={lastSeg} previousSegment={segments[segments.length - 2]} />;
            }
            return null;
          })()}
          {pendingProjectSwitch && (
            <ProjectSwitchCard
              newPaths={pendingProjectSwitch.newPaths}
              previousPaths={pendingProjectSwitch.previousPaths}
            />
          )}
          {pendingAgentSwitch && (
            <AgentSwitchCard
              newAgent={pendingAgentSwitch.newAgent}
              previousAgent={pendingAgentSwitch.previousAgent}
            />
          )}
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
          <AgentStatusBanner
            onKeepWaiting={() => getKeepWaitingCallback()?.() ?? useAgentStatusStore.getState().clearStatus()}
            onRetry={() => { getRetryCallback()?.(); }}
            onCancel={() => useAgentStatusStore.getState().clearStatus()}
          />
          {(permissionRequests.length > 0 || domainRequests.length > 0 || toolPermission) && (
            <div className="flex flex-col gap-2 mt-2">
              {permissionRequests.map((req) => (
                <PermissionCard key={req.id} request={req} />
              ))}
              {domainRequests.map((req) => (
                <DomainApprovalCard
                  key={req.requestId}
                  request={req}
                  onResolved={handleDomainResolved}
                />
              ))}
              {toolPermission && (
                <ToolCallPermissionCard key={toolPermission.id} request={toolPermission} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
});
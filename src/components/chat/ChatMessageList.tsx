import { memo, useEffect, useRef, useCallback, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useChatStore, selectMessages, selectPendingProjectSwitch, selectPendingAgentSwitch, selectSegments } from '@/stores/chat-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useRoutingStore } from '@/stores/routing-store';
import { useProjectMetadataStore } from '@/stores/project-metadata-store';
import { usePermissionStore } from '@/stores/permission-store';
import { PROVIDER_OPTIONS } from '@/lib/ai/connections';
import { ChatMessage } from './ChatMessage';
import { LocalAISetupCard } from './LocalAISetupCard';
import { PermissionCard } from './PermissionCard';
import { DomainApprovalCard, type DomainApprovalRequest } from './DomainApprovalCard';
import { ProjectSwitchCard } from './ProjectSwitchCard';
import { AgentSwitchCard } from './AgentSwitchCard';
import { ContextDivider } from './ContextDivider';
import { QuickReplies, parseQuickReplies } from './QuickReplies';

interface ChatMessageListProps {
  onSend: (content: string) => void;
  selectedProjectPaths: string[];
}

export const ChatMessageList = memo(function ChatMessageList({ onSend, selectedProjectPaths }: ChatMessageListProps) {
  const isLoading = useChatStore((s) => s.isLoading);
  const activeTool = useChatStore((s) => s.activeTool);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const messages = useChatStore(selectMessages);
  const pendingProjectSwitch = useChatStore(selectPendingProjectSwitch);
  const pendingAgentSwitch = useChatStore(selectPendingAgentSwitch);
  const segments = useChatStore(selectSegments);
  const permissionRequests = usePermissionStore((s) => s.requests);

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
        if (permStore.isDomainAllowed(connId, domain, builtIn)) {
          invoke('network_domain_respond', {
            instanceId,
            requestId,
            decision: 'allow_once',
          }).catch(() => {});
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

  return (
    <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-3 py-4">
      {messages.length === 0 ? (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm text-center">
          <div>
            <LocalAISetupCard />
            <p className="mt-4">
              Start a conversation with AI.
              <br />
              Ask questions about your writing or get suggestions.
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

            const segmentAtIndex = segments.findIndex((s, si) => si > 0 && s.startMessageIndex === index);
            const segment = segmentAtIndex >= 0 ? segments[segmentAtIndex] : null;
            const prevSegment = segmentAtIndex >= 1 ? segments[segmentAtIndex - 1] : undefined;

            return (
              <div key={index}>
                {segment && (
                  <ContextDivider segment={segment} previousSegment={prevSegment} />
                )}
                <ChatMessage message={displayMessage} isLast={isLast} />
                {isLastAssistant && parsed && parsed.replies.length > 0 && (
                  <QuickReplies replies={parsed.replies} onSelect={onSend} />
                )}
              </div>
            );
          })}
          {/* Context divider for the latest segment (when no messages sent in it yet) */}
          {segments.length > 1 && (() => {
            const lastSeg = segments[segments.length - 1];
            if (lastSeg.startMessageIndex >= messages.length && !pendingProjectSwitch) {
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
          {(permissionRequests.length > 0 || domainRequests.length > 0) && (
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
            </div>
          )}
        </>
      )}
    </div>
  );
});

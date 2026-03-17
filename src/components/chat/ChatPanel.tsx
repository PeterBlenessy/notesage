import { useEffect, useRef, useState, useMemo } from 'react';
import { Trash2, Loader2, Target, ChevronUp, FolderOpen, Check, Globe, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { AgentIcon } from '@/components/AgentIcon';
import { ProviderLogo } from '@/components/ProviderLogo';
import { useChatStore, selectMessages, selectProjectPaths, selectPendingProjectSwitch, selectPendingAgentSwitch, selectSegments } from '@/stores/chat-store';
import { useAIStore } from '@/stores/ai-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { PROVIDER_OPTIONS } from '@/lib/ai/connections';
import { useRoutingStore } from '@/stores/routing-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useProjectMetadataStore } from '@/stores/project-metadata-store';
import { tauriApi } from '@/lib/tauri';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAIOperations } from '@/hooks/useAIOperations';
import { useGoalsDiscovery } from '@/hooks/useGoalsDiscovery';
import { usePermissionStore } from '@/stores/permission-store';
import { useSkillStore } from '@/stores/skill-store';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { LocalAISetupCard } from './LocalAISetupCard';
import { PermissionCard } from './PermissionCard';
import { DomainApprovalCard, type DomainApprovalRequest } from './DomainApprovalCard';
import { ProjectSwitchCard } from './ProjectSwitchCard';
import { AgentSwitchCard } from './AgentSwitchCard';
import { ContextDivider } from './ContextDivider';
import { QuickReplies, parseQuickReplies } from './QuickReplies';
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
  const { isLoading, activeTool, clearMessages, setSelectedProjectPaths, toggleProjectPath, webSearchEnabled, setWebSearchEnabled, conversations, activeConversationId, createConversation, deleteConversation, setActiveConversation, setPendingProjectSwitch, setPendingAgentSwitch } = useChatStore();
  const messages = useChatStore(selectMessages);
  const selectedProjectPaths = useChatStore(selectProjectPaths);
  const pendingProjectSwitch = useChatStore(selectPendingProjectSwitch);
  const pendingAgentSwitch = useChatStore(selectPendingAgentSwitch);
  const segments = useChatStore(selectSegments);
  const legacyProvider = useAIStore((s) => s.provider);
  const agents = useSkillStore((s) => s.agents);
  const agentEnabledOverrides = useSkillStore((s) => s.agentEnabledOverrides);
  const activeAgentName = useSkillStore((s) => s.activeAgentName);
  const invocableAgents = useMemo(() => useSkillStore.getState().getUserInvocableAgents(), [agents, agentEnabledOverrides]);
  const activeAgent = useMemo(() => useSkillStore.getState().getActiveAgent(), [agents, agentEnabledOverrides, activeAgentName]);
  const setActiveAgent = useSkillStore((s) => s.setActiveAgent);
  const projects = useWorkspaceStore((s) => s.projects);
  const metadataMap = useProjectMetadataStore((s) => s.metadataMap);
  const interactiveConnection = useRoutingStore((s) => s.getConnectionForUseCase('interactive'));
  const setRouting = useRoutingStore((s) => s.setRouting);
  const allConnections = useConnectionsStore((s) => s.connections);
  const interactiveConnections = useMemo(() => allConnections.filter((c) => c.capabilities.includes('interactive')), [allConnections]);

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
  // Effective provider type for capability checks (e.g. web search support)
  const effectiveProviderType = effectiveConnection?.provider || legacyProvider;

  // Goals discovery for single-project selection only
  const { goalFiles } = useGoalsDiscovery(singleProjectPath);
  const { sendChatMessage, cancelChat } = useAIOperations();
  const permissionRequests = usePermissionStore((s) => s.requests);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [providerOpen, setProviderOpen] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [convListOpen, setConvListOpen] = useState(false);

  const [domainRequests, setDomainRequests] = useState<DomainApprovalRequest[]>([]);

  const isAcpConnection = effectiveConnection?.authMethod === 'agent_managed';
  const hasProjectOverride = !!projectOverrideConnection;

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
  }, [messages, permissionRequests.length, domainRequests.length]);

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

      // Auto-approve if domain is already allowed (built-in, session, or always)
      const connId = effectiveConnection?.id;
      if (connId) {
        const provOpt = PROVIDER_OPTIONS.find(
          (o) => o.agentBinary === agentId
        );
        const builtIn = provOpt?.installMeta?.allowedDomains ?? [];
        const permStore = usePermissionStore.getState();
        if (permStore.isDomainAllowed(connId, domain, builtIn)) {
          // Auto-respond with allow_once
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

  // Auto-create a conversation when none exists (e.g. after deleting the last one)
  useEffect(() => {
    if (!activeConversationId && conversations.length === 0) {
      createConversation();
    }
  }, [activeConversationId, conversations.length, createConversation]);

  const handleSend = async (content: string) => {
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

    await sendChatMessage(expandedContent, messages, skillName ? { displayContent: content, skillName } : undefined);
  };

  const handleClear = () => {
    if (!activeConversationId) return;
    // Deny any pending permission requests before clearing
    const pending = usePermissionStore.getState().requests;
    for (const req of pending) {
      tauriApi.acpPermissionRespond(req.instanceId, req.requestId, null).catch((e) => {
        console.warn('Failed to deny permission on clear:', e);
      });
    }
    usePermissionStore.getState().clearAll();
    clearMessages();
  };

  const handleNewChat = () => {
    createConversation();
  };

  const activeConvTitle = useMemo(() => {
    if (!activeConversationId) return 'New Chat';
    const conv = conversations.find((c) => c.id === activeConversationId);
    return conv?.title || 'New Chat';
  }, [activeConversationId, conversations]);

  const allSelected = projects.length > 0 && selectedProjectPaths.length === projects.length;

  /** Get a project's provider override (connection ID), or null if none. */
  const getProjectOverride = (path: string): string | null =>
    metadataMap[path]?.ai?.provider ?? null;

  const handleProjectToggle = (path: string) => {
    const isSelected = selectedProjectPaths.includes(path);
    if (isSelected) {
      // Deselecting — always allowed
      toggleProjectPath(path);
      return;
    }

    // Selecting — check for provider override conflicts
    const newOverride = getProjectOverride(path);
    if (newOverride) {
      // Check if any currently selected project has a different non-null override
      const conflicting = selectedProjectPaths.some((sp) => {
        const existing = getProjectOverride(sp);
        return existing !== null && existing !== newOverride;
      });
      if (conflicting) {
        // Swap to just the new project
        setSelectedProjectPaths([path]);
        toast.info('Switched project — selected projects had conflicting provider overrides.', { id: 'provider-conflict' });
        return;
      }
    }

    toggleProjectPath(path);
  };

  const handleToggleAll = () => {
    if (allSelected) {
      setSelectedProjectPaths([]);
    } else {
      // Check for conflicting overrides across all projects
      const overrides = new Set<string>();
      for (const p of projects) {
        const ov = getProjectOverride(p.path);
        if (ov) overrides.add(ov);
      }
      if (overrides.size > 1) {
        toast.info('Cannot select all — projects have conflicting provider overrides.', { id: 'provider-conflict' });
        return;
      }
      setSelectedProjectPaths(projects.map((p) => p.path));
    }
  };

  return (
    <div className="h-full w-full bg-card flex flex-col">
      <div className="h-9 px-3 flex items-center justify-between shrink-0 bg-card">
        <Popover open={convListOpen} onOpenChange={setConvListOpen}>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-1.5 text-sm font-semibold tracking-tight hover:text-muted-foreground transition-colors rounded px-1 py-0.5 min-w-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
              <span className="truncate max-w-[160px]">{activeConvTitle}</span>
              <ChevronUp className="h-3 w-3 opacity-50 shrink-0 rotate-180" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="start" className="w-60 p-1">
            <button
              onClick={() => { handleNewChat(); setConvListOpen(false); }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors text-foreground hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
              New Chat
            </button>
            {conversations.length > 0 && (
              <div className="mx-2 my-1 border-t border-border" />
            )}
            <div className="max-h-64 overflow-y-auto thin-scrollbar">
              {conversations.map((conv) => (
                <div
                  role="button"
                  tabIndex={0}
                  key={conv.id}
                  className={`group w-full flex items-center justify-between gap-1 px-2 py-1.5 rounded text-xs transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                    conv.id === activeConversationId
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground hover:bg-accent/50'
                  }`}
                  onClick={() => { setActiveConversation(conv.id); setConvListOpen(false); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setActiveConversation(conv.id); setConvListOpen(false); } }}
                >
                  <span className="truncate min-w-0 text-left">{conv.title || 'New Chat'}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                    className="opacity-0 group-hover:opacity-100 shrink-0 h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground active:opacity-75 transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <X className="h-3 w-3" strokeWidth={1.5} />
                  </button>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <div className="flex items-center gap-0.5">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleNewChat}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors duration-150 text-muted-foreground hover:text-foreground hover:bg-accent active:opacity-75 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">New Chat</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleClear}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors duration-150 text-muted-foreground hover:text-foreground hover:bg-accent active:opacity-75 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">Delete conversation</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {!hasAIProvider && (
        <div className="p-4 bg-muted border-b border-border">
          <p className="text-sm text-muted-foreground">
            Please configure an AI provider in Settings (Cmd+,) before using chat.
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-4">
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

              // Check if a segment boundary falls before this message
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
                    <QuickReplies replies={parsed.replies} onSelect={handleSend} />
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
            {/* Pending project switch prompt — shown after all messages */}
            {pendingProjectSwitch && (
              <ProjectSwitchCard
                newPaths={pendingProjectSwitch.newPaths}
                previousPaths={pendingProjectSwitch.previousPaths}
              />
            )}
            {/* Pending agent switch prompt */}
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
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-border px-3 py-3">
        <ChatInput
          onSend={handleSend}
          onStop={cancelChat}
          isLoading={isLoading}
          disabled={!hasAIProvider || !!pendingProjectSwitch || !!pendingAgentSwitch}
          placeholder={pendingProjectSwitch ? 'Resolve project context change first...' : pendingAgentSwitch ? 'Resolve provider change first...' : chatPlaceholder}
          footer={
            <>
              {(interactiveConnections.length > 0 || hasProjectOverride) && (
                <Popover open={providerOpen} onOpenChange={hasProjectOverride ? undefined : setProviderOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={`flex items-center gap-1.5 text-xs text-muted-foreground transition-colors rounded px-1 py-0.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                        hasProjectOverride ? 'cursor-default' : 'hover:text-foreground hover:bg-accent/50 active:opacity-75'
                      }`}
                      title={hasProjectOverride ? `Set by project: ${singleMetadata?.name || singleProjectPath}` : undefined}
                    >
                      {effectiveConnection && (
                        <ProviderLogo provider={effectiveConnection.provider} className="w-3.5 h-3.5" />
                      )}
                      <span className="max-w-[80px] truncate">
                        {effectiveConnection?.label ?? 'Select provider'}
                      </span>
                      {!hasProjectOverride && <ChevronUp className="h-3 w-3 opacity-50" />}
                    </button>
                  </PopoverTrigger>
                  {!hasProjectOverride && (
                  <PopoverContent side="top" align="start" className="w-52 p-1">
                    {interactiveConnections.map((conn) => (
                      <button
                        key={conn.id}
                        onClick={() => {
                          setRouting('interactive', conn.id);
                          setProviderOpen(false);
                        }}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                          effectiveConnection?.id === conn.id
                            ? 'bg-accent text-accent-foreground'
                            : 'text-foreground hover:bg-accent/50'
                        }`}
                      >
                        <ProviderLogo provider={conn.provider} className="w-4 h-4" />
                        <span className="truncate">{conn.label}</span>
                      </button>
                    ))}
                  </PopoverContent>
                  )}
                </Popover>
              )}
              <Popover open={agentPickerOpen} onOpenChange={setAgentPickerOpen}>
                <PopoverTrigger asChild>
                  <button type="button" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded px-1 py-0.5 hover:bg-accent/50 active:opacity-75 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                    <AgentIcon icon={activeAgent?.icon} size={14} />
                    <span>{activeAgent?.name ?? 'No agent'}</span>
                    <ChevronUp className="h-3 w-3 opacity-50" />
                  </button>
                </PopoverTrigger>
                <PopoverContent side="top" align="start" className="w-56 p-1 max-h-64 overflow-y-auto thin-scrollbar">
                  {invocableAgents.map((agent) => (
                    <button
                      key={agent.path}
                      onClick={() => {
                        setActiveAgent(agent.name);
                        setAgentPickerOpen(false);
                      }}
                      className={`w-full flex items-start gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                        agent.name === activeAgent?.name
                          ? 'bg-accent text-accent-foreground'
                          : 'text-foreground hover:bg-accent/50'
                      }`}
                    >
                      <AgentIcon icon={agent.icon} size={14} className="mt-0.5 shrink-0" />
                      <div className="min-w-0 text-left">
                        <div className="truncate font-medium">{agent.name}</div>
                        {agent.description && (
                          <div className="text-muted-foreground line-clamp-1 mt-0.5">{agent.description}</div>
                        )}
                      </div>
                      {agent.name === activeAgent?.name && (
                        <Check className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground" />
                      )}
                    </button>
                  ))}
                  {invocableAgents.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      No agents discovered
                    </div>
                  )}
                </PopoverContent>
              </Popover>
              <Popover open={projectOpen} onOpenChange={setProjectOpen}>
                <PopoverTrigger asChild>
                  <button type="button" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded px-1 py-0.5 hover:bg-accent/50 active:opacity-75 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
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
                        onClick={() => handleProjectToggle(project.path)}
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
              {!isAcpConnection && (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => {
                          if (!hasAIProvider) return;
                          if (effectiveProviderType === 'ollama') {
                            toast.info('Web search is not yet available for Ollama. Please use Anthropic or OpenAI for search.');
                            return;
                          }
                          setWebSearchEnabled(!webSearchEnabled);
                        }}
                        disabled={!hasAIProvider}
                        className={`flex items-center gap-1 text-xs transition-colors rounded px-1 py-0.5 hover:bg-accent/50 active:opacity-75 disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                          webSearchEnabled && hasAIProvider && effectiveProviderType !== 'ollama'
                            ? 'text-foreground'
                            : 'text-muted-foreground'
                        }`}
                      >
                        <Globe className="h-3 w-3" strokeWidth={1.5} />
                        <span>Search</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-64">
                      <p className="text-xs">
                        {!hasAIProvider
                          ? 'Configure an AI provider to use search'
                          : effectiveProviderType === 'ollama'
                            ? 'Web search is not available for Ollama'
                            : webSearchEnabled
                              ? 'Web search enabled — AI can search the internet'
                              : 'Click to enable web search'}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
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

import { memo, useMemo, useState, useEffect, useRef, type RefObject } from 'react';
import { ChevronUp, FolderOpen, Check, Target, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { AgentIcon } from '@/components/AgentIcon';
import { ProviderLogo } from '@/components/ProviderLogo';
import { useChatStore, selectPendingProjectSwitch, selectPendingAgentSwitch } from '@/stores/chat-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useRoutingStore } from '@/stores/routing-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useProjectMetadataStore } from '@/stores/project-metadata-store';
import { useSkillStore } from '@/stores/skill-store';
import { useSettingsStore } from '@/stores/settings-store';
import { AcpSessionControls } from './AcpSessionControls';
import { useGoalsDiscovery } from '@/hooks/useGoalsDiscovery';
import { useChatContext } from '@/hooks/useChatContext';
import { useAIOperations } from '@/hooks/useAIOperations';
import { ChatInput, type ChatInputHandle } from './ChatInput';
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

/** Convert a snake_case tool name to a pretty display name. */
function prettyToolName(name: string): string {
  // For skill tools, strip the skill__ prefix and show just the script part (or skill name)
  if (name.startsWith('skill__')) {
    const rest = name.slice(7); // strip "skill__"
    const parts = rest.split('__');
    // Use last part (script name) if multi-part, otherwise skill name
    const display = parts.length > 1 ? parts[parts.length - 1] : parts[0];
    return display.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Get a pretty display name for a skill tool, including script name for multi-script skills. */
function prettySkillToolName(toolName: string, skillName: string): string {
  const pretty = skillName.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  // Check if this is a multi-script tool: skill__{skill}__{script}
  const rest = toolName.slice(7); // strip "skill__"
  const parts = rest.split('__');
  if (parts.length > 1) {
    const scriptPretty = parts[parts.length - 1].replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return `${pretty} — ${scriptPretty}`;
  }
  return pretty;
}

import type { EditContext } from './ChatPanel';

interface ChatFooterProps {
  onSend: (content: string, attachments?: import('@/lib/ai/types').ImageAttachment[]) => Promise<void>;
  selectedProjectPaths: string[];
  hasAIProvider: boolean;
  chatPlaceholder: string;
  editContext?: EditContext | null;
  onCancelEdit?: () => void;
  chatInputRef?: RefObject<ChatInputHandle | null>;
  supportsVision?: boolean;
}

export const ChatFooter = memo(function ChatFooter({ onSend, selectedProjectPaths, hasAIProvider, chatPlaceholder, editContext, onCancelEdit, chatInputRef, supportsVision }: ChatFooterProps) {
  const isLoading = useChatStore((s) => s.isLoading);
  const pendingProjectSwitch = useChatStore(selectPendingProjectSwitch);
  const pendingAgentSwitch = useChatStore(selectPendingAgentSwitch);
  const setSelectedProjectPaths = useChatStore((s) => s.setSelectedProjectPaths);
  const toggleProjectPath = useChatStore((s) => s.toggleProjectPath);

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

  const singleProjectPath = selectedProjectPaths.length === 1 ? selectedProjectPaths[0] : null;
  const singleMetadata = singleProjectPath ? metadataMap[singleProjectPath] ?? null : null;
  const projectProviderOverride = singleMetadata?.ai.provider ?? null;
  const projectOverrideConnection = useMemo(() => {
    if (!projectProviderOverride) return null;
    return allConnections.find((c) => c.id === projectProviderOverride) ?? null;
  }, [projectProviderOverride, allConnections]);
  const effectiveConnection = projectOverrideConnection ?? interactiveConnection;
  const hasProjectOverride = !!projectOverrideConnection;

  const { goalFiles } = useGoalsDiscovery(singleProjectPath);
  const { cancelChat } = useAIOperations();
  const { contextItems, dismissItem } = useChatContext();

  const toolCallingEnabled = useSettingsStore((s) => s.toolCallingEnabled);
  const showAgentModePicker = useSettingsStore((s) => s.showAgentModePicker);
  const skillTools = useSkillStore((s) => s.skillTools);
  const toolDefs = useMemo(() => {
    if (!toolCallingEnabled) return [];
    // All tools available to all agents — user controls access via permission system
    return useSkillStore.getState().getToolDefinitions();
  }, [toolCallingEnabled, skillTools, activeAgentName, agents, agentEnabledOverrides]);

  const [providerOpen, setProviderOpen] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  // Measure the chat panel height so the textarea can cap at 40%
  const footerRef = useRef<HTMLDivElement>(null);
  const [maxTextareaHeight, setMaxTextareaHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    const panel = footerRef.current?.closest('.chat-panel-root') as HTMLElement | null;
    if (!panel) return;

    const observer = new ResizeObserver(([entry]) => {
      const panelHeight = entry.contentRect.height;
      // 30% of the chat panel — keeps the conversation comfortably visible
      setMaxTextareaHeight(Math.floor(panelHeight * 0.3));
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

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

  const allSelected = projects.length > 0 && selectedProjectPaths.length === projects.length;

  const getProjectOverride = (path: string): string | null =>
    metadataMap[path]?.ai?.provider ?? null;

  const handleProjectToggle = (path: string) => {
    const isSelected = selectedProjectPaths.includes(path);
    if (isSelected) {
      toggleProjectPath(path);
      return;
    }

    const newOverride = getProjectOverride(path);
    if (newOverride) {
      const conflicting = selectedProjectPaths.some((sp) => {
        const existing = getProjectOverride(sp);
        return existing !== null && existing !== newOverride;
      });
      if (conflicting) {
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
    <div ref={footerRef} className="border-t border-border px-3 py-3">
      <ChatInput
        ref={chatInputRef}
        onSend={onSend}
        onStop={cancelChat}
        isLoading={isLoading}
        disabled={!hasAIProvider || !!pendingProjectSwitch || !!pendingAgentSwitch}
        placeholder={pendingProjectSwitch ? 'Resolve project context change first...' : pendingAgentSwitch ? 'Resolve provider change first...' : chatPlaceholder}
        editContext={editContext}
        onCancelEdit={onCancelEdit}
        contextItems={contextItems}
        onDismissContext={dismissItem}
        supportsVision={supportsVision}
        maxTextareaHeight={maxTextareaHeight}
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
            {toolCallingEnabled && toolDefs.length > 0 && (
              <Popover open={toolsOpen} onOpenChange={setToolsOpen}>
                <PopoverTrigger asChild>
                  <button type="button" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded px-1 py-0.5 hover:bg-accent/50 active:opacity-75 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                    <Wrench className="h-3 w-3" strokeWidth={1.5} />
                    <span>{toolDefs.length} {toolDefs.length === 1 ? 'tool' : 'tools'}</span>
                    <ChevronUp className="h-3 w-3 opacity-50" />
                  </button>
                </PopoverTrigger>
                <PopoverContent side="top" align="start" className="w-64 p-1 max-h-72 overflow-y-auto thin-scrollbar">
                  <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Built-in</div>
                  {toolDefs.filter((t) => !t.name.startsWith('skill__')).map((tool) => (
                    <div key={tool.name} className="px-2 py-1.5 text-xs text-foreground rounded">
                      {prettyToolName(tool.name)}
                    </div>
                  ))}
                  {toolDefs.some((t) => t.name.startsWith('skill__')) && (
                    <>
                      <div className="mx-2 my-1 border-t border-border" />
                      <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Skills</div>
                      {toolDefs.filter((t) => t.name.startsWith('skill__')).map((tool) => {
                        const st = useSkillStore.getState().getSkillToolByName(tool.name);
                        return (
                          <div key={tool.name} className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs text-foreground rounded">
                            <span className="truncate">{prettySkillToolName(tool.name, st?.skill_name ?? tool.name)}</span>
                            <span className="shrink-0 inline-flex items-center px-1.5 py-px rounded-full text-[9px] font-medium bg-muted text-muted-foreground">
                              {st?.explicit_schema ? 'schema' : 'auto'}
                            </span>
                          </div>
                        );
                      })}
                    </>
                  )}
                </PopoverContent>
              </Popover>
            )}
            <AcpSessionControls showModePicker={showAgentModePicker} />
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
  );
});

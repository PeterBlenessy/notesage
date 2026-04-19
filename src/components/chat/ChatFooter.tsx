import { memo, useMemo, useState, useEffect, useRef, useCallback, type RefObject } from 'react';
import { ChevronUp, Check, Target, Plus, ImagePlus, FolderOpen, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { getProjectLock, getUniqueLockedConnectionIds, describeLockTarget } from '@/lib/ai/project-lock';
import { ProviderLogo } from '@/components/ProviderLogo';
import { useChatStore, selectPendingProjectSwitch, selectPendingAgentSwitch } from '@/stores/chat-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useRoutingStore } from '@/stores/routing-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useProjectMetadataStore } from '@/stores/project-metadata-store';
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

  const lockedConnectionIds = useMemo(
    () => getUniqueLockedConnectionIds(selectedProjectPaths, metadataMap),
    [selectedProjectPaths, metadataMap],
  );
  const activeLockConnectionId = lockedConnectionIds.length === 1 ? lockedConnectionIds[0] : null;
  const lockedConnection = useMemo(
    () => (activeLockConnectionId ? allConnections.find((c) => c.id === activeLockConnectionId) ?? null : null),
    [activeLockConnectionId, allConnections],
  );
  const isProviderLocked = !!activeLockConnectionId;

  const effectiveConnection = lockedConnection ?? projectOverrideConnection ?? interactiveConnection;
  const hasProjectOverride = !!projectOverrideConnection || isProviderLocked;

  const { goalFiles } = useGoalsDiscovery(singleProjectPath);
  const { cancelChat } = useAIOperations();
  const { contextItems, dismissItem } = useChatContext();

  const showAgentModePicker = useSettingsStore((s) => s.showAgentModePicker);

  const [providerOpen, setProviderOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);

  // Handler bridge: the "+" menu's "Attach image" entry calls into ChatInput's
  // exposed imperative handle. Defined here because the menu lives in the
  // footer but the file-picker wiring lives in ChatInput.
  const handlePlusMenuAttachImage = useCallback(() => {
    setPlusMenuOpen(false);
    chatInputRef?.current?.openAttachDialog();
  }, [chatInputRef]);

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

  // Note: `projectLabel` used to drive a dedicated project pill button in the
  // footer. Removed 2026-04-19 when project selection merged into the "+" menu.
  // The popover itself shows per-project names inline, so no aggregate label
  // is needed anymore.

  const allSelected = projects.length > 0 && selectedProjectPaths.length === projects.length;

  const getProjectOverride = (path: string): string | null =>
    metadataMap[path]?.ai?.provider ?? null;

  const handleProjectToggle = (path: string) => {
    const isSelected = selectedProjectPaths.includes(path);
    if (isSelected) {
      toggleProjectPath(path);
      return;
    }

    const newLock = getProjectLock(path, metadataMap);
    const existingLockIds = new Set<string>();
    for (const sp of selectedProjectPaths) {
      const l = getProjectLock(sp, metadataMap);
      if (l) existingLockIds.add(l.connectionId);
    }
    if (newLock && existingLockIds.size > 0 && !existingLockIds.has(newLock.connectionId)) {
      toast.error('These projects are locked to different providers.', { id: 'provider-lock-conflict' });
      return;
    }
    if (!newLock && existingLockIds.size > 0) {
      const lockedId = Array.from(existingLockIds)[0];
      const lockedConn = allConnections.find((c) => c.id === lockedId);
      toast.error(
        `Current selection is locked to ${describeLockTarget(lockedId, lockedConn?.label)}. Unlock or deselect first.`,
        { id: 'provider-lock-conflict' },
      );
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
            {/* "+" consolidated menu: attach image + project multi-select.
                Replaces the standalone image-attach button (previously in
                ChatInput's tool group) and the standalone project pill. */}
            <Popover open={plusMenuOpen} onOpenChange={setPlusMenuOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium text-muted-foreground transition-colors duration-150 border border-transparent hover:text-foreground hover:bg-muted hover:border-border active:opacity-75 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  aria-label="Add image or choose projects"
                >
                  <Plus className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-56 p-1">
                {supportsVision && (
                  <>
                    <button
                      onClick={handlePlusMenuAttachImage}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors text-foreground hover:bg-accent/50"
                    >
                      <ImagePlus className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
                      <span>Attach image…</span>
                    </button>
                    <div className="mx-2 my-1 border-t border-border" />
                  </>
                )}
                <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <FolderOpen className="h-3 w-3" strokeWidth={1.5} />
                  Projects
                </div>
                {projects.length > 1 && (
                  <button
                    onClick={handleToggleAll}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded text-xs transition-colors text-foreground hover:bg-accent/50"
                  >
                    <span>{allSelected ? 'Deselect all' : 'Select all'}</span>
                    {allSelected && <Check className="h-3 w-3 text-muted-foreground" />}
                  </button>
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
            {(interactiveConnections.length > 0 || hasProjectOverride) && (
              <Popover open={providerOpen} onOpenChange={hasProjectOverride ? undefined : setProviderOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    data-testid="chat-footer-provider"
                    data-locked={isProviderLocked ? 'true' : 'false'}
                    className={`flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium text-muted-foreground transition-colors duration-150 border border-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                      hasProjectOverride ? 'cursor-default' : 'hover:text-foreground hover:bg-muted hover:border-border active:opacity-75'
                    }`}
                    title={
                      isProviderLocked
                        ? `Locked to ${describeLockTarget(activeLockConnectionId!, lockedConnection?.label)} by project`
                        : hasProjectOverride
                        ? `Set by project: ${singleMetadata?.name || singleProjectPath}`
                        : effectiveConnection?.label ?? 'Select provider'
                    }
                    aria-label={effectiveConnection?.label ?? 'Select provider'}
                  >
                    {effectiveConnection ? (
                      <ProviderLogo provider={effectiveConnection.provider} className="w-[18px] h-[18px]" bare />
                    ) : (
                      <span className="text-xs">Provider</span>
                    )}
                    {isProviderLocked ? (
                      <Lock className="h-3 w-3 opacity-60" strokeWidth={1.5} />
                    ) : !hasProjectOverride ? (
                      <ChevronUp className="h-3 w-3 opacity-50" />
                    ) : null}
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
            <AcpSessionControls showModePicker={showAgentModePicker} connection={effectiveConnection ?? undefined} />
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

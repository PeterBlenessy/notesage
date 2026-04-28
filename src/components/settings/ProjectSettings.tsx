import { useState, useCallback, useEffect } from 'react';
import { ArrowRight, Check, Cloud, FolderOpen, Loader2, Lock, Unlock, X } from 'lucide-react';
import { useProjectMetadataStore } from '@/stores/project-metadata-store';
import { LockProjectDialog } from './LockProjectDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useSkillStore } from '@/stores/skill-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSyncStore } from '@/stores/sync-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { tauriApi } from '@/lib/tauri';
import { migrateProjectPath } from '@/lib/migrate-project-path';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ProviderLogo } from '@/components/ProviderLogo';
import { AgentIcon } from '@/components/AgentIcon';
import { formatDisplayPath } from '@/lib/utils';

interface ProjectSettingsProps {
  projectPath: string;
  onPathChanged?: (newPath: string) => void;
  onOpenAISettings?: () => void;
}

export function ProjectSettings({ projectPath, onPathChanged, onOpenAISettings }: ProjectSettingsProps) {
  const metadata = useProjectMetadataStore((s) => s.metadataMap[projectPath]);
  const { updateMetadata, updateAI, clearAiLock } = useProjectMetadataStore();
  const connections = useConnectionsStore((s) => s.connections);
  const getUserInvocableAgents = useSkillStore((s) => s.getUserInvocableAgents);
  const { icloudAvailable, icloudNotesagePath, notesRootPath } = useSettingsStore();
  const {
    icloudEnabled,
    syncedProjectPaths,
    addSyncedProject,
    removeSyncedProject,
    saveSettings,
  } = useSyncStore();

  const [pendingSync, setPendingSync] = useState<boolean | null>(null);
  const [applying, setApplying] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [localName, setLocalName] = useState(metadata?.name ?? '');
  const [lockDialogOpen, setLockDialogOpen] = useState(false);
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);

  // Sync localName when metadata.name changes externally (e.g., after rename completes)
  useEffect(() => {
    if (metadata?.name) {
      setLocalName(metadata.name);
    }
  }, [metadata?.name]);

  const nameChanged = localName.trim() !== '' && localName !== (metadata?.name ?? '');

  const isSynced = syncedProjectPaths.includes(projectPath);
  const displaySynced = pendingSync ?? isSynced;
  const syncChanged = pendingSync !== null && pendingSync !== isSynced;

  // Show sync section for all projects when iCloud is enabled
  const showSyncSection = icloudEnabled && icloudAvailable;

  /** Confirm rename: rename the project folder on disk to localName. */
  const handleNameConfirm = useCallback(async () => {
    if (!metadata || renaming) return;
    const newName = localName.trim();
    if (!newName) return;

    const currentFolderName = projectPath.split('/').filter(Boolean).pop() || '';
    if (newName === currentFolderName) {
      // Name matches the folder — just update metadata if needed
      if (newName !== metadata.name) {
        updateMetadata(projectPath, { name: newName });
      }
      return;
    }

    const parentDir = projectPath.substring(0, projectPath.lastIndexOf('/'));
    const newPath = `${parentDir}/${newName}`;

    // Check if destination already exists
    try {
      const exists = await tauriApi.pathExists(newPath);
      if (exists) {
        toast.error(`A folder named "${newName}" already exists`);
        setLocalName(metadata.name);
        return;
      }
    } catch {
      // If check fails, proceed cautiously
    }

    setRenaming(true);
    try {
      await tauriApi.renamePath(projectPath, newPath);
      await migrateProjectPath(projectPath, newPath);

      // Update synced project path if applicable
      if (syncedProjectPaths.includes(projectPath)) {
        const syncStore = useSyncStore.getState();
        syncStore.updateProjectPath(projectPath, newPath);
        await syncStore.saveSettings(notesRootPath!);
      }

      onPathChanged?.(newPath);
      toast.success(`Project folder renamed to "${newName}"`);
    } catch (err) {
      toast.error(`Failed to rename folder: ${err}`);
      setLocalName(metadata.name);
    } finally {
      setRenaming(false);
    }
  }, [metadata, localName, projectPath, renaming, updateMetadata, syncedProjectPaths, notesRootPath, onPathChanged]);

  const handleNameCancel = useCallback(() => {
    if (metadata) {
      setLocalName(metadata.name);
    }
  }, [metadata]);

  const handleSyncToggle = (checked: boolean) => {
    setPendingSync(checked);
  };

  const applySyncToggle = useCallback(async () => {
    if (pendingSync === null) return;

    setApplying(true);
    try {
      if (pendingSync && icloudNotesagePath) {
        // Check if the project is already in the iCloud Notesage folder
        const alreadyInICloud = projectPath.startsWith(icloudNotesagePath + "/");
        if (alreadyInICloud) {
          // Already in iCloud — just register as synced, no migration needed
          addSyncedProject(projectPath);
          await saveSettings(notesRootPath);
          toast.success("Project marked as synced to iCloud");
        } else {
          // Enable sync: move to iCloud
          const newPath = await tauriApi.migrateToICloud(projectPath, icloudNotesagePath);
          await migrateProjectPath(projectPath, newPath);
          addSyncedProject(newPath);
          await saveSettings(notesRootPath);
          onPathChanged?.(newPath);
          toast.success("Project synced to iCloud");
        }
      } else if (!pendingSync && notesRootPath) {
        // Disable sync: move back to local
        const newPath = await tauriApi.migrateFromICloud(projectPath, notesRootPath);
        await migrateProjectPath(projectPath, newPath);
        removeSyncedProject(projectPath);
        await saveSettings(notesRootPath);
        onPathChanged?.(newPath);
        toast.success("Project moved to local library");
      }
    } catch (err) {
      toast.error(`Failed to ${pendingSync ? "sync" : "unsync"} project: ${err}`);
    } finally {
      setPendingSync(null);
      setApplying(false);
    }
  }, [pendingSync, projectPath, icloudNotesagePath, notesRootPath, addSyncedProject, removeSyncedProject, saveSettings, onPathChanged]);

  const allAgents = metadata ? getUserInvocableAgents() : [];
  const selectedConnection = metadata ? connections.find((c) => c.id === metadata.ai.provider) : undefined;

  const aiLock = metadata?.aiLock;
  const lockedConnection = aiLock ? connections.find((c) => c.id === aiLock.connectionId) : undefined;
  const lockedAtDate = aiLock ? new Date(aiLock.lockedAt) : null;
  const lockedAtLabel = lockedAtDate
    ? lockedAtDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : '';

  const handleConfirmUnlock = () => {
    clearAiLock(projectPath);
    setUnlockDialogOpen(false);
  };

  return (
    <div className="space-y-6">
      {!metadata ? (
        <div className="p-8 text-center border border-dashed border-border rounded-lg">
          <p className="text-sm text-muted-foreground">
            Loading project metadata...
          </p>
        </div>
      ) : (
      <>
      {/* Project Info */}
      <div className="space-y-4">
        <div>
          <Label className="text-sm font-semibold">Project Info</Label>
          <p className="text-xs text-muted-foreground mt-1">
            Basic information about this project
          </p>
        </div>

        <div className="space-y-2">
          <div
            className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
          >
            <Label htmlFor="project-name" className="text-sm font-medium">
              Project Name
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">
              Displayed in the sidebar header
            </p>
            <div className="flex items-center gap-2">
              <Input
                id="project-name"
                value={localName}
                onChange={(e) => setLocalName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && nameChanged) {
                    e.preventDefault();
                    handleNameConfirm();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    handleNameCancel();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                disabled={renaming}
                placeholder="My Project"
                className="text-sm transition-all hover:border-foreground/20 focus:border-foreground/40"
              />
              {nameChanged && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={handleNameConfirm}
                    disabled={renaming}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors duration-150 disabled:opacity-50 focus-visible:[outline:1px_solid_var(--color-accent-primary)] focus-visible:[outline-offset:2px]"
                  >
                    {renaming ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                    ) : (
                      <Check className="h-4 w-4" strokeWidth={1.5} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleNameCancel}
                    disabled={renaming}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors duration-150 disabled:opacity-50 focus-visible:[outline:1px_solid_var(--color-accent-primary)] focus-visible:[outline-offset:2px]"
                  >
                    <X className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div
            className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
          >
            <Label htmlFor="project-description" className="text-sm font-medium">
              Description
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">
              A short description of this project
            </p>
            <Input
              id="project-description"
              value={metadata.description}
              onChange={(e) => updateMetadata(projectPath, { description: e.target.value })}
              placeholder="Optional project description"
              className="text-sm transition-all hover:border-foreground/20 focus:border-foreground/40"
            />
          </div>
        </div>
      </div>

      <div className="h-px bg-border" />

      {/* AI Overrides */}
      <div className="space-y-4">
        <div>
          <Label className="text-sm font-semibold">AI Overrides</Label>
          <p className="text-xs text-muted-foreground mt-1">
            Override global AI settings for this project only
          </p>
        </div>

        <div className="space-y-2">
          {/* Provider Override */}
          <div
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
          >
            <div>
              <Label className="text-sm font-medium">Provider</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Override the global AI provider for this project
              </p>
            </div>
            {connections.length === 0 ? (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-muted-foreground">No providers configured</span>
                {onOpenAISettings && (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={onOpenAISettings}
                  >
                    Set up in Settings
                  </Button>
                )}
              </div>
            ) : (
              <Select
                value={metadata.ai.provider || '_global'}
                onValueChange={(value) =>
                  updateAI(projectPath, { provider: value === '_global' ? null : value })
                }
              >
                <SelectTrigger className="ml-auto w-56 text-left">
                  <SelectValue>
                    {metadata.ai.provider === null ? (
                      <span className="text-muted-foreground">Use Global Default</span>
                    ) : selectedConnection ? (
                      <div className="flex items-center gap-2">
                        <ProviderLogo provider={selectedConnection.provider} className="w-4 h-4" />
                        <span>{selectedConnection.label}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Use Global Default</span>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_global">
                    <span className="text-muted-foreground">Use Global Default</span>
                  </SelectItem>
                  {connections.map((conn) => (
                    <SelectItem key={conn.id} value={conn.id}>
                      <div className="flex items-center gap-2">
                        <ProviderLogo provider={conn.provider} className="w-4 h-4" />
                        <span>{conn.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Agent Override */}
          <div
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
          >
            <div>
              <Label className="text-sm font-medium">Agent</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Override the global AI agent for this project
              </p>
            </div>
            <Select
              value={metadata.ai.agentName || '_global'}
              onValueChange={(value) =>
                updateAI(projectPath, { agentName: value === '_global' ? null : value })
              }
            >
              <SelectTrigger className="ml-auto w-56 text-left">
                <SelectValue>
                  {metadata.ai.agentName == null ? (
                    <span className="text-muted-foreground">Use Global Default</span>
                  ) : (() => {
                    const a = allAgents.find((a) => a.name === metadata.ai.agentName);
                    return a ? (
                      <span className="flex items-center gap-2">
                        <AgentIcon icon={a.icon} size={14} />
                        {a.name}
                      </span>
                    ) : (
                      <span>{metadata.ai.agentName}</span>
                    );
                  })()}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_global">
                  <span className="text-muted-foreground">Use Global Default</span>
                </SelectItem>
                {allAgents.map((agent) => (
                  <SelectItem key={agent.path} value={agent.name}>
                    <span className="flex items-center gap-2">
                      <AgentIcon icon={agent.icon} size={14} />
                      {agent.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Project Context */}
          <div
            className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
          >
            <Label htmlFor="project-context" className="text-sm font-medium">
              Project Context
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">
              Additional context prepended to all AI system messages for this project
            </p>
            <Textarea
              id="project-context"
              value={metadata.ai.projectContext}
              onChange={(e) => updateAI(projectPath, { projectContext: e.target.value })}
              placeholder="e.g., This is a Rust systems programming project. Use technical language and provide code examples in Rust."
              rows={4}
              className="text-sm resize-none transition-all hover:border-foreground/20 focus:border-foreground/40"
            />
          </div>
        </div>
      </div>

      <div className="h-px bg-border" />

      {/* AI Provider Lock */}
      <div className="space-y-4">
        <div>
          <Label className="text-sm font-semibold">AI Provider Lock</Label>
          <p className="text-xs text-muted-foreground mt-1">
            Hard-restrict this project to a single AI provider. Locked projects refuse to send to
            any other provider — for chat, resend, comment delegation, and inline actions.
          </p>
        </div>

        <div
          data-testid="project-lock-status"
          className="px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
        >
          {aiLock ? (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
                  <Label className="text-sm font-medium">Locked</Label>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  This project is locked to{' '}
                  <span className="font-medium text-foreground">
                    {lockedConnection?.label ?? aiLock.connectionId}
                  </span>
                  {lockedAtLabel ? ` since ${lockedAtLabel}` : ''}.
                </p>
                {aiLock.reason && (
                  <p className="text-xs text-muted-foreground mt-1 italic">&ldquo;{aiLock.reason}&rdquo;</p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs shrink-0"
                onClick={() => setUnlockDialogOpen(true)}
              >
                <Unlock className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                Unlock
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Label className="text-sm font-medium">Not locked</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Any configured provider can be used with this project.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs shrink-0"
                onClick={() => setLockDialogOpen(true)}
                disabled={connections.length === 0}
              >
                <Lock className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                Lock to provider
              </Button>
            </div>
          )}
        </div>
      </div>

      </>
      )}

      <LockProjectDialog
        open={lockDialogOpen}
        onOpenChange={setLockDialogOpen}
        projectPath={projectPath}
        projectName={metadata?.name ?? projectPath}
      />

      <AlertDialog open={unlockDialogOpen} onOpenChange={setUnlockDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlock this project?</AlertDialogTitle>
            <AlertDialogDescription>
              After unlocking, any configured AI provider can access this project again. You can
              re-lock it at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmUnlock}>Unlock</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Sync Section */}
      {showSyncSection && (
        <>
          <div className="h-px bg-border" />

          <div className="space-y-4">
            <div>
              <Label className="text-sm font-semibold">Sync</Label>
              <p className="text-xs text-muted-foreground mt-1">
                iCloud sync for this project
              </p>
            </div>

            <div className="space-y-2">
              <div
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
              >
                <div>
                  <Label
                    htmlFor="project-sync"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Sync to iCloud
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {displaySynced
                      ? "This project syncs across your Apple devices"
                      : "Enable to sync this project via iCloud Drive"
                    }
                  </p>
                </div>
                <Switch
                  id="project-sync"
                  checked={displaySynced}
                  onCheckedChange={handleSyncToggle}
                  disabled={applying}
                  className="ml-auto"
                />
              </div>

              {syncChanged && (
                <div className="px-4 py-3 rounded-lg border border-foreground/20 bg-accent/50 space-y-2.5">
                  {applying ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Applying...</span>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        {pendingSync
                          ? "This project will be moved to iCloud Drive/Notesage."
                          : "This project will be moved back to ~/Notesage."
                        }
                      </p>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-medium truncate">
                          {metadata?.name || projectPath.split("/").pop()}
                        </span>
                        {pendingSync ? (
                          <ProjectSyncPathFlow
                            fromPath={projectPath.split("/").slice(0, -1).join("/")}
                            fromIcon="folder"
                            toPath={icloudNotesagePath || ""}
                            toIcon="cloud"
                          />
                        ) : (
                          <ProjectSyncPathFlow
                            fromPath={projectPath.split("/").slice(0, -1).join("/")}
                            fromIcon="cloud"
                            toPath={notesRootPath || ""}
                            toIcon="folder"
                          />
                        )}
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setPendingSync(null)}
                        >
                          Discard
                        </Button>
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          onClick={applySyncToggle}
                        >
                          {pendingSync ? "Enable Sync" : "Disable Sync"}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Clickable icon that reveals a folder in Finder, with tooltip showing display path */
function ProjectSyncPathIcon({ path, icon }: { path: string; icon: "cloud" | "folder" }) {
  const Icon = icon === "cloud" ? Cloud : FolderOpen;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="p-1 rounded cursor-pointer hover:bg-foreground/10 transition-colors duration-150 text-muted-foreground hover:text-foreground"
            onClick={() => tauriApi.revealInFinder(path)}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <p className="font-mono text-xs break-all">{formatDisplayPath(path)}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Compact from → to flow with clickable icons and tooltips */
function ProjectSyncPathFlow({
  fromPath,
  fromIcon,
  toPath,
  toIcon,
}: {
  fromPath: string;
  fromIcon: "cloud" | "folder";
  toPath: string;
  toIcon: "cloud" | "folder";
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <ProjectSyncPathIcon path={fromPath} icon={fromIcon} />
      <ArrowRight className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
      <ProjectSyncPathIcon path={toPath} icon={toIcon} />
    </span>
  );
}

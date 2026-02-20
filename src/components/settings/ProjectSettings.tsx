import { useState, useCallback } from 'react';
import { ArrowRight, Cloud, FolderOpen, Loader2 } from 'lucide-react';
import { useProjectMetadataStore } from '@/stores/project-metadata-store';
import { useAIStore, getAllPersonas } from '@/stores/ai-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSyncStore } from '@/stores/sync-store';
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
import type { AIProviderType } from '@/lib/ai/types';
import { PersonaIcon } from '@/components/PersonaIcon';
import { formatDisplayPath } from '@/lib/utils';

const PROVIDERS = [
  {
    value: 'anthropic',
    label: 'Anthropic Claude',
    logo: '/logos/anthropic.svg',
  },
  {
    value: 'openai',
    label: 'OpenAI',
    logo: '/logos/openai.svg',
  },
  {
    value: 'ollama',
    label: 'Ollama',
    logo: '/logos/ollama-official.png',
  },
];

interface ProjectSettingsProps {
  projectPath: string;
  onPathChanged?: (newPath: string) => void;
}

export function ProjectSettings({ projectPath, onPathChanged }: ProjectSettingsProps) {
  const metadata = useProjectMetadataStore((s) => s.metadataMap[projectPath]);
  const { updateMetadata, updateAI } = useProjectMetadataStore();
  const aiStore = useAIStore();
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

  const isSynced = syncedProjectPaths.includes(projectPath);
  const displaySynced = pendingSync ?? isSynced;
  const syncChanged = pendingSync !== null && pendingSync !== isSynced;

  // Only show sync section for library projects when iCloud is enabled
  const isLibraryProject =
    (notesRootPath && projectPath.startsWith(notesRootPath + "/")) ||
    (icloudNotesagePath && projectPath.startsWith(icloudNotesagePath + "/"));
  const showSyncSection = icloudEnabled && icloudAvailable && isLibraryProject;

  /** Rename the project folder on disk when the display name changes. */
  const handleNameBlur = useCallback(async () => {
    if (!metadata || renaming) return;
    const newName = metadata.name.trim();
    if (!newName) return;

    const currentFolderName = projectPath.split('/').filter(Boolean).pop() || '';
    if (newName === currentFolderName) return;

    const parentDir = projectPath.substring(0, projectPath.lastIndexOf('/'));
    const newPath = `${parentDir}/${newName}`;

    // Check if destination already exists
    try {
      const exists = await tauriApi.pathExists(newPath);
      if (exists) {
        toast.error(`A folder named "${newName}" already exists`);
        // Revert the name in metadata
        updateMetadata(projectPath, { name: currentFolderName });
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
      // Revert the name
      updateMetadata(projectPath, { name: currentFolderName });
    } finally {
      setRenaming(false);
    }
  }, [metadata, projectPath, renaming, updateMetadata, syncedProjectPaths, notesRootPath, onPathChanged]);

  const handleSyncToggle = (checked: boolean) => {
    setPendingSync(checked);
  };

  const applySyncToggle = useCallback(async () => {
    if (pendingSync === null) return;

    setApplying(true);
    try {
      if (pendingSync && icloudNotesagePath) {
        // Enable sync: move to iCloud
        const newPath = await tauriApi.migrateToICloud(projectPath, icloudNotesagePath);
        await migrateProjectPath(projectPath, newPath);
        addSyncedProject(newPath);
        await saveSettings(notesRootPath);
        onPathChanged?.(newPath);
        toast.success("Project synced to iCloud");
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

  if (!metadata) {
    return (
      <div className="p-8 text-center border border-dashed border-border rounded-lg">
        <p className="text-sm text-muted-foreground">
          Loading project metadata...
        </p>
      </div>
    );
  }

  const allPersonas = getAllPersonas(aiStore);
  const selectedProvider = PROVIDERS.find((p) => p.value === metadata.ai.provider);

  return (
    <div className="space-y-6">
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
            <Input
              id="project-name"
              value={metadata.name}
              onChange={(e) => updateMetadata(projectPath, { name: e.target.value })}
              onBlur={handleNameBlur}
              disabled={renaming}
              placeholder="My Project"
              className="text-sm transition-all hover:border-foreground/20 focus:border-foreground/40"
            />
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
            <Select
              value={metadata.ai.provider || '_global'}
              onValueChange={(value) =>
                updateAI(projectPath, { provider: value === '_global' ? null : (value as AIProviderType) })
              }
            >
              <SelectTrigger className="ml-auto w-56 text-left">
                <SelectValue>
                  {metadata.ai.provider === null ? (
                    <span className="text-muted-foreground">Use Global Default</span>
                  ) : selectedProvider ? (
                    <div className="flex items-center gap-2">
                      <img
                        src={selectedProvider.logo}
                        alt={selectedProvider.label}
                        className="w-4 h-4 rounded object-contain bg-white p-0.5"
                      />
                      <span>{selectedProvider.label}</span>
                    </div>
                  ) : null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_global">
                  <span className="text-muted-foreground">Use Global Default</span>
                </SelectItem>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    <div className="flex items-center gap-2">
                      <img
                        src={p.logo}
                        alt={p.label}
                        className="w-4 h-4 rounded object-contain bg-white p-0.5"
                      />
                      <span>{p.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Persona Override */}
          <div
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
          >
            <div>
              <Label className="text-sm font-medium">Persona</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Override the global AI persona for this project
              </p>
            </div>
            <Select
              value={metadata.ai.personaId || '_global'}
              onValueChange={(value) =>
                updateAI(projectPath, { personaId: value === '_global' ? null : value })
              }
            >
              <SelectTrigger className="ml-auto w-56 text-left">
                <SelectValue>
                  {metadata.ai.personaId === null ? (
                    <span className="text-muted-foreground">Use Global Default</span>
                  ) : (() => {
                    const p = allPersonas.find((p) => p.id === metadata.ai.personaId);
                    return p ? (
                      <span className="flex items-center gap-2">
                        <PersonaIcon persona={p} size={14} />
                        {p.name}
                      </span>
                    ) : null;
                  })()}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_global">
                  <span className="text-muted-foreground">Use Global Default</span>
                </SelectItem>
                {allPersonas.map((persona) => (
                  <SelectItem key={persona.id} value={persona.id}>
                    <span className="flex items-center gap-2">
                      <PersonaIcon persona={persona} size={14} />
                      {persona.name}
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

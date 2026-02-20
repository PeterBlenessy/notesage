import { useState, useCallback } from 'react';
import { useProjectMetadataStore } from '@/stores/project-metadata-store';
import { useAIStore, getAllPersonas } from '@/stores/ai-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSyncStore } from '@/stores/sync-store';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
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
}

export function ProjectSettings({ projectPath }: ProjectSettingsProps) {
  const metadata = useProjectMetadataStore((s) => s.metadataMap[projectPath]);
  const { updateMetadata, updateAI } = useProjectMetadataStore();
  const aiStore = useAIStore();
  const { icloudAvailable, icloudNotesagePath, notesRootPath } = useSettingsStore();
  const {
    icloudEnabled,
    syncedProjectPaths,
    migrating,
    addSyncedProject,
    removeSyncedProject,
    setMigrating,
    saveSettings,
  } = useSyncStore();

  const [unsyncDialogOpen, setUnsyncDialogOpen] = useState(false);

  const isSynced = syncedProjectPaths.includes(projectPath);

  // Only show sync section for library projects when iCloud is enabled
  const isLibraryProject =
    (notesRootPath && projectPath.startsWith(notesRootPath + "/")) ||
    (icloudNotesagePath && projectPath.startsWith(icloudNotesagePath + "/"));
  const showSyncSection = icloudEnabled && icloudAvailable && isLibraryProject;

  const handleSyncToggle = useCallback(async (checked: boolean) => {
    if (checked) {
      if (!icloudNotesagePath || migrating) return;
      setMigrating(projectPath);
      try {
        const newPath = await tauriApi.migrateToICloud(projectPath, icloudNotesagePath);
        await migrateProjectPath(projectPath, newPath);
        addSyncedProject(newPath);
        await saveSettings(notesRootPath);
        toast.success("Project synced to iCloud");
      } catch (err) {
        toast.error(`Failed to sync project: ${err}`);
      } finally {
        setMigrating(null);
      }
    } else {
      setUnsyncDialogOpen(true);
    }
  }, [projectPath, icloudNotesagePath, notesRootPath, migrating, addSyncedProject, setMigrating, saveSettings]);

  const confirmUnsync = useCallback(async () => {
    if (!notesRootPath || migrating) return;
    setUnsyncDialogOpen(false);
    setMigrating(projectPath);
    try {
      const newPath = await tauriApi.migrateFromICloud(projectPath, notesRootPath);
      await migrateProjectPath(projectPath, newPath);
      removeSyncedProject(projectPath);
      await saveSettings(notesRootPath);
      toast.success("Project moved to local library");
    } catch (err) {
      toast.error(`Failed to unsync project: ${err}`);
    } finally {
      setMigrating(null);
    }
  }, [projectPath, notesRootPath, migrating, removeSyncedProject, setMigrating, saveSettings]);

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
                    {isSynced
                      ? "This project syncs across your Apple devices"
                      : "Enable to sync this project via iCloud Drive"
                    }
                  </p>
                </div>
                <Switch
                  id="project-sync"
                  checked={isSynced}
                  onCheckedChange={handleSyncToggle}
                  disabled={migrating !== null}
                  className="ml-auto"
                />
              </div>
            </div>
          </div>

          <AlertDialog open={unsyncDialogOpen} onOpenChange={setUnsyncDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Stop syncing &ldquo;{metadata?.name || projectPath.split("/").pop()}&rdquo;?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This project will be copied to your local Notesage library and removed from iCloud.
                  It will no longer sync across your devices.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={confirmUnsync}>
                  Stop Syncing
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}

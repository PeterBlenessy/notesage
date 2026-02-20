import { useCallback, useState } from "react";
import { Cloud, Info, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSettingsStore } from "@/stores/settings-store";
import { useSyncStore } from "@/stores/sync-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useProjectMetadataStore } from "@/stores/project-metadata-store";
import { tauriApi } from "@/lib/tauri";
import { migrateProjectPath } from "@/lib/migrate-project-path";
import { toast } from "sonner";

export function SyncSettings() {
  const { icloudAvailable, icloudNotesagePath, notesRootPath } = useSettingsStore();
  const {
    icloudEnabled,
    syncQuickNotes,
    syncedProjectPaths,
    migrating,
    setICloudEnabled,
    setSyncQuickNotes,
    addSyncedProject,
    removeSyncedProject,
    setMigrating,
    saveSettings,
  } = useSyncStore();
  const { projects } = useWorkspaceStore();
  const metadataMap = useProjectMetadataStore((s) => s.metadataMap);

  const [unsyncDialog, setUnsyncDialog] = useState<{ path: string; name: string } | null>(null);

  // Filter to library projects only (in ~/Notesage or iCloud/Notesage)
  const libraryProjects = projects.filter((p) => {
    if (notesRootPath && p.path.startsWith(notesRootPath + "/")) return true;
    if (icloudNotesagePath && p.path.startsWith(icloudNotesagePath + "/")) return true;
    return false;
  });

  const handleICloudToggle = useCallback(async (checked: boolean) => {
    setICloudEnabled(checked);

    if (checked && icloudNotesagePath) {
      // Create iCloud Notesage folder if needed
      try {
        const exists = await tauriApi.pathExists(icloudNotesagePath);
        if (!exists) {
          await tauriApi.createDirectory(icloudNotesagePath);
        }
      } catch {
        toast.error("Failed to create iCloud Notesage folder");
        setICloudEnabled(false);
        return;
      }
    }

    await saveSettings(notesRootPath);
  }, [icloudNotesagePath, notesRootPath, setICloudEnabled, saveSettings]);

  const handleSyncQuickNotes = useCallback(async (checked: boolean) => {
    setSyncQuickNotes(checked);
    await saveSettings(notesRootPath);
  }, [notesRootPath, setSyncQuickNotes, saveSettings]);

  const handleSyncProject = useCallback(async (projectPath: string) => {
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
  }, [icloudNotesagePath, migrating, notesRootPath, addSyncedProject, setMigrating, saveSettings]);

  const handleUnsyncProject = useCallback(async (projectPath: string) => {
    if (!notesRootPath || migrating) return;

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
  }, [notesRootPath, migrating, removeSyncedProject, setMigrating, saveSettings]);

  const handleProjectCheckboxChange = useCallback((projectPath: string, checked: boolean) => {
    const projectName = projectPath.split("/").pop() || projectPath;
    if (checked) {
      handleSyncProject(projectPath);
    } else {
      // Show confirmation dialog before unsyncing
      setUnsyncDialog({ path: projectPath, name: projectName });
    }
  }, [handleSyncProject]);

  const confirmUnsync = useCallback(() => {
    if (unsyncDialog) {
      handleUnsyncProject(unsyncDialog.path);
      setUnsyncDialog(null);
    }
  }, [unsyncDialog, handleUnsyncProject]);

  const isProjectSynced = (path: string) => {
    return syncedProjectPaths.includes(path);
  };

  const getProjectName = (path: string) => {
    const meta = metadataMap[path];
    if (meta?.name) return meta.name;
    return path.split("/").pop() || path;
  };

  return (
    <>
      <div className="space-y-6">
        {/* iCloud Sync Toggle */}
        <div className="space-y-4">
          <div>
            <Label className="text-sm font-semibold">iCloud Sync</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Sync projects and notes across your Apple devices
            </p>
          </div>

          <div className="space-y-2">
            <div
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
            >
              <div>
                <Label
                  htmlFor="icloud-sync"
                  className="text-sm font-medium cursor-pointer"
                >
                  Enable iCloud Sync
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Selectively sync projects to iCloud Drive
                </p>
              </div>
              <Switch
                id="icloud-sync"
                checked={icloudEnabled}
                onCheckedChange={handleICloudToggle}
                disabled={!icloudAvailable}
                className="ml-auto"
              />
            </div>

            {!icloudAvailable && (
              <div className="flex gap-2.5 rounded-md border border-border bg-muted/50 p-3">
                <Info className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" strokeWidth={1.5} />
                <div className="text-xs text-muted-foreground">
                  <p>iCloud sync is available on macOS with iCloud Drive enabled.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Quick Notes sync and project list — only shown when iCloud is enabled */}
        {icloudEnabled && icloudAvailable && (
          <>
            <div className="h-px bg-border" />

            {/* Sync Quick Notes */}
            <div className="space-y-4">
              <div
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
              >
                <div>
                  <Label
                    htmlFor="sync-quick-notes"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Sync Quick Notes
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Sync loose notes in your Notesage library
                  </p>
                </div>
                <Switch
                  id="sync-quick-notes"
                  checked={syncQuickNotes}
                  onCheckedChange={handleSyncQuickNotes}
                  className="ml-auto"
                />
              </div>
            </div>

            <div className="h-px bg-border" />

            {/* Project List */}
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-semibold">Projects</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Choose which projects to sync to iCloud
                </p>
              </div>

              {libraryProjects.length === 0 ? (
                <div className="flex gap-2.5 rounded-md border border-border bg-muted/50 p-3">
                  <Info className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" strokeWidth={1.5} />
                  <div className="text-xs text-muted-foreground">
                    <p>No projects in your Notesage library. Create a project to get started.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  {libraryProjects.map((project) => {
                    const synced = isProjectSynced(project.path);
                    const isMigrating = migrating === project.path;
                    const projectName = getProjectName(project.path);

                    return (
                      <div
                        key={project.path}
                        className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border hover:border-muted-foreground transition-colors duration-150"
                      >
                        {isMigrating ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                        ) : (
                          <Checkbox
                            checked={synced}
                            onCheckedChange={(checked) =>
                              handleProjectCheckboxChange(project.path, checked === true)
                            }
                            disabled={migrating !== null}
                          />
                        )}
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="text-sm font-medium truncate">{projectName}</span>
                          {synced && !isMigrating && (
                            <Cloud className="h-3.5 w-3.5 text-muted-foreground shrink-0" strokeWidth={1.5} />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Only projects in your Notesage library can be synced.
              </p>
            </div>
          </>
        )}
      </div>

      {/* Unsync Confirmation Dialog */}
      <AlertDialog open={unsyncDialog !== null} onOpenChange={(open) => !open && setUnsyncDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop syncing &ldquo;{unsyncDialog?.name}&rdquo;?</AlertDialogTitle>
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
  );
}

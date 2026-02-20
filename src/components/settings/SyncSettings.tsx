import { useCallback, useState } from "react";
import { Cloud, Info, Loader2, FolderSymlink } from "lucide-react";
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

type DialogState =
  | { type: "sync"; path: string; name: string; fromLocation: string }
  | { type: "unsync"; path: string; name: string }
  | null;

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

  const [dialog, setDialog] = useState<DialogState>(null);

  const isLibraryProject = (path: string) => {
    if (notesRootPath && path.startsWith(notesRootPath + "/")) return true;
    if (icloudNotesagePath && path.startsWith(icloudNotesagePath + "/")) return true;
    return false;
  };

  const handleICloudToggle = useCallback(async (checked: boolean) => {
    setICloudEnabled(checked);

    if (checked && icloudNotesagePath) {
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
    const projectName = getProjectName(projectPath);
    if (checked) {
      if (!isLibraryProject(projectPath)) {
        // Non-library project — show confirmation about moving
        const parentDir = projectPath.split("/").slice(0, -1).join("/");
        setDialog({ type: "sync", path: projectPath, name: projectName, fromLocation: parentDir });
      } else {
        handleSyncProject(projectPath);
      }
    } else {
      setDialog({ type: "unsync", path: projectPath, name: projectName });
    }
  }, [handleSyncProject]);

  const confirmDialog = useCallback(() => {
    if (!dialog) return;
    if (dialog.type === "sync") {
      handleSyncProject(dialog.path);
    } else {
      handleUnsyncProject(dialog.path);
    }
    setDialog(null);
  }, [dialog, handleSyncProject, handleUnsyncProject]);

  const isProjectSynced = (path: string) => {
    return syncedProjectPaths.includes(path);
  };

  const getProjectName = (path: string) => {
    const meta = metadataMap[path];
    if (meta?.name) return meta.name;
    return path.split("/").pop() || path;
  };

  /** Friendly location label for a project path */
  const getLocationLabel = (path: string) => {
    if (icloudNotesagePath && path.startsWith(icloudNotesagePath + "/")) {
      return "iCloud";
    }
    if (notesRootPath && path.startsWith(notesRootPath + "/")) {
      return "Notesage Library";
    }
    // Show the parent folder for external projects
    const parent = path.split("/").slice(0, -1).pop();
    return parent || "External";
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

              {projects.length === 0 ? (
                <div className="flex gap-2.5 rounded-md border border-border bg-muted/50 p-3">
                  <Info className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" strokeWidth={1.5} />
                  <div className="text-xs text-muted-foreground">
                    <p>No open projects. Open or create a project to sync it.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  {projects.map((project) => {
                    const synced = isProjectSynced(project.path);
                    const isMigrating = migrating === project.path;
                    const projectName = getProjectName(project.path);
                    const locationLabel = getLocationLabel(project.path);

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
                        <span className="text-xs text-muted-foreground shrink-0">{locationLabel}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Syncing a project moves it to iCloud Drive. Unsyncing moves it back to your local Notesage library.
              </p>
            </div>
          </>
        )}
      </div>

      {/* Sync Confirmation Dialog (for non-library projects being moved) */}
      <AlertDialog open={dialog?.type === "sync"} onOpenChange={(open) => !open && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <FolderSymlink className="h-5 w-5" strokeWidth={1.5} />
              Sync &ldquo;{dialog?.type === "sync" ? dialog.name : ""}&rdquo; to iCloud?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This project will be moved from its current location to iCloud Drive.
              It will no longer be at its original folder.
              {dialog?.type === "sync" && (
                <>
                  <br /><br />
                  <span className="font-medium text-foreground">From:</span>{" "}
                  <span className="font-mono text-xs">{dialog.fromLocation}</span>
                  <br />
                  <span className="font-medium text-foreground">To:</span>{" "}
                  <span className="font-mono text-xs">{icloudNotesagePath}</span>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDialog}>
              Move &amp; Sync
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unsync Confirmation Dialog */}
      <AlertDialog open={dialog?.type === "unsync"} onOpenChange={(open) => !open && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop syncing &ldquo;{dialog?.type === "unsync" ? dialog.name : ""}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This project will be moved to your local Notesage library and removed from iCloud.
              It will no longer sync across your devices.
              {notesRootPath && (
                <>
                  <br /><br />
                  <span className="font-medium text-foreground">Moved to:</span>{" "}
                  <span className="font-mono text-xs">{notesRootPath}</span>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDialog}>
              Stop Syncing
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

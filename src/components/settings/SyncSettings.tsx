import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Cloud, FolderOpen, Info, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useSettingsStore } from "@/stores/settings-store";
import { useSyncStore } from "@/stores/sync-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useProjectMetadataStore } from "@/stores/project-metadata-store";
import { tauriApi } from "@/lib/tauri";
import { migrateProjectPath } from "@/lib/migrate-project-path";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function SyncSettings() {
  const { icloudAvailable, icloudNotesagePath, notesRootPath } = useSettingsStore();
  const {
    icloudEnabled,
    syncQuickNotes,
    syncedProjectPaths,
    setICloudEnabled,
    setSyncQuickNotes,
    setSyncedProjectPaths,
    saveSettings,
  } = useSyncStore();
  const { projects } = useWorkspaceStore();
  const metadataMap = useProjectMetadataStore((s) => s.metadataMap);

  // Local state — pending selections, discarded on close
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set(syncedProjectPaths));
  const [expandedProjectPath, setExpandedProjectPath] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  // Re-sync local state when store changes (e.g. after apply or external update)
  useEffect(() => {
    setSelectedPaths(new Set(syncedProjectPaths));
  }, [syncedProjectPaths]);

  // Computed diff
  const { toSync, toUnsync, hasChanges } = useMemo(() => {
    const currentSet = new Set(syncedProjectPaths);
    const sync: string[] = [];
    const unsync: string[] = [];

    for (const path of selectedPaths) {
      if (!currentSet.has(path)) sync.push(path);
    }
    for (const path of currentSet) {
      if (!selectedPaths.has(path)) unsync.push(path);
    }

    return { toSync: sync, toUnsync: unsync, hasChanges: sync.length > 0 || unsync.length > 0 };
  }, [selectedPaths, syncedProjectPaths]);

  const toggleSelection = (path: string) => {
    if (applying) return;
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const discardChanges = () => {
    setSelectedPaths(new Set(syncedProjectPaths));
  };

  const applyChanges = useCallback(async () => {
    if (!icloudNotesagePath || !notesRootPath) return;

    setApplying(true);
    const newSyncedPaths = new Set(syncedProjectPaths);
    let failures = 0;

    // Process syncs
    for (const path of toSync) {
      try {
        const newPath = await tauriApi.migrateToICloud(path, icloudNotesagePath);
        await migrateProjectPath(path, newPath);
        newSyncedPaths.add(newPath);
      } catch (err) {
        console.error(`Failed to sync ${path}:`, err);
        failures++;
      }
    }

    // Process unsyncs
    for (const path of toUnsync) {
      try {
        const newPath = await tauriApi.migrateFromICloud(path, notesRootPath);
        await migrateProjectPath(path, newPath);
        newSyncedPaths.delete(path);
      } catch (err) {
        console.error(`Failed to unsync ${path}:`, err);
        failures++;
      }
    }

    // Atomic store update
    setSyncedProjectPaths(Array.from(newSyncedPaths));
    await saveSettings(notesRootPath);

    if (failures === 0) {
      toast.success("Sync settings applied");
    } else {
      toast.error(`${failures} project(s) failed to migrate`);
    }

    setApplying(false);
  }, [icloudNotesagePath, notesRootPath, syncedProjectPaths, toSync, toUnsync, setSyncedProjectPaths, saveSettings]);

  const getProjectName = (path: string) => {
    const meta = metadataMap[path];
    if (meta?.name) return meta.name;
    return path.split("/").pop() || path;
  };

  const getLocationLabel = (path: string) => {
    if (icloudNotesagePath && path.startsWith(icloudNotesagePath + "/")) {
      return "iCloud";
    }
    if (notesRootPath && path.startsWith(notesRootPath + "/")) {
      return "Notesage Library";
    }
    const parent = path.split("/").slice(0, -1).pop();
    return parent || "External";
  };

  /** Migration info for the expanded card detail area */
  const getMigrationDetail = (path: string) => {
    const isSelected = selectedPaths.has(path);
    const isCurrentlySynced = syncedProjectPaths.includes(path);

    if (isSelected && !isCurrentlySynced) {
      // Will be synced
      const fromDir = path.split("/").slice(0, -1).join("/");
      return {
        label: "Will be moved to iCloud Drive",
        from: fromDir,
        to: icloudNotesagePath || "",
      };
    }
    if (!isSelected && isCurrentlySynced) {
      // Will be unsynced
      return {
        label: "Will be moved back to local library",
        from: path.split("/").slice(0, -1).join("/"),
        to: notesRootPath || "",
      };
    }
    if (isCurrentlySynced) {
      return { label: "Synced to iCloud Drive", location: path };
    }
    return { label: "Stored locally", location: path };
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

  // Summary text for the apply bar
  const summaryParts: string[] = [];
  if (toSync.length > 0) summaryParts.push(`${toSync.length} to sync`);
  if (toUnsync.length > 0) summaryParts.push(`${toUnsync.length} to unsync`);
  const summaryText = summaryParts.join(", ");

  return (
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
              <div className="space-y-1.5">
                {projects.map((project) => {
                  const isSelected = selectedPaths.has(project.path);
                  const isExpanded = expandedProjectPath === project.path;
                  const projectName = getProjectName(project.path);
                  const locationLabel = getLocationLabel(project.path);
                  const detail = getMigrationDetail(project.path);

                  return (
                    <Collapsible
                      key={project.path}
                      open={isExpanded}
                      onOpenChange={(open) => setExpandedProjectPath(open ? project.path : null)}
                    >
                      <div
                        className={cn(
                          "group rounded-md border transition-all overflow-hidden",
                          isSelected
                            ? "border-foreground/30 bg-accent"
                            : "border-border hover:border-foreground/20 hover:bg-accent/50"
                        )}
                      >
                        {/* Card header */}
                        <div className="flex items-center gap-3 px-4 py-2.5">
                          <button
                            type="button"
                            className="flex items-center gap-3 min-w-0 flex-1 text-left"
                            onClick={() => toggleSelection(project.path)}
                            disabled={applying}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <span className="text-sm font-medium truncate">{projectName}</span>
                              <span className="text-xs text-muted-foreground shrink-0">{locationLabel}</span>
                            </div>
                          </button>

                          <div className="flex items-center gap-1 shrink-0">
                            <Check
                              className={cn(
                                "h-4 w-4 shrink-0 transition-opacity duration-150",
                                isSelected
                                  ? "text-primary opacity-100"
                                  : "text-muted-foreground opacity-0 group-hover:opacity-40"
                              )}
                            />
                            <CollapsibleTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 hover:bg-accent"
                              >
                                <ChevronDown
                                  className={cn(
                                    "h-4 w-4 transition-transform duration-200 text-muted-foreground",
                                    isExpanded && "rotate-180"
                                  )}
                                />
                              </Button>
                            </CollapsibleTrigger>
                          </div>
                        </div>

                        {/* Expanded detail */}
                        <CollapsibleContent>
                          <div className="px-4 pb-3 pt-0 border-t border-border/50">
                            <div className="pt-2.5 space-y-1.5">
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                {syncedProjectPaths.includes(project.path) ? (
                                  <Cloud className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                                ) : (
                                  <FolderOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                                )}
                                <span>{detail.label}</span>
                              </div>
                              {"from" in detail ? (
                                <div className="space-y-0.5 text-xs text-muted-foreground">
                                  <p>
                                    <span className="font-medium text-foreground">From:</span>{" "}
                                    <span className="font-mono">{detail.from}</span>
                                  </p>
                                  <p>
                                    <span className="font-medium text-foreground">To:</span>{" "}
                                    <span className="font-mono">{detail.to}</span>
                                  </p>
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground font-mono truncate">
                                  {detail.location}
                                </p>
                              )}
                            </div>
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  );
                })}
              </div>
            )}

            {/* Apply Changes bar */}
            {hasChanges && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-foreground/20 bg-accent/50">
                {applying ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Applying...</span>
                  </div>
                ) : (
                  <>
                    <span className="text-xs text-muted-foreground">{summaryText}</span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={discardChanges}
                      >
                        Discard
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={applyChanges}
                      >
                        Apply Changes
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Syncing a project moves it to iCloud Drive. Unsyncing moves it back to your local Notesage library.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

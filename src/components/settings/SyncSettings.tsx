import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Cloud, FolderOpen, Info, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSettingsStore } from "@/stores/settings-store";
import { useSyncStore } from "@/stores/sync-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useProjectMetadataStore } from "@/stores/project-metadata-store";
import { tauriApi } from "@/lib/tauri";
import { migrateProjectPath } from "@/lib/migrate-project-path";
import { toast } from "sonner";
import { cn, formatDisplayPath } from "@/lib/utils";
import { refreshNotesTree } from "@/lib/refresh-notes-tree";

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

  // Local state — pending values, discarded on close
  const [pendingICloud, setPendingICloud] = useState<boolean | null>(null);
  const [pendingQuickNotes, setPendingQuickNotes] = useState<boolean | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set(syncedProjectPaths));
  const [applying, setApplying] = useState(false);

  // The displayed states (pending overrides store)
  const displayICloudEnabled = pendingICloud ?? icloudEnabled;
  const displayQuickNotes = pendingQuickNotes ?? syncQuickNotes;
  const icloudToggleChanged = pendingICloud !== null && pendingICloud !== icloudEnabled;
  const quickNotesChanged = pendingQuickNotes !== null && pendingQuickNotes !== syncQuickNotes;

  // Re-sync local state when store changes (e.g. after apply or external update)
  useEffect(() => {
    setSelectedPaths(new Set(syncedProjectPaths));
  }, [syncedProjectPaths]);

  // Reset pending values when store changes (e.g. after apply)
  useEffect(() => {
    setPendingICloud(null);
  }, [icloudEnabled]);

  useEffect(() => {
    setPendingQuickNotes(null);
  }, [syncQuickNotes]);

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

  /** Migration info: move (pending change) or static (current location) */
  const getMigrationDetail = (path: string):
    | { type: "move"; label: string; from: string; to: string }
    | { type: "static"; label: string; location: string } => {
    const isSelected = selectedPaths.has(path);
    const isCurrentlySynced = syncedProjectPaths.includes(path);

    if (isSelected && !isCurrentlySynced) {
      const fromDir = path.split("/").slice(0, -1).join("/");
      return { type: "move", label: "Will be moved to iCloud Drive/Notesage", from: fromDir, to: icloudNotesagePath || "" };
    }
    if (!isSelected && isCurrentlySynced) {
      return { type: "move", label: "Will be moved back to local library", from: path.split("/").slice(0, -1).join("/"), to: notesRootPath || "" };
    }
    if (isCurrentlySynced) {
      return { type: "static", label: "Synced to iCloud Drive/Notesage", location: path };
    }
    return { type: "static", label: "Stored locally", location: path };
  };

  const handleICloudToggle = (checked: boolean) => {
    setPendingICloud(checked);
  };

  const applyICloudToggle = useCallback(async () => {
    if (pendingICloud === null) return;

    setApplying(true);

    if (pendingICloud && icloudNotesagePath && notesRootPath) {
      // Enabling — ensure iCloud folder exists, move Quick Notes if sync is on
      try {
        const exists = await tauriApi.pathExists(icloudNotesagePath);
        if (!exists) {
          await tauriApi.createDirectory(icloudNotesagePath);
        }
        // Move Quick Notes to iCloud if Quick Notes sync is enabled
        if (syncQuickNotes) {
          await tauriApi.migrateQuickNotes(notesRootPath, icloudNotesagePath);
        }
      } catch {
        toast.error("Failed to create iCloud Notesage folder");
        setApplying(false);
        setPendingICloud(null);
        return;
      }
    } else if (!pendingICloud && notesRootPath && icloudNotesagePath) {
      // Disabling — migrate all synced projects and Quick Notes back to local library
      let failures = 0;
      for (const path of syncedProjectPaths) {
        try {
          const newPath = await tauriApi.migrateFromICloud(path, notesRootPath);
          await migrateProjectPath(path, newPath);
        } catch (err) {
          console.error(`Failed to unsync ${path}:`, err);
          failures++;
        }
      }
      // Move Quick Notes back if they were synced
      if (syncQuickNotes) {
        try {
          await tauriApi.migrateQuickNotes(icloudNotesagePath, notesRootPath);
        } catch (err) {
          console.error("Failed to migrate Quick Notes back:", err);
          failures++;
        }
        setSyncQuickNotes(false);
      }
      setSyncedProjectPaths([]);
      if (failures > 0) {
        toast.error(`${failures} item(s) failed to move back to local library`);
      }
    }

    setICloudEnabled(pendingICloud);
    await saveSettings(notesRootPath);
    await refreshNotesTree();
    setPendingICloud(null);
    setApplying(false);
    toast.success(pendingICloud ? "iCloud sync enabled" : "iCloud sync disabled");
  }, [pendingICloud, icloudNotesagePath, notesRootPath, syncedProjectPaths, syncQuickNotes, setICloudEnabled, setSyncQuickNotes, setSyncedProjectPaths, saveSettings]);

  const handleSyncQuickNotes = (checked: boolean) => {
    setPendingQuickNotes(checked);
  };

  const applyQuickNotesToggle = useCallback(async () => {
    if (pendingQuickNotes === null || !notesRootPath || !icloudNotesagePath) return;
    setApplying(true);

    try {
      if (pendingQuickNotes) {
        // Enabling: move loose files from local → iCloud
        const moved = await tauriApi.migrateQuickNotes(notesRootPath, icloudNotesagePath);
        setSyncQuickNotes(true);
        await saveSettings(notesRootPath);
        toast.success(moved > 0 ? `Quick Notes sync enabled — ${moved} file(s) moved to iCloud` : "Quick Notes sync enabled");
      } else {
        // Disabling: move loose files from iCloud → local
        const moved = await tauriApi.migrateQuickNotes(icloudNotesagePath, notesRootPath);
        setSyncQuickNotes(false);
        await saveSettings(notesRootPath);
        toast.success(moved > 0 ? `Quick Notes sync disabled — ${moved} file(s) moved to local library` : "Quick Notes sync disabled");
      }
    } catch (err) {
      console.error("Failed to migrate Quick Notes:", err);
      toast.error(`Failed to migrate Quick Notes: ${err}`);
    }

    await refreshNotesTree();
    setPendingQuickNotes(null);
    setApplying(false);
  }, [pendingQuickNotes, notesRootPath, icloudNotesagePath, setSyncQuickNotes, saveSettings]);

  return (
    <div className="space-y-6">
      {/* iCloud Sync Toggle — the panel-level "iCloud Sync" header
          comes from the SettingsGroup wrapper in v2 ProjectsSettings,
          so the inner Label/description that used to live here was
          duplicating the panel chrome (live-test 2026-04-26). */}
      <div className="space-y-4">
        <div className="space-y-2">
          {/* Flat row — drops the inner bordered card so the Enable
              iCloud Sync toggle matches the Version Control row in
              ProjectsSettings (live-test 2026-04-26). */}
          <div className="flex flex-wrap items-center justify-between gap-3 py-1">
            <div className="min-w-0 flex-1">
              <Label
                htmlFor="icloud-sync"
                className="text-[13px] font-medium cursor-pointer text-foreground"
              >
                Enable iCloud Sync
              </Label>
              <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">
                Selectively sync projects to iCloud Drive
              </p>
            </div>
            <Switch
              id="icloud-sync"
              checked={displayICloudEnabled}
              onCheckedChange={handleICloudToggle}
              disabled={!icloudAvailable || applying}
              className="shrink-0"
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

          {icloudToggleChanged && (
            <div className="px-4 py-3 rounded-lg border border-foreground/20 bg-accent/50 space-y-2.5">
              {applying ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Applying...</span>
                </div>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    {pendingICloud
                      ? "iCloud sync will be enabled. The following will be synced to iCloud Drive/Notesage:"
                      : (syncedProjectPaths.length > 0 || syncQuickNotes)
                        ? "iCloud sync will be disabled. The following will be moved back to ~/Notesage:"
                        : "iCloud sync will be disabled."
                    }
                  </p>
                  {pendingICloud && (
                    <ul className="space-y-1">
                      {syncQuickNotes && (
                        <li className="flex items-center gap-2 text-xs">
                          <span className="font-medium">Quick Notes</span>
                          <PathFlow
                            fromPath={notesRootPath || ""}
                            fromIcon="folder"
                            toPath={icloudNotesagePath || ""}
                            toIcon="cloud"
                          />
                        </li>
                      )}
                      {syncedProjectPaths.length > 0 && syncedProjectPaths.map((path) => (
                        <li key={path} className="flex items-center gap-2 text-xs">
                          <span className="font-medium">{getProjectName(path)}</span>
                          <PathFlow
                            fromPath={path.split("/").slice(0, -1).join("/")}
                            fromIcon="folder"
                            toPath={icloudNotesagePath || ""}
                            toIcon="cloud"
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                  {!pendingICloud && (syncedProjectPaths.length > 0 || syncQuickNotes) && (
                    <ul className="space-y-1">
                      {syncQuickNotes && (
                        <li className="flex items-center gap-2 text-xs">
                          <span className="font-medium">Quick Notes</span>
                          <PathFlow
                            fromPath={icloudNotesagePath || ""}
                            fromIcon="cloud"
                            toPath={notesRootPath || ""}
                            toIcon="folder"
                          />
                        </li>
                      )}
                      {syncedProjectPaths.map((path) => (
                        <li key={path} className="flex items-center gap-2 text-xs">
                          <span className="font-medium">{getProjectName(path)}</span>
                          <PathFlow
                            fromPath={icloudNotesagePath || ""}
                            fromIcon="cloud"
                            toPath={notesRootPath || ""}
                            toIcon="folder"
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setPendingICloud(null)}
                    >
                      Discard
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={applyICloudToggle}
                    >
                      {pendingICloud ? "Enable" : "Disable"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Quick Notes sync and project list — only shown when iCloud is enabled */}
      {displayICloudEnabled && icloudAvailable && (
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
                checked={displayQuickNotes}
                onCheckedChange={handleSyncQuickNotes}
                disabled={applying}
                className="ml-auto"
              />
            </div>

            {quickNotesChanged && (
              <div className="px-4 py-3 rounded-lg border border-foreground/20 bg-accent/50 space-y-2.5">
                {applying ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Applying...</span>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {pendingQuickNotes
                        ? "Quick Notes will be synced to iCloud Drive."
                        : "Quick Notes will be stored locally."
                      }
                    </p>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-medium">Quick Notes</span>
                      {pendingQuickNotes ? (
                        <PathFlow
                          fromPath={notesRootPath || ""}
                          fromIcon="folder"
                          toPath={icloudNotesagePath || ""}
                          toIcon="cloud"
                        />
                      ) : (
                        <PathFlow
                          fromPath={icloudNotesagePath || ""}
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
                        onClick={() => setPendingQuickNotes(null)}
                      >
                        Discard
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={applyQuickNotesToggle}
                      >
                        {pendingQuickNotes ? "Enable" : "Disable"}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
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
                  const isSynced = syncedProjectPaths.includes(project.path);
                  const projectName = getProjectName(project.path);
                  const detail = getMigrationDetail(project.path);

                  return (
                    <div
                      key={project.path}
                      className={cn(
                        "group rounded-md border transition-all",
                        isSelected
                          ? "border-foreground/30 bg-accent"
                          : "border-border hover:border-foreground/20 hover:bg-accent/50"
                      )}
                    >
                      <div className="flex items-center gap-3 px-4 py-2.5">
                        <button
                          type="button"
                          className="flex items-center gap-2 min-w-0 flex-1 text-left"
                          onClick={() => toggleSelection(project.path)}
                          disabled={applying}
                        >
                          <span className="text-sm font-medium truncate">{projectName}</span>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          {detail.type === "move" ? (
                            <PathFlow
                              fromPath={detail.from}
                              fromIcon={isSynced ? "cloud" : "folder"}
                              toPath={detail.to}
                              toIcon={isSynced ? "folder" : "cloud"}
                            />
                          ) : (
                            <PathIcon
                              path={detail.location}
                              icon={isSynced ? "cloud" : "folder"}
                            />
                          )}
                          <button
                            type="button"
                            className="p-0.5"
                            onClick={() => toggleSelection(project.path)}
                            disabled={applying}
                          >
                            <Check
                              className={cn(
                                "h-4 w-4 shrink-0 transition-opacity duration-150",
                                isSelected
                                  ? "text-primary opacity-100"
                                  : "text-muted-foreground opacity-0 group-hover:opacity-100"
                              )}
                            />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Apply Changes bar */}
            {hasChanges && (
              <div className="px-4 py-3 rounded-lg border border-foreground/20 bg-accent/50 space-y-2.5">
                {applying ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Applying...</span>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      The following projects will be moved:
                    </p>
                    <ul className="space-y-1">
                      {toSync.map((path) => (
                        <li key={path} className="flex items-center gap-2 text-xs">
                          <span className="font-medium">{getProjectName(path)}</span>
                          <PathFlow
                            fromPath={path.split("/").slice(0, -1).join("/")}
                            fromIcon="folder"
                            toPath={icloudNotesagePath || ""}
                            toIcon="cloud"
                          />
                        </li>
                      ))}
                      {toUnsync.map((path) => (
                        <li key={path} className="flex items-center gap-2 text-xs">
                          <span className="font-medium">{getProjectName(path)}</span>
                          <PathFlow
                            fromPath={path.split("/").slice(0, -1).join("/")}
                            fromIcon="cloud"
                            toPath={notesRootPath || ""}
                            toIcon="folder"
                          />
                        </li>
                      ))}
                    </ul>
                    <div className="flex items-center justify-end gap-2">
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
              Syncing a project moves it to iCloud Drive/Notesage. Unsyncing moves it back to ~/Notesage.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/** Clickable icon that reveals a folder in Finder, with tooltip showing display path */
function PathIcon({ path, icon }: { path: string; icon: "cloud" | "folder" }) {
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
function PathFlow({
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
      <PathIcon path={fromPath} icon={fromIcon} />
      <ArrowRight className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
      <PathIcon path={toPath} icon={toIcon} />
    </span>
  );
}

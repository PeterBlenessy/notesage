import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { CommandPalette } from "@/components/CommandPalette";
import type { SettingsTab } from "@/components/settings/SettingsDialog";
import { NewNoteDialog } from "@/components/NewNoteDialog";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { UpdateDialog } from "@/components/UpdateDialog";
import { Layout } from "@/components/Layout";

// Lazy-load dialogs — these are hidden by default and only shown on demand.
const SettingsDialog = lazy(() => import("@/components/settings/SettingsDialog").then(m => ({ default: m.SettingsDialog })));
const ProjectSettingsDialog = lazy(() => import("@/components/settings/ProjectSettingsDialog").then(m => ({ default: m.ProjectSettingsDialog })));
const KeyboardShortcutsDialog = lazy(() => import("@/components/KeyboardShortcutsDialog").then(m => ({ default: m.KeyboardShortcutsDialog })));
const ActionsDialog = lazy(() => import("@/components/actions/ActionsDialog").then(m => ({ default: m.ActionsDialog })));
import { useActionScanner } from "@/hooks/useActionScanner";
import { useAutoUpdate } from "@/hooks/useAutoUpdate";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useProjectMetadata } from "@/hooks/useProjectMetadata";
import { useActiveProject } from "@/hooks/useActiveProject";
import { useFileOperations } from "@/hooks/useFileOperations";
import { useStartWatchers } from "@/hooks/useStartWatchers";
import { useSkillDiscovery } from "@/hooks/useSkillOperations";
import { useMcpDiscovery } from "@/hooks/useMcpOperations";
import { useLocalAI } from "@/hooks/useLocalAI";
import { useSandboxViolations } from "@/hooks/useSandboxViolations";
import { useAgentTaskOperations } from "@/hooks/useAgentTaskOperations";
import { useActivityNavigation } from "@/hooks/useActivityNavigation";
import { useAppLifecycle } from "@/hooks/useAppLifecycle";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { useActivityStore } from "@/stores/activity-store";
import { useCommentStore, clearPartialReply } from "@/stores/comment-store";
import { useSyncStore } from "@/stores/sync-store";
import { tauriApi } from "@/lib/tauri";
import { refreshNotesTree } from "@/lib/refresh-notes-tree";
import { log } from "@/lib/logger";
import type { PaletteMode } from "@/lib/command-palette";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

function App() {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteInitialMode, setCommandPaletteInitialMode] = useState<PaletteMode>("default");
  const [commandPaletteDrilldown, setCommandPaletteDrilldown] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab | undefined>(undefined);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [projectSettingsPath, setProjectSettingsPath] = useState("");
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [newNoteParentPath, setNewNoteParentPath] = useState("");
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [focusHintVisible, setFocusHintVisible] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [actionsDialogOpen, setActionsDialogOpen] = useState(false);

  const { state: updateState, checkForUpdate, downloadAndInstall, restartNow, dismiss: dismissUpdate } = useAutoUpdate();
  const { addProject, addExplorerFolder } = useWorkspaceStore();
  const { projectPath: activeProjectPath } = useActiveProject();

  // ============================================================
  // CRITICAL: All lifecycle hooks MUST remain mounted here.
  // Removing any of these will silently break features.
  // ============================================================
  useProjectMetadata();
  useStartWatchers();
  useSkillDiscovery();
  useMcpDiscovery();
  useLocalAI();
  useSandboxViolations();
  useActionScanner();

  // Consolidated startup effects and event listeners
  const onOpenPalette = useCallback((mode: PaletteMode, drilldown: string) => {
    setCommandPaletteDrilldown(drilldown);
    setCommandPaletteInitialMode(mode);
    setCommandPaletteOpen(true);
  }, []);
  useAppLifecycle({ onOpenPalette });

  // Activity strip — cancel handler and navigation
  const { cancelTask } = useAgentTaskOperations();
  const { handleClickTask } = useActivityNavigation();
  const isManuallyHidden = useActivityStore((s) => s.isManuallyHidden);

  const handleCancelTask = useCallback(
    async (taskId: string) => {
      try {
        await cancelTask(taskId);
        const task = useActivityStore.getState().tasks.find((t) => t.id === taskId);
        if (task?.commentId && task?.documentId) {
          const cs = useCommentStore.getState();
          clearPartialReply(task.documentId, task.commentId);
          cs.completeAllActivities(task.commentId);
          const comments = cs.commentsByDocument[task.documentId] ?? [];
          const comment = comments.find((c) => c.id === task.commentId);
          const hasReplies = (comment?.replies?.length ?? 0) > 0;
          cs.setCommentStatus(task.documentId, task.commentId, hasReplies ? "done" : "open");
          cs.clearDelegationMode(task.commentId);
          const ws = useWorkspaceStore.getState();
          const settings = useSettingsStore.getState();
          const projectRoot =
            ws.projects.find((p) => task.sourceFile?.startsWith(p.path + "/"))?.path ?? settings.notesRootPath;
          if (projectRoot) {
            cs.saveComments(task.documentId, projectRoot);
          }
        }
      } catch (error) {
        toast.error(`Failed to cancel task: ${error}`);
      }
    },
    [cancelTask]
  );

  const stripExpanded = !isManuallyHidden && !focusMode;

  const { openFile, openFileAtTag, openFileAtText } = useFileOperations();

  // Handle file-open events from macOS file association
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<string[]>("open-files", async (event) => {
        for (const filePath of event.payload) {
          const fileName = filePath.split("/").pop() ?? filePath;
          try {
            await openFile(filePath, fileName);
            const parentDir = filePath.substring(0, filePath.lastIndexOf("/"));
            if (parentDir) {
              const ws = useWorkspaceStore.getState();
              const isKnown =
                ws.projects.some((p) => filePath.startsWith(p.path)) ||
                ws.explorerFolders.some((f) => filePath.startsWith(f.path));
              if (!isKnown) {
                try {
                  const tree = await tauriApi.listDirectory(parentDir);
                  addExplorerFolder(parentDir, tree);
                } catch {
                  // Parent directory may not be listable
                }
              }
            }
          } catch (error) {
            log.error("lifecycle", "Failed to open file from association", error);
            toast.error(`Failed to open file: ${error}`);
          }
        }
      }).then((fn) => { unlisten = fn; });
    }).catch((e) => log.warn("lifecycle", "Failed to set up file-open listener", e));
    return () => { unlisten?.(); };
  }, [openFile, addExplorerFolder]);

  // --- Callbacks ---

  const handleOpenFolder = useCallback(async () => {
    try {
      const folderPath = await tauriApi.openFolderDialog();
      if (folderPath) {
        const isProject = await tauriApi.pathExists(`${folderPath}/.notesage`);
        const tree = await tauriApi.listDirectory(folderPath);
        if (isProject) {
          addProject(folderPath, tree);
        } else {
          addExplorerFolder(folderPath, tree);
        }
      }
    } catch (error) {
      log.error("lifecycle", "Failed to open folder", error);
      toast.error(`Failed to open folder: ${error}`);
    }
  }, [addProject, addExplorerFolder]);

  const handleOpenProject = useCallback(async (projectPath: string) => {
    try {
      const tree = await tauriApi.listDirectory(projectPath);
      addProject(projectPath, tree);
    } catch (error) {
      log.error("lifecycle", "Failed to open project", error);
      toast.error(`Failed to open project: ${error}`);
    }
  }, [addProject]);

  const handleOpenFile = useCallback(async (filePath: string, fileName: string) => {
    try {
      await openFile(filePath, fileName);
    } catch (error) {
      log.error("lifecycle", "Failed to open file", error);
      toast.error(`Failed to open file: ${error}`);
    }
  }, [openFile]);

  const handleOpenFileAtTag = useCallback(async (filePath: string, fileName: string, symbol: string, occurrenceInFile: number) => {
    try {
      await openFileAtTag(filePath, fileName, symbol, occurrenceInFile);
    } catch (error) {
      log.error("lifecycle", "Failed to open file at tag", error);
      toast.error(`Failed to open file: ${error}`);
    }
  }, [openFileAtTag]);

  const handleBrowseForProject = useCallback(async () => {
    try {
      const folderPath = await tauriApi.openFolderDialog();
      if (folderPath) {
        const metaDir = `${folderPath}/.notesage`;
        const dirExists = await tauriApi.pathExists(metaDir);
        if (!dirExists) {
          await tauriApi.createDirectory(metaDir);
        }
        const tree = await tauriApi.listDirectory(folderPath);
        addProject(folderPath, tree);
      }
    } catch (error) {
      log.error("lifecycle", "Failed to open project", error);
      toast.error(`Failed to open project: ${error}`);
    }
  }, [addProject]);

  const handleMakeProject = useCallback(async (path: string) => {
    try {
      const metaDir = `${path}/.notesage`;
      const dirExists = await tauriApi.pathExists(metaDir);
      if (!dirExists) {
        await tauriApi.createDirectory(metaDir);
      }
      const tree = await tauriApi.listDirectory(path);
      addProject(path, tree);
    } catch (error) {
      log.error("lifecycle", "Failed to make project", error);
      toast.error(`Failed to create project: ${error}`);
    }
  }, [addProject]);

  const handleNoteCreated = useCallback(async (filePath: string, fileName: string) => {
    try {
      await tauriApi.createFile(filePath);
      const ws = useWorkspaceStore.getState();
      for (const project of ws.projects) {
        if (filePath.startsWith(project.path + "/")) {
          const tree = await tauriApi.listDirectory(project.path);
          ws.updateProjectTree(project.path, tree);
          break;
        }
      }
      for (const folder of ws.explorerFolders) {
        if (filePath.startsWith(folder.path + "/")) {
          const tree = await tauriApi.listDirectory(folder.path);
          ws.updateExplorerTree(folder.path, tree);
          break;
        }
      }
      const settings = useSettingsStore.getState();
      const notesRoot = settings.notesRootPath;
      const icloudPath = settings.icloudNotesagePath;
      if (
        (notesRoot && filePath.startsWith(notesRoot)) ||
        (icloudPath && filePath.startsWith(icloudPath))
      ) {
        await refreshNotesTree();
      }
      const content = await tauriApi.readFile(filePath);
      useEditorStore.getState().openTab(filePath, fileName, content);
    } catch (err) {
      log.error("lifecycle", "Failed to create note", err);
      toast.error(`Failed to create note: ${err}`);
    }
  }, []);

  const handleNewNote = useCallback((parentPath?: string) => {
    let target = parentPath;
    if (!target) {
      const activeProject = activeProjectPath;
      if (activeProject) {
        target = activeProject;
      } else {
        const ws = useWorkspaceStore.getState();
        if (ws.projects.length > 0) {
          target = ws.projects[0].path;
        } else {
          const settings = useSettingsStore.getState();
          const sync = useSyncStore.getState();
          if (sync.icloudEnabled && sync.syncQuickNotes && settings.icloudNotesagePath) {
            target = settings.icloudNotesagePath;
          } else {
            target = settings.notesRootPath;
          }
        }
      }
    }
    if (target) {
      setNewNoteParentPath(target);
      setNewNoteOpen(true);
    }
  }, [activeProjectPath]);

  const handleNewProject = useCallback(() => {
    setNewProjectOpen(true);
  }, []);

  const handleExportFile = useCallback(async (filePath: string, fileName: string) => {
    const { tabs, activeTabId } = useEditorStore.getState();
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab || activeTab.filePath !== filePath) {
      await openFile(filePath, fileName);
    }
    setExportOpen(true);
  }, [openFile]);

  const handleOpenProjectSettings = useCallback((projectPath: string) => {
    setProjectSettingsPath(projectPath);
    setProjectSettingsOpen(true);
  }, []);

  // Show toast when update becomes available
  useEffect(() => {
    if (updateState.status === "available" && updateState.updateInfo) {
      toast.info(`Notesage v${updateState.updateInfo.version} is available`, {
        id: "update-available",
        duration: 8000,
        action: {
          label: "View",
          onClick: () => setUpdateDialogOpen(true),
        },
      });
    }
  }, [updateState.status, updateState.updateInfo]);

  // Show and auto-fade focus mode hint
  useEffect(() => {
    if (focusMode) {
      setFocusHintVisible(true);
      const timer = setTimeout(() => setFocusHintVisible(false), 2000);
      return () => clearTimeout(timer);
    } else {
      setFocusHintVisible(false);
    }
  }, [focusMode]);

  const openPalette = useCallback((mode: PaletteMode = "default") => {
    setCommandPaletteInitialMode(mode);
    setCommandPaletteOpen(true);
  }, []);

  useKeyboardShortcuts({
    onPaletteOpen: openPalette,
    onFindOpen: () => {
      window.dispatchEvent(new CustomEvent("notesage:find-open"));
    },
    onFindReplaceOpen: () => {
      window.dispatchEvent(new CustomEvent("notesage:find-replace-open"));
    },
    onToggleFocusMode: () => setFocusMode((prev) => !prev),
    onExitFocusMode: () => setFocusMode(false),
    onOutlineOpen: () => setOutlineOpen(true),
    onSettingsOpen: () => setSettingsOpen(true),
    onExportOpen: () => setExportOpen(true),
    onNewProject: handleNewProject,
    onNewNote: handleNewNote,
    onOpenFolder: handleOpenFolder,
    onShortcutsOpen: () => setShortcutsOpen(true),
    onToggleActivityStrip: () => {
      const store = useActivityStore.getState();
      store.setManuallyHidden(!store.isManuallyHidden);
    },
    onToggleRecording: () => {
      window.dispatchEvent(new CustomEvent("notesage:toggle-recording"));
    },
    onOpenActions: () => setActionsDialogOpen(true),
    focusMode,
  });

  return (
    <ThemeProvider>
      <div className="flex h-screen w-screen overflow-hidden">
        <Layout
          focusMode={focusMode}
          stripExpanded={stripExpanded}
          onNewNote={handleNewNote}
          onNewProject={handleNewProject}
          onOpenFolder={handleOpenFolder}
          onOpenProject={handleOpenProject}
          onOpenFile={handleOpenFile}
          exportOpen={exportOpen}
          onExportOpenChange={setExportOpen}
          outlineOpen={outlineOpen}
          onOutlineOpenChange={setOutlineOpen}
          updateAvailable={!!updateState.updateInfo}
          updateVersion={updateState.updateInfo?.version ?? null}
          onUpdateClick={() => setUpdateDialogOpen(true)}
          onShortcutsOpen={() => setShortcutsOpen(true)}
          onOpenActions={() => setActionsDialogOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onBrowseForProject={handleBrowseForProject}
          onOpenProjectSettings={handleOpenProjectSettings}
          onMakeProject={handleMakeProject}
          onExportFile={handleExportFile}
          onCancelTask={handleCancelTask}
          onClickTask={handleClickTask}
        />

        {/* Focus mode hint overlay */}
        {focusMode && (
          <div
            className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none transition-opacity duration-500 ${focusHintVisible ? "opacity-100" : "opacity-0"}`}
          >
            <div className="px-3 py-1.5 rounded-md text-xs bg-popover text-popover-foreground border border-border shadow-md">
              Press <kbd className="font-mono font-semibold">Esc</kbd> to exit focus mode
            </div>
          </div>
        )}

        <Suspense fallback={null}>
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={(open) => {
              setSettingsOpen(open);
              if (!open) setSettingsInitialTab(undefined);
            }}
            initialTab={settingsInitialTab}
            updateState={updateState}
            onCheckForUpdate={checkForUpdate}
            onOpenUpdateDialog={() => setUpdateDialogOpen(true)}
          />
          {projectSettingsPath && (
            <ProjectSettingsDialog
              open={projectSettingsOpen}
              onOpenChange={setProjectSettingsOpen}
              projectPath={projectSettingsPath}
              onPathChanged={setProjectSettingsPath}
              onOpenAISettings={() => {
                setProjectSettingsOpen(false);
                setSettingsInitialTab("ai");
                setSettingsOpen(true);
              }}
            />
          )}
        </Suspense>
        <CommandPalette
          open={commandPaletteOpen}
          onOpenChange={(open) => {
            setCommandPaletteOpen(open);
            if (!open) {
              setCommandPaletteInitialMode("default");
              setCommandPaletteDrilldown("");
            }
          }}
          initialMode={commandPaletteInitialMode}
          drilldownName={commandPaletteDrilldown || undefined}
          onOpenFileAtSymbol={handleOpenFileAtTag}
          onNewNote={() => handleNewNote()}
          onNewProject={handleNewProject}
          onOpenFolder={handleOpenFolder}
          onOpenSettings={() => setSettingsOpen(true)}
          onExportPdf={() => setExportOpen(true)}
          onToggleFocusMode={() => setFocusMode((prev) => !prev)}
          onOpenActions={() => setActionsDialogOpen(true)}
        />
        <NewNoteDialog
          open={newNoteOpen}
          onOpenChange={setNewNoteOpen}
          parentPath={newNoteParentPath}
          onCreated={handleNoteCreated}
        />
        <NewProjectDialog
          open={newProjectOpen}
          onOpenChange={setNewProjectOpen}
          onCreated={handleOpenProject}
        />
        <UpdateDialog
          open={updateDialogOpen}
          onOpenChange={setUpdateDialogOpen}
          updateInfo={updateState.updateInfo}
          status={updateState.status}
          progress={updateState.progress}
          onInstall={downloadAndInstall}
          onRestartNow={restartNow}
          onDismiss={dismissUpdate}
        />
        <Suspense fallback={null}>
          <KeyboardShortcutsDialog
            open={shortcutsOpen}
            onOpenChange={setShortcutsOpen}
          />
        </Suspense>
        <Suspense fallback={null}>
        <ActionsDialog
          open={actionsDialogOpen}
          onOpenChange={setActionsDialogOpen}
          onActionClick={(action) => {
            if (!action.file_path) return;

            // Comments: open the document and scroll to the comment
            if (action.source_type === 'comment' && action.metadata) {
              const meta = typeof action.metadata === 'object' ? action.metadata as Record<string, unknown> : {};
              const commentId = meta.commentId as string | undefined;
              const filePath = action.file_path;
              const fileName = filePath.split("/").pop() ?? filePath;

              const { tabs, activeTabId } = useEditorStore.getState();
              const alreadyActive = tabs.some((t) => t.filePath === filePath && t.id === activeTabId);

              (async () => {
                if (!alreadyActive) {
                  await handleOpenFile(filePath, fileName);
                }
                if (commentId) {
                  const delay = alreadyActive ? 50 : 300;
                  setTimeout(() => {
                    useCommentStore.getState().requestScrollToComment(commentId);
                  }, delay);
                }
              })().catch((error) => {
                log.error("lifecycle", "Failed to navigate to comment", error);
                toast.error(`Failed to open file: ${error}`);
              });
              return;
            }

            // Default: open file and optionally search for text
            const fileName = action.file_path.split("/").pop() ?? action.file_path;
            if (action.text) {
              openFileAtText(action.file_path, fileName, action.text).catch((error) => {
                log.error("lifecycle", "Failed to open file", error);
                toast.error(`Failed to open file: ${error}`);
              });
            } else {
              handleOpenFile(action.file_path, fileName);
            }
          }}
        />
        </Suspense>
      </div>
      <Toaster position="bottom-right" />
    </ThemeProvider>
  );
}

export default App;

import { useState, useEffect, useCallback } from "react";
import { TabBar } from "@/components/tabs/TabBar";
import { Editor } from "@/components/editor/Editor";
import { ThemeProvider } from "@/components/ThemeProvider";
import { CommandPalette } from "@/components/CommandPalette";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { ProjectSettingsDialog } from "@/components/settings/ProjectSettingsDialog";
import { NewNoteDialog } from "@/components/NewNoteDialog";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { TitleBar } from "@/components/TitleBar";
import { SidebarPanel } from "@/components/SidebarPanel";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useProjectMetadata } from "@/hooks/useProjectMetadata";
import { useActiveProject } from "@/hooks/useActiveProject";
import { useFileOperations } from "@/hooks/useFileOperations";
import { useStartWatchers } from "@/hooks/useStartWatchers";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { useSyncStore } from "@/stores/sync-store";
import { tauriApi } from "@/lib/tauri";
import { parseFrontmatter } from "@/lib/frontmatter";
import { refreshNotesTree } from "@/lib/refresh-notes-tree";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

const PANEL_SIZES_KEY = "notesage-panel-sizes";

function layoutConfigKey(panelIds: string[]): string {
  return `main:${[...panelIds].sort().join(",")}`;
}

function savePanelSizes(layout: Record<string, number>) {
  try {
    const key = layoutConfigKey(Object.keys(layout));
    const stored = JSON.parse(localStorage.getItem(PANEL_SIZES_KEY) || "{}");
    stored[key] = layout;
    localStorage.setItem(PANEL_SIZES_KEY, JSON.stringify(stored));
  } catch {
    // localStorage may be full or unavailable
  }
}

function loadPanelSize(configKey: string, panel: string, fallback: number): number {
  try {
    const stored = JSON.parse(localStorage.getItem(PANEL_SIZES_KEY) || "{}");
    return stored[configKey]?.[panel] ?? fallback;
  } catch {
    return fallback;
  }
}

// Editor area with document-style presentation
function EditorArea({ onNewNote, onNewProject, onOpenFolder, onOpenProject, onOpenFile, exportOpen, onExportOpenChange, focusMode, outlineOpen, onOutlineOpenChange }: {
  onNewNote?: () => void;
  onNewProject?: () => void;
  onOpenFolder?: () => void;
  onOpenProject?: (path: string) => void;
  onOpenFile?: (path: string, name: string) => void;
  exportOpen?: boolean;
  onExportOpenChange?: (open: boolean) => void;
  focusMode?: boolean;
  outlineOpen?: boolean;
  onOutlineOpenChange?: (open: boolean) => void;
}) {
  return (
    <div className="flex flex-col h-full overflow-hidden bg-muted">
      {!focusMode && <TabBar />}
      <Editor onNewNote={onNewNote} onNewProject={onNewProject} onOpenFolder={onOpenFolder} onOpenProject={onOpenProject} onOpenFile={onOpenFile} exportOpen={exportOpen} onExportOpenChange={onExportOpenChange} focusMode={focusMode} outlineOpen={outlineOpen} onOutlineOpenChange={onOutlineOpenChange} />
    </div>
  );
}

function App() {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteFilesOnly, setCommandPaletteFilesOnly] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [projectSettingsPath, setProjectSettingsPath] = useState("");
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [newNoteParentPath, setNewNoteParentPath] = useState("");
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [focusHintVisible, setFocusHintVisible] = useState(false);

  const { chatPanelOpen, setChatPanelOpen } = useSettingsStore();

  const { addProject, setExplorerPath, setExplorerTree } = useWorkspaceStore();
  const { projectPath: activeProjectPath } = useActiveProject();

  useProjectMetadata();
  useStartWatchers();

  // Reload file trees for all persisted projects on startup
  useEffect(() => {
    async function reloadTrees() {
      const ws = useWorkspaceStore.getState();
      const settings = useSettingsStore.getState();

      // Resolve ~ in notes root path
      let notesRoot = settings.notesRootPath;
      if (notesRoot.startsWith("~")) {
        try {
          const homeDir = await tauriApi.getHomeDir();
          notesRoot = notesRoot.replace("~", homeDir);
          settings.setNotesRootPath(notesRoot);
        } catch {
          console.error("Failed to resolve home directory");
        }
      }

      // Reload explorer tree
      if (ws.explorerPath) {
        try {
          const tree = await tauriApi.listDirectory(ws.explorerPath);
          ws.setExplorerTree(tree);
        } catch {
          ws.setExplorerPath(null);
          ws.setExplorerTree([]);
        }
      }

      // Reload all project trees
      for (const project of ws.projects) {
        try {
          const tree = await tauriApi.listDirectory(project.path);
          ws.updateProjectTree(project.path, tree);
        } catch {
          ws.removeProject(project.path);
        }
      }

      // Ensure notes directory exists
      if (notesRoot) {
        try {
          const exists = await tauriApi.pathExists(notesRoot);
          if (!exists) {
            await tauriApi.createDirectory(notesRoot);
          }
          const metaDir = `${notesRoot}/.notesage`;
          const metaDirExists = await tauriApi.pathExists(metaDir);
          if (!metaDirExists) {
            await tauriApi.createDirectory(metaDir);
          }
        } catch {
          // Notes root creation failed, that's fine on first launch
        }
      }

      // Detect iCloud availability
      try {
        const icloudRoot = await tauriApi.getICloudPath();
        if (icloudRoot) {
          const icloudNotesagePath = `${icloudRoot}/Notesage`;
          settings.setICloudAvailable(true);
          settings.setICloudNotesagePath(icloudNotesagePath);
        }
      } catch {
        // iCloud detection failed, that's fine
      }

      // Load sync settings from disk
      if (notesRoot) {
        const syncStore = useSyncStore.getState();
        await syncStore.loadSettings(notesRoot);

        // If iCloud sync is enabled, verify iCloud is still available and load synced content
        if (syncStore.icloudEnabled) {
          const icloudNotesagePath = settings.icloudNotesagePath;
          if (!icloudNotesagePath || !settings.icloudAvailable) {
            // iCloud was enabled but is now unavailable (user signed out)
            syncStore.setICloudEnabled(false);
            await syncStore.saveSettings(notesRoot);
            toast.info("iCloud is no longer available. Sync has been disabled.");
          } else {
            // Load file trees for synced projects from iCloud
            for (const syncedPath of syncStore.syncedProjectPaths) {
              try {
                const tree = await tauriApi.listDirectory(syncedPath);
                ws.addProject(syncedPath, tree);
              } catch {
                // Synced project no longer exists in iCloud
                syncStore.removeSyncedProject(syncedPath);
              }
            }

            // Save any cleanup (removed stale projects)
            await syncStore.saveSettings(notesRoot);
          }
        }
      }

      // Load Quick Notes tree (after iCloud + sync settings are known, so we
      // get it right in one shot — no flash of local-only then merged content)
      await refreshNotesTree();
    }

    reloadTrees();

    // Re-open persisted tabs
    const { persistedTabs, persistedActiveFilePath } = useEditorStore.getState();
    for (const pt of persistedTabs) {
      tauriApi.readFile(pt.filePath).then((raw) => {
        const { frontmatter, content } = parseFrontmatter(raw);
        useEditorStore.getState().openTab(pt.filePath, pt.fileName, content, frontmatter);
      }).catch(() => {
        // File no longer exists — skip it
      });
    }
    if (persistedActiveFilePath) {
      const waitForActive = () => {
        const { tabs } = useEditorStore.getState();
        const match = tabs.find((t) => t.filePath === persistedActiveFilePath);
        if (match) {
          useEditorStore.getState().setActiveTab(match.id);
        } else if (persistedTabs.some((p) => p.filePath === persistedActiveFilePath)) {
          requestAnimationFrame(waitForActive);
        }
      };
      requestAnimationFrame(waitForActive);
    }
  }, []);

  const handleOpenFolder = useCallback(async () => {
    try {
      const folderPath = await tauriApi.openFolderDialog();
      if (folderPath) {
        const isProject = await tauriApi.pathExists(`${folderPath}/.notesage`);
        if (isProject) {
          const tree = await tauriApi.listDirectory(folderPath);
          addProject(folderPath, tree);
        } else {
          setExplorerPath(folderPath);
          const tree = await tauriApi.listDirectory(folderPath);
          setExplorerTree(tree);
        }
      }
    } catch (error) {
      console.error("Failed to open folder:", error);
      toast.error(`Failed to open folder: ${error}`);
    }
  }, [setExplorerPath, setExplorerTree, addProject]);

  const { openFile } = useFileOperations();

  const handleOpenProject = useCallback(async (projectPath: string) => {
    try {
      const tree = await tauriApi.listDirectory(projectPath);
      addProject(projectPath, tree);
    } catch (error) {
      console.error("Failed to open project:", error);
      toast.error(`Failed to open project: ${error}`);
    }
  }, [addProject]);

  const handleOpenFile = useCallback(async (filePath: string, fileName: string) => {
    try {
      await openFile(filePath, fileName);
    } catch (error) {
      console.error("Failed to open file:", error);
      toast.error(`Failed to open file: ${error}`);
    }
  }, [openFile]);

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
      console.error("Failed to open project:", error);
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
      console.error("Failed to make project:", error);
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
      if (ws.explorerPath && filePath.startsWith(ws.explorerPath)) {
        const tree = await tauriApi.listDirectory(ws.explorerPath);
        ws.setExplorerTree(tree);
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
      console.error("Failed to create note:", err);
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

  const handlePanelLayout = useCallback((layout: Record<string, number>) => {
    savePanelSizes(layout);
  }, []);

  // Panel config key (editor + optional chat)
  const configKey = layoutConfigKey([
    "editor",
    ...(chatPanelOpen ? ["chat"] : []),
  ]);

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

  useKeyboardShortcuts({
    onCommandPaletteOpen: () => setCommandPaletteOpen(true),
    onFileSearchOpen: () => {
      setCommandPaletteFilesOnly(true);
      setCommandPaletteOpen(true);
    },
    onToggleFocusMode: () => setFocusMode((prev) => !prev),
    onExitFocusMode: () => setFocusMode(false),
    onOutlineOpen: () => setOutlineOpen(true),
    onSettingsOpen: () => setSettingsOpen(true),
    onExportOpen: () => setExportOpen(true),
    onNewProject: handleNewProject,
    onNewNote: handleNewNote,
    onOpenFolder: handleOpenFolder,
    focusMode,
  });

  return (
    <ThemeProvider>
      <div className="flex h-screen w-screen overflow-hidden">
        {/* Left: SidebarPanel — full window height, rail + drawer (hidden in focus mode) */}
        {!focusMode && (
          <SidebarPanel
            onOpenSettings={() => setSettingsOpen(true)}
            onNewNote={handleNewNote}
            onNewProject={handleNewProject}
            onOpenExistingProject={handleBrowseForProject}
            onOpenProjectSettings={handleOpenProjectSettings}
            onMakeProject={handleMakeProject}
            onExportFile={handleExportFile}
          />
        )}

        {/* Right: Title bar + editor + chat */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {!focusMode && (
            <TitleBar
              onToggleChat={() => setChatPanelOpen(!chatPanelOpen)}
            />
          )}

          <ResizablePanelGroup
            orientation="horizontal"
            className="flex h-full w-full"
            onLayoutChanged={handlePanelLayout}
          >
            <ResizablePanel
              id="editor"
              defaultSize={loadPanelSize(configKey, "editor", chatPanelOpen ? 65 : 100)}
              minSize={300}
            >
              <EditorArea
                onNewNote={handleNewNote}
                onNewProject={handleNewProject}
                onOpenFolder={handleOpenFolder}
                onOpenProject={handleOpenProject}
                onOpenFile={handleOpenFile}
                exportOpen={exportOpen}
                onExportOpenChange={setExportOpen}
                focusMode={focusMode}
                outlineOpen={outlineOpen}
                onOutlineOpenChange={setOutlineOpen}
              />
            </ResizablePanel>

            {chatPanelOpen && !focusMode && (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel
                  id="chat"
                  defaultSize={loadPanelSize(configKey, "chat", 35)}
                  minSize={280}
                  maxSize={500}
                >
                  <ChatPanel />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </div>

        {/* Focus mode hint overlay */}
        {focusMode && (
          <div
            className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none transition-opacity duration-500 ${focusHintVisible ? "opacity-100" : "opacity-0"}`}
          >
            <div className="px-3 py-1.5 rounded-md text-xs bg-muted text-muted-foreground border border-border">
              Press <kbd className="font-mono font-semibold">Esc</kbd> to exit focus mode
            </div>
          </div>
        )}

        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        {projectSettingsPath && (
          <ProjectSettingsDialog
            open={projectSettingsOpen}
            onOpenChange={setProjectSettingsOpen}
            projectPath={projectSettingsPath}
            onPathChanged={setProjectSettingsPath}
          />
        )}
        <CommandPalette
          open={commandPaletteOpen}
          onOpenChange={(open) => {
            setCommandPaletteOpen(open);
            if (!open) setCommandPaletteFilesOnly(false);
          }}
          onNewNote={() => handleNewNote()}
          onNewProject={handleNewProject}
          onOpenFolder={handleOpenFolder}
          onOpenSettings={() => setSettingsOpen(true)}
          onExportPdf={() => setExportOpen(true)}
          onToggleFocusMode={() => setFocusMode((prev) => !prev)}
          filesOnly={commandPaletteFilesOnly}
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
      </div>
      <Toaster position="bottom-right" />
    </ThemeProvider>
  );
}

export default App;

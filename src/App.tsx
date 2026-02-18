import { useState, useEffect, useCallback } from "react";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { TabBar } from "@/components/tabs/TabBar";
import { Editor } from "@/components/editor/Editor";
import { ThemeProvider } from "@/components/ThemeProvider";
import { QuickOpen } from "@/components/QuickOpen";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { ProjectSettingsDialog } from "@/components/settings/ProjectSettingsDialog";
import { NewNoteDialog } from "@/components/NewNoteDialog";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useProjectMetadata } from "@/hooks/useProjectMetadata";
import { useActiveProject } from "@/hooks/useActiveProject";
import { useFileOperations } from "@/hooks/useFileOperations";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { tauriApi } from "@/lib/tauri";
import { parseFrontmatter } from "@/lib/frontmatter";
import { Button } from "@/components/ui/button";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { PanelLeft, MessageSquare, Settings, FilePlus, FolderPlus, FolderOpen, FileDown } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

const BREAKPOINT_WIDE = 1200; // px
const SIDEBAR_FLOAT_WIDTH = 280; // px - sidebar width in narrow/floating mode
const PANEL_SIZES_KEY = "notesage-panel-sizes";

/** Derive a storage key from mode + which panel IDs are in the layout. */
function layoutConfigKey(mode: string, panelIds: string[]): string {
  return `${mode}:${[...panelIds].sort().join(",")}`;
}

function savePanelSizes(layout: Record<string, number>, mode: string) {
  try {
    const key = layoutConfigKey(mode, Object.keys(layout));
    const stored = JSON.parse(localStorage.getItem(PANEL_SIZES_KEY) || "{}");
    stored[key] = layout;
    localStorage.setItem(PANEL_SIZES_KEY, JSON.stringify(stored));
  } catch {}
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
function EditorArea({ onNewNote, onNewProject, onOpenFolder, onOpenProject, onOpenFile, exportOpen, onExportOpenChange }: {
  onNewNote?: () => void;
  onNewProject?: () => void;
  onOpenFolder?: () => void;
  onOpenProject?: (path: string) => void;
  onOpenFile?: (path: string, name: string) => void;
  exportOpen?: boolean;
  onExportOpenChange?: (open: boolean) => void;
}) {
  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: 'var(--color-muted)' }}>
      <TabBar />
      <Editor onNewNote={onNewNote} onNewProject={onNewProject} onOpenFolder={onOpenFolder} onOpenProject={onOpenProject} onOpenFile={onOpenFile} exportOpen={exportOpen} onExportOpenChange={onExportOpenChange} />
    </div>
  );
}

function App() {
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [projectSettingsPath, setProjectSettingsPath] = useState("");
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [newNoteParentPath, setNewNoteParentPath] = useState("");
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [isWideMode, setIsWideMode] = useState(window.innerWidth >= BREAKPOINT_WIDE);
  const { sidebarOpen, setSidebarOpen, chatPanelOpen, setChatPanelOpen } = useSettingsStore();

  const activeTabId = useEditorStore((s) => s.activeTabId);
  const { addProject, setExplorerPath, setExplorerTree } = useWorkspaceStore();
  const { projectPath: activeProjectPath } = useActiveProject();

  useKeyboardShortcuts();
  useProjectMetadata();

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

      // Auto-create and load notes directory
      if (notesRoot) {
        try {
          const exists = await tauriApi.pathExists(notesRoot);
          if (!exists) {
            await tauriApi.createDirectory(notesRoot);
          }
          // Ensure .notesage/ exists for global comment storage
          const metaDir = `${notesRoot}/.notesage`;
          const metaDirExists = await tauriApi.pathExists(metaDir);
          if (!metaDirExists) {
            await tauriApi.createDirectory(metaDir);
          }
          const tree = await tauriApi.listDirectory(notesRoot);
          ws.setNotesTree(tree);
        } catch {
          // Notes root creation failed, that's fine on first launch
        }
      }

    }

    reloadTrees();

    // Re-open persisted tabs (same as clicking each file in the sidebar)
    const { persistedTabs, persistedActiveFilePath } = useEditorStore.getState();
    for (const pt of persistedTabs) {
      tauriApi.readFile(pt.filePath).then((raw) => {
        const { frontmatter, content } = parseFrontmatter(raw);
        useEditorStore.getState().openTab(pt.filePath, pt.fileName, content, frontmatter);
      }).catch(() => {
        // File no longer exists — skip it
      });
    }
    // Re-activate the previously active file once it's opened
    if (persistedActiveFilePath) {
      const waitForActive = () => {
        const { tabs } = useEditorStore.getState();
        const match = tabs.find((t) => t.filePath === persistedActiveFilePath);
        if (match) {
          useEditorStore.getState().setActiveTab(match.id);
        } else if (persistedTabs.some((p) => p.filePath === persistedActiveFilePath)) {
          // Not loaded yet, try again next tick
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
        // Auto-detect project folders: if .notesage/ exists, add to Projects instead
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
    }
  }, [setExplorerPath, setExplorerTree, addProject]);

  const { openFile } = useFileOperations();

  const handleOpenProject = useCallback(async (projectPath: string) => {
    try {
      const tree = await tauriApi.listDirectory(projectPath);
      addProject(projectPath, tree);
    } catch (error) {
      console.error("Failed to open project:", error);
    }
  }, [addProject]);

  const handleOpenFile = useCallback(async (filePath: string, fileName: string) => {
    try {
      await openFile(filePath, fileName);
    } catch (error) {
      console.error("Failed to open file:", error);
    }
  }, [openFile]);

  const handleBrowseForProject = useCallback(async () => {
    try {
      const folderPath = await tauriApi.openFolderDialog();
      if (folderPath) {
        // Bootstrap .notesage/ if it doesn't exist
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
    }
  }, [addProject]);

  const handleMakeProject = useCallback(async (path: string) => {
    try {
      // Bootstrap .notesage/ directory
      const metaDir = `${path}/.notesage`;
      const dirExists = await tauriApi.pathExists(metaDir);
      if (!dirExists) {
        await tauriApi.createDirectory(metaDir);
      }
      // Add as project (metadata will be auto-loaded by useProjectMetadata)
      const tree = await tauriApi.listDirectory(path);
      addProject(path, tree);
    } catch (error) {
      console.error("Failed to make project:", error);
    }
  }, [addProject]);

  const handleNoteCreated = useCallback(async (filePath: string, fileName: string) => {
    try {
      await tauriApi.createFile(filePath);

      // Refresh the relevant file tree
      const ws = useWorkspaceStore.getState();
      // Check which section this belongs to
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
      // Check notes root
      const settings = useSettingsStore.getState();
      const notesRoot = settings.notesRootPath;
      if (notesRoot && filePath.startsWith(notesRoot)) {
        try {
          const tree = await tauriApi.listDirectory(notesRoot);
          ws.setNotesTree(tree);
        } catch {}
      }

      const content = await tauriApi.readFile(filePath);
      useEditorStore.getState().openTab(filePath, fileName, content);
    } catch (err) {
      console.error("Failed to create note:", err);
    }
  }, []);

  const handleNewNote = useCallback((parentPath?: string) => {
    // Determine target: explicit parent > active project root > first project > notes root
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
          target = settings.notesRootPath;
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
    // Open the file if it's not already the active tab
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

  const handleWideLayout = useCallback((layout: Record<string, number>) => {
    savePanelSizes(layout, "wide");
  }, []);

  const handleNarrowLayout = useCallback((layout: Record<string, number>) => {
    savePanelSizes(layout, "narrow");
  }, []);

  // Compute config-specific storage keys for the current panel configuration
  const wideConfigKey = layoutConfigKey("wide", [
    ...(sidebarOpen ? ["sidebar"] : []),
    "editor",
    ...(chatPanelOpen ? ["chat"] : []),
  ]);
  const narrowConfigKey = layoutConfigKey("narrow", [
    "editor-narrow",
    ...(chatPanelOpen ? ["chat-narrow"] : []),
  ]);

  // Track window width for responsive behavior
  useEffect(() => {
    const handleResize = () => {
      setIsWideMode(window.innerWidth >= BREAKPOINT_WIDE);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+F for quick open
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setQuickOpenVisible(true);
      }

      // Cmd+B for sidebar toggle
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        setSidebarOpen(!useSettingsStore.getState().sidebarOpen);
      }

      // Cmd+Shift+A for AI chat toggle
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "a") {
        e.preventDefault();
        setChatPanelOpen(!useSettingsStore.getState().chatPanelOpen);
      }

      // Cmd+, for settings
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      }

      // Cmd+Shift+E for export PDF
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "e") {
        e.preventDefault();
        // Only open if there's an active tab
        if (useEditorStore.getState().activeTabId) {
          setExportOpen(true);
        }
        return;
      }

      // Cmd+Shift+N for new project
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "n") {
        e.preventDefault();
        setNewProjectOpen(true);
        return;
      }

      // Cmd+N for new note
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        handleNewNote();
      }

      // Cmd+O for open folder
      if ((e.metaKey || e.ctrlKey) && e.key === "o") {
        e.preventDefault();
        handleOpenFolder();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleOpenFolder, handleNewNote]);

  return (
    <ThemeProvider>
      <div className="flex flex-col h-screen w-screen overflow-hidden">
        {/* Title Bar */}
        <div className="h-11 border-b border-border flex items-center justify-between px-4 shrink-0" style={{ backgroundColor: 'var(--color-card)' }}>
          <div className="flex items-center gap-2.5">
            <img src="/app-icon.svg" alt="Notesage" className="h-6 w-6 rounded-md" />
            <h1 className="text-sm font-semibold tracking-tight text-foreground">Notesage</h1>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className={cn(
                "h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors text-muted-foreground hover:text-foreground",
                sidebarOpen ? "text-foreground" : ""
              )}
              style={sidebarOpen ? { backgroundColor: 'var(--color-accent)' } : undefined}
              onMouseEnter={(e) => { if (!sidebarOpen) e.currentTarget.style.backgroundColor = 'var(--color-accent)'; }}
              onMouseLeave={(e) => { if (!sidebarOpen) e.currentTarget.style.backgroundColor = ''; }}
              title={`${sidebarOpen ? "Hide" : "Show"} Sidebar (Cmd+B)`}
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setChatPanelOpen(!chatPanelOpen)}
              className={cn(
                "h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors text-muted-foreground hover:text-foreground",
                chatPanelOpen ? "text-foreground" : ""
              )}
              style={chatPanelOpen ? { backgroundColor: 'var(--color-accent)' } : undefined}
              onMouseEnter={(e) => { if (!chatPanelOpen) e.currentTarget.style.backgroundColor = 'var(--color-accent)'; }}
              onMouseLeave={(e) => { if (!chatPanelOpen) e.currentTarget.style.backgroundColor = ''; }}
              title={`${chatPanelOpen ? "Hide" : "Show"} AI Chat (Cmd+Shift+A)`}
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => {
                if (activeTabId) {
                  setExportOpen(true);
                }
              }}
              className={cn(
                "h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors text-muted-foreground",
                activeTabId ? "hover:text-foreground" : "opacity-40 pointer-events-none"
              )}
              onMouseEnter={(e) => { if (activeTabId) e.currentTarget.style.backgroundColor = 'var(--color-accent)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
              title="Export as PDF (Cmd+Shift+E)"
            >
              <FileDown className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors text-muted-foreground hover:text-foreground"
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-accent)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
              title="Settings (Cmd+,)"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex flex-1 overflow-hidden relative">
          {isWideMode ? (
            // WIDE MODE: All panels docked and resizable
            <>
            {!sidebarOpen && (
              <div
                className="h-full shrink-0 border-r border-border flex flex-col items-center pt-3 gap-1"
                style={{ width: '40px', backgroundColor: 'var(--color-card)' }}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleOpenFolder}
                  title="Open Folder (Cmd+O)"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleNewProject}
                  title="New Project (Cmd+Shift+N)"
                >
                  <FolderPlus className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleNewNote()}
                  title="New Note (Cmd+N)"
                >
                  <FilePlus className="h-4 w-4" />
                </Button>
              </div>
            )}
            <ResizablePanelGroup orientation="horizontal" className="flex h-full w-full" onLayoutChanged={handleWideLayout}>
              {sidebarOpen && (
                <>
                  <ResizablePanel id="sidebar" defaultSize={loadPanelSize(wideConfigKey, "sidebar", 20)} minSize={200} maxSize={400}>
                    <Sidebar
                      onNewNote={handleNewNote}
                      onNewProject={handleNewProject}
                      onOpenExistingProject={handleBrowseForProject}
                      onOpenProjectSettings={handleOpenProjectSettings}
                      onMakeProject={handleMakeProject}
                      onExportFile={handleExportFile}
                    />
                  </ResizablePanel>
                  <ResizableHandle withHandle />
                </>
              )}

              <ResizablePanel id="editor" defaultSize={loadPanelSize(wideConfigKey, "editor", sidebarOpen && chatPanelOpen ? 50 : 70)} minSize={300}>
                <EditorArea onNewNote={handleNewNote} onNewProject={handleNewProject} onOpenFolder={handleOpenFolder} onOpenProject={handleOpenProject} onOpenFile={handleOpenFile} exportOpen={exportOpen} onExportOpenChange={setExportOpen} />
              </ResizablePanel>

              {chatPanelOpen && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel id="chat" defaultSize={loadPanelSize(wideConfigKey, "chat", 30)} minSize={280} maxSize={500}>
                    <ChatPanel onClose={() => setChatPanelOpen(false)} />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
            </>
          ) : (
            // NARROW MODE: Sidebar floats, content + chat are docked
            <>
              {/* Backdrop overlay - click to close sidebar */}
              {sidebarOpen && (
                <div
                  className="absolute inset-0 bg-black/20 z-[9]"
                  onClick={() => setSidebarOpen(false)}
                />
              )}

              {/* Floating Sidebar Overlay */}
              {sidebarOpen && (
                <div
                  className="absolute left-0 top-0 bottom-0 z-10 shadow-2xl"
                  style={{ width: `${SIDEBAR_FLOAT_WIDTH}px`, backgroundColor: 'var(--color-card)' }}
                >
                  <Sidebar
                    onNewNote={handleNewNote}
                    onNewProject={handleNewProject}
                    onOpenExistingProject={handleBrowseForProject}
                    onOpenProjectSettings={handleOpenProjectSettings}
                    onMakeProject={handleMakeProject}
                    onExportFile={handleExportFile}
                  />
                </div>
              )}

              {/* Collapsed sidebar strip */}
              {!sidebarOpen && (
                <div
                  className="h-full shrink-0 border-r border-border flex flex-col items-center pt-3 gap-1"
                  style={{ width: '40px', backgroundColor: 'var(--color-card)' }}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={handleOpenFolder}
                    title="Open Folder (Cmd+O)"
                  >
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={handleNewProject}
                    title="New Project (Cmd+Shift+N)"
                  >
                    <FolderPlus className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleNewNote()}
                    title="New Note (Cmd+N)"
                  >
                    <FilePlus className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {/* Content + Chat (always docked) */}
              <ResizablePanelGroup
                orientation="horizontal"
                className="flex h-full w-full"
                onLayoutChanged={handleNarrowLayout}
              >
                <ResizablePanel id="editor-narrow" minSize={300}>
                  <EditorArea onNewNote={handleNewNote} onNewProject={handleNewProject} onOpenFolder={handleOpenFolder} onOpenProject={handleOpenProject} onOpenFile={handleOpenFile} exportOpen={exportOpen} onExportOpenChange={setExportOpen} />
                </ResizablePanel>

                {chatPanelOpen && (
                  <>
                    <ResizableHandle withHandle />
                    <ResizablePanel id="chat-narrow" defaultSize={loadPanelSize(narrowConfigKey, "chat-narrow", 35)} minSize={280} maxSize={500}>
                      <ChatPanel onClose={() => setChatPanelOpen(false)} />
                    </ResizablePanel>
                  </>
                )}
              </ResizablePanelGroup>
            </>
          )}
        </div>

        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        {projectSettingsPath && (
          <ProjectSettingsDialog
            open={projectSettingsOpen}
            onOpenChange={setProjectSettingsOpen}
            projectPath={projectSettingsPath}
          />
        )}
        <QuickOpen open={quickOpenVisible} onOpenChange={setQuickOpenVisible} />
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

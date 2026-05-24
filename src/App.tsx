import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ThemeProvider } from "@/components/ThemeProvider";
import { emitCmdBarEvent } from "@/lib/cmd-bar-events";
import { emitAgentOrbEvent } from "@/lib/agent-orb-events";
import { UpdateDialog } from "@/components/UpdateDialog";
import { QuietLayout } from "@/components/QuietLayout";

// Lazy-load dialogs — these are hidden by default and only shown on demand.
const SettingsDialogV2 = lazy(() => import("@/components/settings/v2/SettingsDialogV2").then(m => ({ default: m.SettingsDialogV2 })));
const ProjectSettingsDialog = lazy(() => import("@/components/settings/ProjectSettingsDialog").then(m => ({ default: m.ProjectSettingsDialog })));
const KeyboardShortcutsDialogV2 = lazy(() => import("@/components/KeyboardShortcutsDialogV2").then(m => ({ default: m.KeyboardShortcutsDialogV2 })));
const ActionsDialog = lazy(() => import("@/components/actions/ActionsDialog").then(m => ({ default: m.ActionsDialog })));
// #128 — Sidebar-driven commit dialog. Lazy-loaded here so the
// affordance is only instantiated when the sidebar context menu
// actually fires `SIDEBAR_COMMIT_FILE_EVENT`.
const SidebarCommitDialog = lazy(() => import("@/components/git/CommitDialog").then(m => ({ default: m.CommitDialog })));
import { useActionScanner } from "@/hooks/useActionScanner";
import { useAutoUpdate } from "@/hooks/useAutoUpdate";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useProjectMetadata } from "@/hooks/useProjectMetadata";
import { useActiveProject } from "@/hooks/useActiveProject";
import { useFileOperations } from "@/hooks/useFileOperations";
import { useStartWatchers } from "@/hooks/useStartWatchers";
import { useSkillDiscovery } from "@/hooks/useSkillOperations";
import { useWindowTitle } from "@/hooks/useWindowTitle";
import { useMcpDiscovery } from "@/hooks/useMcpOperations";
import { useLocalAI } from "@/hooks/useLocalAI";
import { useSandboxViolations } from "@/hooks/useSandboxViolations";
import { useAgentTaskOperations } from "@/hooks/useAgentTaskOperations";
import { useActivityNavigation } from "@/hooks/useActivityNavigation";
import { useAppLifecycle } from "@/hooks/useAppLifecycle";
import { useTrayEvents } from "@/hooks/useTrayEvents";
import { useTraySync } from "@/hooks/useTraySync";
import { useApprovalMigrationToast } from "@/hooks/useApprovalMigrationToast";
import { useFileRenameSync } from "@/hooks/useFileRenameSync";
import { useRecentDocumentCycle } from "@/hooks/useRecentDocumentCycle";
import { useAccent } from "@/hooks/useAccent";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { useActivityStore } from "@/stores/activity-store";
import { useCommentStore, clearPartialReply } from "@/stores/comment-store";
import { useQuietSidebarStore } from "@/stores/quiet-sidebar-store";
import { tauriApi } from "@/lib/tauri";
import { log } from "@/lib/logger";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

/**
 * Close every open Radix popover / context menu / dropdown by dispatching
 * a synthetic Escape on the document. Use BEFORE opening a dialog so the
 * dialog mounts above an already-cleared overlay stack — without this,
 * the Radix sidebar context menu (`z-[60]`) would render above the
 * settings dialog (`z-50`) and the user would have to dismiss it
 * manually first. Live-test 2026-04-25 reported the case explicitly.
 */
function closeOpenMenus(): void {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
}

function openSettingsAndCloseMenus(setOpen: (open: boolean) => void): void {
  closeOpenMenus();
  // Defer the dialog mount one tick so any context menu's close
  // animation (Radix uses CSS data-state transitions) has dropped its
  // portal before the dialog's portal mounts.
  requestAnimationFrame(() => setOpen(true));
}

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [projectSettingsPath, setProjectSettingsPath] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [actionsDialogOpen, setActionsDialogOpen] = useState(false);
  // #128 — global commit dialog state for the Quiet Composer sidebar
  // context menu. Driven by `SIDEBAR_COMMIT_FILE_EVENT` from the
  // sidebar's commit affordance.
  const [commitDialogState, setCommitDialogState] = useState<{
    projectPath: string;
  } | null>(null);

  const { state: updateState, checkForUpdate, downloadAndInstall, restartNow, dismiss: dismissUpdate } = useAutoUpdate();
  const { addProject, addExplorerFolder } = useWorkspaceStore();
  const { projectPath: activeProjectPath } = useActiveProject();

  // Window focus/blur de-emphasis lives in `useWindowFocus()` (audit #17,
  // 2026-04-27 quiet-composer-migration). It is mounted from `QuietLayout`
  // — Quiet Composer only — so the desaturate effect is scoped to the
  // shell that ships beyond Phase 2.

  // --- Show main window after first themed paint (window starts hidden to prevent white flash) ---
  useEffect(() => {
    // Wait for ThemeProvider to apply the dark/light class and for Tailwind CSS
    // to be loaded (the computed background-color will change from the inline
    // fallback to the CSS variable value). Poll briefly to handle dev mode where
    // Vite serves CSS on-demand. In production the first check succeeds immediately.
    const showWhenReady = () => {
      const root = document.documentElement;
      const hasThemeClass = root.classList.contains("dark") || root.classList.contains("light");
      const bg = getComputedStyle(document.body).backgroundColor;
      const cssLoaded = bg !== "" && bg !== "rgba(0, 0, 0, 0)";
      if (hasThemeClass && cssLoaded) {
        requestAnimationFrame(() => {
          invoke("show_main_window_command").catch(() => {});
        });
      } else {
        requestAnimationFrame(showWhenReady);
      }
    };
    requestAnimationFrame(showWhenReady);
  }, []);

  // ============================================================
  // CRITICAL: All lifecycle hooks MUST remain mounted here.
  // Removing any of these will silently break features.
  // ============================================================
  useProjectMetadata();
  useStartWatchers();
  useFileRenameSync();
  useSkillDiscovery();
  // #105 — keep the OS window title in sync with the active tab
  // (e.g. "On Craft.md — Notesage"). Falls back to "Notesage" when no
  // document is active.
  useWindowTitle();
  useMcpDiscovery();
  useLocalAI();
  useSandboxViolations();
  useActionScanner();
  useTraySync();
  useApprovalMigrationToast();
  useRecentDocumentCycle();
  // Live-test 2026-04-25 #144 — without this mount the accent radio in
  // Settings > Appearance writes to settings-store but the DOM never
  // gets the `.accent-orange` / `.accent-blue` / `.accent-system`
  // class on `<html>`, so `--accent` stays unset and the chosen accent
  // never actually applies. The hook owns the class swap effect.
  useAccent();

  // Consolidated startup effects and event listeners
  useAppLifecycle();

  // Activity panel — cancel handler and navigation (forwarded to QuietLayout/AgentPanel)
  const { cancelTask } = useAgentTaskOperations();
  const { handleClickTask } = useActivityNavigation();

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

  const { openFile, openFileAtTag, openFileAtText, refreshFileTree } = useFileOperations();
  const showHiddenFiles = useSettingsStore((s) => s.showHiddenFiles);

  // Tray menu event handlers
  const handleTrayOpenFile = useCallback((path: string) => {
    const name = path.split("/").pop() ?? path;
    openFile(path, name);
  }, [openFile]);
  useTrayEvents({
    onNewNote: useCallback(() => {
      const ws = useWorkspaceStore.getState();
      const settings = useSettingsStore.getState();
      const target = ws.projects.length > 0
        ? ws.projects[0].path
        : settings.notesRootPath;
      if (target) useQuietSidebarStore.getState().setPendingCreate({ parentDir: target });
    }, []),
    onQuickNote: useCallback(() => {
      const settings = useSettingsStore.getState();
      const target = settings.notesRootPath;
      if (target) useQuietSidebarStore.getState().setPendingCreate({ parentDir: target });
    }, []),
    onOpenActions: useCallback(() => emitCmdBarEvent({ type: "focus", prefix: "!" }), []),
    onOpenFile: handleTrayOpenFile,
  });

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
                  const tree = await tauriApi.listDirectory(parentDir, useSettingsStore.getState().showHiddenFiles);
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
      }).then((fn) => { unlisten = fn; }).catch((e) => {
        log.warn("lifecycle", "Failed to register listener for open-files", e);
      });
    }).catch((e) => log.warn("lifecycle", "Failed to set up file-open listener", e));
    return () => { unlisten?.(); };
  }, [openFile, addExplorerFolder]);

  // Refresh file tree when hidden files toggle changes
  const hiddenFilesInitRef = useRef(true);
  useEffect(() => {
    if (hiddenFilesInitRef.current) {
      hiddenFilesInitRef.current = false;
      return;
    }
    refreshFileTree();
  }, [showHiddenFiles, refreshFileTree]);

  // --- Callbacks ---

  const handleOpenFolder = useCallback(async () => {
    try {
      const folderPath = await tauriApi.openFolderDialog();
      if (folderPath) {
        const isProject = await tauriApi.pathExists(`${folderPath}/.notesage`);
        const tree = await tauriApi.listDirectory(folderPath, useSettingsStore.getState().showHiddenFiles);
        if (isProject) {
          addProject(folderPath, tree);
        } else {
          // Sidebar #8 — detect ⌘O re-open of an existing folder so we
          // can fire a toast instead of silently refreshing the
          // already-tracked entry. The store dedups by canonical
          // path; we look up via the same canonical-aware selector
          // it uses internally so `/var/foo` and the macOS-canonical
          // `/private/var/foo` resolve to the same entry.
          const existing = useWorkspaceStore.getState().getExplorerFolder(folderPath);
          addExplorerFolder(folderPath, tree);
          if (existing) {
            const name = folderPath.split("/").filter(Boolean).pop() ?? folderPath;
            toast(`"${name}" is already in your sidebar`);
          }
        }
      }
    } catch (error) {
      log.error("lifecycle", "Failed to open folder", error);
      toast.error(`Failed to open folder: ${error}`);
    }
  }, [addProject, addExplorerFolder]);

  const handleOpenProject = useCallback(async (projectPath: string) => {
    try {
      const tree = await tauriApi.listDirectory(projectPath, useSettingsStore.getState().showHiddenFiles);
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

  const handleBrowseForProject = useCallback(async () => {
    try {
      const folderPath = await tauriApi.openFolderDialog();
      if (folderPath) {
        const metaDir = `${folderPath}/.notesage`;
        const dirExists = await tauriApi.pathExists(metaDir);
        if (!dirExists) {
          await tauriApi.createDirectory(metaDir);
        }
        const tree = await tauriApi.listDirectory(folderPath, useSettingsStore.getState().showHiddenFiles);
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
      const tree = await tauriApi.listDirectory(path, useSettingsStore.getState().showHiddenFiles);
      addProject(path, tree);
    } catch (error) {
      log.error("lifecycle", "Failed to make project", error);
      toast.error(`Failed to create project: ${error}`);
    }
  }, [addProject]);

  // #128 — Quiet Composer sidebar context menu fires DOM CustomEvents
  // for actions that need App-level state (commit dialog, make-project,
  // export). We listen once here and proxy to the existing handlers so
  // we don't have to prop-drill through QuietSidebar → sections →
  // SidebarContextMenu.
  // Forward-declared above; the export listener reads the current binding
  // at event-dispatch time via a ref-stable closure workaround. We can't
  // reference `handleExportFile` yet because it's declared below — a ref
  // mirror keeps the listener stable without participating in the
  // render cycle.
  const handleExportFileRef = useRef<
    ((filePath: string, fileName: string, format?: 'pdf' | 'docx' | 'pptx' | 'html') => Promise<void>) | null
  >(null);

  useEffect(() => {
    const onMakeProject = (ev: Event) => {
      const detail = (ev as CustomEvent<{ path?: string }>).detail;
      if (detail?.path) void handleMakeProject(detail.path);
    };
    const onCommitFile = (ev: Event) => {
      const detail = (ev as CustomEvent<{ filePath?: string }>).detail;
      if (!detail?.filePath) return;
      // Find the owning project so the CommitDialog has a repo root.
      const projects = useWorkspaceStore.getState().projects;
      const sorted = [...projects].sort(
        (a, b) => b.path.length - a.path.length,
      );
      const owning = sorted.find(
        (p) => detail.filePath === p.path || detail.filePath!.startsWith(p.path + "/"),
      );
      if (!owning) {
        toast.error("Commit requires the file to sit inside an open project.");
        return;
      }
      setCommitDialogState({ projectPath: owning.path });
    };
    const onExportFile = (ev: Event) => {
      const detail = (ev as CustomEvent<{ filePath?: string; format?: 'pdf' | 'docx' | 'pptx' | 'html' }>).detail;
      if (!detail?.filePath) return;
      const fileName = detail.filePath.split("/").filter(Boolean).pop() ?? detail.filePath;
      handleExportFileRef.current?.(detail.filePath, fileName, detail.format);
    };
    window.addEventListener("sidebar:make-project", onMakeProject);
    window.addEventListener("sidebar:commit-file", onCommitFile);
    window.addEventListener("sidebar:export-file", onExportFile);
    return () => {
      window.removeEventListener("sidebar:make-project", onMakeProject);
      window.removeEventListener("sidebar:commit-file", onCommitFile);
      window.removeEventListener("sidebar:export-file", onExportFile);
    };
  }, [handleMakeProject]);

  const handleNewNote = useCallback((parentPath?: string) => {
    let target = parentPath;
    if (!target) {
      if (activeProjectPath) {
        target = activeProjectPath;
      } else {
        const ws = useWorkspaceStore.getState();
        if (ws.projects.length > 0) {
          target = ws.projects[0].path;
        } else {
          target = useSettingsStore.getState().notesRootPath;
        }
      }
    }
    if (!target) return;
    useQuietSidebarStore.getState().setPendingCreate({ parentDir: target });
  }, [activeProjectPath]);

  const handleNewProject = useCallback(() => {
    useQuietSidebarStore.getState().setPendingCreateProject(true);
  }, []);

  const handleExportFile = useCallback(async (filePath: string, fileName: string, format?: 'pdf' | 'docx' | 'pptx' | 'html') => {
    if (format === 'html') {
      // Direct HTML export without opening the export dialog
      try {
        const content = await tauriApi.readFile(filePath);
        const theme = useSettingsStore.getState().theme;
        const resolvedTheme = theme === "system"
          ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
          : theme;
        const title = fileName.replace(/\.[^.]+$/, "");

        const { save } = await import("@tauri-apps/plugin-dialog");
        const defaultName = fileName.replace(/\.[^.]+$/, ".html");
        const savePath = await save({
          defaultPath: defaultName,
          filters: [{ name: "HTML", extensions: ["html", "htm"] }],
        });

        if (savePath) {
          const { invoke } = await import("@tauri-apps/api/core");
          const { presetsForBackend } = await import("@/lib/typography-presets");
          const { useEditorStylesStore } = await import("@/stores/editor-styles-store");
          const typography = presetsForBackend(useEditorStylesStore.getState().presets);
          const htmlDoc = await invoke<string>("render_html", {
            markdown: content,
            title,
            theme: resolvedTheme,
            includeStyles: true,
            projectRoot: null,
            typography,
          });
          await tauriApi.writeFile(savePath, htmlDoc);
          toast.success("HTML exported");
        }
      } catch (err) {
        toast.error(`Failed to export HTML: ${err}`);
      }
      return;
    }

    const { openDocuments, activeTabId } = useEditorStore.getState();
    const activeTab = openDocuments.find((t) => t.id === activeTabId);
    if (!activeTab || activeTab.filePath !== filePath) {
      await openFile(filePath, fileName);
    }
    if (format) {
      useSettingsStore.getState().setLastExportFormat(format);
    }
    setExportOpen(true);
  }, [openFile]);

  // #128 — Keep the CustomEvent listener's ref in sync with the latest
  // `handleExportFile` binding. Running this on every render is cheap
  // (ref write, no effect re-subscription).
  handleExportFileRef.current = handleExportFile;

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

  // Listen for global "open settings" event (used by toast actions, etc.)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ tab?: string }>).detail;
      if (detail?.tab) setSettingsInitialTab(detail.tab);
      openSettingsAndCloseMenus(setSettingsOpen);
    };
    window.addEventListener("notesage:open-settings", handler);
    return () => window.removeEventListener("notesage:open-settings", handler);
  }, []);

  // Listen for `>` palette command-bar dispatch (live-test 2026-04-26).
  // FloatingCommandBar emits `notesage:palette-command` with a stable
  // `commandId` from `PALETTE_COMMANDS`; we map ids to the same callbacks
  // plumbed through `useKeyboardShortcuts` so the chord and the palette
  // pick run identical code paths.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ commandId?: string }>).detail;
      const id = detail?.commandId;
      if (!id) return;
      switch (id) {
        case "new-note":
          handleNewNote();
          break;
        case "new-project":
          handleNewProject();
          break;
        case "export-pdf":
          setExportOpen(true);
          break;
        case "toggle-theme": {
          const s = useSettingsStore.getState();
          s.setTheme(s.theme === "dark" ? "light" : "dark");
          break;
        }
        case "toggle-sidebar": {
          const s = useSettingsStore.getState();
          s.setSidebarPinned(!s.sidebarPinned);
          break;
        }
        case "open-settings":
          openSettingsAndCloseMenus(setSettingsOpen);
          break;
        case "toggle-agent-orb":
          // Same bus the ⌘⇧A chord uses — AgentOrb's popover toggles
          // its open state when this event fires.
          emitAgentOrbEvent({ type: "toggle" });
          break;
        case "document-outline":
          setOutlineOpen(true);
          break;
        case "open-keyboard-shortcuts":
          setShortcutsOpen(true);
          break;
        default:
          // Unknown command — no-op. Logged so future palette additions
          // surface during dev if their App.tsx wire-up is missing.
          console.warn("[palette-command] no handler for", id);
      }
    };
    window.addEventListener("notesage:palette-command", handler);
    return () => window.removeEventListener("notesage:palette-command", handler);
  }, [handleNewNote, handleNewProject]);

  // Listen for `notesage:open-file` events dispatched by FloatingCommandBar
  // pickers (`?` research, `!` task, and the upcoming `#`/`@` drilldowns).
  // App-level listener routes to `openFile` from `useFileOperations`
  // without plumbing the hook through QuietLayout.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (
        e as CustomEvent<{
          filePath?: string;
          fileName?: string;
          scrollToText?: string;
        }>
      ).detail;
      if (!detail?.filePath || !detail.fileName) return;
      void openFile(
        detail.filePath,
        detail.fileName,
        undefined,
        detail.scrollToText,
      );
    };
    window.addEventListener("notesage:open-file", handler);
    return () => window.removeEventListener("notesage:open-file", handler);
  }, [openFile]);

  // Listen for `notesage:open-file-at-tag` events dispatched by the
  // FloatingCommandBar's `#` tag and `@` mention pickers. Routes to
  // `openFileAtTag` to perform the tag/mention drilldown selection.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (
        e as CustomEvent<{
          filePath?: string;
          fileName?: string;
          symbol?: string;
          occurrenceInFile?: number;
        }>
      ).detail;
      if (!detail?.filePath || !detail.fileName || !detail.symbol) return;
      void openFileAtTag(
        detail.filePath,
        detail.fileName,
        detail.symbol,
        detail.occurrenceInFile ?? 0,
      );
    };
    window.addEventListener("notesage:open-file-at-tag", handler);
    return () =>
      window.removeEventListener("notesage:open-file-at-tag", handler);
  }, [openFileAtTag]);


  useKeyboardShortcuts({
    onFindOpen: () => {
      window.dispatchEvent(new CustomEvent("notesage:find-open"));
    },
    onFindReplaceOpen: () => {
      window.dispatchEvent(new CustomEvent("notesage:find-replace-open"));
    },
    onOutlineOpen: () => setOutlineOpen(true),
    onSettingsOpen: () => openSettingsAndCloseMenus(setSettingsOpen),
    onExportOpen: () => setExportOpen(true),
    onNewProject: handleNewProject,
    onNewNote: handleNewNote,
    onOpenFolder: handleOpenFolder,
    onShortcutsOpen: () => setShortcutsOpen(true),
    onToggleRecording: () => {
      window.dispatchEvent(new CustomEvent("notesage:toggle-recording"));
    },
  });

  return (
    <ThemeProvider>
      <div className="flex h-screen w-screen overflow-hidden">
        <QuietLayout
          stripExpanded={false}
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
          onOpenActions={() => emitCmdBarEvent({ type: "focus", prefix: "!" })}
          onOpenSettings={() => openSettingsAndCloseMenus(setSettingsOpen)}
          onBrowseForProject={handleBrowseForProject}
          onOpenProjectSettings={handleOpenProjectSettings}
          onMakeProject={handleMakeProject}
          onExportFile={handleExportFile}
          onCancelTask={handleCancelTask}
          onClickTask={handleClickTask}
        />

        <Suspense fallback={null}>
          <SettingsDialogV2
            open={settingsOpen}
            onOpenChange={(open) => {
              setSettingsOpen(open);
              if (!open) setSettingsInitialTab(undefined);
            }}
            initialActiveItem={settingsInitialTab}
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
          <KeyboardShortcutsDialogV2
            open={shortcutsOpen}
            onOpenChange={setShortcutsOpen}
          />
        </Suspense>
        {/*
          #128 — Global commit dialog for the sidebar's "Commit…" menu
          item. Mounted at the App root so it survives sidebar row
          unmount / re-render cycles. Driven exclusively by the
          `sidebar:commit-file` CustomEvent.
        */}
        {commitDialogState && (
          <Suspense fallback={null}>
            <SidebarCommitDialog
              repoPath={commitDialogState.projectPath}
              open={commitDialogState !== null}
              onOpenChange={(next) => {
                if (!next) setCommitDialogState(null);
              }}
            />
          </Suspense>
        )}
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

              const { openDocuments, activeTabId } = useEditorStore.getState();
              const alreadyActive = openDocuments.some((t) => t.filePath === filePath && t.id === activeTabId);

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

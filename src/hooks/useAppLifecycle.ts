import { useEffect, useRef } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useEditorStore } from "@/stores/editor-store";
import { useSyncStore } from "@/stores/sync-store";
import { useEditorStylesStore } from "@/stores/editor-styles-store";
import { useChatStore } from "@/stores/chat-store";
import { tauriApi, type FileEntry } from "@/lib/tauri";
import { parseFrontmatter } from "@/lib/frontmatter";
import { getFileType, isBinaryFileType } from "@/lib/file-utils";
import { setBinaryData } from "@/lib/binary-cache";
import { refreshNotesTree } from "@/lib/refresh-notes-tree";
import { migrateV1AISettings } from "@/lib/ai/migration";
import { scanICloudForProjects } from "@/lib/scan-icloud-projects";
import { log, setLogLevel } from "@/lib/logger";
import { stopAcpAgent } from "@/hooks/useAIOperations";
import { stopTaskAgent } from "@/hooks/useAgentTaskOperations";
import { toast } from "sonner";
import type { PaletteMode } from "@/lib/command-palette";

interface UseAppLifecycleOptions {
  onOpenPalette: (mode: PaletteMode, drilldown: string) => void;
}

/**
 * Consolidates all App-level startup side effects and event listeners:
 *  - Tag/mention badge click → command palette
 *  - ACP cleanup on beforeunload
 *  - Visibility-change wake handler with health check
 *  - Drag/drop prevention
 *  - AI settings migration
 *  - Debug logging sync
 *  - localStorage cleanup for removed stores
 *  - Startup tree reload (reloadTrees)
 */
export function useAppLifecycle({ onOpenPalette }: UseAppLifecycleOptions) {
  // --- Tag badge click → open command palette with tag drilldown ---
  useEffect(() => {
    const handler = (e: Event) => {
      const tag = (e as CustomEvent<{ tag: string }>).detail.tag;
      onOpenPalette("tags", tag);
    };
    window.addEventListener("notesage:open-tag-search", handler);
    return () => window.removeEventListener("notesage:open-tag-search", handler);
  }, [onOpenPalette]);

  // --- Mention badge click → open command palette with mention drilldown ---
  useEffect(() => {
    const handler = (e: Event) => {
      const mention = (e as CustomEvent<{ mention: string }>).detail.mention;
      onOpenPalette("mentions", mention);
    };
    window.addEventListener("notesage:open-mention-search", handler);
    return () => window.removeEventListener("notesage:open-mention-search", handler);
  }, [onOpenPalette]);

  // --- Migrate v1 AI settings + clear orphaned stores ---
  useEffect(() => {
    migrateV1AISettings();
    localStorage.removeItem("tag-store");
    localStorage.removeItem("mention-store");
  }, []);

  // --- Sync log level to logger + Rust backend on startup ---
  useEffect(() => {
    const { logLevel } = useSettingsStore.getState();
    setLogLevel(logLevel);
    tauriApi.setLogLevel(logLevel);
  }, []);

  // --- Stop ACP agent processes on window close ---
  useEffect(() => {
    const handleBeforeUnload = () => {
      stopAcpAgent();
      stopTaskAgent();
      tauriApi.stopLocalServer().catch(() => {}); // Expected: best-effort cleanup on window close
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      handleBeforeUnload();
    };
  }, []);

  // --- Visibility-change wake handler ---
  const lastWakeCheckRef = useRef(0);
  useEffect(() => {
    let mounted = true;
    const handleVisibilityChange = async () => {
      if (document.visibilityState !== "visible") return;

      const now = Date.now();
      if (now - lastWakeCheckRef.current < 5000) return;
      lastWakeCheckRef.current = now;

      log.info("lifecycle", "App became visible, checking backend health");

      try {
        await Promise.race([
          tauriApi.ping(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("ping timeout")), 500)
          ),
        ]);
      } catch {
        // Expected: backend may be unresponsive after sleep/wake — reload recovers
        log.info("lifecycle", "Ping failed or timed out, reloading WebView");
        window.location.reload();
        return;
      }

      if (!mounted) return;

      try {
        const health = await tauriApi.healthCheck();
        log.info(
          "lifecycle",
          `Health check: watcher=${health.watcher_alive}, acp=${health.acp_agents.length}, mcp=${health.mcp_servers.length}`
        );

        if (!health.watcher_alive) {
          log.info("lifecycle", "Watcher dead, re-watching workspace paths");
          const ws = useWorkspaceStore.getState();
          for (const project of ws.projects) {
            try {
              await tauriApi.watchDirectory(project.path);
            } catch (err) {
              log.info("lifecycle", `Failed to re-watch ${project.path}: ${err}`);
            }
          }
          for (const folder of ws.explorerFolders) {
            try {
              await tauriApi.watchDirectory(folder.path);
            } catch (err) {
              log.info("lifecycle", `Failed to re-watch ${folder.path}: ${err}`);
            }
          }
        }

        const deadAcp = health.acp_agents.some((a) => !a.alive);
        const deadCopilot = health.copilot_lsp != null && !health.copilot_lsp.alive;
        const deadMcp = health.mcp_servers.some((s) => !s.alive);
        if (deadAcp || deadCopilot || deadMcp) {
          log.info("lifecycle", "Some AI processes died — they will be lazily respawned on next use");
          toast.info("Reconnected to AI services");
        }
      } catch (err) {
        log.info("lifecycle", `Health check failed: ${err}`);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      mounted = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // --- Prevent browser default drop behavior ---
  useEffect(() => {
    const preventDrop = (e: DragEvent) => {
      if (!e.defaultPrevented) {
        e.preventDefault();
      }
    };
    const preventDragOver = (e: DragEvent) => {
      if (!e.defaultPrevented) {
        e.preventDefault();
      }
    };
    document.addEventListener("drop", preventDrop);
    document.addEventListener("dragover", preventDragOver);
    return () => {
      document.removeEventListener("drop", preventDrop);
      document.removeEventListener("dragover", preventDragOver);
    };
  }, []);

  // --- Reload file trees on startup ---
  useEffect(() => {
    const STARTUP_TIMEOUT_MS = 30_000;
    let timedOut = false;

    const startupWithTimeout = async () => {
      try {
        await Promise.race([
          reloadTrees(),
          new Promise<void>((resolve) =>
            setTimeout(() => {
              timedOut = true;
              resolve();
            }, STARTUP_TIMEOUT_MS)
          ),
        ]);
      } catch (err) {
        log.error("startup", "Startup tree reload failed", err);
      } finally {
        const settings = useSettingsStore.getState();
        if (!settings.startupReady) {
          if (timedOut) {
            log.warn(
              "startup",
              `Startup timed out after ${STARTUP_TIMEOUT_MS / 1000}s — setting startupReady to unblock skill discovery`
            );
          }
          settings.setStartupReady(true);
        }
      }
    };

    startupWithTimeout();
  }, []);
}

/** Race a promise against a per-step timeout. Returns undefined on timeout. */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      log.warn("startup", `${label} timed out after ${ms / 1000}s — skipping`);
      resolve(undefined);
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Full startup tree reload — loads explorer folders, projects, iCloud,
 * Quick Notes, SQLite index, and re-opens persisted tabs.
 */
async function reloadTrees() {
  const t0 = performance.now();
  log.info("startup", "reloadTrees started");
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
      // Expected: home directory resolution may fail in sandboxed environments
      log.error("startup", "Failed to resolve home directory");
    }
  }

  // Kick off tab restoration early — file reads run concurrently with
  // tree validation, iCloud scanning, and index init below.
  const tTabs0 = performance.now();
  const tabRestorePromise = restorePersistedTabs();

  // Reload explorer folder trees (remove invalid ones)
  log.info("startup", `Validating ${ws.explorerFolders.length} explorer folders, ${ws.projects.length} projects`);
  const STEP_TIMEOUT_MS = 10_000;
  const validFolders: string[] = [];
  for (const folder of ws.explorerFolders) {
    try {
      const tree = await withTimeout(
        tauriApi.listDirectory(folder.path, settings.showHiddenFiles),
        STEP_TIMEOUT_MS,
        `listDirectory(${folder.path.split('/').pop()})`,
      );
      if (tree) {
        ws.updateExplorerTree(folder.path, tree);
        validFolders.push(folder.path);
      } else {
        validFolders.push(folder.path); // Keep on timeout — don't remove
      }
    } catch {
      // Expected: folder no longer exists — will be removed below
    }
  }
  for (const folder of ws.explorerFolders) {
    if (!validFolders.includes(folder.path)) {
      ws.removeExplorerFolder(folder.path);
    }
  }

  // Reload all project trees
  for (const project of ws.projects) {
    try {
      const tree = await withTimeout(
        tauriApi.listDirectory(project.path, settings.showHiddenFiles),
        STEP_TIMEOUT_MS,
        `listDirectory(${project.path.split('/').pop()})`,
      );
      if (tree) {
        ws.updateProjectTree(project.path, tree);
      }
      // On timeout: keep the project, just skip tree refresh
    } catch {
      // Expected: project directory may have been deleted or moved
      const projectName = project.path.split('/').pop() || project.path;
      ws.removeProject(project.path);
      toast.warning(`Project "${projectName}" was removed — directory no longer exists`);
    }
  }

  {
    const wsNow = useWorkspaceStore.getState();
    const totalFiles = wsNow.explorerFolders.length + wsNow.projects.length;
    console.log('[perf:startup] trees validated', {
      projects: wsNow.projects.length,
      folders: wsNow.explorerFolders.length,
      totalFiles,
      ms: Math.round(performance.now() - t0),
    });
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
      // Expected: notes root creation may fail on first launch (permissions, path issues)
    }
  }

  // Load editor typography settings from disk
  if (notesRoot) {
    await useEditorStylesStore.getState().loadSettings(notesRoot);
  }

  // Load system fonts for font picker (non-blocking)
  useEditorStylesStore.getState().loadSystemFonts();

  // Detect iCloud availability
  log.info("startup", `Trees validated in ${Math.round(performance.now() - t0)}ms, starting iCloud detection`);
  try {
    const icloudRoot = await tauriApi.getICloudPath();
    if (icloudRoot) {
      const icloudNotesagePath = `${icloudRoot}/Notesage`;
      settings.setICloudAvailable(true);
      settings.setICloudNotesagePath(icloudNotesagePath);
    }
  } catch {
    // Expected: iCloud path unavailable on non-Apple systems or when iCloud is not set up
  }

  // Load sync settings from disk
  if (notesRoot) {
    const syncStore = useSyncStore.getState();
    await syncStore.loadSettings(notesRoot);

    if (syncStore.icloudEnabled) {
      const icloudNotesagePath = settings.icloudNotesagePath;
      if (!icloudNotesagePath || !settings.icloudAvailable) {
        syncStore.setICloudEnabled(false);
        await syncStore.saveSettings(notesRoot);
        toast.info("iCloud is no longer available. Sync has been disabled.");
      } else {
        for (const syncedPath of syncStore.syncedProjectPaths) {
          try {
            const tree = await withTimeout(
              tauriApi.listDirectory(syncedPath, settings.showHiddenFiles),
              STEP_TIMEOUT_MS,
              `listDirectory(synced:${syncedPath.split('/').pop()})`,
            );
            if (tree) {
              ws.addProject(syncedPath, tree);
            }
            // On timeout: skip this synced project but don't remove it
          } catch {
            // Expected: synced project directory may have been removed from iCloud
            syncStore.removeSyncedProject(syncedPath);
          }
        }

        try {
          await withTimeout(
            (async () => {
              const found = await scanICloudForProjects(icloudNotesagePath);
              if (found) {
                await syncStore.saveSettings(notesRoot);
              }
            })(),
            STEP_TIMEOUT_MS,
            "scanICloudForProjects",
          );
        } catch {
          // Expected: iCloud scan may fail if cloud storage is temporarily unavailable
        }

        await syncStore.saveSettings(notesRoot);
      }
    }
  }

  // Prune stale project paths from chat conversations
  {
    const wsNow = useWorkspaceStore.getState();
    const validProjectPaths = new Set([
      ...wsNow.projects.map((p) => p.path),
      ...wsNow.explorerFolders.map((f) => f.path),
    ]);
    useChatStore.getState().pruneStaleProjectPaths(validProjectPaths);
  }

  // Load Quick Notes tree
  log.info("startup", `iCloud/sync complete in ${Math.round(performance.now() - t0)}ms, loading notes tree`);
  await refreshNotesTree();

  // Initialize the SQLite document index
  log.info("startup", `Notes tree loaded in ${Math.round(performance.now() - t0)}ms, initializing index`);
  try {
    const tIndex0 = performance.now();
    await tauriApi.indexInit();
    const projectsForIndex = useWorkspaceStore.getState().projects;
    for (const project of projectsForIndex) {
      const tProjectIndex0 = performance.now();
      await tauriApi.indexInit(project.path);
      const projectTree = useWorkspaceStore.getState().projects.find(p => p.path === project.path);
      const fileCount = countFiles(projectTree?.fileTree);
      console.log('[perf:startup] index init', {
        project: project.path,
        fileCount,
        ms: Math.round(performance.now() - tProjectIndex0),
      });
    }
    console.log('[perf:startup] index init total', {
      ms: Math.round(performance.now() - tIndex0),
    });
  } catch (error) {
    log.error("lifecycle", "Failed to initialize index", error);
  }

  // Signal that startup tree validation is complete
  log.info("startup", `Startup complete in ${Math.round(performance.now() - t0)}ms, setting startupReady`);
  settings.setStartupReady(true);
  console.log('[perf:startup] ready', { totalMs: Math.round(performance.now() - t0) });

  // Wait for tab restoration (started earlier, runs concurrently with above)
  await tabRestorePromise;
  const editorState = useEditorStore.getState();
  const activeTabForLog = editorState.tabs.find(t => t.id === editorState.activeTabId);
  console.log('[perf:startup] tabs restored', {
    tabCount: editorState.tabs.length,
    activeTab: activeTabForLog?.filePath ?? null,
    ms: Math.round(performance.now() - tTabs0),
  });
}

/**
 * Restore persisted tabs by reading their files from disk.
 * Called early in startup so file reads run concurrently with tree validation.
 */
async function restorePersistedTabs() {
  const { persistedTabs, persistedActiveFilePath } = useEditorStore.getState();
  if (persistedTabs.length === 0) return;

  // Phase 1: Create ALL tabs as placeholders in their persisted order so the
  // tab bar renders with correct ordering immediately. Then load the active
  // tab's content so the editor has something to render.
  const store = useEditorStore.getState();
  for (const pt of persistedTabs) {
    store.openTabPlaceholder(pt.filePath, pt.fileName, getFileType(pt.fileName));
  }

  // Find and activate the previously active tab, loading its content from disk
  const activePersistedTab = persistedTabs.find((pt) => pt.filePath === persistedActiveFilePath);
  if (activePersistedTab) {
    const { filePath, fileName } = activePersistedTab;
    const activeTab = useEditorStore.getState().tabs.find((t) => t.filePath === filePath);
    if (activeTab) {
      useEditorStore.getState().setActiveTab(activeTab.id);
      try {
        const fileType = getFileType(fileName);
        if (fileType === "image") {
          useEditorStore.getState().loadTabContent(activeTab.id, "");
        } else if (isBinaryFileType(fileType)) {
          const bytes = await tauriApi.readBinaryFile(filePath);
          setBinaryData(filePath, new Uint8Array(bytes));
          useEditorStore.getState().loadTabContent(activeTab.id, "");
        } else {
          const raw = await tauriApi.readFile(filePath);
          if (fileType === "markdown") {
            const { frontmatter, content } = parseFrontmatter(raw);
            useEditorStore.getState().loadTabContent(activeTab.id, content, frontmatter);
          } else {
            useEditorStore.getState().loadTabContent(activeTab.id, raw);
          }
        }
      } catch {
        // Expected: active tab file may have been deleted since last session — user sees empty state
      }
    }
  }

  // Phase 2: Background tabs load on demand when the user clicks them.
}

/** Recursively count files (non-directories) in a FileEntry tree. */
function countFiles(entries: FileEntry[] | undefined): number {
  if (!entries) return 0;
  let count = 0;
  for (const entry of entries) {
    if (entry.is_directory) {
      count += countFiles(entry.children);
    } else {
      count += 1;
    }
  }
  return count;
}


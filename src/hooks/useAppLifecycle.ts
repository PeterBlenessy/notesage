import { useEffect, useRef } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useEditorStore } from "@/stores/editor-store";
import { useSyncStore } from "@/stores/sync-store";
import { useEditorStylesStore } from "@/stores/editor-styles-store";
import { useChatStore } from "@/stores/chat-store";
import { tauriApi } from "@/lib/tauri";
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
      tauriApi.stopLocalServer().catch(() => {});
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
        log.info("lifecycle", "Ping failed or timed out, reloading WebView");
        window.location.reload();
        return;
      }

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
    reloadTrees();
  }, []);
}

/**
 * Full startup tree reload — loads explorer folders, projects, iCloud,
 * Quick Notes, SQLite index, and re-opens persisted tabs.
 */
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
      log.error("startup", "Failed to resolve home directory");
    }
  }

  // Kick off tab restoration early — file reads run concurrently with
  // tree validation, iCloud scanning, and index init below.
  const tabRestorePromise = restorePersistedTabs();

  // Reload explorer folder trees (remove invalid ones)
  const validFolders: string[] = [];
  for (const folder of ws.explorerFolders) {
    try {
      const tree = await tauriApi.listDirectory(folder.path);
      ws.updateExplorerTree(folder.path, tree);
      validFolders.push(folder.path);
    } catch {
      // Folder no longer exists — will be removed below
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

  // Load editor typography settings from disk
  if (notesRoot) {
    await useEditorStylesStore.getState().loadSettings(notesRoot);
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

    if (syncStore.icloudEnabled) {
      const icloudNotesagePath = settings.icloudNotesagePath;
      if (!icloudNotesagePath || !settings.icloudAvailable) {
        syncStore.setICloudEnabled(false);
        await syncStore.saveSettings(notesRoot);
        toast.info("iCloud is no longer available. Sync has been disabled.");
      } else {
        for (const syncedPath of syncStore.syncedProjectPaths) {
          try {
            const tree = await tauriApi.listDirectory(syncedPath);
            ws.addProject(syncedPath, tree);
          } catch {
            syncStore.removeSyncedProject(syncedPath);
          }
        }

        try {
          const found = await scanICloudForProjects(icloudNotesagePath);
          if (found) {
            await syncStore.saveSettings(notesRoot);
          }
        } catch {
          // iCloud scan failed, non-critical
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
  await refreshNotesTree();

  // Initialize the SQLite document index
  try {
    await tauriApi.indexInit();
    for (const project of useWorkspaceStore.getState().projects) {
      await tauriApi.indexInit(project.path);
    }
  } catch (error) {
    log.error("lifecycle", "Failed to initialize index", error);
  }

  // Signal that startup tree validation is complete
  settings.setStartupReady(true);

  // Wait for tab restoration (started earlier, runs concurrently with above)
  await tabRestorePromise;
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
        // Active tab failed to load — user will see empty state
      }
    }
  }

  // Phase 2: Background tabs load on demand when the user clicks them.
}


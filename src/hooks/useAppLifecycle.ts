import { useEffect, useRef } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useEditorStore } from "@/stores/editor-store";
import { useEditorStylesStore } from "@/stores/editor-styles-store";
import { useChatStore } from "@/stores/chat-store";
import { tauriApi, type FileEntry } from "@/lib/tauri";
import { parseFrontmatter } from "@/lib/frontmatter";
import { getFileType, isBinaryFileType } from "@/lib/file-utils";
import { setBinaryData } from "@/lib/binary-cache";
import { refreshNotesTree } from "@/lib/refresh-notes-tree";
import { backfillSidecarOriginalPaths } from "@/lib/backfill-sidecar-paths";
import { recoverIncompleteTransactions } from "@/lib/rename-transaction";
import { migrateUserContentPathsForFolders } from "@/lib/migrate-user-content-paths";
import { migrateV1AISettings } from "@/lib/ai/migration";
import { scanICloudForProjects } from "@/lib/scan-icloud-projects";
import { log, setLogLevel } from "@/lib/logger";
import { stopAcpAgent } from "@/hooks/useAIOperations";
import { stopTaskAgent } from "@/hooks/useAgentTaskOperations";
import { emitCmdBarEvent } from "@/lib/cmd-bar-events";
import { track, coarseOs } from "@/lib/telemetry";
import { toastTelemetryNotice } from "@/lib/notifications";
import { toast } from "sonner";

/**
 * Consolidates all App-level startup side effects and event listeners:
 *  - Tag/mention badge click → cmd-bar drilldown
 *  - ACP cleanup on beforeunload
 *  - Visibility-change wake handler with health check
 *  - Drag/drop prevention
 *  - AI settings migration
 *  - Debug logging sync
 *  - localStorage cleanup for removed stores
 *  - Startup tree reload (reloadTrees)
 */
export function useAppLifecycle() {
  // --- Tag badge click → cmd bar ---
  // In-document `#tag` clicks fire `notesage:open-tag-search`. Quiet Composer
  // is the only shell, so we always emit to the FloatingCommandBar.
  useEffect(() => {
    const handler = (e: Event) => {
      const tag = (e as CustomEvent<{ tag: string }>).detail.tag;
      emitCmdBarEvent({
        type: "focus",
        prefix: "#",
        drilldown: { kind: "tag", name: tag },
      });
    };
    window.addEventListener("notesage:open-tag-search", handler);
    return () => window.removeEventListener("notesage:open-tag-search", handler);
  }, []);

  // --- Mention badge click → cmd bar ---
  useEffect(() => {
    const handler = (e: Event) => {
      const mention = (e as CustomEvent<{ mention: string }>).detail.mention;
      emitCmdBarEvent({
        type: "focus",
        prefix: "@",
        drilldown: { kind: "mention", name: mention },
      });
    };
    window.addEventListener("notesage:open-mention-search", handler);
    return () => window.removeEventListener("notesage:open-mention-search", handler);
  }, []);

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

  // --- Telemetry: app_launched event + alpha first-run/channel notice ---
  // Fires once on startup, after settings have rehydrated from localStorage
  // (Zustand persist rehydrates synchronously, so getState() here is current).
  // `track` is a no-op when the effective usage flag is off, so the event is
  // self-gated; the notice only appears on the alpha channel and only once.
  const telemetryRanRef = useRef(false);
  useEffect(() => {
    if (telemetryRanRef.current) return;
    telemetryRanRef.current = true;

    const settings = useSettingsStore.getState();
    const channel = settings.releaseChannel === "alpha" ? "alpha" : "stable";
    const version =
      typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

    track("app_launched", { version, os: coarseOs(), channel });

    if (channel === "alpha" && !settings.telemetryNoticeSeen) {
      toastTelemetryNotice({
        onOpenSettings: () =>
          window.dispatchEvent(
            new CustomEvent("notesage:open-settings", {
              detail: { tab: "system" },
            }),
          ),
      });
      // Read the setter from the live store rather than the captured snapshot,
      // so this stays correct if the persist storage adapter ever goes async.
      useSettingsStore.getState().setTelemetryNoticeSeen(true);
    }
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
  // Guard against `React.StrictMode`'s dev-only double-invocation of
  // empty-deps effects. Without this, `reloadTrees()` (and its per-project
  // `index init` Promise.all) runs TWICE on every dev cold-start, doubling
  // the perceived startup time. Production is unaffected — StrictMode
  // double-invoke is dev-only — but the dev cost is real, and the
  // workload here is genuinely once-per-process (DB init, tree validation,
  // tab restoration), not a candidate for "tolerate the double-fire and
  // make it idempotent." Live-test 2026-04-26.
  const startupRanRef = useRef(false);
  useEffect(() => {
    if (startupRanRef.current) return;
    startupRanRef.current = true;

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
        if (!settings.skillsReady) {
          settings.setSkillsReady(true);
        }
        if (!settings.startupReady) {
          if (timedOut) {
            log.warn(
              "startup",
              `Startup timed out after ${STARTUP_TIMEOUT_MS / 1000}s — setting startupReady to unblock watchers`
            );
          }
          settings.setStartupReady(true);
        }
      }
    };

    startupWithTimeout();
  }, []);

  // Mid-session iCloud detection used to live here as a separate
  // useEffect that subscribed to workspace-store changes and called
  // detectProjectICloudSync() on every newly-added project. It's been
  // removed — sync state is now derived purely from `path.startsWith
  // (icloudNotesagePath + "/")`, so adding a project under iCloud
  // Notesage automatically appears synced (cloud badge, settings UI)
  // without any side-effect step. There is no longer an "enable iCloud
  // sync" global toggle to consult or prompt for.
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
// Exported for direct testing of the iCloud detection branch (the
// regression-lock test for the stale-snapshot bug fixed in this file).
// Production callers go through `useAppLifecycle()`.
export async function reloadTrees() {
  const t0 = performance.now();
  log.info("startup", "reloadTrees started");
  const ws = useWorkspaceStore.getState();
  const settings = useSettingsStore.getState();

  // Resolve home directory and ~ in notes root path
  let notesRoot = settings.notesRootPath;
  try {
    const homeDir = await tauriApi.getHomeDir();
    settings.setHomeDir(homeDir);
    if (notesRoot.startsWith("~")) {
      notesRoot = notesRoot.replace("~", homeDir);
      settings.setNotesRootPath(notesRoot);
    }
  } catch {
    // Expected: home directory resolution may fail in sandboxed environments
    log.error("startup", "Failed to resolve home directory");
  }

  // Signal that skill discovery can start — it only needs home dir and
  // project paths (already available from persisted state), not tree validation.
  settings.setSkillsReady(true);

  // Kick off tab restoration early — file reads run concurrently with
  // tree validation, iCloud scanning, and index init below.
  const tTabs0 = performance.now();
  const tabRestorePromise = restorePersistedTabs();

  // Reload explorer folder trees and project trees in parallel
  log.info("startup", `Validating ${ws.explorerFolders.length} explorer folders, ${ws.projects.length} projects`);
  const STEP_TIMEOUT_MS = 10_000;

  const [folderResults] = await Promise.all([
    // Explorer folders — all in parallel
    Promise.all(ws.explorerFolders.map(async (folder) => {
      try {
        const tree = await withTimeout(
          tauriApi.listDirectory(folder.path, settings.showHiddenFiles),
          STEP_TIMEOUT_MS,
          `listDirectory(${folder.path.split('/').pop()})`,
        );
        if (tree) {
          ws.updateExplorerTree(folder.path, tree);
        }
        return { path: folder.path, valid: true }; // Keep on success or timeout
      } catch {
        return { path: folder.path, valid: false };
      }
    })),
    // Projects — all in parallel
    Promise.all(ws.projects.map(async (project) => {
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
    })),
  ]);

  // Remove invalid explorer folders
  for (const result of folderResults) {
    if (!result.valid) {
      ws.removeExplorerFolder(result.path);
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

  // Detect iCloud availability. Compute the truth locally instead of
  // re-reading useSettingsStore.getState() afterwards — `settings` above
  // is a stale snapshot, and reading `settings.icloudAvailable` later in
  // this function returns `false` even though we just mutated the store.
  // (PR #84 hit the same shape of bug for useSyncStore and fixed THAT
  // store but not this one — the iCloud-disabled-on-reload regression.)
  log.info("startup", `Trees validated in ${Math.round(performance.now() - t0)}ms, starting iCloud detection`);
  let icloudAvailable = false;
  let icloudNotesagePath: string | null = null;
  try {
    const icloudRoot = await tauriApi.getICloudPath();
    if (icloudRoot) {
      icloudNotesagePath = `${icloudRoot}/Notesage`;
      icloudAvailable = true;
      settings.setICloudAvailable(true);
      settings.setICloudNotesagePath(icloudNotesagePath);
    }
  } catch {
    // Expected: iCloud path unavailable on non-Apple systems or when iCloud is not set up
  }

  // Scan iCloud Notesage for projects that arrived via iCloud sync
  // from other devices. The previous "load sync settings + iterate
  // syncedProjectPaths + addProject" loop is gone — synced projects
  // are already in `ws.projects` from the persisted workspace state
  // (their paths happen to start with the iCloud Notesage path), and
  // the regular tree-validation loop above already refreshed them.
  // What remains is the cross-device discovery scan: find any project
  // folder under iCloud Notesage that ISN'T already in the workspace
  // and add it.
  if (icloudAvailable && icloudNotesagePath) {
    try {
      await withTimeout(
        scanICloudForProjects(icloudNotesagePath),
        STEP_TIMEOUT_MS,
        "scanICloudForProjects",
      );
    } catch {
      // Expected: iCloud scan may fail if cloud storage is temporarily unavailable
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

  // One-time backfill: add originalPath to path-keyed comment sidecars that predate issue #117.
  {
    const notesRoot = useSettingsStore.getState().notesRootPath;
    const isValidNotesRoot = notesRoot != null && notesRoot.length > 0 && !notesRoot.startsWith("~");
    if (isValidNotesRoot) {
      const projectRoots = new Set(useWorkspaceStore.getState().projects.map((p) => p.path));
      const flatten = (entries: FileEntry[]): string[] => {
        const out: string[] = [];
        for (const e of entries) {
          if (e.is_directory && e.children) {
            out.push(...flatten(e.children));
          } else if (!e.is_directory) {
            out.push(e.path);
          }
        }
        return out;
      };
      const notesTree = useWorkspaceStore.getState().notesTree ?? [];
      const mdFilePaths = flatten(notesTree).filter(
        (p) => p.endsWith(".md") && !Array.from(projectRoots).some((pr) => p.startsWith(pr + "/")),
      );
      void backfillSidecarOriginalPaths(notesRoot!, mdFilePaths).catch(() => {});
    }
  }

  // Recover any incomplete rename transactions left by a previous crash.
  // Must run after the notes root is validated and the notes tree is loaded,
  // but before setting startupReady (so the watcher does not start emitting
  // events for staging files that are still being cleaned up).
  {
    const notesRoot = useSettingsStore.getState().notesRootPath;
    const isValidNotesRoot = notesRoot != null && notesRoot.length > 0 && !notesRoot.startsWith("~");
    if (isValidNotesRoot) {
      try {
        await recoverIncompleteTransactions(notesRoot!);
      } catch (err) {
        log.warn("startup", `rename transaction recovery failed: ${err}`);
      }
    }
  }

  // Initialize the SQLite document index.
  // If init fails (corrupted DB), auto-recover by deleting the DB and retrying.
  log.info("startup", `Notes tree loaded in ${Math.round(performance.now() - t0)}ms, initializing index`);
  try {
    const tIndex0 = performance.now();
    await initIndexWithRecovery();
    const projectsForIndex = useWorkspaceStore.getState().projects;
    await Promise.all(projectsForIndex.map(async (project) => {
      const tProjectIndex0 = performance.now();
      await initIndexWithRecovery(project.path);
      const projectTree = useWorkspaceStore.getState().projects.find(p => p.path === project.path);
      const fileCount = countFiles(projectTree?.fileTree);
      console.log('[perf:startup] index init', {
        project: project.path,
        fileCount,
        ms: Math.round(performance.now() - tProjectIndex0),
      });
    }));
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

  // One-time migration: move user content out of hidden .notesage/ subdirectories
  // into user-visible sibling folders (issue #172). Fire-and-forget — must not
  // block the startup path or prevent tab restoration.
  {
    const { projects, explorerFolders } = useWorkspaceStore.getState();
    const notesRoot = useSettingsStore.getState().notesRootPath;
    const allFolders = [
      ...projects.map((p) => p.path),
      // `explorerFolders` are ExplorerFolder objects, not strings — map to the
      // path or each entry reaches the Rust command as `[object Object]` and is
      // rejected ("invalid type: map, expected a string").
      ...explorerFolders.map((f) => f.path),
      ...(notesRoot && !notesRoot.startsWith("~") ? [notesRoot] : []),
    ].filter(Boolean);
    void migrateUserContentPathsForFolders(allFolders).catch(() => {});
  }

  // Wait for tab restoration (started earlier, runs concurrently with above)
  await tabRestorePromise;
  const editorState = useEditorStore.getState();
  const activeTabForLog = editorState.openDocuments.find(t => t.id === editorState.activeTabId);
  console.log('[perf:startup] tabs restored', {
    tabCount: editorState.openDocuments.length,
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
    const activeTab = useEditorStore.getState().openDocuments.find((t) => t.filePath === filePath);
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
/**
 * Initialize the index for a scope, with auto-recovery on failure.
 * If init fails (corrupted DB), deletes the DB files and retries once.
 * Shows a toast during recovery so the user knows tags/mentions may be
 * temporarily unavailable.
 */
async function initIndexWithRecovery(projectPath?: string): Promise<void> {
  try {
    await tauriApi.indexInit(projectPath);
  } catch (firstError) {
    const scope = projectPath ?? "global";
    log.warn("lifecycle", `Index init failed for ${scope}, attempting recovery`, firstError);

    // Delete corrupted DB and retry
    toast.info("Rebuilding search index — tags and mentions will be available shortly", {
      id: `index-recovery-${scope}`,
    });
    try {
      await tauriApi.indexReset(projectPath);
      await tauriApi.indexInit(projectPath);
      toast.dismiss(`index-recovery-${scope}`);
    } catch (retryError) {
      log.error("lifecycle", `Index recovery failed for ${scope}`, retryError);
      toast.error(
        "An unexpected error occurred while rebuilding the search index. " +
        "Tag and mention suggestions will be unavailable until the app is restarted. " +
        "If this persists, please share the app logs and report the issue on GitHub.",
        { id: `index-recovery-${scope}`, duration: 15000 },
      );
    }
  }
}

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


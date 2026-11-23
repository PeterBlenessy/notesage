import { useEffect, useRef } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useEditorStore } from "@/stores/editor-store";
import { useEditorStylesStore } from "@/stores/editor-styles-store";
import { useChatStore } from "@/stores/chat-store";
import { tauriApi, type ContainerAccess, type FileEntry } from "@/lib/tauri";
import { parseFrontmatter } from "@/lib/frontmatter";
import { getFileType, isBinaryFileType } from "@/lib/file-utils";
import { setBinaryData } from "@/lib/binary-cache";
import { refreshNotesTree } from "@/lib/refresh-notes-tree";
import { backfillSidecarOriginalPaths } from "@/lib/backfill-sidecar-paths";
import { recoverIncompleteTransactions } from "@/lib/rename-transaction";
import { migrateUserContentPathsForFolders } from "@/lib/migrate-user-content-paths";
import { migrateV1AISettings } from "@/lib/ai/migration";
import { resolveSyncedLibraryRoot, type LibraryRootKind } from "@/lib/library-root";
import { followLibraryMove } from "@/lib/library-follow-apply";
import { isHeldPath } from "@/lib/library-follow";
import { classifyMissingMarker, type MarkerAbsence } from "@/lib/library-marker-state";
import { scanICloudForProjects } from "@/lib/scan-icloud-projects";
import { log, setLogLevel, PERF } from "@/lib/logger";
import { countFiles } from "@/lib/file-utils";
import { stopAllAcpAgents } from "@/hooks/useAIOperations";
import { stopTaskAgent } from "@/hooks/useAgentTaskOperations";
import { emitCmdBarEvent } from "@/lib/cmd-bar-events";
import { toast } from "sonner";
import { t } from '@/lib/i18n';

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

  // --- Stop ACP agent processes on window close ---
  useEffect(() => {
    const handleBeforeUnload = () => {
      stopAllAcpAgents();
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
          toast.info(t("toast.reconnectedAi"));
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

/** How long startup waits for iCloud to hand over the library marker. */
const MARKER_DOWNLOAD_POLLS = 6;
const MARKER_DOWNLOAD_POLL_MS = 500;

/** True only when the path is confirmed absent; a failed check is "not sure". */
export async function isConfirmedMissing(path: string): Promise<boolean> {
  try {
    return !(await tauriApi.pathExists(path));
  } catch {
    return false;
  }
}

interface SyncedLibrary {
  icloudAvailable: boolean;
  icloudNotesagePath: string | null;
  kind: LibraryRootKind | null;
  /** This Mac's `iCloud Drive/Notesage`, whether or not it is the live root. */
  cloudDocsRoot: string | null;
  /** The container exists here but macOS will not let the app read it. */
  containerDenied: boolean;
  /** Set when the marker read came back empty for a reason other than "there is none". */
  markerUncertain: Exclude<MarkerAbsence, "absent"> | null;
  /** Roots under which an unreadable project is kept rather than removed. */
  holdRoots: string[];
}

/**
 * Work out which synced library is live and publish it to the settings store.
 *
 * Computes the truth locally instead of re-reading useSettingsStore later —
 * a snapshot taken at the top of `reloadTrees` is stale once this mutates the
 * store. (PR #84 hit the same shape of bug; the iCloud-disabled-on-reload
 * regression.)
 */
async function detectSyncedLibrary(stepTimeoutMs: number): Promise<SyncedLibrary> {
  const settings = useSettingsStore.getState();
  const result: SyncedLibrary = {
    icloudAvailable: false,
    icloudNotesagePath: null,
    kind: null,
    cloudDocsRoot: null,
    containerDenied: false,
    markerUncertain: null,
    holdRoots: [],
  };
  try {
    // There are now two places a synced library can live: today's
    // `iCloud Drive/Notesage`, and Notesage's own iCloud container, which the
    // phone can create without anyone picking a folder. Both can exist at
    // once — during a migration they must — so the marker decides which is
    // live, not the directories. `resolveSyncedLibraryRoot` holds the rule;
    // this reads the inputs it needs.
    const icloudRoot = await tauriApi.getICloudPath();
    const cloudDocsRoot = icloudRoot ? `${icloudRoot}/Notesage` : null;
    result.cloudDocsRoot = cloudDocsRoot;
    // Each container lookup is separately defensive. Whatever the answer,
    // failing to get one must leave today's CloudDocs library exactly as it
    // was — a backend without these commands, or an iCloud hiccup, is not a
    // reason for a Mac to lose its library at startup.
    let containerRoot: string | null = null;
    let marker: Awaited<ReturnType<typeof tauriApi.readLibraryMarker>> = null;
    let containerAccess: ContainerAccess | undefined;
    try {
      containerRoot =
        (await withTimeout(
          tauriApi.getLibraryContainerPath(),
          stepTimeoutMs,
          "getLibraryContainerPath",
        )) ?? null;
      if (containerRoot) {
        // Asked BEFORE trusting anything read from the container. Startup
        // used to skip this, so a Mac macOS would not let read the folder
        // could still pick it — and every listing in it then failed in
        // silence, which looked like the library had been emptied.
        try {
          containerAccess = await withTimeout(
            tauriApi.libraryContainerAccess(),
            stepTimeoutMs,
            "libraryContainerAccess",
          );
        } catch {
          containerAccess = undefined;
        }
        if (containerAccess !== "denied") {
          marker =
            (await withTimeout(
              tauriApi.readLibraryMarker(containerRoot),
              stepTimeoutMs,
              "readLibraryMarker",
            )) ?? null;
          if (!marker) {
            // "No marker" is only believed once the file is confirmed absent.
            // An `.icloud` placeholder or an unreadable file used to read as
            // "not migrated", which skipped the follow below and removed
            // every project that had moved with the library.
            const deps = {
              pathExists: (p: string) => tauriApi.pathExists(p),
              readFile: (p: string) => tauriApi.readFile(p),
            };
            let why = await classifyMissingMarker(containerRoot, deps);
            if (why === "pending") {
              // Ask iCloud for it and give it a few seconds; this is one
              // small file, and having it settles the question properly.
              const file = `${containerRoot}/.notesage/library.json`;
              void tauriApi.icloudEnsureDownloaded(file).catch(() => {});
              for (let attempt = 0; attempt < MARKER_DOWNLOAD_POLLS && !marker; attempt++) {
                await new Promise((r) => setTimeout(r, MARKER_DOWNLOAD_POLL_MS));
                marker = (await tauriApi.readLibraryMarker(containerRoot).catch(() => null)) ?? null;
              }
              if (marker) why = "absent";
            }
            if (!marker && why !== "absent") {
              result.markerUncertain = why;
              log.warn("startup", `Library marker is ${why}; keeping unreadable library projects`);
            }
          }
        }
      }
    } catch (err) {
      log.warn("startup", `Could not inspect Notesage's iCloud folder: ${err}`);
      containerRoot = null;
      marker = null;
    }
    result.containerDenied = containerAccess === "denied";
    result.holdRoots = result.containerDenied
      ? [cloudDocsRoot].filter((r): r is string => Boolean(r))
      : result.markerUncertain
        ? [cloudDocsRoot, containerRoot].filter((r): r is string => Boolean(r))
        : [];
    // "Has content" ignores `.DS_Store`: Finder leaves one in any folder a
    // person merely opened, and counting it would keep a phone-first user
    // pinned to an empty CloudDocs root for ever.
    // Only worth asking when there is a readable container to prefer over
    // it: otherwise the answer cannot change the outcome, and this is a
    // directory listing on a cloud path in the startup budget.
    let cloudDocsHasContent = Boolean(cloudDocsRoot);
    if (cloudDocsRoot && containerRoot && !result.containerDenied) {
      try {
        // Timed out like every other cloud-touching step here, and — when it
        // fails or is slow — assumed to HAVE content. That default is the
        // safe one: reading a slow or transiently-empty listing as "empty"
        // would switch a Mac with a real CloudDocs library over to a
        // near-empty container for the session.
        const entries = await withTimeout(
          tauriApi.listDirectory(cloudDocsRoot),
          stepTimeoutMs,
          "listDirectory(cloudDocs)",
        );
        if (!entries) throw new Error("timed out");
        cloudDocsHasContent = entries.some((e) => e.name !== ".DS_Store");
      } catch {
        cloudDocsHasContent = true;
      }
    }
    const resolved = resolveSyncedLibraryRoot({
      containerRoot,
      cloudDocsRoot,
      marker,
      containerAccess,
      cloudDocsHasContent,
    });
    settings.setLibraryContainerDenied(result.containerDenied);
    settings.setLibraryHoldRoots(result.holdRoots);
    if (resolved.path) {
      result.icloudAvailable = true;
      result.icloudNotesagePath = resolved.path;
      result.kind = resolved.kind;
      settings.setICloudAvailable(true);
      settings.setICloudNotesagePath(resolved.path);
      settings.setLibraryRootKind(resolved.kind);
      log.info("startup", `Library root: ${resolved.kind} at ${resolved.path}`);
    }
  } catch (err) {
    // NOT expected: off macOS the command answers `null` rather than throwing,
    // so anything landing here is a real failure. It used to be swallowed,
    // and the sidebar came up empty with nothing in the log to say why.
    log.warn("startup", `Synced library detection failed: ${err}`);
  }
  return result;
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

  // Resolved alongside tree validation rather than after it: a project that
  // fails to list may simply have MOVED with the library (another Mac ran
  // the migration), and that has to be known before anything is removed.
  const libraryPromise = detectSyncedLibrary(STEP_TIMEOUT_MS);
  const failedProjects: string[] = [];

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
        // Expected: project directory may have been deleted or moved.
        // Decided below, once the library's location is known.
        failedProjects.push(project.path);
      }
    })),
  ]);

  // Taken before waiting on the library, so `trees validated` keeps
  // measuring the tree reads alone and stays comparable with the baseline.
  const treesValidatedMs = Math.round(performance.now() - t0);
  const library = await libraryPromise;
  const { icloudAvailable, icloudNotesagePath } = library;

  // Follow a library move another device performed BEFORE pruning: the
  // projects that just failed to list are, in that case, sitting in the new
  // library under the same name.
  if (library.kind === "container" && library.cloudDocsRoot && icloudNotesagePath) {
    // The open document was restored from its OLD path at the very start of
    // startup (concurrently with everything here), so its read failed and it
    // shows empty. Note which one it is, and reload it if the follow moved it.
    const editorBefore = useEditorStore.getState();
    const openBefore = editorBefore.openDocuments.find((d) => d.id === editorBefore.activeTabId);
    try {
      const { followed } = await followLibraryMove(library.cloudDocsRoot, icloudNotesagePath);
      if (followed.length > 0) {
        log.info("startup", `Followed library move: ${followed.length} projects/folders re-pointed`);
      }
      if (openBefore) {
        const openNow = useEditorStore.getState().openDocuments.find((d) => d.id === openBefore.id);
        if (openNow && openNow.filePath !== openBefore.filePath) {
          await loadDocumentContent(openNow.id, openNow.filePath, openNow.fileName).catch((err) =>
            log.warn("startup", `Reloading the followed document failed: ${err}`),
          );
        }
      }
    } catch (err) {
      log.warn("startup", `Following the library move failed: ${err}`);
    }
  }

  {
    const wsNow = useWorkspaceStore.getState();
    const stillListed = new Set(wsNow.projects.map((p) => p.path));
    const stillFolders = new Set(wsNow.explorerFolders.map((f) => f.path));
    let held = 0;
    for (const path of failedProjects) {
      if (!stillListed.has(path)) continue; // followed to the new library
      if (isHeldPath(path, library.holdRoots)) {
        held += 1;
        continue;
      }
      const projectName = path.split('/').pop() || path;
      // Removed only when the folder is confirmed GONE. A listing can fail
      // for other reasons (permissions, an unmounted volume, an iCloud
      // hiccup), and removing the project for those, under a toast saying
      // the directory no longer exists, was simply false.
      if (await isConfirmedMissing(path)) {
        wsNow.removeProject(path);
        toast.warning(t("toast.projectRemoved", { project: projectName }));
      } else {
        log.warn("startup", `Project unreadable but present, kept: ${path}`);
        toast.warning(t("toast.projectUnreadable", { project: projectName }));
      }
    }
    for (const result of folderResults) {
      if (result.valid || !stillFolders.has(result.path)) continue;
      if (isHeldPath(result.path, library.holdRoots)) {
        held += 1;
        continue;
      }
      if (await isConfirmedMissing(result.path)) {
        wsNow.removeExplorerFolder(result.path);
      } else {
        log.warn("startup", `Folder unreadable but present, kept: ${result.path}`);
      }
    }
    if (library.markerUncertain) {
      toast.warning(t("toast.libraryMarkerPending"), {
        id: "library-marker-pending",
        duration: Infinity,
      });
    }
    if (library.containerDenied) {
      log.warn("startup", `Notesage's iCloud folder is unreadable; kept ${held} unreadable library entries`);
      toast.warning(t("toast.libraryAccessDenied"), {
        id: "library-access-denied",
        duration: Infinity,
      });
    }
  }

  {
    const wsNow = useWorkspaceStore.getState();
    // This was `explorerFolders.length + projects.length` under the name
    // `totalFiles`, so it read 16 on a launch with ~3,254 files — and both
    // numbers it actually summed are already logged beside it. Count the
    // files, which is what the field claims and what the baseline compares.
    // The trees are already in memory, so this is an in-memory walk.
    const totalFiles =
      wsNow.projects.reduce((n, p) => n + countFiles(p.fileTree ?? []), 0) +
      wsNow.explorerFolders.reduce((n, f) => n + countFiles(f.fileTree ?? []), 0);
    log.perf(PERF.startup, 'trees validated', {
      projects: wsNow.projects.length,
      folders: wsNow.explorerFolders.length,
      totalFiles,
      ms: treesValidatedMs,
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
    } catch (err) {
      log.warn("startup", `iCloud project scan failed: ${err}`);
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
      log.perf(PERF.startup, 'index init', {
        project: project.path,
        fileCount,
        ms: Math.round(performance.now() - tProjectIndex0),
      });
    }));
    log.perf(PERF.startup, 'index init total', {
      ms: Math.round(performance.now() - tIndex0),
    });
  } catch (error) {
    log.error("lifecycle", "Failed to initialize index", error);
  }

  // Signal that startup tree validation is complete
  log.info("startup", `Startup complete in ${Math.round(performance.now() - t0)}ms, setting startupReady`);
  settings.setStartupReady(true);
  log.perf(PERF.startup, 'ready', { totalMs: Math.round(performance.now() - t0) });

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
  log.perf(PERF.startup, 'tabs restored', {
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
        await loadDocumentContent(activeTab.id, filePath, fileName);
      } catch {
        // Expected: active tab file may have been deleted since last session — user sees empty state
      }
    }
  }

  // Phase 2: Background tabs load on demand when the user clicks them.
}

/** Read a document from disk into its (already open) editor entry. */
async function loadDocumentContent(id: string, filePath: string, fileName: string): Promise<void> {
  const fileType = getFileType(fileName);
  if (fileType === "image") {
    useEditorStore.getState().loadTabContent(id, "");
  } else if (isBinaryFileType(fileType)) {
    const bytes = await tauriApi.readBinaryFile(filePath);
    setBinaryData(filePath, new Uint8Array(bytes));
    useEditorStore.getState().loadTabContent(id, "");
  } else {
    const raw = await tauriApi.readFile(filePath);
    if (fileType === "markdown") {
      const { frontmatter, content } = parseFrontmatter(raw);
      useEditorStore.getState().loadTabContent(id, content, frontmatter);
    } else {
      useEditorStore.getState().loadTabContent(id, raw);
    }
  }
}

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
    toast.info(t("toast.rebuildingIndex"), {
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


import { useCallback } from "react";
import { tauriApi, type FileEntry } from "@/lib/tauri";
import { useEditorStore, type ScrollToTag } from "@/stores/editor-store";
import { useInboxStore } from "@/stores/inbox-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { isHeldPath } from "@/lib/library-follow";
import { useGitStore } from "@/stores/git-store";
import { parseFrontmatter, serializeFrontmatter, type Frontmatter } from "@/lib/frontmatter";
import { refreshNotesTree } from "@/lib/refresh-notes-tree";
import { useActionStore } from "@/stores/action-store";
import { migrateProjectPath } from "@/lib/migrate-project-path";
import { getFileType, isBinaryFileType, countFiles } from "@/lib/file-utils";
import { setBinaryData } from "@/lib/binary-cache";
import { emitWorkflowEvent } from "@/lib/automations/event-bus";
import { wasAutomationWrite } from "@/lib/automations/loop-guard";
import { toast } from "sonner";
import { trackSelfRename } from "@/lib/self-rename-filter";
import { t } from '@/lib/i18n';
import { log, PERF } from '@/lib/logger';
import { flushAllPendingSerializes } from "@/lib/pending-serialize";

/** Debounced git status refresh per repo. Each repo gets its own timer. */
const repoRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function refreshGitForPath(filePath: string) {
  if (!useSettingsStore.getState().gitEnabled) return;

  const repos = useGitStore.getState().repos;
  const { setFileStatuses, setCurrentBranch } = useGitStore.getState();

  // Find repos whose path is a prefix of the affected file
  const affectedRepoPaths = Object.keys(repos).filter(
    (repoPath) => repos[repoPath].isGitRepo && filePath.startsWith(repoPath)
  );

  if (affectedRepoPaths.length === 0) return;

  for (const repoPath of affectedRepoPaths) {
    const existing = repoRefreshTimers.get(repoPath);
    if (existing) clearTimeout(existing);

    repoRefreshTimers.set(
      repoPath,
      setTimeout(async () => {
        repoRefreshTimers.delete(repoPath);
        try {
          const [statuses, branch] = await Promise.all([
            tauriApi.gitStatus(repoPath),
            tauriApi.gitBranchCurrent(repoPath),
          ]);
          setFileStatuses(repoPath, statuses);
          setCurrentBranch(repoPath, branch);
        } catch (error) {
          console.warn("Git status refresh failed for", repoPath, error);
          useGitStore.getState().setStatusError(repoPath, true);
        }
      }, 300)
    );
  }
}

/**
 * Detect if a project was renamed by scanning the parent directory for a
 * sibling folder with .notesage metadata that isn't already open as a project.
 * Returns the new path if found, null otherwise.
 */
async function detectRenamedProject(
  parentDir: string,
): Promise<string | null> {
  try {
    const parentExists = await tauriApi.pathExists(parentDir);
    if (!parentExists) return null;

    const entries = await tauriApi.listDirectory(parentDir, useSettingsStore.getState().showHiddenFiles);
    const ws = useWorkspaceStore.getState();
    const openPaths = new Set(ws.projects.map((p) => p.path));

    for (const entry of entries) {
      if (!entry.is_directory) continue;
      if (openPaths.has(entry.path)) continue;
      // Check if this folder has .notesage metadata (i.e., is a Notesage project)
      const metaPath = `${entry.path}/.notesage/project.json`;
      try {
        const exists = await tauriApi.pathExists(metaPath);
        if (exists) return entry.path;
      } catch {
        // Expected: pathExists may fail for inaccessible directories — skip this candidate
      }
    }
  } catch {
    // Expected: parent directory may not exist or be inaccessible after rename
  }
  return null;
}

/** One deduplicated warning per unreadable tree, not one per watcher event. */
function reportTreeReadFailure(path: string, error: unknown): void {
  log.warn("tree", `Could not refresh ${path}, keeping the tree already shown`, error);
  const name = path.split("/").pop() || path;
  toast.warning(t("toast.treeRefreshFailed", { name }), { id: `tree-refresh-failed:${path}` });
}

/** `path` is `root` or lies beneath it. `/a/Work-archive` is not under `/a/Work`. */
function isAtOrUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`);
}

interface TreeFlight {
  running: Promise<number | null>;
  /** The one re-run requested while `running` was in flight, shared by everyone who asked. */
  queued: Promise<number | null> | null;
  queuedRun: () => Promise<number | null>;
}

/** Refreshes in flight, by root. */
const treeFlights = new Map<string, TreeFlight>();

/**
 * At most one refresh of a root at a time. A request that arrives while one
 * is running does not start a second listing alongside it: it marks the root
 * dirty, and ONE re-run starts when the current listing finishes, however
 * many requests arrived meanwhile. The re-run is not optional: the listing in
 * flight may have read the directory before the change that prompted the new
 * request, so its caller gets a listing that began after it asked.
 *
 * `supersede` lets the request choose what the re-run does (a full refresh
 * decides more than a targeted one, see `refreshProjectRoot`).
 */
function singleFlight(
  key: string,
  run: () => Promise<number | null>,
  supersede = false,
): Promise<number | null> {
  const flight = treeFlights.get(key);
  if (flight) {
    if (supersede || !flight.queued) flight.queuedRun = run;
    if (!flight.queued) {
      const rerun = () => singleFlight(key, flight.queuedRun);
      flight.queued = flight.running.then(rerun, rerun);
    }
    return flight.queued;
  }
  const running = run().finally(() => {
    treeFlights.delete(key);
  });
  treeFlights.set(key, { running, queued: null, queuedRun: run });
  return running;
}

/** List one root and log it. Throws when the listing fails. */
async function listRoot(rootPath: string): Promise<{ tree: FileEntry[]; fileCount: number }> {
  const t0 = performance.now();
  const tree = await tauriApi.listDirectory(rootPath, useSettingsStore.getState().showHiddenFiles);
  const ms = Math.round(performance.now() - t0);
  const fileCount = countFiles(tree);
  const path = rootPath.split('/').pop() ?? rootPath;
  log.perf(PERF.tree, 'list', { path, fileCount, ms });
  return { tree, fileCount };
}

/** Relist an explorer folder. Resolves its file count, or null when it could not be read. */
function refreshExplorerRoot(folderPath: string): Promise<number | null> {
  return singleFlight(`explorer:${folderPath}`, async () => {
    try {
      const { tree, fileCount } = await listRoot(folderPath);
      useWorkspaceStore.getState().updateExplorerTree(folderPath, tree);
      return fileCount;
    } catch (error) {
      // The tree already in the store stays; say that it is stale.
      reportTreeReadFailure(folderPath, error);
      return null;
    }
  });
}

/**
 * Relist a project. Resolves its file count, or null when it could not be
 * read. What an unreadable project means depends on who asks: a targeted
 * refresh keeps the tree and says it is stale; a `full` refresh also works out
 * whether the project was renamed, is merely unreachable, or is gone.
 */
function refreshProjectRoot(projectPath: string, full: boolean): Promise<number | null> {
  return singleFlight(
    `project:${projectPath}`,
    async () => {
      try {
        const { tree, fileCount } = await listRoot(projectPath);
        useWorkspaceStore.getState().updateProjectTree(projectPath, tree);
        return fileCount;
      } catch (error) {
        if (!full) {
          // The tree already in the store stays; say that it is stale.
          reportTreeReadFailure(projectPath, error);
          return null;
        }
        // Expected: project path no longer exists — check if it was renamed
        // by scanning the parent directory for a folder with matching .notesage metadata
        if (!useSettingsStore.getState().startupReady) {
          // Startup decides what an unreadable project means — it may have
          // moved with the library and be about to be followed — so a
          // refresh that races it (the hidden-files setting loading fires
          // one) must not prune it first.
          return null;
        }
        const parentDir = projectPath.substring(0, projectPath.lastIndexOf('/'));
        const renamed = await detectRenamedProject(parentDir);
        if (renamed) {
          await migrateProjectPath(projectPath, renamed);
        } else if (isHeldPath(projectPath, useSettingsStore.getState().libraryHoldRoots ?? [])) {
          // Unreadable while the library's state is uncertain (iCloud folder
          // blocked, or its marker not readable yet), not because it is
          // gone: keep it so it can be followed once that clears.
        } else if (await tauriApi.pathExists(projectPath).catch(() => true)) {
          // Still there, just not listable right now (permissions, a volume
          // that dropped, an iCloud hiccup). One failed read must not drop a
          // project from the sidebar mid-session.
          log.warn("tree", `Project unreadable but present, kept: ${projectPath}`);
        } else {
          const projectName = projectPath.split('/').pop() || projectPath;
          useWorkspaceStore.getState().removeProject(projectPath);
          toast.warning(t("toast.projectRemoved", { project: projectName }));
        }
        return null;
      }
    },
    full,
  );
}

/** Relist Quick Notes. Null when there is no notes root, or it could not be read. */
function refreshNotesRoot(): Promise<number | null> {
  return singleFlight("notes", async () => (await refreshNotesTree()) ?? null);
}

/**
 * Write a document to disk and mark it clean. The body of the hook's
 * `saveFile`, at module level so the leave paths below (which are not hooks)
 * can use it too.
 */
export async function saveDocumentToDisk(
  filePath: string,
  content: string,
  tabId: string,
): Promise<boolean> {
  try {
    const saveStart = performance.now();
    const tab = useEditorStore.getState().openDocuments.find((t) => t.id === tabId);
    const frontmatter = tab?.frontmatter ?? null;
    const serializeStart = performance.now();
    const raw = serializeFrontmatter(frontmatter, content);
    const serializeMs = Math.round(performance.now() - serializeStart);
    await tauriApi.markSelfWrite(filePath);
    const writeStart = performance.now();
    await tauriApi.writeFile(filePath, raw);
    const writeMs = Math.round(performance.now() - writeStart);
    const totalMs = Math.round(performance.now() - saveStart);
    const file = filePath.split('/').pop() ?? filePath;
    const sizeKB = Math.round(raw.length / 1024 * 10) / 10;
    log.perf(PERF.save, 'save', { file, sizeKB, serializeMs, writeMs, totalMs });
    useEditorStore.getState().markTabClean(tabId, content);
    useEditorStore.getState().clearExternalChange(filePath);
    refreshGitForPath(filePath);
    // Refresh the actions dashboard for this file.
    // Note: SQLite reindexing is handled by the Rust watcher callback
    // (queue_reindex + process_reindex_queue) — do NOT call tauriApi.indexFile()
    // here as it creates lock contention with the watcher's reindex.
    useActionStore.getState().incrementalUpdate(filePath);
    // Phase 3: surface a document-saved workflow event for automations,
    // unless this save was an automation's own write (loop prevention).
    if (!wasAutomationWrite(filePath)) {
      emitWorkflowEvent({ event: 'document-saved', file: filePath });
    }
    return true;
  } catch (error) {
    await tauriApi.clearSelfWrite(filePath).catch(() => {}); // Expected: best-effort cleanup, write already failed
    // Defensive: ensure the tab stays dirty so the user knows data is unsaved.
    // markTabClean is only called after a successful write, but re-assert dirty
    // here to guard against future refactors that might change the order.
    const tab = useEditorStore.getState().openDocuments.find((t) => t.id === tabId);
    if (tab) {
      useEditorStore.getState().updateTabContent(tabId, tab.content, true);
    }
    console.error("Failed to save file:", error);
    throw error;
  }
}

/**
 * Documents whose save-before-leaving failed once. The first failure keeps
 * the document open and says why; leaving it a second time lets it go, so a
 * file that can no longer be written cannot trap the user in it.
 */
const leaveSaveFailed = new Set<string>();

/**
 * Make the active document safe to drop from the store: flush the debounced
 * markdown serialize (≤150 ms of typing that exists only in the editor) and
 * save it if it is dirty.
 *
 * The store keeps ONE document. `openTab` evicts the previous one and
 * `closeTab` drops it, and both used to rely on the 1 s auto-save debounce
 * having already run — so opening or closing within a second of the last
 * keystroke lost it (audit 2026-11-22 §2, §9).
 *
 * Resolves `false` when the save failed and the document must be kept.
 */
export async function saveActiveDocumentBeforeLeaving(): Promise<boolean> {
  // Typing can continue while a save is in flight, hence more than one pass.
  for (let pass = 0; pass < 3; pass++) {
    flushAllPendingSerializes();
    const { activeTabId, openDocuments } = useEditorStore.getState();
    const tab = openDocuments.find((d) => d.id === activeTabId);
    if (!tab || !tab.isDirty || tab.deleted) return true;
    try {
      await saveDocumentToDisk(tab.filePath, tab.content, tab.id);
      leaveSaveFailed.delete(tab.id);
    } catch (error) {
      if (leaveSaveFailed.delete(tab.id)) {
        log.warn("save", `Leaving ${tab.filePath} with unsaved changes after a second failed save`, error);
        return true;
      }
      leaveSaveFailed.add(tab.id);
      toast.error(t("toast.saveBeforeLeaveFailed", { name: tab.fileName, error: String(error) }), {
        duration: 10000,
      });
      return false;
    }
  }
  return true;
}

/**
 * Close the active document (⌘W, the TitleBar ×), saving it first if it has
 * unsaved changes. Replaces a `pendingCloseTabId` flow whose dialog was
 * removed with the tab bar, which left a close on a dirty document doing
 * nothing at all.
 */
export async function closeActiveDocument(): Promise<void> {
  const id = useEditorStore.getState().activeTabId;
  if (!id) return;
  if (!(await saveActiveDocumentBeforeLeaving())) return;
  // The save is async: only close the document the user asked to close.
  const state = useEditorStore.getState();
  if (state.activeTabId === id) state.closeTab(id);
}

export function useFileOperations() {

  const refreshFileTree = useCallback(async (target?: string | readonly string[]) => {
    const refreshStart = performance.now();
    const ws = useWorkspaceStore.getState();
    const settings = useSettingsStore.getState();
    let sections = 0;
    let totalFiles = 0;
    const count = (files: number | null) => {
      if (files === null) return;
      totalFiles += files;
      sections += 1;
    };

    // One or more paths: refresh every root that owns one of them, each root
    // once however many of the paths it owns.
    if (target !== undefined) {
      const targets = typeof target === "string" ? [target] : target;
      if (targets.length === 0) return;
      const owns = (root: string) => targets.some((path) => isAtOrUnder(path, root));

      for (const folder of ws.explorerFolders) {
        if (owns(folder.path)) count(await refreshExplorerRoot(folder.path));
      }

      for (const project of ws.projects) {
        if (owns(project.path)) count(await refreshProjectRoot(project.path, false));
      }

      // Check notes root (and iCloud notes path)
      const notesRoot = settings.notesRootPath;
      const icloudPath = settings.icloudNotesagePath;
      if (
        targets.some(
          (path) =>
            (notesRoot && path.startsWith(notesRoot)) ||
            (icloudPath && path.startsWith(icloudPath)),
        )
      ) {
        count(await refreshNotesRoot());
      }

      const ms = Math.round(performance.now() - refreshStart);
      // `targetPath` is the difference between a correct no-op and a refresh
      // that silently failed to find what it was asked to refresh: both log
      // `sections: 0`. Five such lines appear on every launch (see the
      // v0.60.2 baseline entry) and there is currently no way to tell which
      // kind they are.
      log.perf(PERF.tree, 'refresh', {
        mode: 'targeted',
        targetPath: targets[0],
        targets: targets.length,
        sections,
        totalFiles,
        ms,
      });
      return;
    }

    // No target path: refresh everything that's open. One full refresh at a
    // time: a second request while one runs becomes a single re-run after it,
    // instead of a second pass over every root alongside the first.
    await singleFlight("full", async () => {
      const fullStart = performance.now();
      const now = useWorkspaceStore.getState();
      let fullSections = 0;
      let fullFiles = 0;
      const tally = (files: number | null) => {
        if (files === null) return;
        fullFiles += files;
        fullSections += 1;
      };
      for (const folder of now.explorerFolders) tally(await refreshExplorerRoot(folder.path));
      for (const project of now.projects) tally(await refreshProjectRoot(project.path, true));
      tally(await refreshNotesRoot());

      const ms = Math.round(performance.now() - fullStart);
      log.perf(PERF.tree, 'refresh', { mode: 'full', sections: fullSections, totalFiles: fullFiles, ms });
      return fullFiles;
    });
  }, []);

  // The Inbox is a mode of the document column, so showing a document means
  // leaving it — including re-opening the file that was already active
  // behind the list, which changes no store state the Inbox could watch.
  const leaveInbox = () => {
    const inbox = useInboxStore.getState();
    if (inbox.open) inbox.closeInbox();
  };

  const openFile = useCallback(
    async (filePath: string, fileName: string, scrollToTag?: ScrollToTag, scrollToText?: string) => {
      try {
        const fileType = getFileType(fileName);

        // Opening a different document evicts the current one from the store
        // (see `openTab`), before the editor's switch pipeline gets to flush
        // it. So the outgoing document is flushed and saved HERE, as the last
        // thing before `openTab` — after the new file has been read, so that
        // typing done while it was loading is included.
        const show = async (content: string, frontmatter: Frontmatter | null) => {
          const editor = useEditorStore.getState();
          const active = editor.openDocuments.find((d) => d.id === editor.activeTabId);
          if (active && active.filePath !== filePath && !(await saveActiveDocumentBeforeLeaving())) {
            // Could not be saved: it stays open (a toast said why).
            return;
          }
          useEditorStore.getState().openTab(filePath, fileName, content, frontmatter, fileType, scrollToTag, scrollToText);
          leaveInbox();
        };

        if (fileType === "image") {
          await show("", null);
          return;
        }

        if (isBinaryFileType(fileType)) {
          const bytes = await tauriApi.readBinaryFile(filePath);
          setBinaryData(filePath, new Uint8Array(bytes));
          await show("", null);
          return;
        }

        // Text files (markdown, other): read as UTF-8
        const raw = await tauriApi.readFile(filePath);
        if (fileType === "markdown") {
          const { frontmatter, content } = parseFrontmatter(raw);
          await show(content, frontmatter);
        } else {
          await show(raw, null);
        }
      } catch (error) {
        console.error("Failed to read file:", error);
        throw error;
      }
    },
    []
  );

  const openFileAtTag = useCallback(
    async (filePath: string, fileName: string, symbol: string, occurrenceInFile: number = 0) => {
      // `symbol` includes the prefix (e.g. "#climate" or "@alice").
      // Encode the occurrence index so findTextPositionInDoc can find the Nth match.
      // Format: "symbol\0N" where N is the 0-based occurrence index.
      const searchText = occurrenceInFile > 0 ? `${symbol}\0${occurrenceInFile}` : symbol;
      await openFile(filePath, fileName, undefined, searchText);
    },
    [openFile]
  );

  const openFileAtText = useCallback(
    async (filePath: string, fileName: string, searchText: string) => {
      // Pass scrollToText through openFile atomically.
      await openFile(filePath, fileName, undefined, searchText);
    },
    [openFile]
  );

  const saveFile = useCallback(
    (filePath: string, content: string, tabId: string) => saveDocumentToDisk(filePath, content, tabId),
    []
  );

  const createFile = useCallback(
    async (parentPath: string, fileName: string) => {
      const filePath = `${parentPath}/${fileName}`;
      try {
        await tauriApi.createFile(filePath);
        await refreshFileTree(parentPath);
        refreshGitForPath(filePath);
        return filePath;
      } catch (error) {
        console.error("Failed to create file:", error);
        throw error;
      }
    },
    [refreshFileTree]
  );

  const createFolder = useCallback(
    async (parentPath: string, folderName: string) => {
      const folderPath = `${parentPath}/${folderName}`;
      try {
        await tauriApi.createDirectory(folderPath);
        await refreshFileTree(parentPath);
        refreshGitForPath(folderPath);
        return folderPath;
      } catch (error) {
        console.error("Failed to create folder:", error);
        throw error;
      }
    },
    [refreshFileTree]
  );

  const renamePath = useCallback(
    async (oldPath: string, newPath: string) => {
      try {
        trackSelfRename(oldPath, newPath);
        await tauriApi.markSelfWrite(oldPath);
        await tauriApi.markSelfWrite(newPath);
        await tauriApi.renamePath(oldPath, newPath);
        // `renameOpenDocument`, NOT `renameTab`: this is the one primitive
        // behind every move and rename in the app — the sidebar's rename, its
        // "Move to…", the Inbox drop, "File to…" and `e` — and it is handed
        // folders as readily as files. `renameTab` matches `filePath ===
        // oldPath` exactly, so renaming or moving a FOLDER left every open tab,
        // persisted tab, recent entry and scroll position beneath it pointing
        // at a path that no longer existed. `renameOpenDocument` matches the
        // path OR the path plus a separator; see `project-moved.ts` for the
        // same reasoning applied to a project move.
        useEditorStore.getState().renameOpenDocument(oldPath, newPath);
        // A pin is a path too. `deletePath` below already drops pins beneath a
        // deleted folder, with a comment about stale rows that 404 on click;
        // a move reaches the same state by the other route, so it gets the
        // same treatment rather than only the tab.
        useWorkspaceStore.getState().renamePinnedPath(oldPath, newPath);
        await refreshFileTree(oldPath);
        await refreshFileTree(newPath);
        refreshGitForPath(oldPath);
        refreshGitForPath(newPath);
        return true;
      } catch (error) {
        console.error("Failed to rename:", error);
        throw error;
      }
    },
    [refreshFileTree]
  );

  const deletePath = useCallback(
    async (path: string) => {
      try {
        await tauriApi.deletePath(path);
      } catch (error) {
        console.error("Failed to delete:", error);
        // Still refresh the tree — the file may already be gone externally,
        // and we need to remove the stale entry from the sidebar.
        await refreshFileTree(path);
        refreshGitForPath(path);
        throw error;
      }
      useEditorStore.getState().markTabDeleted(path);
      // Sidebar-simplification task #18 — drop the deleted file/folder
      // from BOTH the Pinned (workspace-store) and Recent
      // (editor-store) lists in the same render cycle. Without this,
      // delete leaves stale rows in the sidebar that 404 on click.
      // Each store's action is path-prefix-aware so a folder delete
      // cleans every entry under it.
      const ws = useWorkspaceStore.getState();
      for (const pinned of [...ws.pinnedFiles]) {
        if (pinned === path || pinned.startsWith(path + "/")) {
          ws.unpinFile(pinned);
        }
      }
      useEditorStore.getState().removeRecent(path);
      await refreshFileTree(path);
      refreshGitForPath(path);
      return true;
    },
    [refreshFileTree]
  );

  return {
    openFile,
    openFileAtTag,
    openFileAtText,
    saveFile,
    createFile,
    createFolder,
    renamePath,
    deletePath,
    refreshFileTree,
  };
}

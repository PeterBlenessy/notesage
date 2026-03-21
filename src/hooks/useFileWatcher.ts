import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { tauriApi } from "@/lib/tauri";
import { useEditorStore } from "@/stores/editor-store";
import { useExternalChangeStore } from "@/stores/external-change-store";
import { useDiffReviewStore } from "@/stores/diff-review-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSyncStore } from "@/stores/sync-store";
import { useMcpStore } from "@/stores/mcp-store";
import { useFileOperations, refreshGitForPath } from "@/hooks/useFileOperations";
import { parseFrontmatter } from "@/lib/frontmatter";
import { log } from "@/lib/logger";

/** Cached home dir for skill/agent path matching (set once on first event). */
let cachedHomeDir: string | undefined;
async function getHomeDir(): Promise<string> {
  if (!cachedHomeDir) {
    cachedHomeDir = await tauriApi.getHomeDir();
  }
  return cachedHomeDir;
}

/** Maximum entries in per-path debounce maps before triggering a batch refresh. */
const MAX_DEBOUNCE_ENTRIES = 500;

interface FileChangedPayload {
  path: string;
  kind: "create" | "modify" | "delete";
}

/** Strip trailing slashes and resolve /private prefix for consistent path comparison on macOS. */
function normalizePath(p: string): string {
  let result = p.endsWith("/") ? p.slice(0, -1) : p;
  // macOS FSEvents can canonicalize /var → /private/var, /tmp → /private/tmp, etc.
  if (result.startsWith("/private/")) {
    const withoutPrivate = result.slice("/private".length);
    // Only strip if the non-private path is a known symlink target
    if (
      withoutPrivate.startsWith("/var/") ||
      withoutPrivate.startsWith("/tmp/") ||
      withoutPrivate.startsWith("/etc/")
    ) {
      result = withoutPrivate;
    }
  }
  return result;
}

/**
 * Listens for `file-changed` Tauri events from the filesystem watcher
 * and handles auto-reload (clean tabs) or external-change toasts (dirty tabs).
 */
export function useFileWatcher() {
  const { refreshFileTree } = useFileOperations();
  const refreshDebounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const gitDebounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mcpRescanDebounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Per-file debounce for modify events — macOS FSEvents often fires duplicates
  const modifyDebounce = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Per-project debounce for iCloud project discovery
  const icloudDiscoveryDebounce = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    /** Shared handler for processing a single file-changed event. */
    function handleEvent(path: string, kind: FileChangedPayload["kind"]) {
      // For create/delete events, debounce file tree refresh
      // Refresh everything (no targetPath) to avoid path mismatch issues
      // where FSEvents-canonicalized paths don't match stored workspace paths
      if (kind === "create" || kind === "delete") {
        clearTimeout(refreshDebounce.current);
        refreshDebounce.current = setTimeout(() => {
          refreshFileTree();
        }, 300);
        // Index new files for tags/mentions/FTS; remove deleted files
        if (kind === "create") {
          tauriApi.indexFile(normalizePath(path)).catch((e) => log.warn('watcher', 'Failed to index new file', e));
        }
      }

      // Runtime iCloud project discovery — detect new projects synced from other machines
      if (kind === "create") {
        const icloudPath = useSettingsStore.getState().icloudNotesagePath;
        if (icloudPath && path.startsWith(icloudPath + "/")) {
          // Extract the top-level subfolder (potential project root)
          const relative = path.slice(icloudPath.length + 1);
          const topFolder = relative.split("/")[0];
          if (topFolder) {
            const projectRoot = `${icloudPath}/${topFolder}`;
            const knownPaths = new Set(
              useWorkspaceStore.getState().projects.map((p) => p.path)
            );
            if (!knownPaths.has(projectRoot)) {
              // Guard: flush debounce map if it grows too large
              if (Object.keys(icloudDiscoveryDebounce.current).length >= MAX_DEBOUNCE_ENTRIES) {
                log.warn('watcher', 'iCloud discovery debounce map overflow — triggering batch refresh');
                for (const t of Object.values(icloudDiscoveryDebounce.current)) clearTimeout(t);
                icloudDiscoveryDebounce.current = {};
                clearTimeout(refreshDebounce.current);
                refreshDebounce.current = setTimeout(() => refreshFileTree(), 300);
                return;
              }
              // Debounce per-project — iCloud syncs files gradually
              clearTimeout(icloudDiscoveryDebounce.current[projectRoot]);
              icloudDiscoveryDebounce.current[projectRoot] = setTimeout(async () => {
                delete icloudDiscoveryDebounce.current[projectRoot];
                try {
                  // Re-check: project may have been added by another event
                  const ws = useWorkspaceStore.getState();
                  if (ws.projects.some((p) => p.path === projectRoot)) return;

                  const hasMetadata = await tauriApi.pathExists(`${projectRoot}/.notesage`);
                  if (!hasMetadata) return;

                  const tree = await tauriApi.listDirectory(projectRoot);
                  ws.addProject(projectRoot, tree);

                  const syncStore = useSyncStore.getState();
                  syncStore.addSyncedProject(projectRoot);
                  const notesRoot = useSettingsStore.getState().notesRootPath;
                  if (notesRoot) {
                    await syncStore.saveSettings(notesRoot);
                  }
                } catch {
                  // Discovery failed for this path — non-critical
                }
              }, 1000);
            }
          }
        }
      }

      // Debounced git status refresh for any external change
      clearTimeout(gitDebounce.current);
      gitDebounce.current = setTimeout(() => {
        refreshGitForPath(path);
      }, 500);

      // Detect mcp.json changes → rescan MCP configs
      if (kind === "create" || kind === "delete" || kind === "modify") {
        getHomeDir().then((home) => {
          const isMcpConfig =
            path.endsWith("/mcp.json") &&
            (path.includes("/.notesage/") ||
              path.startsWith(`${home}/.notesage/`));

          if (isMcpConfig) {
            clearTimeout(mcpRescanDebounce.current);
            mcpRescanDebounce.current = setTimeout(() => {
              useMcpStore.getState().requestRescan();
            }, 500);
          }
        });
      }

      // For modify events, debounce per-file to collapse duplicate FSEvents
      if (kind === "modify") {
        const normalizedPath = normalizePath(path);
        // Guard: flush debounce map if it grows too large
        if (Object.keys(modifyDebounce.current).length >= MAX_DEBOUNCE_ENTRIES) {
          log.warn('watcher', 'Debounce map overflow — triggering batch refresh');
          for (const t of Object.values(modifyDebounce.current)) clearTimeout(t);
          modifyDebounce.current = {};
          clearTimeout(refreshDebounce.current);
          refreshDebounce.current = setTimeout(() => refreshFileTree(), 300);
          return;
        }
        clearTimeout(modifyDebounce.current[normalizedPath]);
        modifyDebounce.current[normalizedPath] = setTimeout(async () => {
          delete modifyDebounce.current[normalizedPath];
          await handleModifyEvent(path, normalizedPath);
          // Incrementally reindex the changed file for tags/mentions/FTS
          tauriApi.indexFile(normalizedPath).catch((e) => log.warn('watcher', 'Failed to index modified file', e));
        }, 200);
      }
    }

    // Batch listener — processes all events from a single debounce cycle at once,
    // deduplicating paths so each file is handled only once per batch.
    const unlistenBatch = listen<FileChangedPayload[]>(
      "file-changed-batch",
      (event) => {
        const batch = event.payload;
        if (!batch || batch.length === 0) return;

        // Deduplicate: keep last event per normalized path (last wins)
        const seen = new Map<string, FileChangedPayload>();
        for (const item of batch) {
          seen.set(normalizePath(item.path), item);
        }

        for (const { path, kind } of seen.values()) {
          handleEvent(path, kind);
        }
      }
    );

    // Per-event listener kept for backward compatibility
    const unlisten = listen<FileChangedPayload>("file-changed", (event) => {
      const { path, kind } = event.payload;
      handleEvent(path, kind);
    });

    return () => {
      unlistenBatch.then((fn) => fn());
      unlisten.then((fn) => fn());
      clearTimeout(refreshDebounce.current);
      clearTimeout(gitDebounce.current);
      clearTimeout(mcpRescanDebounce.current);
      for (const t of Object.values(modifyDebounce.current)) clearTimeout(t);
      for (const t of Object.values(icloudDiscoveryDebounce.current)) clearTimeout(t);
    };
  }, [refreshFileTree]);
}

/** Handle a debounced modify event for a single file. */
async function handleModifyEvent(path: string, normalizedPath: string) {
  // Self-write suppression is handled at the Rust/backend level:
  // saveFile() calls tauriApi.markSelfWrite() before writing, and the
  // backend file watcher skips events for recently self-written files.

  const state = useEditorStore.getState();
  const tab = state.tabs.find(
    (t) => normalizePath(t.filePath) === normalizedPath
  );

  if (!tab) return;

  try {
    const raw = await tauriApi.readFile(path);
    const { content } = parseFrontmatter(raw);

    // Skip if content matches what's in the tab (no change)
    if (content === tab.content) return;

    // Skip if content matches what we last saved — this handles the race where the
    // user continues typing after a save but the watcher fires for the save event.
    // The disk content matches our save, so it's not an external change.
    if (tab.lastSavedContent !== undefined && content === tab.lastSavedContent) return;

    // If a git branch diff review is active, auto-accept silently
    if (useDiffReviewStore.getState().reviewActive) {
      state.setExternalChange(tab.filePath, content);
      return;
    }

    if (tab.isDirty) {
      // Dirty tabs: toast with Reload action shown by Editor.tsx
      state.setExternalChange(tab.filePath, content);
    } else {
      if (!useSettingsStore.getState().externalChangeDiffReview) {
        // Auto-accept: editor-store path → Editor.tsx auto-reloads clean tabs
        state.setExternalChange(tab.filePath, content);
      } else {
        // Diff review beta: external-change-store → inline decorations
        const existing = useExternalChangeStore.getState().getChange(tab.filePath);
        if (existing && existing.newContent === content) return;

        useExternalChangeStore.getState().addChange(
          tab.filePath,
          tab.fileName,
          tab.content,
          content,
        );
      }
    }
  } catch (error) {
    log.error('watcher', 'Failed to read externally changed file', error);
  }
}

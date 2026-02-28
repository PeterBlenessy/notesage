import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { tauriApi } from "@/lib/tauri";
import { useEditorStore } from "@/stores/editor-store";
import { useExternalChangeStore } from "@/stores/external-change-store";
import { useDiffReviewStore } from "@/stores/diff-review-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useFileOperations, refreshGitForPath } from "@/hooks/useFileOperations";
import { parseFrontmatter } from "@/lib/frontmatter";

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
  // Per-file debounce for modify events — macOS FSEvents often fires duplicates
  const modifyDebounce = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const unlisten = listen<FileChangedPayload>("file-changed", (event) => {
      const { path, kind } = event.payload;

      // For create/delete events, debounce file tree refresh
      // Refresh everything (no targetPath) to avoid path mismatch issues
      // where FSEvents-canonicalized paths don't match stored workspace paths
      if (kind === "create" || kind === "delete") {
        clearTimeout(refreshDebounce.current);
        refreshDebounce.current = setTimeout(() => {
          refreshFileTree();
        }, 300);
      }

      // Debounced git status refresh for any external change
      clearTimeout(gitDebounce.current);
      gitDebounce.current = setTimeout(() => {
        refreshGitForPath(path);
      }, 500);

      // For modify events, debounce per-file to collapse duplicate FSEvents
      if (kind === "modify") {
        const normalizedPath = normalizePath(path);
        clearTimeout(modifyDebounce.current[normalizedPath]);
        modifyDebounce.current[normalizedPath] = setTimeout(async () => {
          delete modifyDebounce.current[normalizedPath];
          await handleModifyEvent(path, normalizedPath);
        }, 200);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
      clearTimeout(refreshDebounce.current);
      clearTimeout(gitDebounce.current);
      for (const t of Object.values(modifyDebounce.current)) clearTimeout(t);
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

    // Skip if content matches what's in the tab
    if (content === tab.content) return;

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
    console.error("Failed to read externally changed file:", error);
  }
}

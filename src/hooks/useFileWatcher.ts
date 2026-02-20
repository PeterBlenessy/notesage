import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { tauriApi } from "@/lib/tauri";
import { useEditorStore } from "@/stores/editor-store";
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
 * and handles auto-reload (clean tabs) or external-change banners (dirty tabs).
 */
export function useFileWatcher() {
  const { refreshFileTree } = useFileOperations();
  const refreshDebounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const gitDebounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const unlisten = listen<FileChangedPayload>("file-changed", async (event) => {
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

      // For modify events, check if file is open in a tab
      if (kind === "modify") {
        const state = useEditorStore.getState();
        const normalizedPath = normalizePath(path);
        const tab = state.tabs.find(
          (t) => normalizePath(t.filePath) === normalizedPath
        );

        if (!tab) return;

        try {
          const raw = await tauriApi.readFile(path);
          const { content } = parseFrontmatter(raw);

          // Skip if content hasn't actually changed (guards against
          // self-write events that slip through the Rust-side filter)
          if (content === tab.content) {
            return;
          }
          if (tab.isDirty) {
            // Dirty tab: show banner, don't auto-reload
            state.setExternalChange(tab.filePath, content);
          } else {
            // Clean tab: auto-reload silently
            state.updateTabContent(tab.id, content, false);
          }
        } catch (error) {
          console.error("Failed to read externally changed file:", error);
        }
      }
    });

    return () => {
      unlisten.then((fn) => fn());
      clearTimeout(refreshDebounce.current);
      clearTimeout(gitDebounce.current);
    };
  }, [refreshFileTree]);
}

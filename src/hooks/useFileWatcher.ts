import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { tauriApi } from "@/lib/tauri";
import { useEditorStore } from "@/stores/editor-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { parseFrontmatter } from "@/lib/frontmatter";

interface FileChangedPayload {
  path: string;
  kind: "create" | "modify" | "delete";
}

/**
 * Listens for `file-changed` Tauri events from the filesystem watcher
 * and handles auto-reload (clean tabs) or external-change banners (dirty tabs).
 */
export function useFileWatcher() {
  const { refreshFileTree } = useFileOperations();
  const refreshDebounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const unlisten = listen<FileChangedPayload>("file-changed", async (event) => {
      const { path, kind } = event.payload;

      // For create/delete events, debounce file tree refresh
      if (kind === "create" || kind === "delete") {
        clearTimeout(refreshDebounce.current);
        refreshDebounce.current = setTimeout(() => {
          refreshFileTree(path);
        }, 300);
      }

      // For modify events, check if file is open in a tab
      if (kind === "modify") {
        const state = useEditorStore.getState();
        const tab = state.tabs.find((t) => t.filePath === path);

        if (!tab) return;

        try {
          const raw = await tauriApi.readFile(path);
          const { content } = parseFrontmatter(raw);

          if (tab.isDirty) {
            // Dirty tab: show banner, don't auto-reload
            state.setExternalChange(path, content);
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
    };
  }, [refreshFileTree]);
}

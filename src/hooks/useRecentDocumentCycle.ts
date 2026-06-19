import { useEffect, useRef } from "react";
import { useEditorStore } from "@/stores/editor-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { CYCLE_RECENT_EVENT } from "@/lib/keyboard/shortcut-events";

/**
 * useRecentDocumentCycle — Task #77.
 *
 * Listens for the `notesage:cycle-recent` event (dispatched by the
 * `⌃Tab` / `⌃⇧Tab` keyboard shortcut in `useKeyboardShortcuts` —
 * mirrors VS Code's MRU-cycle convention) and advances the active
 * document.
 *
 * Walks `editor-store.recentFiles` (the persisted MRU history) and
 * OPENS the previous / next entry from disk via
 * `useFileOperations.openFile`. `openTab` evicts the previous doc as a
 * side effect of the open.
 *
 * No-ops when fewer than 2 entries exist in `recentFiles`, or when the
 * active path cannot be located in the recent list.
 */
export function useRecentDocumentCycle(): void {
  const { openFile } = useFileOperations();
  // Capture `openFile` in a ref so the keydown handler always sees the
  // latest closure without re-binding the listener on every render.
  const openFileRef = useRef(openFile);
  useEffect(() => {
    openFileRef.current = openFile;
  }, [openFile]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ direction: "previous" | "next" }>)
        .detail;
      if (!detail) return;

      const editorState = useEditorStore.getState();
      const { activeTabId, openDocuments, recentFiles } = editorState;

      // Walk recentFiles (persistent MRU) and load the sibling entry
      // from disk. `openFile` flows through `openTab`, which evicts the
      // currently-active doc.
      if (recentFiles.length < 2) return;

      const activeTab = activeTabId
        ? openDocuments.find((t) => t.id === activeTabId)
        : null;
      const activePath = activeTab?.filePath ?? null;

      // Recent list head is the most recently activated (matches the
      // legacy MRU ordering convention used by documentAccessOrder).
      // `delta = 1` (previous) advances toward older entries; `delta =
      // -1` (next) advances toward newer entries.
      const currentIndex = activePath
        ? recentFiles.findIndex((r) => r.path === activePath)
        : -1;
      if (currentIndex === -1) return;

      const delta = detail.direction === "next" ? -1 : 1;
      const nextIndex =
        (currentIndex + delta + recentFiles.length) % recentFiles.length;
      const target = recentFiles[nextIndex];
      if (!target || target.path === activePath) return;

      // Fire and forget — `openFile` is async (reads from disk). Errors
      // surface via the existing toast in `useFileOperations.openFile`.
      openFileRef.current(target.path, target.name).catch((err) => {
        console.error("Failed to cycle to recent document:", err);
      });
    };

    window.addEventListener(CYCLE_RECENT_EVENT, handler);
    return () => {
      window.removeEventListener(CYCLE_RECENT_EVENT, handler);
    };
  }, []);
}

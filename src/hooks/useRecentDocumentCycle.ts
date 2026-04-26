import { useEffect, useRef } from "react";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useFileOperations } from "@/hooks/useFileOperations";
import { CYCLE_RECENT_EVENT } from "@/hooks/useKeyboardShortcuts";

/**
 * useRecentDocumentCycle — Task #77.
 *
 * Listens for the `notesage:cycle-recent` event (dispatched by the
 * `⌘⇧[` / `⌘⇧]` keyboard shortcut in `useKeyboardShortcuts`) and
 * advances the active document.
 *
 * Two modes:
 *
 * 1. **Legacy shell** — cycles through `editor-store.documentAccessOrder`
 *    (the in-session MRU of already-open tabs). `⌘⇧[` advances toward
 *    older-accessed entries; `⌘⇧]` advances toward newer-accessed
 *    entries. Both wrap.
 *
 * 2. **Quiet Composer shell** — there is at most one open doc at a time
 *    by design (`openTab` evicts the previous; see `editor-store.ts`).
 *    Instead of cycling open docs, this walks `editor-store.recentFiles`
 *    (the persisted MRU history) and OPENS the previous / next entry
 *    from disk via `useFileOperations.openFile`. Step 1's eviction
 *    handles closing the current doc as a side effect of the open.
 *
 * No-ops:
 * - Legacy: when 0 or 1 documents are open
 * - Quiet: when fewer than 2 entries exist in `recentFiles`
 * - Active tab is missing from the access order / recent list
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

      const isQuiet =
        useSettingsStore.getState().uiPreview === "quiet-composer";

      const editorState = useEditorStore.getState();
      const { documentAccessOrder, activeTabId, openDocuments, recentFiles } =
        editorState;

      if (isQuiet) {
        // Quiet Composer: walk recentFiles (persistent MRU) and load the
        // sibling entry from disk. `openFile` flows through `openTab`,
        // which evicts the currently-active doc under Quiet Composer.
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
        return;
      }

      // Legacy shell: cycle through already-open tabs via documentAccessOrder.
      if (openDocuments.length < 2) return;

      // The access order is authoritative. Fall back to openDocuments order
      // if it's been desynced (e.g., right after startup before any
      // navigation has happened).
      const order =
        documentAccessOrder.length >= openDocuments.length
          ? documentAccessOrder
          : openDocuments.map((d) => d.id);

      if (order.length < 2) return;

      const currentIndex = activeTabId ? order.indexOf(activeTabId) : -1;
      if (currentIndex === -1) return;

      const delta = detail.direction === "next" ? -1 : 1;
      const nextIndex =
        (currentIndex + delta + order.length) % order.length;
      const nextId = order[nextIndex];
      if (!nextId || nextId === activeTabId) return;

      editorState.setActiveTab(nextId);
    };

    window.addEventListener(CYCLE_RECENT_EVENT, handler);
    return () => {
      window.removeEventListener(CYCLE_RECENT_EVENT, handler);
    };
  }, []);
}

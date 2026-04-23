import { useEffect } from "react";
import { useEditorStore } from "@/stores/editor-store";
import { CYCLE_RECENT_EVENT } from "@/hooks/useKeyboardShortcuts";

/**
 * useRecentDocumentCycle — Task #77.
 *
 * Listens for the `notesage:cycle-recent` event (dispatched by the
 * `⌘⇧[` / `⌘⇧]` keyboard shortcut in `useKeyboardShortcuts`) and
 * advances the active document through the editor-store's MRU order.
 *
 * Direction:
 * - `"previous"` (`⌘⇧[`) — moves toward older-accessed documents
 * - `"next"` (`⌘⇧]`) — moves toward newer-accessed documents
 *
 * MRU order is maintained in `editor-store.documentAccessOrder` — first
 * entry is the most recently activated. `⌘⇧[` advances the cursor
 * toward the tail (older); `⌘⇧]` moves toward the head (newer).
 * Both directions wrap at the boundaries so cycling is continuous.
 *
 * No-ops:
 * - When 0 or 1 documents are open (nothing to cycle through)
 * - When the active tab is missing from the access order (shouldn't
 *   happen in practice, defensive)
 */
export function useRecentDocumentCycle(): void {
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ direction: "previous" | "next" }>)
        .detail;
      if (!detail) return;

      const state = useEditorStore.getState();
      const { documentAccessOrder, activeTabId, openDocuments } = state;

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

      state.setActiveTab(nextId);
    };

    window.addEventListener(CYCLE_RECENT_EVENT, handler);
    return () => {
      window.removeEventListener(CYCLE_RECENT_EVENT, handler);
    };
  }, []);
}

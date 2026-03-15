import { useEffect, useCallback, useRef, type MutableRefObject, type RefObject } from "react";
import { useEditorStore } from "@/stores/editor-store";

interface ScrollPersistenceOptions {
  scrollAreaRef: RefObject<HTMLDivElement | null>;
  activeTabId: string | null | undefined;
  activeTabFilePath: string | undefined;
}

interface ScrollPersistenceReturn {
  /** Whether a programmatic scroll is in progress (e.g. scroll-to-tag/text) */
  isProgrammaticScroll: MutableRefObject<boolean>;
  /** Whether the scroll container is being resized */
  isResizing: MutableRefObject<boolean>;
  /** ID of the last tab that was loaded into the editor */
  lastLoadedTabId: MutableRefObject<string | null>;
  /** Save the current scroll position as a ratio for the active tab */
  saveScrollRatio: () => void;
  /** Restore the saved scroll position for a given file path */
  restoreScrollRatio: (filePath: string, onComplete?: () => void) => void;
  /**
   * Save the scroll position of the outgoing tab during a tab switch.
   * Must be called before updating lastLoadedTabId.
   */
  saveOutgoingTabScroll: () => void;
}

/**
 * Manages scroll position persistence across tab switches.
 *
 * Stores scroll positions as ratios (0-1) keyed by file path in the editor store.
 * Uses double-RAF for restoring scroll after ProseMirror DOM updates.
 * Guards against saving during resize or programmatic scroll operations.
 */
export function useScrollPersistence({
  scrollAreaRef,
  activeTabId,
  activeTabFilePath,
}: ScrollPersistenceOptions): ScrollPersistenceReturn {
  const isResizing = useRef(false);
  const isProgrammaticScroll = useRef(false);
  const lastLoadedTabId = useRef<string | null>(null);

  const scrollPositions = useEditorStore((s) => s.scrollPositions);
  const setScrollPosition = useEditorStore((s) => s.setScrollPosition);
  const tabs = useEditorStore((s) => s.tabs);

  // Save current scroll position as a ratio (0-1) keyed by file path
  const saveScrollRatio = useCallback(() => {
    const el = scrollAreaRef.current;
    // Skip save during resize, programmatic scroll, or before first tab load
    if (!el || !activeTabFilePath || isResizing.current || isProgrammaticScroll.current || !lastLoadedTabId.current) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    const ratio = maxScroll > 0 ? el.scrollTop / maxScroll : 0;
    setScrollPosition(activeTabFilePath, ratio);
  }, [activeTabFilePath, setScrollPosition, scrollAreaRef]);

  // Restore scroll position from the persisted ratio
  const restoreScrollRatio = useCallback((filePath: string, onComplete?: () => void) => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const ratio = scrollPositions[filePath] ?? 0;
    // Double-RAF: first waits for ProseMirror DOM update, second for layout
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!scrollAreaRef.current) return;
        const maxScroll = scrollAreaRef.current.scrollHeight - scrollAreaRef.current.clientHeight;
        scrollAreaRef.current.scrollTop = ratio * maxScroll;
        onComplete?.();
      });
    });
  }, [scrollPositions, scrollAreaRef]);

  // Save scroll position of the outgoing tab during a tab switch.
  // Cannot use saveScrollRatio() because activeTab already points to the
  // new tab in this render. Instead, look up the previous tab by its id.
  const saveOutgoingTabScroll = useCallback(() => {
    const el = scrollAreaRef.current;
    const prevTabId = lastLoadedTabId.current;
    if (el && prevTabId && !isResizing.current) {
      const prevTab = tabs.find((t) => t.id === prevTabId);
      if (prevTab) {
        const maxScroll = el.scrollHeight - el.clientHeight;
        const ratio = maxScroll > 0 ? el.scrollTop / maxScroll : 0;
        setScrollPosition(prevTab.filePath, ratio);
      }
    }
  }, [tabs, setScrollPosition, scrollAreaRef]);

  // Save scroll position on scroll events (debounced)
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el || !activeTabId) return;
    let timeout: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(timeout);
      timeout = setTimeout(saveScrollRatio, 150);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      clearTimeout(timeout);
    };
  }, [activeTabId, saveScrollRatio, scrollAreaRef]);

  return {
    isProgrammaticScroll,
    isResizing,
    lastLoadedTabId,
    saveScrollRatio,
    restoreScrollRatio,
    saveOutgoingTabScroll,
  };
}

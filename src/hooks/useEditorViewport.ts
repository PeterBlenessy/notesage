import type { MutableRefObject, RefObject } from "react";
import { useScrollPersistence } from "@/hooks/useScrollPersistence";
import { useEditorResize } from "@/hooks/useEditorResize";
import { useCursorScrollGuard } from "@/hooks/useCursorScrollGuard";

interface EditorViewportOptions {
  scrollAreaRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  activeTabId: string | null | undefined;
  activeTabFilePath: string | undefined;
}

interface EditorViewportReturn {
  isProgrammaticScroll: MutableRefObject<boolean>;
  lastLoadedTabId: MutableRefObject<string | null>;
  restoreScrollRatio: (filePath: string, onComplete?: () => void) => void;
  saveOutgoingTabScroll: () => void;
}

/**
 * Viewport controller for the editor scroll surface.
 *
 * Groups the three scroll/resize hooks that must run together (in this order)
 * before the editor instance exists:
 *  - `useScrollPersistence` — save/restore scroll ratio across tab switches
 *  - `useCursorScrollGuard`  — keep the caret clear of the floating cmd bar
 *  - `useEditorResize`       — ResizeObserver-driven width + scroll restore
 *
 * The shared `isResizing` ref stays internal; the values consumed downstream
 * (by `useEditorResize` internally and by `useEditorTabSwitch`) are returned.
 *
 * `useEditorZoom` (a module-level singleton read for a CSS var) and
 * `useTypewriterScroll` (needs the editor instance, runs later) are kept in
 * Editor.tsx so hook ORDER is unchanged by this extraction.
 */
export function useEditorViewport({
  scrollAreaRef,
  contentRef,
  activeTabId,
  activeTabFilePath,
}: EditorViewportOptions): EditorViewportReturn {
  const {
    isProgrammaticScroll,
    isResizing,
    lastLoadedTabId,
    restoreScrollRatio,
    saveOutgoingTabScroll,
  } = useScrollPersistence({
    scrollAreaRef,
    activeTabId,
    activeTabFilePath,
  });

  useCursorScrollGuard(scrollAreaRef);

  useEditorResize({
    contentRef,
    scrollAreaRef,
    isProgrammaticScroll,
    isResizing,
    activeTabId,
    activeTabFilePath,
    restoreScrollRatio,
  });

  return { isProgrammaticScroll, lastLoadedTabId, restoreScrollRatio, saveOutgoingTabScroll };
}

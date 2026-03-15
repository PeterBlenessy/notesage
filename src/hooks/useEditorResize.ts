import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";

interface EditorResizeOptions {
  /** Ref to the content container whose width is tracked */
  contentRef: RefObject<HTMLDivElement | null>;
  /** Ref to the scroll container whose resize triggers scroll restoration */
  scrollAreaRef: RefObject<HTMLDivElement | null>;
  /** Whether a programmatic scroll is in progress (shared with useScrollPersistence) */
  isProgrammaticScroll: MutableRefObject<boolean>;
  /** Whether the scroll container is being resized (shared with useScrollPersistence) */
  isResizing: MutableRefObject<boolean>;
  /** Active tab ID — used to reset observer when tab changes */
  activeTabId: string | null | undefined;
  /** Active tab file path — used to restore scroll after resize */
  activeTabFilePath: string | undefined;
  /** Restore scroll position after resize settles */
  restoreScrollRatio: (filePath: string) => void;
}

interface EditorResizeReturn {
  /** The rendered content width in pixels, or null if not yet measured */
  renderedWidth: number | null;
}

/**
 * Manages ResizeObserver setup for the editor:
 * 1. Tracks the rendered width of the content container (for the status bar).
 * 2. Observes the scroll container for resize — suppresses scroll saves during
 *    resize and restores the scroll position after settling.
 */
export function useEditorResize({
  contentRef,
  scrollAreaRef,
  isProgrammaticScroll,
  isResizing,
  activeTabId,
  activeTabFilePath,
  restoreScrollRatio,
}: EditorResizeOptions): EditorResizeReturn {
  const [renderedWidth, setRenderedWidth] = useState<number | null>(null);
  const resizeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Observe rendered width of content container
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setRenderedWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [activeTabId, contentRef]);

  // Observe scroll container for resize — suppress scroll saves and restore after settling.
  // Skip restore if a programmatic scroll-to-text/tag is active.
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el || !activeTabId || !activeTabFilePath) return;
    const filePath = activeTabFilePath;
    const observer = new ResizeObserver(() => {
      if (isProgrammaticScroll.current) return; // Don't interfere with scroll-to-text
      isResizing.current = true;
      clearTimeout(resizeTimer.current);
      resizeTimer.current = setTimeout(() => {
        if (isProgrammaticScroll.current) { isResizing.current = false; return; }
        restoreScrollRatio(filePath);
        // Allow saves again after restore has been fully applied (matches double-RAF in restore)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            isResizing.current = false;
          });
        });
      }, 100);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      clearTimeout(resizeTimer.current);
    };
  }, [activeTabId, activeTabFilePath, restoreScrollRatio, scrollAreaRef, isProgrammaticScroll, isResizing]);

  return { renderedWidth };
}

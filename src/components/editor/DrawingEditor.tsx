import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import "@excalidraw/excalidraw/index.css";
import { FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { useSettingsStore } from "@/stores/settings-store";
import { saveDrawing, saveSvgPreview, loadDrawingStrict, loadLibrary, loadLibraryStrict, saveLibrary, importLibraryFile } from "@/lib/drawing-storage";
import { t } from "@/lib/i18n";
import { log } from "@/lib/logger";
import { exportDrawingToSvg } from "@/lib/excalidraw-export";
import { tauriApi } from "@/lib/tauri";
import type { Editor } from "@tiptap/core";
import type { LibraryItems } from "@excalidraw/excalidraw/types";

// Excalidraw types — use inline type to avoid import issues
type ExcalidrawAPI = {
  getSceneElements: () => unknown[];
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown>;
  updateLibrary: (opts: { libraryItems: unknown[]; merge?: boolean; openLibraryMenu?: boolean }) => void;
  getLibraryItems: () => unknown[];
};

const ExcalidrawLazy = lazy(() =>
  import("@excalidraw/excalidraw").then((m) => ({ default: m.Excalidraw }))
);

interface DrawingEditorProps {
  drawingId: string;
  drawingJson?: string | null;
  projectRoot: string;
  initialHeight: number;
  editor?: Editor | null;
  getPos?: () => number | undefined;
  nodeAttrs?: Record<string, unknown>;
  onDone: (svgContent: string | null) => void;
}

export function DrawingEditor({
  drawingId,
  drawingJson,
  projectRoot,
  initialHeight,
  editor,
  getPos,
  nodeAttrs,
  onDone,
}: DrawingEditorProps) {
  const [height, setHeight] = useState(initialHeight);
  const [initialData, setInitialData] = useState<unknown>(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  // Set when the existing drawing could not be loaded. The canvas is NOT
  // shown then: an empty one would be saved over the drawing by Done.
  const [loadError, setLoadError] = useState<string | null>(null);
  // True until the shape library is known to have loaded (or to not exist):
  // saving the canvas's library before that would overwrite the real one.
  const libraryWritableRef = useRef(false);
  const [libraryItems, setLibraryItems] = useState<unknown[]>([]);
  const excalidrawRef = useRef<ExcalidrawAPI | null>(null);
  const librarySaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const theme = useSettingsStore((s) => s.theme);
  const resolvedTheme =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;

  // Load existing scene data on mount
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    if (drawingJson) {
      try {
        setInitialData(JSON.parse(drawingJson));
      } catch (err) {
        // Not an empty canvas: Done would replace the stored JSON with it.
        log.warn("drawing", "Inline drawing JSON could not be parsed", err);
        setLoadError(String(err));
      }
      setDataLoaded(true);
      return;
    }
    // Legacy: load from sidecar file
    if (drawingId && projectRoot) {
      loadDrawingStrict(drawingId, projectRoot)
        .then((data: unknown) => {
          if (cancelled) return;
          if (data) setInitialData(data);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          log.warn("drawing", `Drawing ${drawingId} could not be loaded`, err);
          setLoadError(String(err));
        })
        .finally(() => {
          if (!cancelled) setDataLoaded(true);
        });
    } else {
      setDataLoaded(true);
    }
    return () => {
      cancelled = true;
    };
  }, [drawingId, drawingJson, projectRoot]);

  // Load global shape library on mount
  useEffect(() => {
    let cancelled = false;
    loadLibraryStrict()
      .then((items) => {
        if (cancelled) return;
        libraryWritableRef.current = true;
        setLibraryItems(items);
      })
      .catch((err: unknown) => {
        // The canvas still opens, without the library — and without saving
        // one over the file that could not be read.
        log.warn("drawing", "Shape library could not be loaded; it will not be saved in this session", err);
        toast.warning(t("toast.drawingLibraryUnreadable"), { id: "drawing-library-unreadable" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced library save on change
  const handleLibraryChange = useCallback((items: LibraryItems) => {
    setLibraryItems([...items]);
    if (librarySaveTimerRef.current) clearTimeout(librarySaveTimerRef.current);
    if (!libraryWritableRef.current) return;
    librarySaveTimerRef.current = setTimeout(() => {
      saveLibrary([...items]).catch((err: unknown) => {
        log.warn("drawing", "Shape library could not be saved", err);
      });
    }, 500);
  }, []);

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (librarySaveTimerRef.current) clearTimeout(librarySaveTimerRef.current);
    };
  }, []);

  // Import .excalidrawlib file via native dialog
  const handleImportLibrary = useCallback(async () => {
    const filePath = await tauriApi.openFileDialog(
      "Excalidraw Libraries",
      ["excalidrawlib"],
    );
    if (!filePath) return;

    try {
      const count = await importLibraryFile(filePath);
      if (count > 0) {
        const updated = await loadLibrary();
        // The import read and rewrote the library, so it is known-good now.
        libraryWritableRef.current = true;
        setLibraryItems(updated);
        excalidrawRef.current?.updateLibrary({
          libraryItems: updated,
          merge: false,
          openLibraryMenu: true,
        });
        toast.success(`Library imported (${count} item${count === 1 ? "" : "s"})`);
      } else {
        toast.info("No new items to import");
      }
    } catch (err) {
      toast.error(`Failed to import library: ${err}`);
    }
  }, []);

  const handleDone = useCallback(async () => {
    const api = excalidrawRef.current;
    // No canvas, or one that never held the real drawing: close without
    // writing anything.
    if (!api || loadError !== null) {
      onDone(null);
      return;
    }

    // Gather scene data
    const elements = api.getSceneElements();
    const appState = api.getAppState();
    const files = api.getFiles();
    const sceneData = {
      type: "excalidraw",
      version: 2,
      elements,
      appState: {
        viewBackgroundColor: appState.viewBackgroundColor,
      },
      files,
    };

    // Update drawingJson on the node via ProseMirror transaction (inline mode)
    if (editor && getPos) {
      const pos = getPos();
      if (typeof pos === "number") {
        const jsonStr = JSON.stringify(sceneData);
        editor.chain().command(({ tr }) => {
          tr.setNodeMarkup(pos, undefined, {
            ...(nodeAttrs ?? {}),
            drawingJson: jsonStr,
          });
          return true;
        }).run();
      }
    } else if (projectRoot) {
      // Legacy fallback: save to sidecar file
      await saveDrawing(drawingId, projectRoot, sceneData);
    }

    // Export SVG preview
    try {
      const exportSvg = async (darkMode: boolean) => {
        const svg = await exportDrawingToSvg({
          elements,
          appState: {
            ...appState,
            exportWithDarkMode: darkMode,
            exportBackground: false,
          },
          files,
        });
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        svg.style.width = "100%";
        svg.style.height = "auto";
        return svg.outerHTML;
      };

      const lightSvg = await exportSvg(false);
      const darkSvg = await exportSvg(true);

      // Save SVG cache for legacy sidecar mode
      if (projectRoot && drawingId !== "inline") {
        await saveSvgPreview(drawingId, projectRoot, lightSvg);
        await saveSvgPreview(drawingId + "-dark", projectRoot, darkSvg);
      }

      // Return the one matching current theme
      onDone(resolvedTheme === "dark" ? darkSvg : lightSvg);
    } catch {
      onDone(null);
    }
  }, [drawingId, drawingJson, projectRoot, editor, getPos, nodeAttrs, onDone, resolvedTheme, loadError]);

  // Handle Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleDone();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [handleDone]);

  // Resize handle
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(
    null,
  );
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizeRef.current = { startY: e.clientY, startHeight: height };
      const onMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        const delta = ev.clientY - resizeRef.current.startY;
        setHeight(Math.max(200, resizeRef.current.startHeight + delta));
      };
      const onUp = () => {
        resizeRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [height],
  );

  // Stop event propagation so ProseMirror doesn't intercept
  // clicks, keypresses, and pointer events meant for Excalidraw
  const stopPropagation = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      className="drawing-editor"
      onMouseDown={stopPropagation}
      onPointerDown={stopPropagation}
      onKeyDown={stopPropagation}
    >
      <div className="drawing-editor-header">
        <span className="text-sm font-medium text-muted-foreground">
          Drawing
        </span>
        <div className="drawing-header-actions">
          <button
            className="drawing-import-button"
            onClick={handleImportLibrary}
            title="Import shape library (.excalidrawlib)"
          >
            <FolderOpen size={14} strokeWidth={1.5} />
            <span>Import Library</span>
          </button>
          <button className="drawing-done-button" onClick={handleDone}>
            {loadError !== null ? t("drawing.close") : "Done"}
          </button>
        </div>
      </div>
      <div className="drawing-editor-canvas" style={{ height, width: "100%" }}>
        {dataLoaded && loadError !== null && (
          <div className="drawing-loading" role="alert">
            <p>{t("drawing.loadFailed")}</p>
            <p className="text-xs text-muted-foreground">{loadError}</p>
          </div>
        )}
        {dataLoaded && loadError === null && (
          <Suspense
            fallback={
              <div className="drawing-loading">Loading editor...</div>
            }
          >
            <ExcalidrawLazy
              excalidrawAPI={(api: unknown) => {
                excalidrawRef.current = api as ExcalidrawAPI;
              }}
              initialData={{
                ...(initialData as Record<string, unknown> | undefined),
                // Library items come from disk as unvalidated JSON; Excalidraw's
                // own restore path normalises them. Cast to the exported type.
                libraryItems: libraryItems as LibraryItems,
              }}
              onLibraryChange={handleLibraryChange}
              theme={resolvedTheme}
              UIOptions={{
                canvasActions: { saveAsImage: true, loadScene: false },
                welcomeScreen: false,
                dockedSidebarBreakpoint: 640,
              }}
            />
          </Suspense>
        )}
      </div>
      <div className="drawing-resize-handle" onMouseDown={handleResizeStart}>
        <div className="drawing-resize-grip" />
      </div>
    </div>
  );
}

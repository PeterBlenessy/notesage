import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import "@excalidraw/excalidraw/index.css";
import { useSettingsStore } from "@/stores/settings-store";
import { saveDrawing, saveSvgPreview, loadDrawing } from "@/lib/drawing-storage";
import type { Editor } from "@tiptap/core";

// Excalidraw types — use inline type to avoid import issues
type ExcalidrawAPI = {
  getSceneElements: () => unknown[];
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown>;
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
  const excalidrawRef = useRef<ExcalidrawAPI | null>(null);
  const theme = useSettingsStore((s) => s.theme);
  const resolvedTheme =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;

  // Load existing scene data on mount
  useEffect(() => {
    if (drawingJson) {
      try {
        setInitialData(JSON.parse(drawingJson));
      } catch {
        // invalid JSON — start with empty canvas
      }
      setDataLoaded(true);
      return;
    }
    // Legacy: load from sidecar file
    if (drawingId && projectRoot) {
      loadDrawing(drawingId, projectRoot).then((data: unknown) => {
        if (data) setInitialData(data);
        setDataLoaded(true);
      });
    } else {
      setDataLoaded(true);
    }
  }, [drawingId, drawingJson, projectRoot]);

  const handleDone = useCallback(async () => {
    const api = excalidrawRef.current;
    if (!api) {
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
      const { exportToSvg } = await import("@excalidraw/excalidraw");

      const exportSvg = async (darkMode: boolean) => {
        const svg = await exportToSvg({
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
  }, [drawingId, drawingJson, projectRoot, editor, getPos, nodeAttrs, onDone, resolvedTheme]);

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
        <button className="drawing-done-button" onClick={handleDone}>
          Done
        </button>
      </div>
      <div className="drawing-editor-canvas" style={{ height, width: "100%" }}>
        {dataLoaded && (
          <Suspense
            fallback={
              <div className="drawing-loading">Loading editor...</div>
            }
          >
            <ExcalidrawLazy
              excalidrawAPI={(api: unknown) => {
                excalidrawRef.current = api as ExcalidrawAPI;
              }}
              initialData={initialData as Record<string, unknown> | undefined}
              theme={resolvedTheme}
              UIOptions={{
                canvasActions: { saveAsImage: false, loadScene: false },
                welcomeScreen: false,
                dockedSidebarBreakpoint: 0,
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

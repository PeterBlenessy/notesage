import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { saveDrawing, saveSvgPreview, loadDrawing } from "@/lib/drawing-storage";

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
  projectRoot: string;
  initialHeight: number;
  onDone: (svgContent: string | null) => void;
}

export function DrawingEditor({
  drawingId,
  projectRoot,
  initialHeight,
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
    loadDrawing(drawingId, projectRoot).then((data: unknown) => {
      if (data) setInitialData(data);
      setDataLoaded(true);
    });
  }, [drawingId, projectRoot]);

  const handleDone = useCallback(async () => {
    const api = excalidrawRef.current;
    if (!api) {
      onDone(null);
      return;
    }

    // Save scene JSON
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
    await saveDrawing(drawingId, projectRoot, sceneData);

    // Export SVG preview
    try {
      const { exportToSvg } = await import("@excalidraw/excalidraw");
      const svg = await exportToSvg({
        elements,
        appState: {
          ...appState,
          exportWithDarkMode: resolvedTheme === "dark",
        },
        files,
      });
      const svgString = svg.outerHTML;
      await saveSvgPreview(drawingId, projectRoot, svgString);
      onDone(svgString);
    } catch {
      onDone(null);
    }
  }, [drawingId, projectRoot, onDone, resolvedTheme]);

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

  return (
    <div className="drawing-editor">
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

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useEffect, useState, useCallback } from "react";
import { Pencil } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { loadSvgPreview, loadDrawing, saveSvgPreview } from "@/lib/drawing-storage";
import { useActiveProject } from "@/hooks/useActiveProject";
import { useSettingsStore } from "@/stores/settings-store";
import { cn } from "@/lib/utils";
import { DrawingEditor } from "./DrawingEditor";

export function DrawingPreview({ node, selected }: NodeViewProps) {
  const drawingId = node.attrs.drawingId as string | null;
  const height = (node.attrs.height as number) || 600;
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const { projectPath } = useActiveProject();

  // Resolve theme to load correct SVG variant
  const theme = useSettingsStore((s) => s.theme);
  const isDark =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : theme === "dark";

  // Regenerate SVG from .excalidraw JSON and save to disk
  const regenerateSvg = useCallback(async (id: string, root: string, dark: boolean): Promise<string | null> => {
    const sceneData = await loadDrawing(id, root);
    if (!sceneData) return null;

    try {
      const scene = sceneData as { elements?: unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown> };
      const elements = scene.elements ?? [];
      if (elements.length === 0) return null;

      const { exportToSvg } = await import("@excalidraw/excalidraw");

      const renderSvg = async (darkMode: boolean) => {
        const svgEl = await exportToSvg({
          elements: elements as Parameters<typeof exportToSvg>[0]["elements"],
          appState: {
            ...(scene.appState ?? {}),
            exportWithDarkMode: darkMode,
            exportBackground: false,
          },
          files: (scene.files ?? {}) as Parameters<typeof exportToSvg>[0]["files"],
        });
        svgEl.removeAttribute("width");
        svgEl.removeAttribute("height");
        svgEl.style.width = "100%";
        svgEl.style.height = "auto";
        return svgEl.outerHTML;
      };

      const lightSvg = await renderSvg(false);
      const darkSvg = await renderSvg(true);

      await saveSvgPreview(id, root, lightSvg);
      await saveSvgPreview(id + "-dark", root, darkSvg);

      return dark ? darkSvg : lightSvg;
    } catch {
      return null;
    }
  }, []);

  // Always render from .excalidraw source (ensures agent edits are reflected).
  // Falls back to cached SVG only when the .excalidraw file doesn't exist.
  useEffect(() => {
    if (!drawingId || !projectPath) return;
    let cancelled = false;

    (async () => {
      // Try rendering directly from the .excalidraw source (authoritative)
      const generated = await regenerateSvg(drawingId, projectPath, isDark);
      if (!cancelled && generated) {
        setSvgContent(generated);
        return;
      }

      // Fallback: load cached SVG (e.g., .excalidraw file was deleted but SVG remains)
      const svgId = isDark ? drawingId + "-dark" : drawingId;
      let svg = await loadSvgPreview(svgId, projectPath);
      if (!svg) svg = await loadSvgPreview(drawingId, projectPath);
      if (!cancelled && svg) setSvgContent(svg);
    })();

    return () => { cancelled = true; };
  }, [drawingId, projectPath, isDark, regenerateSvg, refreshKey]);

  // Listen for .excalidraw file changes and trigger a re-render
  useEffect(() => {
    if (!drawingId) return;
    const needle = drawingId + ".excalidraw";

    const unlisten = listen<Array<{ path: string; kind: string }>>("file-changed-batch", (event) => {
      const batch = event.payload;
      if (!batch) return;
      for (const { path, kind } of batch) {
        if ((kind === "modify" || kind === "create") && path.includes(needle)) {
          setRefreshKey((k) => k + 1);
          break;
        }
      }
    });

    return () => { unlisten.then((fn) => fn()); };
  }, [drawingId]);

  return (
    <NodeViewWrapper className="drawing-node-view" data-drawing-id={drawingId} contentEditable={false}>
      {isEditing && drawingId && projectPath ? (
        <DrawingEditor
          drawingId={drawingId}
          projectRoot={projectPath}
          initialHeight={height}
          onDone={(svg) => {
            if (svg) setSvgContent(svg);
            setIsEditing(false);
          }}
        />
      ) : (
        <div
          className={cn(
            "drawing-preview",
            selected && "drawing-preview-selected",
          )}
          style={{ minHeight: svgContent ? undefined : 200 }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onClick={() => {
            if (drawingId && projectPath) setIsEditing(true);
          }}
        >
          {svgContent ? (
            <div
              className="drawing-svg-container"
              dangerouslySetInnerHTML={{ __html: svgContent }}
            />
          ) : (
            <div className="drawing-empty-placeholder">
              <Pencil
                className="h-8 w-8 text-muted-foreground"
                strokeWidth={1.5}
              />
              <span className="text-sm text-muted-foreground mt-2">
                Click to draw
              </span>
            </div>
          )}
          {isHovered && (
            <div className="drawing-edit-overlay">
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span className="text-xs">Edit</span>
            </div>
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}

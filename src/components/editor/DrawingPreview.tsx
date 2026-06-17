import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import React, { useEffect, useState, useCallback } from "react";
import { Pencil, Copy, Image as ImageIcon } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { loadSvgPreview, loadDrawing, saveSvgPreview } from "@/lib/drawing-storage";
import { exportDrawingToSvg, type ExportSvgOpts } from "@/lib/excalidraw-export";
import { useActiveProject } from "@/hooks/useActiveProject";
import { useSettingsStore } from "@/stores/settings-store";
import { cn } from "@/lib/utils";
import { DrawingEditor } from "./DrawingEditor";
import { BlockSizeControls } from "@/components/editor/BlockSizeControls";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export function DrawingPreview({ node, selected, editor, getPos }: NodeViewProps) {
  const drawingJson = node.attrs.drawingJson as string | null;
  const drawingId = node.attrs.drawingId as string | null;
  const height = (node.attrs.height as number) || 600;
  const blockWidth = node.attrs.blockWidth as number | null;
  const align = node.attrs.align as string | null;
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

      const renderSvg = async (darkMode: boolean) => {
        const svgEl = await exportDrawingToSvg({
          elements: elements as ExportSvgOpts["elements"],
          appState: {
            ...(scene.appState ?? {}),
            exportWithDarkMode: darkMode,
            exportBackground: false,
          },
          files: (scene.files ?? {}) as ExportSvgOpts["files"],
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

  // Inline drawing: generate SVG from in-memory scene data
  useEffect(() => {
    if (!drawingJson) return;
    let cancelled = false;

    (async () => {
      try {
        const scene = JSON.parse(drawingJson) as {
          elements?: unknown[];
          appState?: Record<string, unknown>;
          files?: Record<string, unknown>;
        };
        const elements = scene.elements ?? [];
        if (elements.length === 0) {
          setSvgContent(null);
          return;
        }

        const svgEl = await exportDrawingToSvg({
          elements: elements as ExportSvgOpts["elements"],
          appState: {
            ...(scene.appState ?? {}),
            exportWithDarkMode: isDark,
            exportBackground: false,
          },
          files: (scene.files ?? {}) as ExportSvgOpts["files"],
        });
        svgEl.removeAttribute("width");
        svgEl.removeAttribute("height");
        svgEl.style.width = "100%";
        svgEl.style.height = "auto";

        if (!cancelled) setSvgContent(svgEl.outerHTML);
      } catch {
        if (!cancelled) setSvgContent(null);
      }
    })();

    return () => { cancelled = true; };
  }, [drawingJson, isDark]);

  // Legacy: load from sidecar (only when no drawingJson)
  useEffect(() => {
    if (drawingJson || !drawingId || !projectPath) return;
    let cancelled = false;

    (async () => {
      // Try rendering directly from the .excalidraw source (authoritative)
      const generated = await regenerateSvg(drawingId, projectPath, isDark);
      if (!cancelled && generated) {
        setSvgContent(generated);

        // Auto-migrate: load scene data and set drawingJson for inline format.
        // Use setTimeout to escape React's commit phase and avoid flushSync errors.
        const sceneData = await loadDrawing(drawingId, projectPath);
        if (sceneData && editor && getPos) {
          setTimeout(() => {
            const pos = getPos();
            if (typeof pos === "number") {
              editor.chain().command(({ tr }) => {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  drawingJson: JSON.stringify(sceneData),
                });
                return true;
              }).run();
            }
          }, 0);
        }
        return;
      }

      // Fallback: load cached SVG (e.g., .excalidraw file was deleted but SVG remains)
      const svgId = isDark ? drawingId + "-dark" : drawingId;
      let svg = await loadSvgPreview(svgId, projectPath);
      if (!svg) svg = await loadSvgPreview(drawingId, projectPath);
      if (!cancelled && svg) setSvgContent(svg);
    })();

    return () => { cancelled = true; };
  }, [drawingJson, drawingId, projectPath, isDark, regenerateSvg, refreshKey]);

  // Listen for .excalidraw file changes — only needed for legacy sidecar mode
  useEffect(() => {
    if (drawingJson || !drawingId) return;
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
  }, [drawingJson, drawingId]);

  const getSceneData = useCallback(() => {
    if (!drawingJson) return null;
    try {
      return JSON.parse(drawingJson) as {
        elements?: unknown[];
        appState?: Record<string, unknown>;
        files?: Record<string, unknown>;
      };
    } catch {
      return null;
    }
  }, [drawingJson]);

  const handleCopy = useCallback(async (type: "png" | "svg") => {
    const scene = getSceneData();
    if (!scene?.elements?.length) return;
    try {
      const { exportToClipboard } = await import("@excalidraw/excalidraw");
      await exportToClipboard({
        elements: scene.elements as Parameters<typeof exportToClipboard>[0]["elements"],
        appState: {
          ...(scene.appState ?? {}),
          exportWithDarkMode: isDark,
          exportBackground: false,
        },
        files: (scene.files ?? {}) as Parameters<typeof exportToClipboard>[0]["files"],
        type,
      });
      toast.success(`Copied as ${type.toUpperCase()}`);
    } catch (err) {
      console.error(`Copy as ${type} failed:`, err);
      toast.error("Failed to copy drawing");
    }
  }, [getSceneData, isDark]);

  if (!drawingId && !drawingJson) return null;

  const blockStyle: React.CSSProperties = {};
  if (blockWidth != null) {
    blockStyle.width = `${blockWidth}%`;
    if (align === "center") {
      blockStyle.marginLeft = "auto";
      blockStyle.marginRight = "auto";
    } else if (align === "right") {
      blockStyle.marginLeft = "auto";
      blockStyle.marginRight = "0";
    } else {
      blockStyle.marginRight = "auto";
    }
  }

  return (
    <NodeViewWrapper className="drawing-node-view" style={blockStyle} data-drawing-id={drawingId} contentEditable={false}>
      {isEditing && (drawingJson || (drawingId && projectPath)) ? (
        <DrawingEditor
          drawingId={drawingId ?? "inline"}
          drawingJson={drawingJson}
          projectRoot={projectPath ?? ""}
          initialHeight={height}
          editor={editor}
          getPos={getPos}
          nodeAttrs={node.attrs}
          onDone={(svg) => {
            if (svg) setSvgContent(svg);
            setIsEditing(false);
          }}
        />
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className={cn(
                "drawing-preview",
                selected && "drawing-preview-selected",
              )}
              style={{ minHeight: svgContent ? undefined : 200 }}
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
              onClick={() => {
                if (drawingJson || (drawingId && projectPath)) setIsEditing(true);
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
                /* Bottom-right hover row — width/align controls + Edit pill,
                   matching the chart node's layout for consistency. */
                <div className="absolute bottom-2 right-2 z-10 flex items-center gap-1.5">
                  {(() => {
                    const pos = getPos();
                    if (typeof pos !== "number") return null;
                    return (
                      <BlockSizeControls
                        editor={editor}
                        pos={pos}
                        node={node}
                        blockWidth={blockWidth}
                        align={align}
                      />
                    );
                  })()}
                  <div className="flex items-center gap-1 rounded-md bg-muted/80 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm">
                    <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                    <span>Edit</span>
                  </div>
                </div>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => handleCopy("png")}>
              <ImageIcon className="mr-2 h-4 w-4" strokeWidth={1.5} />
              Copy as PNG
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleCopy("svg")}>
              <Copy className="mr-2 h-4 w-4" strokeWidth={1.5} />
              Copy as SVG
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )}
    </NodeViewWrapper>
  );
}

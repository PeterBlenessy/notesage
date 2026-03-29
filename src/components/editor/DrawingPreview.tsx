import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { loadSvgPreview } from "@/lib/drawing-storage";
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

  const { projectPath } = useActiveProject();

  // Resolve theme to load correct SVG variant
  const theme = useSettingsStore((s) => s.theme);
  const isDark =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : theme === "dark";

  // Load the theme-appropriate SVG variant
  useEffect(() => {
    if (!drawingId || !projectPath) return;
    const svgId = isDark ? drawingId + "-dark" : drawingId;
    loadSvgPreview(svgId, projectPath).then((svg) => {
      // Fall back to the base SVG if the themed variant doesn't exist
      if (svg) {
        setSvgContent(svg);
      } else {
        loadSvgPreview(drawingId, projectPath).then(setSvgContent);
      }
    });
  }, [drawingId, projectPath, isDark]);

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

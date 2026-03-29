import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { loadSvgPreview } from "@/lib/drawing-storage";
import { useActiveProject } from "@/hooks/useActiveProject";
import { cn } from "@/lib/utils";
import { DrawingEditor } from "./DrawingEditor";

export function DrawingPreview({ node, selected }: NodeViewProps) {
  const drawingId = node.attrs.drawingId as string | null;
  const height = (node.attrs.height as number) || 400;
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const { projectPath } = useActiveProject();

  useEffect(() => {
    if (!drawingId || !projectPath) return;
    loadSvgPreview(drawingId, projectPath).then(setSvgContent);
  }, [drawingId, projectPath]);

  return (
    <NodeViewWrapper className="drawing-node-view" data-drawing-id={drawingId}>
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
          style={{ minHeight: 200, height }}
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

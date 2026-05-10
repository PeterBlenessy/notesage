import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { Pencil, Copy, Download } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChartRenderer } from "./ChartRenderer";
import { ChartEditorPanel } from "./ChartEditorPanel";
import { loadChart } from "@/lib/chart-storage";
import type { ChartData } from "@/lib/chart-types";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function useActiveProjectPath(): string | undefined {
  // Only subscribe to the active tab's filePath — NOT the full openDocuments array.
  // openDocuments changes on every keystroke, which would re-render every chart.
  const activeFilePath = useEditorStore((s) => {
    const tab = s.openDocuments.find((t) => t.id === s.activeTabId);
    return tab?.filePath ?? null;
  });
  const findOwningProject = useWorkspaceStore((s) => s.findOwningProject);

  if (!activeFilePath) return undefined;
  const project = findOwningProject(activeFilePath);
  return project?.path;
}

const MIN_HEIGHT = 150;
const MAX_HEIGHT = 600;

export function ChartNodeView({ node, selected, editor, getPos }: NodeViewProps) {
  const chartJson = node.attrs.chartJson as string | null;
  const chartId = node.attrs.chartId as string | null;
  const height = (node.attrs.height as number) ?? 300;
  const blockWidth = node.attrs.blockWidth as number | null;
  const align = node.attrs.align as string | null;
  const projectRoot = useActiveProjectPath();

  // Inline charts: parse directly from attribute (synchronous, no loading state)
  const inlineData = useMemo(() => {
    if (!chartJson) return null;
    try {
      return JSON.parse(chartJson) as ChartData;
    } catch {
      return null;
    }
  }, [chartJson]);

  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const closedAtRef = useRef(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Legacy fallback: load chart data from sidecar files
  useEffect(() => {
    if (chartJson || !chartId || !projectRoot) return;

    loadChart(chartId, projectRoot).then((data) => {
      if (!data) {
        setLoaded(true);
        return;
      }
      setChartData(data);
      setLoaded(true);

      // Auto-migrate: set chartJson on the node so next save writes inline format.
      // Use setTimeout to escape React's commit phase and avoid flushSync errors
      // from Tiptap's ReactNodeViewRenderer during ProseMirror state updates.
      setTimeout(() => {
        const pos = getPos();
        if (typeof pos === "number" && editor) {
          editor
            .chain()
            .command(({ tr }) => {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                chartJson: JSON.stringify(data),
              });
              return true;
            })
            .run();
        }
      }, 0);
    });
  }, [chartJson, chartId, projectRoot]); // eslint-disable-line react-hooks/exhaustive-deps -- editor, getPos, node.attrs excluded to avoid re-trigger loops

  const finalData = inlineData ?? chartData;
  const isReady = inlineData !== null || loaded;

  const handleOpenChange = useCallback((open: boolean) => {
    setIsEditing(open);
    if (!open) {
      closedAtRef.current = Date.now();
    }
  }, []);

  const handleClick = useCallback(() => {
    // Prevent reopening immediately after close (click-through from dialog overlay)
    if (Date.now() - closedAtRef.current < 300) return;
    setIsEditing(true);
  }, []);

  const handleSave = useCallback(
    (data: ChartData) => {
      const pos = getPos();
      if (typeof pos === "number" && editor) {
        // Update chartJson attribute — makes document dirty → triggers auto-save
        // This also converts legacy sidecar charts to inline on edit
        editor
          .chain()
          .command(({ tr }) => {
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              chartJson: JSON.stringify(data),
            });
            return true;
          })
          .run();
      }
    },
    [editor, getPos, node.attrs]
  );

  // ── Drag-to-resize ──────────────────────────────────────

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const startY = e.clientY;
      const startHeight = height;

      const onMouseMove = (moveE: MouseEvent) => {
        const delta = moveE.clientY - startY;
        const newHeight = Math.min(
          MAX_HEIGHT,
          Math.max(MIN_HEIGHT, startHeight + delta)
        );
        setDragHeight(newHeight);
      };

      const onMouseUp = (upE: MouseEvent) => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);

        const delta = upE.clientY - startY;
        const newHeight = Math.min(
          MAX_HEIGHT,
          Math.max(MIN_HEIGHT, startHeight + delta)
        );
        setDragHeight(null);

        // Update ProseMirror node attribute
        const pos = getPos();
        if (typeof pos === "number" && editor) {
          editor
            .chain()
            .command(({ tr }) => {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                height: newHeight,
              });
              return true;
            })
            .run();
        }
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [height, editor, getPos, node.attrs]
  );

  // ── Chart duplication ───────────────────────────────────

  const handleDuplicate = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const data = inlineData ?? chartData;
      if (!data || !editor) return;

      const pos = getPos();
      if (typeof pos === "number") {
        const nodeSize = node.nodeSize;
        editor
          .chain()
          .insertContentAt(pos + nodeSize, {
            type: "chart",
            attrs: {
              chartJson: JSON.stringify(data),
              height,
            },
          })
          .run();
      }

      toast("Chart duplicated");
    },
    [inlineData, chartData, editor, getPos, node, height]
  );

  // ── Image download ──────────────────────────────────────

  const downloadSvg = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();

      const svgElement = wrapperRef.current?.querySelector(
        ".recharts-wrapper svg"
      );
      if (!svgElement) return;

      const svgString = new XMLSerializer().serializeToString(svgElement);
      const blob = new Blob([svgString], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `chart-${(chartId ?? "inline").slice(0, 8)}.svg`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [chartId]
  );

  const downloadPng = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();

      const svgElement = wrapperRef.current?.querySelector(
        ".recharts-wrapper svg"
      );
      if (!svgElement) return;

      const svgString = new XMLSerializer().serializeToString(svgElement);
      const svgBlob = new Blob([svgString], { type: "image/svg+xml" });
      const url = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        const scale = 2;
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d")!;
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);

        canvas.toBlob((blob) => {
          if (!blob) return;
          const pngUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = pngUrl;
          a.download = `chart-${(chartId ?? "inline").slice(0, 8)}.png`;
          a.click();
          URL.revokeObjectURL(pngUrl);
        }, "image/png");
        URL.revokeObjectURL(url);
      };
      img.src = url;
    },
    [chartId]
  );

  if (!chartId && !chartJson) return null;

  const isEmpty = isReady && !finalData;
  const displayHeight = dragHeight ?? height;

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
    <NodeViewWrapper
      ref={wrapperRef}
      data-chart-id={chartId ?? undefined}
      style={blockStyle}
      className={cn(
        "chart-block my-4 rounded-lg border transition-colors cursor-pointer relative",
        selected
          ? "border-ring"
          : isHovered
            ? "border-muted-foreground/30"
            : "border-border"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
    >
      {isEmpty ? (
        /* Empty placeholder */
        <div
          className="flex flex-col items-center justify-center gap-2 text-muted-foreground"
          style={{ height: displayHeight }}
        >
          <Pencil className="size-5" strokeWidth={1.5} />
          <span className="text-sm">Click to add data</span>
        </div>
      ) : finalData ? (
        /* Rendered chart */
        <div className="relative p-3">
          {finalData.title && (
            <p className="text-sm font-medium text-center mb-1">
              {finalData.title}
            </p>
          )}
          <ChartRenderer chartData={finalData} height={displayHeight} />

          {/* Hover overlay with actions */}
          {isHovered && (
            <div className="absolute bottom-2 right-3 flex items-center gap-1">
              {/* Download dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center gap-1 rounded-md bg-muted/80 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm hover:text-foreground transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Download className="size-3" strokeWidth={1.5} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={downloadSvg}>
                    Save as SVG
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={downloadPng}>
                    Save as PNG
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Duplicate button */}
              <button
                className="flex items-center gap-1 rounded-md bg-muted/80 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm hover:text-foreground transition-colors"
                onClick={handleDuplicate}
                title="Duplicate chart"
              >
                <Copy className="size-3" strokeWidth={1.5} />
              </button>

              {/* Edit label */}
              <div className="flex items-center gap-1 rounded-md bg-muted/80 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm">
                <Pencil className="size-3" strokeWidth={1.5} />
                Edit
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Loading */
        <div
          className="flex items-center justify-center text-muted-foreground text-sm"
          style={{ height: displayHeight }}
        >
          Loading chart...
        </div>
      )}

      {/* Resize handle at bottom edge */}
      {finalData && (
        <div
          className="absolute bottom-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-primary/20 transition-colors"
          onMouseDown={handleResizeStart}
          onClick={(e) => e.stopPropagation()}
        />
      )}

      <ChartEditorPanel
        open={isEditing}
        onOpenChange={handleOpenChange}
        initialData={finalData}
        onSave={handleSave}
      />
    </NodeViewWrapper>
  );
}

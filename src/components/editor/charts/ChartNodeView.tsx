import { useState, useCallback, useEffect, useRef } from "react";
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
import { loadChart, saveChart, saveSvgPreview } from "@/lib/chart-storage";
import type { ChartData } from "@/lib/chart-types";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function useActiveProject(): string | undefined {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const findOwningProject = useWorkspaceStore((s) => s.findOwningProject);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab) return undefined;

  const project = findOwningProject(activeTab.filePath);
  return project?.path;
}

const MIN_HEIGHT = 150;
const MAX_HEIGHT = 600;

export function ChartNodeView({ node, selected, editor, getPos }: NodeViewProps) {
  const chartId = node.attrs.chartId as string | null;
  const height = (node.attrs.height as number) ?? 300;
  const projectRoot = useActiveProject();

  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const closedAtRef = useRef(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Load chart data from sidecar
  useEffect(() => {
    if (!chartId || !projectRoot) return;

    loadChart(chartId, projectRoot).then((data) => {
      setChartData(data);
      setLoaded(true);
    });
  }, [chartId, projectRoot]);

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
    async (data: ChartData) => {
      if (!chartId || !projectRoot) return;

      setChartData(data);
      await saveChart(chartId, projectRoot, data);

      // Cache SVG preview for PDF export
      const svgElement = document.querySelector(
        `[data-chart-id="${chartId}"] .recharts-wrapper svg`
      );
      if (svgElement) {
        const svgString = new XMLSerializer().serializeToString(svgElement);
        await saveSvgPreview(chartId, projectRoot, svgString);
      }
    },
    [chartId, projectRoot]
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
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!chartId || !projectRoot || !chartData || !editor) return;

      const newId = crypto.randomUUID();
      await saveChart(newId, projectRoot, chartData);

      // Also copy SVG preview
      const svgElement = document.querySelector(
        `[data-chart-id="${chartId}"] .recharts-wrapper svg`
      );
      if (svgElement) {
        const svgString = new XMLSerializer().serializeToString(svgElement);
        await saveSvgPreview(newId, projectRoot, svgString);
      }

      // Insert after current chart node
      const pos = getPos();
      if (typeof pos === "number") {
        const nodeSize = node.nodeSize;
        editor
          .chain()
          .insertContentAt(pos + nodeSize, {
            type: "chart",
            attrs: { chartId: newId, height },
          })
          .run();
      }

      toast("Chart duplicated");
    },
    [chartId, projectRoot, chartData, editor, getPos, node, height]
  );

  // ── Image download ──────────────────────────────────────

  const downloadSvg = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!chartId) return;

      const svgElement = document.querySelector(
        `[data-chart-id="${chartId}"] .recharts-wrapper svg`
      );
      if (!svgElement) return;

      const svgString = new XMLSerializer().serializeToString(svgElement);
      const blob = new Blob([svgString], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `chart-${chartId.slice(0, 8)}.svg`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [chartId]
  );

  const downloadPng = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!chartId) return;

      const svgElement = document.querySelector(
        `[data-chart-id="${chartId}"] .recharts-wrapper svg`
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
          a.download = `chart-${chartId!.slice(0, 8)}.png`;
          a.click();
          URL.revokeObjectURL(pngUrl);
        }, "image/png");
        URL.revokeObjectURL(url);
      };
      img.src = url;
    },
    [chartId]
  );

  if (!chartId) return null;

  const isEmpty = loaded && !chartData;
  const displayHeight = dragHeight ?? height;

  return (
    <NodeViewWrapper
      ref={wrapperRef}
      data-chart-id={chartId}
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
      ) : chartData ? (
        /* Rendered chart */
        <div className="relative p-3">
          {chartData.title && (
            <p className="text-sm font-medium text-center mb-1">
              {chartData.title}
            </p>
          )}
          <ChartRenderer chartData={chartData} height={displayHeight} />

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
      {chartData && (
        <div
          className="absolute bottom-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-primary/20 transition-colors"
          onMouseDown={handleResizeStart}
          onClick={(e) => e.stopPropagation()}
        />
      )}

      <ChartEditorPanel
        open={isEditing}
        onOpenChange={handleOpenChange}
        initialData={chartData}
        onSave={handleSave}
      />
    </NodeViewWrapper>
  );
}

import { useState, useCallback, useEffect, useRef } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { Pencil } from "lucide-react";
import { ChartRenderer } from "./ChartRenderer";
import { ChartEditorPanel } from "./ChartEditorPanel";
import { loadChart, saveChart, saveSvgPreview } from "@/lib/chart-storage";
import type { ChartData } from "@/lib/chart-types";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { cn } from "@/lib/utils";

function useActiveProject(): string | undefined {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const findOwningProject = useWorkspaceStore((s) => s.findOwningProject);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab) return undefined;

  const project = findOwningProject(activeTab.filePath);
  return project?.path;
}

export function ChartNodeView({ node, selected }: NodeViewProps) {
  const chartId = node.attrs.chartId as string | null;
  const height = (node.attrs.height as number) ?? 300;
  const projectRoot = useActiveProject();

  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const closedAtRef = useRef(0);

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
      // We'll use the chart container's rendered SVG
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

  if (!chartId) return null;

  const isEmpty = loaded && !chartData;

  return (
    <NodeViewWrapper
      data-chart-id={chartId}
      className={cn(
        "chart-block my-4 rounded-lg border transition-colors cursor-pointer",
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
          style={{ height }}
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
          <ChartRenderer chartData={chartData} height={height} />

          {/* Edit overlay on hover */}
          {isHovered && (
            <div className="absolute bottom-2 right-3 flex items-center gap-1 rounded-md bg-muted/80 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm">
              <Pencil className="size-3" strokeWidth={1.5} />
              Edit
            </div>
          )}
        </div>
      ) : (
        /* Loading */
        <div
          className="flex items-center justify-center text-muted-foreground text-sm"
          style={{ height }}
        >
          Loading chart...
        </div>
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

import { useState, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChartTypeSelector } from "./ChartTypeSelector";
import { ChartDataTable } from "./ChartDataTable";
import { ChartSettings } from "./ChartSettings";
import { ChartRenderer } from "./ChartRenderer";
import { cn } from "@/lib/utils";
import type {
  ChartData,
  ChartDataPoint,
  ChartConfig,
  ChartType,
  ChartSeries,
} from "@/lib/chart-types";
import { createEmptyChartData } from "@/lib/chart-types";

interface ChartEditorPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: ChartData | null;
  onSave: (data: ChartData) => void;
}

export function ChartEditorPanel({
  open,
  onOpenChange,
  initialData,
  onSave,
}: ChartEditorPanelProps) {
  const [chartData, setChartData] = useState<ChartData>(
    () => initialData ?? createEmptyChartData()
  );
  const [activeTab, setActiveTab] = useState<"data" | "style">("data");

  useEffect(() => {
    if (open) {
      setChartData(initialData ?? createEmptyChartData());
      setActiveTab("data");
    }
  }, [open, initialData]);

  const isNew = !initialData;

  const handleTypeChange = useCallback((type: ChartType) => {
    setChartData((prev) => ({ ...prev, type }));
  }, []);

  const handleDataChange = useCallback((data: ChartDataPoint[]) => {
    setChartData((prev) => ({ ...prev, data }));
  }, []);

  const handleTitleChange = useCallback((title: string) => {
    setChartData((prev) => ({ ...prev, title }));
  }, []);

  const handleConfigChange = useCallback((config: ChartConfig) => {
    setChartData((prev) => ({ ...prev, config }));
  }, []);

  const handleSeriesChange = useCallback((series: ChartSeries[]) => {
    setChartData((prev) => ({ ...prev, series }));
  }, []);

  const handleDone = useCallback(() => {
    onSave(chartData);
    onOpenChange(false);
  }, [chartData, onSave, onOpenChange]);

  const handleOpenChange = useCallback(
    (value: boolean) => {
      if (!value) {
        onSave(chartData);
      }
      onOpenChange(value);
    },
    [chartData, onSave, onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[520px] h-[75vh] flex flex-col gap-0 p-0 overflow-hidden">
        {/* ── Fixed top ── */}
        <div className="px-6 pt-6 pb-0 space-y-3">
          <DialogHeader>
            <DialogTitle>{isNew ? "New Chart" : "Edit Chart"}</DialogTitle>
            <DialogDescription className="sr-only">
              Configure chart type, data, and appearance
            </DialogDescription>
          </DialogHeader>

          <ChartTypeSelector
            value={chartData.type}
            onChange={handleTypeChange}
          />

          {/* Tab bar */}
          <div className="grid grid-cols-2 border-b border-border">
            <button
              className={cn(
                "pb-1.5 text-sm font-medium transition-colors relative",
                activeTab === "data"
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setActiveTab("data")}
            >
              Data
              {activeTab === "data" && (
                <span className="absolute bottom-0 inset-x-0 h-0.5 bg-foreground" />
              )}
            </button>
            <button
              className={cn(
                "pb-1.5 text-sm font-medium transition-colors relative",
                activeTab === "style"
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setActiveTab("style")}
            >
              Style
              {activeTab === "style" && (
                <span className="absolute bottom-0 inset-x-0 h-0.5 bg-foreground" />
              )}
            </button>
          </div>
        </div>

        {/* ── Scrollable middle: tab content + preview ── */}
        <div className="flex-1 overflow-y-auto px-6 py-3 space-y-3">
          {/* Tab content */}
          {activeTab === "data" ? (
            <ChartDataTable
              data={chartData.data}
              chartType={chartData.type}
              series={chartData.series}
              onChange={handleDataChange}
              onSeriesChange={handleSeriesChange}
            />
          ) : (
            <ChartSettings
              title={chartData.title}
              config={chartData.config}
              chartType={chartData.type}
              seriesCount={chartData.series?.length ?? 0}
              onTitleChange={handleTitleChange}
              onConfigChange={handleConfigChange}
            />
          )}

          {/* Preview */}
          <div className="space-y-1">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Preview
            </h4>
            <div className="rounded-lg border bg-background p-2">
              {chartData.title && (
                <p className="text-sm font-medium text-center mb-1">
                  {chartData.title}
                </p>
              )}
              <ChartRenderer chartData={chartData} height={180} />
            </div>
          </div>
        </div>

        {/* ── Fixed bottom ── */}
        <div className="flex justify-end px-6 py-3 border-t border-border">
          <Button size="sm" className="h-7 text-xs px-4" onClick={handleDone}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

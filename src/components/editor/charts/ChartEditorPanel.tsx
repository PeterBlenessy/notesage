import { useState, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ChartTypeSelector } from "./ChartTypeSelector";
import { ChartDataTable } from "./ChartDataTable";
import { ChartSettings } from "./ChartSettings";
import { ChartRenderer } from "./ChartRenderer";
import type {
  ChartData,
  ChartDataPoint,
  ChartConfig,
  ChartType,
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

  // Reset when opened with new data
  useEffect(() => {
    if (open) {
      setChartData(initialData ?? createEmptyChartData());
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

  const handleDone = useCallback(() => {
    onSave(chartData);
    onOpenChange(false);
  }, [chartData, onSave, onOpenChange]);

  const handleOpenChange = useCallback(
    (value: boolean) => {
      if (!value) {
        // Save on any close (overlay click, escape)
        onSave(chartData);
      }
      onOpenChange(value);
    },
    [chartData, onSave, onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[92vh] flex flex-col gap-0 overflow-hidden">
        <DialogHeader>
          <DialogTitle>{isNew ? "New Chart" : "Edit Chart"}</DialogTitle>
          <DialogDescription className="sr-only">
            Configure chart type, data, and appearance
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          <div className="space-y-3 py-3">
            {/* Chart type selector */}
            <ChartTypeSelector
              value={chartData.type}
              onChange={handleTypeChange}
            />

            <Separator />

            {/* Data table */}
            <div className="space-y-1">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Data
              </h4>
              <ChartDataTable
                data={chartData.data}
                chartType={chartData.type}
                onChange={handleDataChange}
              />
            </div>

            <Separator />

            {/* Settings */}
            <ChartSettings
              title={chartData.title}
              config={chartData.config}
              onTitleChange={handleTitleChange}
              onConfigChange={handleConfigChange}
            />

            <Separator />

            {/* Live preview */}
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
        </div>

        <div className="flex justify-end pt-3">
          <Button size="sm" onClick={handleDone}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

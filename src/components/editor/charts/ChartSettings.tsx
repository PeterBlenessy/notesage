import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight, Plus, Minus } from "lucide-react";
import type { ChartConfig, ChartType, ReferenceLine } from "@/lib/chart-types";
import { COLOR_SCHEME_OPTIONS, type ColorScheme, isCartesian } from "@/lib/chart-types";
import { cn } from "@/lib/utils";

/** Compact select trigger — !important to override shadcn's data-[size] h-9 */
const triggerCls = "!h-6 !py-0 text-xs px-1.5 [&>svg]:size-3";

interface ChartSettingsProps {
  title: string;
  config: ChartConfig;
  chartType: ChartType;
  seriesCount: number;
  height?: number;
  onTitleChange: (title: string) => void;
  onConfigChange: (config: ChartConfig) => void;
  onHeightChange?: (height: number) => void;
}

export function ChartSettings({
  title,
  config,
  chartType,
  seriesCount,
  height,
  onTitleChange,
  onConfigChange,
  onHeightChange,
}: ChartSettingsProps) {
  const [refLinesOpen, setRefLinesOpen] = useState(false);

  const cartesian = isCartesian(chartType);
  const isLineOrArea = chartType === "line" || chartType === "area";
  const isPieDonut = chartType === "pie" || chartType === "donut";
  const canStack =
    (chartType === "bar" || chartType === "area") && seriesCount > 1;

  const addReferenceLine = () => {
    const lines = config.referenceLines ?? [];
    onConfigChange({
      ...config,
      referenceLines: [...lines, { axis: "y", value: 0 }],
    });
  };

  const updateReferenceLine = (
    index: number,
    updates: Partial<ReferenceLine>
  ) => {
    const lines = [...(config.referenceLines ?? [])];
    lines[index] = { ...lines[index], ...updates };
    onConfigChange({ ...config, referenceLines: lines });
  };

  const removeReferenceLine = (index: number) => {
    const lines = (config.referenceLines ?? []).filter((_, i) => i !== index);
    onConfigChange({ ...config, referenceLines: lines });
  };

  // Build the dropdown rows based on what's visible
  const dropdowns: { label: string; content: React.ReactNode }[] = [];

  dropdowns.push({
    label: "Palette",
    content: (
      <Select
        value={config.colorScheme}
        onValueChange={(v) =>
          onConfigChange({ ...config, colorScheme: v as ColorScheme })
        }
      >
        <SelectTrigger className={cn(triggerCls, "w-full")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COLOR_SCHEME_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ),
  });

  if (config.showLegend) {
    dropdowns.push({
      label: "Legend",
      content: (
        <Select
          value={config.legendPosition ?? "bottom"}
          onValueChange={(v) =>
            onConfigChange({
              ...config,
              legendPosition: v as ChartConfig["legendPosition"],
            })
          }
        >
          <SelectTrigger className={cn(triggerCls, "w-full")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="bottom">Bottom</SelectItem>
            <SelectItem value="top">Top</SelectItem>
            <SelectItem value="left">Left</SelectItem>
            <SelectItem value="right">Right</SelectItem>
          </SelectContent>
        </Select>
      ),
    });
  }

  if (isLineOrArea) {
    dropdowns.push({
      label: "Curve",
      content: (
        <Select
          value={config.curveType ?? "monotone"}
          onValueChange={(v) =>
            onConfigChange({
              ...config,
              curveType: v as ChartConfig["curveType"],
            })
          }
        >
          <SelectTrigger className={cn(triggerCls, "w-full")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="monotone">Monotone</SelectItem>
            <SelectItem value="linear">Linear</SelectItem>
            <SelectItem value="step">Step</SelectItem>
            <SelectItem value="natural">Natural</SelectItem>
            <SelectItem value="basis">Basis</SelectItem>
          </SelectContent>
        </Select>
      ),
    });
  }

  if (isPieDonut && config.showDataLabels) {
    dropdowns.push({
      label: "Label",
      content: (
        <Select
          value={config.pieLabels ?? "none"}
          onValueChange={(v) =>
            onConfigChange({
              ...config,
              pieLabels: v as ChartConfig["pieLabels"],
            })
          }
        >
          <SelectTrigger className={cn(triggerCls, "w-full")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="value">Value</SelectItem>
            <SelectItem value="percent">Percent</SelectItem>
            <SelectItem value="name">Name</SelectItem>
          </SelectContent>
        </Select>
      ),
    });
  }

  if (onHeightChange && height != null) {
    dropdowns.push({
      label: "Height",
      content: (
        <Select
          value={String(height)}
          onValueChange={(v) => onHeightChange(Number(v))}
        >
          <SelectTrigger className={cn(triggerCls, "w-full")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[150, 200, 250, 300, 350, 400, 450, 500, 550, 600].map((h) => (
              <SelectItem key={h} value={String(h)}>
                {h}px
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    });
  }

  if (cartesian) {
    dropdowns.push({
      label: "X Format",
      content: (
        <Select
          value={config.xTickFormat ?? "plain"}
          onValueChange={(v) =>
            onConfigChange({
              ...config,
              xTickFormat: v as ChartConfig["xTickFormat"],
            })
          }
        >
          <SelectTrigger className={cn(triggerCls, "w-full")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="plain">Plain</SelectItem>
            <SelectItem value="thousands">Thousands</SelectItem>
            <SelectItem value="percent">Percent</SelectItem>
            <SelectItem value="currency">Currency</SelectItem>
          </SelectContent>
        </Select>
      ),
    });

    dropdowns.push({
      label: "Y Format",
      content: (
        <Select
          value={config.yTickFormat ?? "plain"}
          onValueChange={(v) =>
            onConfigChange({
              ...config,
              yTickFormat: v as ChartConfig["yTickFormat"],
            })
          }
        >
          <SelectTrigger className={cn(triggerCls, "w-full")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="plain">Plain</SelectItem>
            <SelectItem value="thousands">Thousands</SelectItem>
            <SelectItem value="percent">Percent</SelectItem>
            <SelectItem value="currency">Currency</SelectItem>
          </SelectContent>
        </Select>
      ),
    });
  }

  return (
    <div className="space-y-3">
      {/* Title */}
      <div className="space-y-0.5">
        <label className="text-[11px] font-medium text-muted-foreground">
          Title
        </label>
        <Input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Chart title"
          className="!h-6 py-0 text-xs"
        />
      </div>

      {/* Axis labels */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-0.5">
          <label className="text-[11px] font-medium text-muted-foreground">
            X Label
          </label>
          <Input
            value={config.xLabel}
            onChange={(e) =>
              onConfigChange({ ...config, xLabel: e.target.value })
            }
            placeholder="X axis"
            className="!h-6 py-0 text-xs"
          />
        </div>
        <div className="space-y-0.5">
          <label className="text-[11px] font-medium text-muted-foreground">
            Y Label
          </label>
          <Input
            value={config.yLabel}
            onChange={(e) =>
              onConfigChange({ ...config, yLabel: e.target.value })
            }
            placeholder="Y axis"
            className="!h-6 py-0 text-xs"
          />
        </div>
      </div>

      {/* Toggles */}
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs">
          <Switch
            checked={config.showGrid}
            onCheckedChange={(checked) =>
              onConfigChange({ ...config, showGrid: checked })
            }
            className="scale-90"
          />
          Grid
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <Switch
            checked={config.showLegend}
            onCheckedChange={(checked) =>
              onConfigChange({ ...config, showLegend: checked })
            }
            className="scale-90"
          />
          Legend
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <Switch
            checked={config.showDataLabels ?? false}
            onCheckedChange={(checked) =>
              onConfigChange({ ...config, showDataLabels: checked })
            }
            className="scale-90"
          />
          Labels
        </label>
        {canStack && (
          <label className="flex items-center gap-1.5 text-xs">
            <Switch
              checked={config.stacked ?? false}
              onCheckedChange={(checked) =>
                onConfigChange({ ...config, stacked: checked })
              }
              className="scale-90"
            />
            Stacked
          </label>
        )}
      </div>

      {/* Dropdowns — uniform 3-column grid */}
      {dropdowns.length > 0 && (
        <div className="grid grid-cols-3 gap-x-2 gap-y-1.5">
          {dropdowns.map((d) => (
            <div key={d.label} className="space-y-0.5">
              <label className="text-[11px] font-medium text-muted-foreground">
                {d.label}
              </label>
              {d.content}
            </div>
          ))}
        </div>
      )}

      {/* Reference lines — cartesian only */}
      {cartesian && (
        <Collapsible open={refLinesOpen} onOpenChange={setRefLinesOpen}>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full">
            <ChevronRight
              className={cn(
                "size-3 transition-transform",
                refLinesOpen && "rotate-90"
              )}
              strokeWidth={1.5}
            />
            Reference Lines
            {(config.referenceLines?.length ?? 0) > 0 && (
              <span className="text-[10px] ml-0.5">
                ({config.referenceLines!.length})
              </span>
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1.5 space-y-1">
            <p className="text-[11px] text-muted-foreground leading-tight">
              Add horizontal or vertical lines to mark targets, averages, or thresholds.
            </p>
            {(config.referenceLines ?? []).map((line, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Select
                  value={line.axis}
                  onValueChange={(v) =>
                    updateReferenceLine(i, { axis: v as "x" | "y" })
                  }
                >
                  <SelectTrigger className={cn(triggerCls, "w-[50px]")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="x">X</SelectItem>
                    <SelectItem value="y">Y</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={String(line.value)}
                  onChange={(e) => {
                    const num = Number(e.target.value);
                    updateReferenceLine(i, {
                      value: isNaN(num) ? e.target.value : num,
                    });
                  }}
                  placeholder="Value"
                  className="!h-6 py-0 w-[70px] text-xs"
                />
                <Input
                  value={line.label ?? ""}
                  onChange={(e) =>
                    updateReferenceLine(i, { label: e.target.value || undefined })
                  }
                  placeholder="Label"
                  className="!h-6 py-0 flex-1 text-xs"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={() => removeReferenceLine(i)}
                >
                  <Minus className="size-3" strokeWidth={1.5} />
                </Button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="w-full h-6 text-xs text-muted-foreground"
              onClick={addReferenceLine}
            >
              <Plus className="size-3 mr-1" strokeWidth={1.5} />
              Add line
            </Button>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

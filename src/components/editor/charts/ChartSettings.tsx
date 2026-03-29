import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ChartConfig } from "@/lib/chart-types";
import { COLOR_SCHEME_OPTIONS, type ColorScheme } from "@/lib/chart-types";

interface ChartSettingsProps {
  title: string;
  config: ChartConfig;
  onTitleChange: (title: string) => void;
  onConfigChange: (config: ChartConfig) => void;
}

export function ChartSettings({
  title,
  config,
  onTitleChange,
  onConfigChange,
}: ChartSettingsProps) {
  return (
    <div className="space-y-2">
      {/* Title */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          Title
        </label>
        <Input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Chart title"
          className="h-8 text-sm"
        />
      </div>

      {/* Axis labels */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            X Label
          </label>
          <Input
            value={config.xLabel}
            onChange={(e) =>
              onConfigChange({ ...config, xLabel: e.target.value })
            }
            placeholder="X axis"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Y Label
          </label>
          <Input
            value={config.yLabel}
            onChange={(e) =>
              onConfigChange({ ...config, yLabel: e.target.value })
            }
            placeholder="Y axis"
            className="h-8 text-sm"
          />
        </div>
      </div>

      {/* Toggles + palette */}
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={config.showGrid}
            onCheckedChange={(checked) =>
              onConfigChange({ ...config, showGrid: checked })
            }
          />
          Grid
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={config.showLegend}
            onCheckedChange={(checked) =>
              onConfigChange({ ...config, showLegend: checked })
            }
          />
          Legend
        </label>

        <div className="ml-auto">
          <Select
            value={config.colorScheme}
            onValueChange={(v) =>
              onConfigChange({
                ...config,
                colorScheme: v as ColorScheme,
              })
            }
          >
            <SelectTrigger className="h-8 w-[120px] text-sm">
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
        </div>
      </div>
    </div>
  );
}

import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Minus } from "lucide-react";
import type { ChartDataPoint, ChartType } from "@/lib/chart-types";

interface ChartDataTableProps {
  data: ChartDataPoint[];
  chartType: ChartType;
  onChange: (data: ChartDataPoint[]) => void;
}

function isRadial(type: ChartType): boolean {
  return type === "pie" || type === "donut";
}

export function ChartDataTable({
  data,
  chartType,
  onChange,
}: ChartDataTableProps) {
  const categoryLabel = isRadial(chartType) ? "Label" : "Category";

  const updateRow = useCallback(
    (index: number, field: "category" | "value", raw: string) => {
      const updated = [...data];
      if (field === "value") {
        const num = Number(raw);
        updated[index] = { ...updated[index], value: isNaN(num) ? 0 : num };
      } else {
        updated[index] = { ...updated[index], category: raw };
      }
      onChange(updated);
    },
    [data, onChange]
  );

  const addRow = useCallback(() => {
    onChange([...data, { category: "", value: 0 }]);
  }, [data, onChange]);

  const removeRow = useCallback(
    (index: number) => {
      if (data.length <= 1) return;
      onChange(data.filter((_, i) => i !== index));
    },
    [data, onChange]
  );

  return (
    <div className="space-y-1">
      {/* Header */}
      <div className="grid grid-cols-[1fr_100px_32px] gap-2 px-1">
        <span className="text-xs font-medium text-muted-foreground">
          {categoryLabel}
        </span>
        <span className="text-xs font-medium text-muted-foreground">Value</span>
        <span />
      </div>

      {/* Rows */}
      {data.map((point, i) => (
        <div
          key={i}
          className="grid grid-cols-[1fr_100px_32px] gap-2 items-center"
        >
          <Input
            value={point.category}
            onChange={(e) => updateRow(i, "category", e.target.value)}
            placeholder={categoryLabel}
            className="h-8 text-sm"
          />
          <Input
            type="number"
            value={point.value}
            onChange={(e) => updateRow(i, "value", e.target.value)}
            placeholder="0"
            className="h-8 text-sm font-mono tabular-nums"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => removeRow(i)}
            disabled={data.length <= 1}
            title="Remove row"
          >
            <Minus className="size-3.5" strokeWidth={1.5} />
          </Button>
        </div>
      ))}

      {/* Add row */}
      <Button
        variant="ghost"
        size="sm"
        className="w-full text-muted-foreground"
        onClick={addRow}
      >
        <Plus className="size-3.5 mr-1" strokeWidth={1.5} />
        Add row
      </Button>
    </div>
  );
}

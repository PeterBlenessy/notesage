import { cn } from "@/lib/utils";
import { CHART_TYPES, type ChartType } from "@/lib/chart-types";

interface ChartTypeSelectorProps {
  value: ChartType;
  onChange: (type: ChartType) => void;
}

export function ChartTypeSelector({
  value,
  onChange,
}: ChartTypeSelectorProps) {
  return (
    <div className="grid grid-cols-6 gap-1">
      {CHART_TYPES.map((meta) => {
        const Icon = meta.icon;
        const isActive = value === meta.type;

        return (
          <button
            key={meta.type}
            type="button"
            onClick={() => onChange(meta.type)}
            className={cn(
              "flex flex-col items-center gap-0.5 rounded-md p-1.5 text-xs transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            title={meta.description}
          >
            <Icon className="size-4" strokeWidth={1.5} />
            <span className="font-medium">{meta.name}</span>
          </button>
        );
      })}
    </div>
  );
}

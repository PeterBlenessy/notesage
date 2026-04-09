import { useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Minus, X } from "lucide-react";
import type {
  ChartDataPoint,
  ChartType,
  ChartSeries,
} from "@/lib/chart-types";
import { isRadial } from "@/lib/chart-types";
import { toast } from "sonner";

/** Shared compact input class for all data cells */
const cellInput = "h-6 py-0 text-xs";
const cellInputMono = "h-6 py-0 text-xs font-mono tabular-nums";
const removeBtn = "h-6 w-6 text-muted-foreground hover:text-destructive";

interface ChartDataTableProps {
  data: ChartDataPoint[];
  chartType: ChartType;
  series?: ChartSeries[];
  onChange: (data: ChartDataPoint[]) => void;
  onSeriesChange?: (series: ChartSeries[]) => void;
}

function isScatter(type: ChartType): boolean {
  return type === "scatter";
}

/** Whether this chart type supports multiple series columns */
function supportsMultiSeries(type: ChartType): boolean {
  return !isRadial(type) && type !== "scatter";
}

export function ChartDataTable({
  data,
  chartType,
  series,
  onChange,
  onSeriesChange,
}: ChartDataTableProps) {
  const scatter = isScatter(chartType);
  const multiSeries = supportsMultiSeries(chartType);
  const activeSeries = series && series.length > 0 ? series : null;

  const categoryLabel = isRadial(chartType) ? "Label" : "Category";
  const tableRef = useRef<HTMLDivElement>(null);

  // ── CSV/TSV paste handler ───────────────────────────────

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const text = e.clipboardData.getData("text/plain");
      if (!text) return;

      const firstLine = text.split("\n")[0];
      const delimiter = firstLine.includes("\t") ? "\t" : ",";
      const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (lines.length === 0) return;

      const parseRow = (line: string): string[] => {
        const fields: string[] = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') {
            inQuotes = !inQuotes;
          } else if (ch === delimiter && !inQuotes) {
            fields.push(current.trim());
            current = "";
          } else {
            current += ch;
          }
        }
        fields.push(current.trim());
        return fields;
      };

      const rows = lines.map(parseRow);
      if (rows.length === 0) return;

      const firstRowValues = rows[0];
      const isHeader = firstRowValues.some(
        (v, i) => i > 0 && isNaN(Number(v)) && v !== ""
      );

      let headers: string[];
      let dataRows: string[][];

      if (isHeader) {
        headers = firstRowValues;
        dataRows = rows.slice(1);
      } else {
        headers = ["Category", ...firstRowValues.slice(1).map((_, i) => `Series ${i + 1}`)];
        dataRows = rows;
      }

      if (dataRows.length === 0) return;

      e.preventDefault();

      const seriesNames = headers.slice(1);
      const newData: ChartDataPoint[] = dataRows.map((row) => {
        const point: ChartDataPoint = {
          category: row[0] ?? "",
          value: Number(row[1]) || 0,
        };
        seriesNames.forEach((_, si) => {
          const key = seriesNames.length > 1 ? `series${si + 1}` : undefined;
          if (key) {
            point[key] = Number(row[si + 1]) || 0;
          }
        });
        return point;
      });

      onChange(newData);

      if (seriesNames.length > 1 && onSeriesChange) {
        const newSeries: ChartSeries[] = seriesNames.map((label, i) => ({
          key: `series${i + 1}`,
          label,
        }));
        onSeriesChange(newSeries);

        const remapped: ChartDataPoint[] = dataRows.map((row) => {
          const point: ChartDataPoint = {
            category: row[0] ?? "",
            value: Number(row[1]) || 0,
          };
          newSeries.forEach((s, si) => {
            point[s.key] = Number(row[si + 1]) || 0;
          });
          return point;
        });
        onChange(remapped);
      }

      toast(`Pasted ${dataRows.length} rows`);
    },
    [onChange, onSeriesChange]
  );

  // ── Row operations ──────────────────────────────────────

  const updateRow = useCallback(
    (index: number, field: string, raw: string) => {
      const updated = [...data];
      if (field === "category") {
        updated[index] = { ...updated[index], category: raw };
      } else {
        const num = Number(raw);
        updated[index] = {
          ...updated[index],
          [field]: isNaN(num) ? 0 : num,
        };
      }
      onChange(updated);
    },
    [data, onChange]
  );

  const addRow = useCallback(() => {
    const empty: ChartDataPoint = scatter
      ? { category: "", value: 0, x: 0, y: 0 }
      : { category: "", value: 0 };
    if (activeSeries) {
      for (const s of activeSeries) {
        empty[s.key] = 0;
      }
    }
    onChange([...data, empty]);
  }, [data, onChange, scatter, activeSeries]);

  const removeRow = useCallback(
    (index: number) => {
      if (data.length <= 1) return;
      onChange(data.filter((_, i) => i !== index));
    },
    [data, onChange]
  );

  // ── Series operations ───────────────────────────────────

  const addSeries = useCallback(() => {
    if (!onSeriesChange) return;
    const current = series ?? [];
    const idx = current.length + 1;
    const key = `series${idx}`;
    const label = `Series ${idx}`;
    onSeriesChange([...current, { key, label }]);
    onChange(data.map((d) => ({ ...d, [key]: 0 })));
  }, [series, data, onChange, onSeriesChange]);

  const removeSeries = useCallback(
    (index: number) => {
      if (!onSeriesChange || !series) return;
      if (series.length <= 1) return;
      const removed = series[index];
      onSeriesChange(series.filter((_, i) => i !== index));
      onChange(
        data.map((d) => {
          const { [removed.key]: _, ...rest } = d;
          return rest as ChartDataPoint;
        })
      );
    },
    [series, data, onChange, onSeriesChange]
  );

  const renameSeries = useCallback(
    (index: number, label: string) => {
      if (!onSeriesChange || !series) return;
      const updated = [...series];
      updated[index] = { ...updated[index], label };
      onSeriesChange(updated);
    },
    [series, onSeriesChange]
  );

  // ── Add row button (right-aligned, shared across layouts) ──

  const addRowButton = (
    <div className="flex justify-end">
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground"
        onClick={addRow}
        title="Add row"
      >
        <Plus className="size-3" strokeWidth={1.5} />
      </Button>
    </div>
  );

  // ── Scatter layout ──────────────────────────────────────

  if (scatter) {
    return (
      <div className="space-y-0.5" ref={tableRef} onPaste={handlePaste}>
        <div className="grid grid-cols-[40px_1fr_1fr_24px] gap-1 px-0.5">
          <span className="text-[11px] font-medium text-muted-foreground">#</span>
          <span className="text-[11px] font-medium text-muted-foreground">X</span>
          <span className="text-[11px] font-medium text-muted-foreground">Y</span>
          <span />
        </div>
        {data.map((point, i) => (
          <div
            key={i}
            className="grid grid-cols-[40px_1fr_1fr_24px] gap-1 items-center"
          >
            <span className="text-[11px] text-muted-foreground px-0.5">{i + 1}</span>
            <Input
              type="number"
              value={point.x ?? 0}
              onChange={(e) => updateRow(i, "x", e.target.value)}
              placeholder="0"
              className={cellInputMono}
            />
            <Input
              type="number"
              value={point.y ?? 0}
              onChange={(e) => updateRow(i, "y", e.target.value)}
              placeholder="0"
              className={cellInputMono}
            />
            <Button
              variant="ghost"
              size="icon"
              className={removeBtn}
              onClick={() => removeRow(i)}
              disabled={data.length <= 1}
              title="Remove row"
            >
              <Minus className="size-3" strokeWidth={1.5} />
            </Button>
          </div>
        ))}
        {addRowButton}
      </div>
    );
  }

  // ── Multi-series layout ─────────────────────────────────

  if (activeSeries && multiSeries) {
    const colCount = activeSeries.length;
    const cols = `1fr ${activeSeries.map(() => "80px").join(" ")} 24px`;

    return (
      <div className="space-y-0.5" ref={tableRef} onPaste={handlePaste}>
        {/* Header row */}
        <div className="gap-1 px-0.5 grid items-end" style={{ gridTemplateColumns: cols }}>
          <span className="text-[11px] font-medium text-muted-foreground">
            {categoryLabel}
          </span>
          {activeSeries.map((s, si) => (
            <div key={s.key} className="flex items-center gap-0.5">
              <Input
                value={s.label}
                onChange={(e) => renameSeries(si, e.target.value)}
                className="h-5 py-0 text-[11px] font-medium px-1"
                title="Click to rename series"
              />
              {colCount > 1 && (
                <button
                  onClick={() => removeSeries(si)}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  title="Remove series"
                >
                  <X className="size-2.5" strokeWidth={1.5} />
                </button>
              )}
            </div>
          ))}
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-6 text-muted-foreground justify-self-end"
            onClick={addSeries}
            title="Add series"
          >
            <Plus className="size-3" strokeWidth={1.5} />
          </Button>
        </div>

        {/* Data rows */}
        {data.map((point, i) => (
          <div
            key={i}
            className="gap-1 items-center grid"
            style={{ gridTemplateColumns: cols }}
          >
            <Input
              value={point.category}
              onChange={(e) => updateRow(i, "category", e.target.value)}
              placeholder={categoryLabel}
              className={cellInput}
            />
            {activeSeries.map((s) => (
              <Input
                key={s.key}
                type="number"
                value={(point[s.key] as number) ?? 0}
                onChange={(e) => updateRow(i, s.key, e.target.value)}
                placeholder="0"
                className={cellInputMono}
              />
            ))}
            <Button
              variant="ghost"
              size="icon"
              className={`${removeBtn} justify-self-end`}
              onClick={() => removeRow(i)}
              disabled={data.length <= 1}
              title="Remove row"
            >
              <Minus className="size-3" strokeWidth={1.5} />
            </Button>
          </div>
        ))}
        {addRowButton}
      </div>
    );
  }

  // ── Single-series layout (default) ──────────────────────

  const cols = `1fr 80px 24px`;

  return (
    <div className="space-y-0.5" ref={tableRef} onPaste={handlePaste}>
      {/* Header */}
      <div className="gap-1 px-0.5 grid items-center" style={{ gridTemplateColumns: cols }}>
        <span className="text-[11px] font-medium text-muted-foreground">
          {categoryLabel}
        </span>
        <span className="text-[11px] font-medium text-muted-foreground">Value</span>
        {multiSeries ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-6 text-muted-foreground justify-self-end"
            onClick={addSeries}
            title="Add series"
          >
            <Plus className="size-3" strokeWidth={1.5} />
          </Button>
        ) : (
          <span />
        )}
      </div>

      {/* Rows */}
      {data.map((point, i) => (
        <div
          key={i}
          className="gap-1 items-center grid"
          style={{ gridTemplateColumns: cols }}
        >
          <Input
            value={point.category}
            onChange={(e) => updateRow(i, "category", e.target.value)}
            placeholder={categoryLabel}
            className={cellInput}
          />
          <Input
            type="number"
            value={point.value}
            onChange={(e) => updateRow(i, "value", e.target.value)}
            placeholder="0"
            className={cellInputMono}
          />
          <Button
            variant="ghost"
            size="icon"
            className={`${removeBtn} justify-self-end`}
            onClick={() => removeRow(i)}
            disabled={data.length <= 1}
            title="Remove row"
          >
            <Minus className="size-3" strokeWidth={1.5} />
          </Button>
        </div>
      ))}
      {addRowButton}
    </div>
  );
}

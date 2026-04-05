import type { CSSProperties, ReactElement } from "react";
import { BarChart3 } from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  AreaChart, Area, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, ResponsiveContainer,
} from "recharts";
import type { PptxChart } from "@/lib/pptx-types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CHART_COLORS = [
  "#6b7280", "#9ca3af", "#4b5563", "#d1d5db", "#374151", "#e5e7eb",
];

// ---------------------------------------------------------------------------
// Position helper (duplicated to avoid circular deps)
// ---------------------------------------------------------------------------

function positionStyle(
  el: { x: number; y: number; width: number; height: number; rotation?: number },
  px: (emu: number) => number,
): CSSProperties {
  return {
    position: "absolute",
    left: px(el.x),
    top: px(el.y),
    width: px(el.width),
    height: px(el.height),
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
  };
}

// ---------------------------------------------------------------------------
// Chart renderer
// ---------------------------------------------------------------------------

interface ChartRendererProps {
  el: PptxChart;
  px: (n: number) => number;
}

export function ChartRenderer({ el, px }: ChartRendererProps) {
  if (el.chartType === "other" || el.series.length === 0) {
    return (
      <div
        style={{
          ...positionStyle(el, px),
          border: "1px dashed #9ca3af",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(156, 163, 175, 0.05)",
        }}
      >
        <div className="flex flex-col items-center gap-1">
          <BarChart3 className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
          <span className="text-xs text-muted-foreground italic">Chart</span>
        </div>
      </div>
    );
  }

  const chartData = el.categories.map((cat, i) => {
    const point: Record<string, unknown> = { name: cat };
    el.series.forEach((s, si) => {
      point[`s${si}`] = s.values[i] ?? 0;
    });
    return point;
  });

  return (
    <div style={{ ...positionStyle(el, px), overflow: "hidden" }}>
      <ResponsiveContainer width="100%" height="100%">
        {renderChart(el, chartData)}
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart type dispatcher
// ---------------------------------------------------------------------------

function renderChart(
  el: PptxChart,
  data: Record<string, unknown>[],
): ReactElement {
  const seriesColors = el.series.map((s, i) => s.color ?? DEFAULT_CHART_COLORS[i % DEFAULT_CHART_COLORS.length]);

  switch (el.chartType) {
    case "bar":
      return (
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          {el.series.map((_, i) => (
            <Bar key={i} dataKey={`s${i}`} fill={seriesColors[i]} />
          ))}
        </BarChart>
      );
    case "line":
      return (
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          {el.series.map((_, i) => (
            <Line key={i} dataKey={`s${i}`} stroke={seriesColors[i]} dot={false} />
          ))}
        </LineChart>
      );
    case "area":
      return (
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          {el.series.map((_, i) => (
            <Area key={i} dataKey={`s${i}`} fill={seriesColors[i]} stroke={seriesColors[i]} fillOpacity={0.3} />
          ))}
        </AreaChart>
      );
    case "scatter":
      return (
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          {el.series.map((_, i) => (
            <Scatter key={i} data={data} dataKey={`s${i}`} fill={seriesColors[i]} />
          ))}
        </ScatterChart>
      );
    case "pie":
    case "doughnut": {
      const pieData = el.categories.map((cat, i) => ({
        name: cat,
        value: el.series[0]?.values[i] ?? 0,
      }));
      return (
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            innerRadius={el.chartType === "doughnut" ? "40%" : 0}
            outerRadius="80%"
            dataKey="value"
          >
            {pieData.map((_, i) => (
              <Cell key={i} fill={seriesColors[i % seriesColors.length]} />
            ))}
          </Pie>
        </PieChart>
      );
    }
    default:
      return <BarChart data={data}><Bar dataKey="s0" fill="#6b7280" /></BarChart>;
  }
}

import type { CSSProperties, ReactElement } from "react";
import { BarChart3 } from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  AreaChart, Area, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  Legend, Tooltip, LabelList, ZAxis,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
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
    <div style={{ ...positionStyle(el, px), overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {el.title && (
        <div style={{ textAlign: "center", fontSize: 12, fontWeight: 600, marginBottom: 4, flexShrink: 0 }}>
          {el.title}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          {renderChart(el, chartData)}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared axis label helpers
// ---------------------------------------------------------------------------

function xAxisLabel(el: PptxChart): Record<string, unknown> | undefined {
  if (!el.axes?.categoryAxis?.title) return undefined;
  return { value: el.axes.categoryAxis.title, position: "insideBottom", offset: -5, fontSize: 10 };
}

function yAxisLabel(el: PptxChart): Record<string, unknown> | undefined {
  if (!el.axes?.valueAxis?.title) return undefined;
  return { value: el.axes.valueAxis.title, angle: -90, position: "insideLeft", fontSize: 10 };
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
          <XAxis dataKey="name" tick={{ fontSize: 10 }} label={xAxisLabel(el)} />
          <YAxis tick={{ fontSize: 10 }} label={yAxisLabel(el)} />
          <Tooltip />
          {el.legend && <Legend verticalAlign={el.legend.position === "top" ? "top" : "bottom"} />}
          {el.series.map((s, i) => (
            <Bar key={i} dataKey={`s${i}`} name={s.name || `Series ${i + 1}`} fill={seriesColors[i]}>
              {el.showDataLabels && <LabelList dataKey={`s${i}`} position="top" fontSize={9} />}
            </Bar>
          ))}
        </BarChart>
      );
    case "line":
      return (
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} label={xAxisLabel(el)} />
          <YAxis tick={{ fontSize: 10 }} label={yAxisLabel(el)} />
          <Tooltip />
          {el.legend && <Legend verticalAlign={el.legend.position === "top" ? "top" : "bottom"} />}
          {el.series.map((s, i) => (
            <Line key={i} dataKey={`s${i}`} name={s.name || `Series ${i + 1}`} stroke={seriesColors[i]} dot={false}>
              {el.showDataLabels && <LabelList dataKey={`s${i}`} position="top" fontSize={9} />}
            </Line>
          ))}
        </LineChart>
      );
    case "area":
      return (
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} label={xAxisLabel(el)} />
          <YAxis tick={{ fontSize: 10 }} label={yAxisLabel(el)} />
          <Tooltip />
          {el.legend && <Legend verticalAlign={el.legend.position === "top" ? "top" : "bottom"} />}
          {el.series.map((s, i) => (
            <Area key={i} dataKey={`s${i}`} name={s.name || `Series ${i + 1}`} fill={seriesColors[i]} stroke={seriesColors[i]} fillOpacity={0.3}>
              {el.showDataLabels && <LabelList dataKey={`s${i}`} position="top" fontSize={9} />}
            </Area>
          ))}
        </AreaChart>
      );
    case "scatter":
      return (
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} label={xAxisLabel(el)} />
          <YAxis tick={{ fontSize: 10 }} label={yAxisLabel(el)} />
          <Tooltip />
          {el.legend && <Legend verticalAlign={el.legend.position === "top" ? "top" : "bottom"} />}
          {el.series.map((s, i) => (
            <Scatter key={i} name={s.name || `Series ${i + 1}`} data={data} dataKey={`s${i}`} fill={seriesColors[i]} />
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
            label={el.showDataLabels ? { fontSize: 9 } : false}
          >
            {pieData.map((_, i) => (
              <Cell key={i} fill={seriesColors[i % seriesColors.length]} />
            ))}
          </Pie>
          <Tooltip />
          {el.legend && <Legend verticalAlign={el.legend.position === "top" ? "top" : "bottom"} />}
        </PieChart>
      );
    }
    case "radar": {
      const radarData = el.categories.map((cat, i) => {
        const point: Record<string, unknown> = { subject: cat };
        el.series.forEach((s, si) => {
          point[`s${si}`] = s.values[i] ?? 0;
        });
        return point;
      });
      return (
        <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
          <PolarGrid stroke="#e5e7eb" />
          <PolarAngleAxis dataKey="subject" tick={{ fontSize: 9 }} />
          <PolarRadiusAxis tick={{ fontSize: 8 }} />
          <Tooltip />
          {el.series.map((s, i) => (
            <Radar
              key={i}
              dataKey={`s${i}`}
              name={s.name || `Series ${i + 1}`}
              stroke={seriesColors[i]}
              fill={seriesColors[i]}
              fillOpacity={0.3}
            />
          ))}
          {el.legend && <Legend />}
        </RadarChart>
      );
    }
    case "bubble": {
      const bubbleSeriesData = el.series.map((s) => {
        return (s.xValues ?? s.values).map((x, i) => ({
          x,
          y: s.values[i] ?? 0,
          z: s.bubbleSizes?.[i] ?? 10,
        }));
      });
      return (
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="x" type="number" tick={{ fontSize: 10 }} name="X" label={xAxisLabel(el)} />
          <YAxis dataKey="y" type="number" tick={{ fontSize: 10 }} name="Y" label={yAxisLabel(el)} />
          <ZAxis dataKey="z" range={[20, 400]} name="Size" />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} />
          {el.series.map((s, i) => (
            <Scatter key={i} name={s.name || `Series ${i + 1}`} data={bubbleSeriesData[i]} fill={seriesColors[i]} />
          ))}
          {el.legend && <Legend />}
        </ScatterChart>
      );
    }
    default:
      return <BarChart data={data}><Bar dataKey="s0" fill="#6b7280" /></BarChart>;
  }
}

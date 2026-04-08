import type { CSSProperties, ReactElement } from "react";
import { BarChart3 } from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  AreaChart, Area, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  Legend, Tooltip, LabelList, ZAxis,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from "recharts";
import type { PptxChart, PptxChartSeries } from "@/lib/pptx-types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Office default accent colors (matches the standard Office theme palette)
const DEFAULT_CHART_COLORS = [
  "#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47",
  "#264478", "#9E480E", "#636363", "#997300", "#255E91", "#43682B",
];

type LabelPos = "top" | "bottom" | "left" | "right" | "center" | "inside" | "insideBottom";

/** Map OOXML dLblPos values to recharts LabelList position prop */
const LABEL_POS_MAP: Record<string, LabelPos> = {
  t: "top",
  b: "bottom",
  l: "left",
  r: "right",
  ctr: "center",
  outEnd: "top",
  inEnd: "inside",
  inBase: "insideBottom",
};

// ---------------------------------------------------------------------------
// Trendline computation
// ---------------------------------------------------------------------------

/** Compute linear regression coefficients (y = slope * x + intercept) */
export function linearRegression(data: { x: number; y: number }[]): { slope: number; intercept: number } {
  const n = data.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  const sumX = data.reduce((s, d) => s + d.x, 0);
  const sumY = data.reduce((s, d) => s + d.y, 0);
  const sumXY = data.reduce((s, d) => s + d.x * d.y, 0);
  const sumX2 = data.reduce((s, d) => s + d.x * d.x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

/** Generate trendline data points for a series */
function computeTrendlineData(
  series: PptxChartSeries,
  dataLength: number,
): { x: number; y: number }[] | null {
  if (!series.trendline || series.trendline.type !== "linear") return null;
  const points = series.values.slice(0, dataLength).map((y, i) => ({ x: i, y }));
  if (points.length < 2) return null;
  const { slope, intercept } = linearRegression(points);
  const backward = series.trendline.backward ?? 0;
  const forward = series.trendline.forward ?? 0;
  const startX = -backward;
  const endX = points.length - 1 + forward;
  return [
    { x: startX, y: slope * startX + intercept },
    { x: endX, y: slope * endX + intercept },
  ];
}

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
  const labelPos = LABEL_POS_MAP[el.dataLabelPosition ?? ""] ?? "top";
  const hasSecondary = el.secondaryAxis?.visible;

  // Percentage formatter for pie/doughnut labels
  const pctFormatter = (value: number) => {
    const total = el.series[0]?.values.reduce((a, b) => a + b, 0) ?? 1;
    return total > 0 ? `${Math.round((value / total) * 100)}%` : "0%";
  };

  // Trendline data for series that have linear trendlines
  const trendlines = el.series.map((s) => computeTrendlineData(s, data.length));

  // Merge trendline data into chart data for recharts
  const dataWithTrend = data.map((d, i) => {
    const augmented = { ...d };
    trendlines.forEach((tl, si) => {
      if (tl) {
        // Interpolate value for this x position
        const [p0, p1] = tl;
        const slope = (p1.y - p0.y) / (p1.x - p0.x || 1);
        (augmented as Record<string, unknown>)[`trend${si}`] = p0.y + slope * (i - p0.x);
      }
    });
    return augmented;
  });

  switch (el.chartType) {
    case "bar": {
      const isHorizontal = el.barDirection === "horizontal";
      return (
        <BarChart data={dataWithTrend} layout={isHorizontal ? "vertical" : "horizontal"}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          {isHorizontal ? (
            <>
              <XAxis type="number" tick={{ fontSize: 10 }} label={xAxisLabel(el)} />
              <YAxis dataKey="name" type="category" yAxisId="left" tick={{ fontSize: 10 }} label={yAxisLabel(el)} width={80} reversed />
            </>
          ) : (
            <>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} label={xAxisLabel(el)} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} label={yAxisLabel(el)} />
              {hasSecondary && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />}
            </>
          )}
          <Tooltip />
          {el.legend && <Legend verticalAlign={el.legend.position === "top" ? "top" : "bottom"} />}
          {el.series.map((s, i) => (
            <Bar key={i} dataKey={`s${i}`} name={s.name || `Series ${i + 1}`} fill={seriesColors[i]} yAxisId={s.axisId === "right" ? "right" : "left"}>
              {el.showDataLabels && <LabelList dataKey={`s${i}`} position={labelPos} fontSize={9} />}
            </Bar>
          ))}
          {trendlines.map((tl, i) => tl && (
            <Line key={`trend-${i}`} dataKey={`trend${i}`} stroke={seriesColors[i]} strokeDasharray="5 3" dot={false} yAxisId={el.series[i]?.axisId === "right" ? "right" : "left"} name={`${el.series[i]?.name || `Series ${i + 1}`} (trend)`} />
          ))}
        </BarChart>
      );
    }
    case "line":
      return (
        <LineChart data={dataWithTrend}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} label={xAxisLabel(el)} />
          <YAxis yAxisId="left" tick={{ fontSize: 10 }} label={yAxisLabel(el)} />
          {hasSecondary && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />}
          <Tooltip />
          {el.legend && <Legend verticalAlign={el.legend.position === "top" ? "top" : "bottom"} />}
          {el.series.map((s, i) => (
            <Line key={i} dataKey={`s${i}`} name={s.name || `Series ${i + 1}`} stroke={seriesColors[i]} dot={false} yAxisId={s.axisId === "right" ? "right" : "left"}>
              {el.showDataLabels && <LabelList dataKey={`s${i}`} position={labelPos} fontSize={9} />}
            </Line>
          ))}
          {trendlines.map((tl, i) => tl && (
            <Line key={`trend-${i}`} dataKey={`trend${i}`} stroke={seriesColors[i]} strokeDasharray="5 3" dot={false} yAxisId={el.series[i]?.axisId === "right" ? "right" : "left"} name={`${el.series[i]?.name || `Series ${i + 1}`} (trend)`} legendType="none" />
          ))}
        </LineChart>
      );
    case "area":
      return (
        <AreaChart data={dataWithTrend}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} label={xAxisLabel(el)} />
          <YAxis yAxisId="left" tick={{ fontSize: 10 }} label={yAxisLabel(el)} />
          {hasSecondary && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />}
          <Tooltip />
          {el.legend && <Legend verticalAlign={el.legend.position === "top" ? "top" : "bottom"} />}
          {el.series.map((s, i) => (
            <Area key={i} dataKey={`s${i}`} name={s.name || `Series ${i + 1}`} fill={seriesColors[i]} stroke={seriesColors[i]} fillOpacity={0.3} yAxisId={s.axisId === "right" ? "right" : "left"}>
              {el.showDataLabels && <LabelList dataKey={`s${i}`} position={labelPos} fontSize={9} />}
            </Area>
          ))}
          {trendlines.map((tl, i) => tl && (
            <Line key={`trend-${i}`} dataKey={`trend${i}`} stroke={seriesColors[i]} strokeDasharray="5 3" dot={false} yAxisId={el.series[i]?.axisId === "right" ? "right" : "left"} legendType="none" />
          ))}
        </AreaChart>
      );
    case "scatter": {
      // Scatter charts need XY coordinate pairs, not category-based data
      const scatterData = el.series.map((s, i) => {
        const points = s.values.map((y, j) => ({
          x: s.xValues?.[j] ?? j + 1,
          y,
        }));
        return { name: s.name || `Series ${i + 1}`, points, color: seriesColors[i] };
      });
      return (
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="x" type="number" tick={{ fontSize: 10 }} label={xAxisLabel(el)} />
          <YAxis dataKey="y" type="number" tick={{ fontSize: 10 }} label={yAxisLabel(el)} />
          <Tooltip />
          {el.legend && <Legend verticalAlign={el.legend.position === "top" ? "top" : "bottom"} />}
          {scatterData.map((s, i) => (
            <Scatter key={i} name={s.name} data={s.points} fill={s.color} />
          ))}
        </ScatterChart>
      );
    }
    case "pie":
    case "doughnut": {
      const pieData = el.categories.map((cat, i) => ({
        name: cat,
        value: el.series[0]?.values[i] ?? 0,
      }));
      const isPct = el.dataLabelType === "percentage";
      return (
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            innerRadius={el.chartType === "doughnut" ? "40%" : 0}
            outerRadius="80%"
            dataKey="value"
            label={el.showDataLabels ? (isPct ? ({ value }: { value: number }) => pctFormatter(value) : { fontSize: 9 }) : false}
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

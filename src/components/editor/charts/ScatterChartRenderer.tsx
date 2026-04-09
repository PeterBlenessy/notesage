import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig as ShadcnChartConfig,
} from "@/components/ui/chart";
import type { ChartData } from "@/lib/chart-types";
import { AXIS_STYLE, GRID_STYLE, getTickFormatter } from "@/lib/chart-theme";

interface ScatterChartRendererProps {
  chartData: ChartData;
  config: ShadcnChartConfig;
  height: number;
}

export function ScatterChartRenderer({
  chartData,
  config,
  height,
}: ScatterChartRendererProps) {
  const xFormatter = getTickFormatter(chartData.config.xTickFormat);
  const yFormatter = getTickFormatter(chartData.config.yTickFormat);
  const legendPos = chartData.config.legendPosition ?? "bottom";

  return (
    <ChartContainer config={config} className="w-full" style={{ height }}>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
        {chartData.config.showGrid && (
          <CartesianGrid
            stroke={GRID_STYLE.stroke}
            strokeOpacity={GRID_STYLE.strokeOpacity}
            strokeDasharray={GRID_STYLE.strokeDasharray}
          />
        )}
        <XAxis
          type="number"
          dataKey="x"
          name={chartData.config.xLabel || "X"}
          tickLine={false}
          axisLine={false}
          tick={AXIS_STYLE.tick}
          tickFormatter={xFormatter}
          label={
            chartData.config.xLabel
              ? {
                  value: chartData.config.xLabel,
                  position: "insideBottom",
                  offset: -4,
                  style: AXIS_STYLE.tick,
                }
              : undefined
          }
        />
        <YAxis
          type="number"
          dataKey="y"
          name={chartData.config.yLabel || "Y"}
          tickLine={false}
          axisLine={false}
          tick={AXIS_STYLE.tick}
          tickFormatter={yFormatter}
          label={
            chartData.config.yLabel
              ? {
                  value: chartData.config.yLabel,
                  angle: -90,
                  position: "insideLeft",
                  style: AXIS_STYLE.tick,
                }
              : undefined
          }
        />
        <ChartTooltip
          content={<ChartTooltipContent />}
          cursor={{ strokeDasharray: "3 3" }}
        />
        {chartData.config.showLegend && (
          <ChartLegend
            content={<ChartLegendContent />}
            verticalAlign={legendPos === "left" || legendPos === "right" ? "middle" : legendPos}
            align={legendPos === "left" || legendPos === "right" ? legendPos : "center"}
          />
        )}
        {chartData.series && chartData.series.length > 0 ? (
          chartData.series.map((s) => (
            <Scatter
              key={s.key}
              name={s.label}
              data={chartData.data.map((d) => ({
                x: d.x ?? 0,
                y: (d[s.key] as number) ?? 0,
              }))}
              fill={`var(--color-${CSS.escape(s.key)})`}
            />
          ))
        ) : (
          <Scatter
            name="Value"
            data={chartData.data.map((d) => ({
              x: d.x ?? 0,
              y: d.y ?? d.value ?? 0,
            }))}
            fill="var(--color-value)"
          />
        )}
      </ScatterChart>
    </ChartContainer>
  );
}

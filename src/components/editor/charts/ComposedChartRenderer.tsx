import {
  ComposedChart,
  Bar,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
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

interface ComposedChartRendererProps {
  chartData: ChartData;
  config: ShadcnChartConfig;
  height: number;
}

export function ComposedChartRenderer({
  chartData,
  config,
  height,
}: ComposedChartRendererProps) {
  const series = chartData.series ?? [];
  const xFormatter = getTickFormatter(chartData.config.xTickFormat);
  const yFormatter = getTickFormatter(chartData.config.yTickFormat);
  const legendPos = chartData.config.legendPosition ?? "bottom";

  return (
    <ChartContainer config={config} className="w-full" style={{ height }}>
      <ComposedChart
        data={chartData.data}
        margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
      >
        {chartData.config.showGrid && (
          <CartesianGrid
            stroke={GRID_STYLE.stroke}
            strokeOpacity={GRID_STYLE.strokeOpacity}
            strokeDasharray={GRID_STYLE.strokeDasharray}
          />
        )}
        <XAxis
          dataKey="category"
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
        <ChartTooltip content={<ChartTooltipContent />} />
        {chartData.config.showLegend && (
          <ChartLegend
            content={<ChartLegendContent />}
            verticalAlign={legendPos === "left" || legendPos === "right" ? "middle" : legendPos}
            align={legendPos === "left" || legendPos === "right" ? legendPos : "center"}
          />
        )}
        {/* Reference lines */}
        {chartData.config.referenceLines?.map((ref, i) => (
          <ReferenceLine
            key={i}
            x={ref.axis === "x" ? ref.value : undefined}
            y={ref.axis === "y" ? ref.value : undefined}
            label={ref.label ? { value: ref.label, position: "top", style: { fontSize: 11, fill: "var(--color-muted-foreground)" } } : undefined}
            stroke={ref.stroke ?? "var(--color-muted-foreground)"}
            strokeDasharray={ref.strokeDasharray ?? "3 3"}
          />
        ))}
        {series.length > 0 ? (
          series.map((s) => {
            const color = `var(--color-${CSS.escape(s.key)})`;
            const renderAs = s.renderAs ?? "bar";

            switch (renderAs) {
              case "line":
                return (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    stroke={color}
                    strokeWidth={2}
                    dot={{ r: 3, fill: color }}
                    activeDot={{ r: 5 }}
                  />
                );
              case "area":
                return (
                  <Area
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    stroke={color}
                    fill={color}
                    fillOpacity={0.2}
                    strokeWidth={2}
                  />
                );
              case "bar":
              default:
                return (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    fill={color}
                    radius={[4, 4, 0, 0]}
                  />
                );
            }
          })
        ) : (
          <Bar
            dataKey="value"
            fill="var(--color-value)"
            radius={[4, 4, 0, 0]}
          />
        )}
      </ComposedChart>
    </ChartContainer>
  );
}

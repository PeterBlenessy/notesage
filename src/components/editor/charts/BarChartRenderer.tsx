import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  LabelList,
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

interface BarChartRendererProps {
  chartData: ChartData;
  config: ShadcnChartConfig;
  height: number;
}

export function BarChartRenderer({
  chartData,
  config,
  height,
}: BarChartRendererProps) {
  const isHorizontal = chartData.type === "horizontal_bar";
  const xFormatter = getTickFormatter(chartData.config.xTickFormat);
  const yFormatter = getTickFormatter(chartData.config.yTickFormat);
  const legendPos = chartData.config.legendPosition ?? "bottom";

  return (
    <ChartContainer config={config} className="w-full" style={{ height }}>
      <BarChart
        data={chartData.data}
        layout={isHorizontal ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
      >
        {chartData.config.showGrid && (
          <CartesianGrid
            stroke={GRID_STYLE.stroke}
            strokeOpacity={GRID_STYLE.strokeOpacity}
            strokeDasharray={GRID_STYLE.strokeDasharray}
          />
        )}
        {isHorizontal ? (
          <>
            <YAxis
              dataKey="category"
              type="category"
              tickLine={false}
              axisLine={false}
              tick={AXIS_STYLE.tick}
              width={80}
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
            <XAxis
              type="number"
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
          </>
        ) : (
          <>
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
          </>
        )}
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
        {chartData.series && chartData.series.length > 0 ? (
          chartData.series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              fill={`var(--color-${CSS.escape(s.key)})`}
              radius={[4, 4, 0, 0]}
              stackId={chartData.config.stacked ? "stack" : undefined}
            >
              {chartData.config.showDataLabels && (
                <LabelList
                  position="top"
                  style={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                />
              )}
            </Bar>
          ))
        ) : (
          <Bar
            dataKey="value"
            fill="var(--color-value)"
            radius={[4, 4, 0, 0]}
          >
            {chartData.config.showDataLabels && (
              <LabelList
                position="top"
                style={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
              />
            )}
          </Bar>
        )}
      </BarChart>
    </ChartContainer>
  );
}

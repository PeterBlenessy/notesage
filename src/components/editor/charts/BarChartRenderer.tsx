import {
  BarChart,
  Bar,
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
import { AXIS_STYLE, GRID_STYLE } from "@/lib/chart-theme";

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
          <ChartLegend content={<ChartLegendContent />} />
        )}
        {chartData.series && chartData.series.length > 0 ? (
          chartData.series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              fill={`var(--color-${CSS.escape(s.key)})`}
              radius={[4, 4, 0, 0]}
            />
          ))
        ) : (
          <Bar
            dataKey="value"
            fill="var(--color-value)"
            radius={[4, 4, 0, 0]}
          />
        )}
      </BarChart>
    </ChartContainer>
  );
}

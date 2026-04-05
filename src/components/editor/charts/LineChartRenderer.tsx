import {
  LineChart,
  Line,
  AreaChart,
  Area,
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

interface LineChartRendererProps {
  chartData: ChartData;
  config: ShadcnChartConfig;
  height: number;
}

export function LineChartRenderer({
  chartData,
  config,
  height,
}: LineChartRendererProps) {
  const isArea = chartData.type === "area";

  const axisElements = (
    <>
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
      <ChartTooltip content={<ChartTooltipContent />} />
      {chartData.config.showLegend && (
        <ChartLegend content={<ChartLegendContent />} />
      )}
    </>
  );

  if (isArea) {
    return (
      <ChartContainer config={config} className="w-full" style={{ height }}>
        <AreaChart
          data={chartData.data}
          margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
        >
          {axisElements}
          {chartData.series && chartData.series.length > 0 ? (
            chartData.series.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={`var(--color-${CSS.escape(s.key)})`}
                fill={`var(--color-${CSS.escape(s.key)})`}
                fillOpacity={0.2}
                strokeWidth={2}
              />
            ))
          ) : (
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--color-value)"
              fill="var(--color-value)"
              fillOpacity={0.2}
              strokeWidth={2}
            />
          )}
        </AreaChart>
      </ChartContainer>
    );
  }

  return (
    <ChartContainer config={config} className="w-full" style={{ height }}>
      <LineChart
        data={chartData.data}
        margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
      >
        {axisElements}
        {chartData.series && chartData.series.length > 0 ? (
          chartData.series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={`var(--color-${CSS.escape(s.key)})`}
              strokeWidth={2}
              dot={{ r: 3, fill: `var(--color-${CSS.escape(s.key)})` }}
              activeDot={{ r: 5 }}
            />
          ))
        ) : (
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--color-value)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--color-value)" }}
            activeDot={{ r: 5 }}
          />
        )}
      </LineChart>
    </ChartContainer>
  );
}

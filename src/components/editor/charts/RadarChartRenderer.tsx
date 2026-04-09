import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
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

interface RadarChartRendererProps {
  chartData: ChartData;
  config: ShadcnChartConfig;
  height: number;
}

export function RadarChartRenderer({
  chartData,
  config,
  height,
}: RadarChartRendererProps) {
  const legendPos = chartData.config.legendPosition ?? "bottom";

  return (
    <ChartContainer config={config} className="w-full" style={{ height }}>
      <RadarChart
        data={chartData.data}
        margin={{ top: 8, right: 24, bottom: 8, left: 24 }}
      >
        <PolarGrid stroke="var(--color-border)" strokeOpacity={0.5} />
        <PolarAngleAxis
          dataKey="category"
          tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
        />
        <PolarRadiusAxis
          tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
          axisLine={false}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        {chartData.config.showLegend && (
          <ChartLegend
            content={<ChartLegendContent />}
            verticalAlign={legendPos === "left" || legendPos === "right" ? "middle" : legendPos}
            align={legendPos === "left" || legendPos === "right" ? legendPos : "center"}
          />
        )}
        {chartData.series && chartData.series.length > 0 ? (
          chartData.series.map((s) => (
            <Radar
              key={s.key}
              name={s.label}
              dataKey={s.key}
              stroke={`var(--color-${CSS.escape(s.key)})`}
              fill={`var(--color-${CSS.escape(s.key)})`}
              fillOpacity={0.15}
              strokeWidth={2}
            />
          ))
        ) : (
          <Radar
            name="Value"
            dataKey="value"
            stroke="var(--color-value)"
            fill="var(--color-value)"
            fillOpacity={0.15}
            strokeWidth={2}
          />
        )}
      </RadarChart>
    </ChartContainer>
  );
}

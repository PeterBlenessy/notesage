import { PieChart, Pie, Cell } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig as ShadcnChartConfig,
} from "@/components/ui/chart";
import type { ChartData } from "@/lib/chart-types";
import { COLOR_PALETTES } from "@/lib/chart-types";
import { useSettingsStore } from "@/stores/settings-store";

interface PieChartRendererProps {
  chartData: ChartData;
  config: ShadcnChartConfig;
  height: number;
}

export function PieChartRenderer({
  chartData,
  config,
  height,
}: PieChartRendererProps) {
  const isDonut = chartData.type === "donut";
  const theme = useSettingsStore((s) => s.theme);
  const resolvedTheme =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  const palette = COLOR_PALETTES[chartData.config.colorScheme];
  const colors = resolvedTheme === "dark" ? palette.dark : palette.light;

  return (
    <ChartContainer config={config} className="w-full" style={{ height }}>
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        {chartData.config.showLegend && (
          <ChartLegend content={<ChartLegendContent nameKey="category" />} />
        )}
        <Pie
          data={chartData.data}
          dataKey="value"
          nameKey="category"
          cx="50%"
          cy="50%"
          innerRadius={isDonut ? "55%" : 0}
          outerRadius="80%"
          strokeWidth={2}
          stroke="var(--color-background)"
        >
          {chartData.data.map((_, i) => (
            <Cell
              key={i}
              fill={colors[i % colors.length]}
            />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}

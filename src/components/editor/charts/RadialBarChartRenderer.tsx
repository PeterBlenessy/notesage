import { RadialBarChart, RadialBar } from "recharts";
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

interface RadialBarChartRendererProps {
  chartData: ChartData;
  config: ShadcnChartConfig;
  height: number;
}

export function RadialBarChartRenderer({
  chartData,
  config,
  height,
}: RadialBarChartRendererProps) {
  const theme = useSettingsStore((s) => s.theme);
  const resolvedTheme =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  const palette = COLOR_PALETTES[chartData.config.colorScheme];
  const colors = resolvedTheme === "dark" ? palette.dark : palette.light;

  // Each data point becomes a concentric arc with its own fill color
  const radialData = chartData.data.map((point, i) => ({
    ...point,
    fill: colors[i % colors.length],
  }));

  return (
    <ChartContainer config={config} className="w-full" style={{ height }}>
      <RadialBarChart
        data={radialData}
        innerRadius="20%"
        outerRadius="90%"
        startAngle={180}
        endAngle={0}
      >
        <ChartTooltip content={<ChartTooltipContent nameKey="category" />} />
        {chartData.config.showLegend && (
          <ChartLegend content={<ChartLegendContent nameKey="category" />} />
        )}
        <RadialBar
          dataKey="value"
          background={{ fill: "var(--color-muted)" }}
          cornerRadius={4}
        />
      </RadialBarChart>
    </ChartContainer>
  );
}

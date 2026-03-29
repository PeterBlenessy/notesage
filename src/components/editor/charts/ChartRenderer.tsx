import { useMemo } from "react";
import type { ChartData } from "@/lib/chart-types";
import { getChartConfig } from "@/lib/chart-theme";
import { BarChartRenderer } from "./BarChartRenderer";
import { LineChartRenderer } from "./LineChartRenderer";
import { PieChartRenderer } from "./PieChartRenderer";

interface ChartRendererProps {
  chartData: ChartData;
  height?: number;
}

export function ChartRenderer({
  chartData,
  height = 300,
}: ChartRendererProps) {
  const config = useMemo(
    () =>
      getChartConfig(
        chartData.data,
        chartData.config.colorScheme,
        chartData.series?.map((s) => s.key)
      ),
    [chartData.data, chartData.config.colorScheme, chartData.series]
  );

  switch (chartData.type) {
    case "bar":
    case "horizontal_bar":
      return (
        <BarChartRenderer
          chartData={chartData}
          config={config}
          height={height}
        />
      );

    case "line":
    case "area":
      return (
        <LineChartRenderer
          chartData={chartData}
          config={config}
          height={height}
        />
      );

    case "pie":
    case "donut":
      return (
        <PieChartRenderer
          chartData={chartData}
          config={config}
          height={height}
        />
      );

    default:
      return null;
  }
}

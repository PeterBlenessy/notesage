/**
 * Chart theme configuration with shadcn/ui ChartConfig.
 *
 * Maps color schemes to CSS variables and builds ChartConfig
 * objects for use with shadcn/ui's ChartContainer.
 */

import type { ChartConfig as ShadcnChartConfig } from "@/components/ui/chart";
import type { ColorScheme, ChartDataPoint } from "@/lib/chart-types";
import { COLOR_PALETTES } from "@/lib/chart-types";

/**
 * Build a shadcn/ui ChartConfig from chart data and a color scheme.
 *
 * Each data point gets a color assigned from the palette. The config
 * maps data keys (e.g., "value", or series keys) to colors and labels.
 */
export function getChartConfig(
  data: ChartDataPoint[],
  scheme: ColorScheme,
  seriesKeys?: string[]
): ShadcnChartConfig {
  const palette = COLOR_PALETTES[scheme];
  const config: ShadcnChartConfig = {};

  if (seriesKeys && seriesKeys.length > 0) {
    // Multi-series: each series key gets a color
    seriesKeys.forEach((key, i) => {
      config[key] = {
        label: key,
        theme: {
          light: palette.light[i % palette.light.length],
          dark: palette.dark[i % palette.dark.length],
        },
      };
    });
  } else {
    // Single-series: use "value" as the key
    config.value = {
      label: "Value",
      theme: {
        light: palette.light[0],
        dark: palette.dark[0],
      },
    };

    // For pie/donut: each data point gets its own color entry
    data.forEach((point, i) => {
      config[point.category] = {
        label: point.category,
        theme: {
          light: palette.light[i % palette.light.length],
          dark: palette.dark[i % palette.dark.length],
        },
      };
    });
  }

  return config;
}

/**
 * Transform chart data for Recharts pie/donut charts.
 * Each data point needs a `fill` property referencing the CSS variable.
 */
export function getPieData(
  data: ChartDataPoint[]
): (ChartDataPoint & { fill: string })[] {
  return data.map((point) => ({
    ...point,
    fill: `var(--color-${CSS.escape(point.category)})`,
  }));
}

/**
 * Common Recharts axis styling to match Notesage's design system.
 */
export const AXIS_STYLE = {
  tick: {
    fontSize: 12,
    fill: "var(--color-muted-foreground)",
  },
  axisLine: {
    stroke: "var(--color-border)",
  },
  tickLine: {
    stroke: "var(--color-border)",
  },
} as const;

export const GRID_STYLE = {
  stroke: "var(--color-border)",
  strokeOpacity: 0.5,
  strokeDasharray: "3 3",
} as const;

/**
 * Chart data types, color schemes, and chart type metadata.
 */

import {
  BarChart3,
  LineChart,
  AreaChart,
  PieChart,
  CircleDot,
  AlignLeft,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ─── Data Model ──────────────────────────────────────────────

export type ChartType =
  | "bar"
  | "line"
  | "area"
  | "pie"
  | "donut"
  | "horizontal_bar";

export interface ChartDataPoint {
  category: string;
  value: number;
  [seriesKey: string]: string | number;
}

export interface ChartSeries {
  key: string;
  label: string;
}

export interface ChartConfig {
  xLabel: string;
  yLabel: string;
  showGrid: boolean;
  showLegend: boolean;
  colorScheme: ColorScheme;
}

export interface ChartData {
  type: ChartType;
  title: string;
  data: ChartDataPoint[];
  series?: ChartSeries[];
  config: ChartConfig;
}

// ─── Color Schemes ───────────────────────────────────────────

export type ColorScheme = "neutral" | "monochrome" | "warm" | "cool";

export interface ColorPalette {
  label: string;
  light: string[];
  dark: string[];
}

/**
 * Four curated color palettes with 5 colors each for light and dark mode.
 * Colors use low-chroma oklch values consistent with the design system,
 * with just enough saturation to distinguish series.
 */
export const COLOR_PALETTES: Record<ColorScheme, ColorPalette> = {
  neutral: {
    label: "Neutral",
    light: [
      "oklch(45% 0.02 250)",
      "oklch(60% 0.02 250)",
      "oklch(50% 0.02 30)",
      "oklch(55% 0.02 150)",
      "oklch(65% 0.02 80)",
    ],
    dark: [
      "oklch(70% 0.02 250)",
      "oklch(55% 0.02 250)",
      "oklch(65% 0.02 30)",
      "oklch(60% 0.02 150)",
      "oklch(75% 0.02 80)",
    ],
  },
  monochrome: {
    label: "Monochrome",
    light: [
      "oklch(30% 0 0)",
      "oklch(45% 0 0)",
      "oklch(58% 0 0)",
      "oklch(70% 0 0)",
      "oklch(82% 0 0)",
    ],
    dark: [
      "oklch(90% 0 0)",
      "oklch(75% 0 0)",
      "oklch(60% 0 0)",
      "oklch(48% 0 0)",
      "oklch(36% 0 0)",
    ],
  },
  warm: {
    label: "Warm",
    light: [
      "oklch(50% 0.04 50)",
      "oklch(55% 0.04 30)",
      "oklch(60% 0.03 70)",
      "oklch(48% 0.04 15)",
      "oklch(65% 0.03 90)",
    ],
    dark: [
      "oklch(70% 0.04 50)",
      "oklch(65% 0.04 30)",
      "oklch(72% 0.03 70)",
      "oklch(62% 0.04 15)",
      "oklch(75% 0.03 90)",
    ],
  },
  cool: {
    label: "Cool",
    light: [
      "oklch(48% 0.04 240)",
      "oklch(55% 0.04 210)",
      "oklch(50% 0.03 270)",
      "oklch(60% 0.04 195)",
      "oklch(53% 0.03 300)",
    ],
    dark: [
      "oklch(68% 0.04 240)",
      "oklch(72% 0.04 210)",
      "oklch(65% 0.03 270)",
      "oklch(75% 0.04 195)",
      "oklch(70% 0.03 300)",
    ],
  },
};

export const COLOR_SCHEME_OPTIONS: { value: ColorScheme; label: string }[] = [
  { value: "neutral", label: "Neutral" },
  { value: "monochrome", label: "Monochrome" },
  { value: "warm", label: "Warm" },
  { value: "cool", label: "Cool" },
];

// ─── Chart Type Metadata ─────────────────────────────────────

export interface ChartTypeMeta {
  type: ChartType;
  name: string;
  description: string;
  icon: LucideIcon;
  /** Whether this chart type uses category + value (cartesian) or label + value (radial) */
  dataShape: "cartesian" | "radial";
}

export const CHART_TYPES: ChartTypeMeta[] = [
  {
    type: "bar",
    name: "Bar",
    description: "Vertical bar chart",
    icon: BarChart3,
    dataShape: "cartesian",
  },
  {
    type: "line",
    name: "Line",
    description: "Line chart",
    icon: LineChart,
    dataShape: "cartesian",
  },
  {
    type: "area",
    name: "Area",
    description: "Filled area chart",
    icon: AreaChart,
    dataShape: "cartesian",
  },
  {
    type: "pie",
    name: "Pie",
    description: "Pie chart",
    icon: PieChart,
    dataShape: "radial",
  },
  {
    type: "donut",
    name: "Donut",
    description: "Donut chart",
    icon: CircleDot,
    dataShape: "radial",
  },
  {
    type: "horizontal_bar",
    name: "H. Bar",
    description: "Horizontal bar chart",
    icon: AlignLeft,
    dataShape: "cartesian",
  },
];

export function getChartTypeMeta(type: ChartType): ChartTypeMeta {
  return CHART_TYPES.find((t) => t.type === type) ?? CHART_TYPES[0];
}

// ─── Defaults ────────────────────────────────────────────────

export const DEFAULT_CHART_CONFIG: ChartConfig = {
  xLabel: "",
  yLabel: "",
  showGrid: true,
  showLegend: false,
  colorScheme: "neutral",
};

export const DEFAULT_CHART_DATA: ChartDataPoint[] = [
  { category: "Category A", value: 40 },
  { category: "Category B", value: 30 },
  { category: "Category C", value: 20 },
  { category: "Category D", value: 10 },
];

export function createEmptyChartData(type: ChartType = "bar"): ChartData {
  return {
    type,
    title: "",
    data: [...DEFAULT_CHART_DATA.map((d) => ({ ...d }))],
    config: { ...DEFAULT_CHART_CONFIG },
  };
}

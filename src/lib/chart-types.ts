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
  Radar,
  ScatterChart,
  Circle,
  Layers,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ─── Data Model ──────────────────────────────────────────────

export type ChartType =
  | "bar"
  | "line"
  | "area"
  | "pie"
  | "donut"
  | "horizontal_bar"
  | "radar"
  | "scatter"
  | "radial_bar"
  | "composed";

export interface ChartDataPoint {
  category: string;
  value: number;
  /** Scatter charts: numeric X coordinate */
  x?: number;
  /** Scatter charts: numeric Y coordinate */
  y?: number;
  [seriesKey: string]: string | number | undefined;
}

export interface ChartSeries {
  key: string;
  label: string;
  /** Composed charts: render this series as bar, line, or area */
  renderAs?: "bar" | "line" | "area";
}

export interface ReferenceLine {
  axis: "x" | "y";
  value: number | string;
  label?: string;
  stroke?: string;
  strokeDasharray?: string;
}

export interface ChartConfig {
  xLabel: string;
  yLabel: string;
  showGrid: boolean;
  showLegend: boolean;
  colorScheme: ColorScheme;
  /** Show value labels on data points (default: false) */
  showDataLabels?: boolean;
  /** Pie/donut slice label format (default: "none") */
  pieLabels?: "none" | "value" | "percent" | "name";
  /** Stack bars/areas in multi-series charts (default: false) */
  stacked?: boolean;
  /** Line/area interpolation curve (default: "monotone") */
  curveType?: "monotone" | "linear" | "step" | "natural" | "basis";
  /** Legend position (default: "bottom") */
  legendPosition?: "bottom" | "top" | "left" | "right";
  /** X axis tick format (default: "plain") */
  xTickFormat?: "plain" | "thousands" | "percent" | "currency";
  /** Y axis tick format (default: "plain") */
  yTickFormat?: "plain" | "thousands" | "percent" | "currency";
  /** Reference lines on cartesian charts */
  referenceLines?: ReferenceLine[];
}

export interface ChartData {
  type: ChartType;
  title: string;
  data: ChartDataPoint[];
  series?: ChartSeries[];
  config: ChartConfig;
}

// ─── Color Schemes ───────────────────────────────────────────

export type ColorScheme =
  | "neutral"
  | "monochrome"
  | "warm"
  | "cool"
  | "vivid"
  | "ocean"
  | "forest"
  | "sunset";

export interface ColorPalette {
  label: string;
  light: string[];
  dark: string[];
}

/**
 * Eight curated color palettes with 5 colors each for light and dark mode.
 * Muted palettes (neutral, monochrome, warm, cool) use low chroma for subtle charts.
 * Vivid palettes (vivid, ocean, forest, sunset) use full chroma for expressive charts.
 * Charts are document content, not UI chrome — chromatic colors are permitted
 * per the design system's editor content color exception.
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
  vivid: {
    label: "Vivid",
    light: [
      "oklch(55% 0.18 260)",  // blue
      "oklch(55% 0.18 25)",   // red-orange
      "oklch(60% 0.18 150)",  // green
      "oklch(55% 0.15 310)",  // purple
      "oklch(65% 0.16 75)",   // amber
    ],
    dark: [
      "oklch(70% 0.16 260)",
      "oklch(70% 0.16 25)",
      "oklch(72% 0.16 150)",
      "oklch(70% 0.14 310)",
      "oklch(75% 0.14 75)",
    ],
  },
  ocean: {
    label: "Ocean",
    light: [
      "oklch(50% 0.15 240)",  // deep blue
      "oklch(55% 0.13 200)",  // teal
      "oklch(60% 0.12 180)",  // cyan
      "oklch(50% 0.16 270)",  // indigo
      "oklch(65% 0.10 160)",  // sea green
    ],
    dark: [
      "oklch(68% 0.14 240)",
      "oklch(70% 0.12 200)",
      "oklch(72% 0.11 180)",
      "oklch(66% 0.14 270)",
      "oklch(75% 0.09 160)",
    ],
  },
  forest: {
    label: "Forest",
    light: [
      "oklch(48% 0.14 145)",  // deep green
      "oklch(55% 0.12 120)",  // olive
      "oklch(50% 0.10 85)",   // dark gold
      "oklch(45% 0.12 170)",  // dark teal
      "oklch(60% 0.08 50)",   // brown
    ],
    dark: [
      "oklch(68% 0.13 145)",
      "oklch(72% 0.11 120)",
      "oklch(70% 0.09 85)",
      "oklch(65% 0.11 170)",
      "oklch(75% 0.07 50)",
    ],
  },
  sunset: {
    label: "Sunset",
    light: [
      "oklch(55% 0.20 30)",   // red
      "oklch(60% 0.18 55)",   // orange
      "oklch(65% 0.16 80)",   // gold
      "oklch(50% 0.18 350)",  // rose
      "oklch(55% 0.14 15)",   // coral
    ],
    dark: [
      "oklch(70% 0.17 30)",
      "oklch(72% 0.15 55)",
      "oklch(75% 0.14 80)",
      "oklch(68% 0.16 350)",
      "oklch(70% 0.12 15)",
    ],
  },
};

export const COLOR_SCHEME_OPTIONS: { value: ColorScheme; label: string }[] = [
  { value: "vivid", label: "Vivid" },
  { value: "ocean", label: "Ocean" },
  { value: "forest", label: "Forest" },
  { value: "sunset", label: "Sunset" },
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
  /** Data shape classification for the chart type */
  dataShape: "cartesian" | "radial" | "polar" | "xy";
}

/** Returns true for cartesian chart types (bar, line, area, horizontal_bar, composed) */
export function isCartesian(type: ChartType): boolean {
  return (
    type === "bar" ||
    type === "line" ||
    type === "area" ||
    type === "horizontal_bar" ||
    type === "composed"
  );
}

/** Returns true for radial chart types (pie, donut, radial_bar) */
export function isRadial(type: ChartType): boolean {
  return type === "pie" || type === "donut" || type === "radial_bar";
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
  {
    type: "radar",
    name: "Radar",
    description: "Radar / spider chart",
    icon: Radar,
    dataShape: "polar",
  },
  {
    type: "scatter",
    name: "Scatter",
    description: "Scatter plot",
    icon: ScatterChart,
    dataShape: "xy",
  },
  {
    type: "radial_bar",
    name: "Radial",
    description: "Radial bar chart",
    icon: Circle,
    dataShape: "radial",
  },
  {
    type: "composed",
    name: "Composed",
    description: "Mixed bar, line & area",
    icon: Layers,
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

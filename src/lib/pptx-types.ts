/**
 * PPTX parsed data model — contract between pptx-parser.ts and PptxViewer.tsx.
 * All positions/sizes are in EMUs (English Metric Units, 1 inch = 914400 EMU).
 */

export interface PptxPresentation {
  slideWidth: number;
  slideHeight: number;
  slides: PptxSlide[];
  theme: PptxTheme;
}

export interface PptxSlide {
  index: number;
  elements: PptxElement[];
  background: PptxBackground | null;
  notes: string;
  searchText: string;
}

export type PptxElement =
  | PptxTextBox
  | PptxImage
  | PptxShape
  | PptxTable
  | PptxChart
  | PptxGroup;

export interface PptxTextBox {
  type: "textbox";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  paragraphs: PptxParagraph[];
}

export interface PptxParagraph {
  alignment: "left" | "center" | "right" | "justify";
  runs: PptxTextRun[];
  bulletChar: string | null;
  bulletLevel: number;
}

export interface PptxTextRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontSize: number;
  fontFamily: string;
  color: string;
}

export interface PptxImage {
  type: "image";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  dataUrl: string;
}

export interface PptxShape {
  type: "shape";
  shapeType: "rect" | "ellipse" | "line" | "arrow" | "roundRect" | "other";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fill: PptxFill | null;
  stroke: string | null;
  strokeWidth: number;
  text: PptxParagraph[];
}

export type PptxFill =
  | { type: "solid"; color: string }
  | { type: "linear"; angle: number; stops: PptxGradientStop[] }
  | { type: "radial"; stops: PptxGradientStop[] }
  | { type: "pattern"; foreground: string };

export interface PptxGradientStop {
  position: number;
  color: string;
}

export interface PptxChart {
  type: "chart";
  x: number;
  y: number;
  width: number;
  height: number;
  chartType: "bar" | "line" | "pie" | "area" | "scatter" | "doughnut" | "other";
  series: PptxChartSeries[];
  categories: string[];
}

export interface PptxChartSeries {
  name: string;
  values: number[];
  color: string | null;
}

export interface PptxTable {
  type: "table";
  x: number;
  y: number;
  width: number;
  height: number;
  rows: PptxTableRow[];
}

export interface PptxTableRow {
  height: number;
  cells: PptxTableCell[];
}

export interface PptxTableCell {
  width: number;
  paragraphs: PptxParagraph[];
  fill: string | null;
  colspan: number;
  rowspan: number;
}

export interface PptxGroup {
  type: "group";
  x: number;
  y: number;
  width: number;
  height: number;
  children: PptxElement[];
}

export interface PptxBackground {
  fill: PptxFill | null;
  imageDataUrl: string | null;
}

export interface PptxTheme {
  colors: Record<string, string>;
  fonts: { heading: string; body: string };
}

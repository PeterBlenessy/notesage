/**
 * PPTX parsed data model — contract between pptx-parser.ts and PptxViewer.tsx.
 * All positions/sizes are in EMUs (English Metric Units, 1 inch = 914400 EMU).
 */

export interface PptxPresentation {
  slideWidth: number;
  slideHeight: number;
  slides: PptxSlide[];
  theme: PptxTheme;
  masters: PptxSlideMaster[];
  layouts: PptxSlideLayout[];
  defaultTextStyle?: PptxTextStyle;
  defaultTextLevelStyles?: PptxTextStyle[];
  sections?: PptxSection[];
}

export interface PptxSection {
  name: string;
  startSlide: number;
}

export interface PptxSlide {
  index: number;
  elements: PptxElement[];
  background: PptxBackground | null;
  notes: string;
  searchText: string;
  headerFooter?: {
    showDate: boolean;
    showFooter: boolean;
    showSlideNum: boolean;
    dateText?: string;
    footerText?: string;
  };
  comments?: PptxComment[];
  layoutIndex?: number;
  masterIndex?: number;
  masterShapes?: PptxElement[];
  layoutShapes?: PptxElement[];
}

export type PptxElement =
  | PptxTextBox
  | PptxImage
  | PptxShape
  | PptxTable
  | PptxChart
  | PptxGroup;

export interface BodyProperties {
  anchor: "top" | "center" | "bottom";
  marginLeft: number;   // EMU
  marginTop: number;    // EMU
  marginRight: number;  // EMU
  marginBottom: number; // EMU
  fontScale: number;    // 0-1 (e.g., 0.75 for 75%)
  autoFit: boolean;
  wrap: boolean;
}

export interface PptxTextBox {
  type: "textbox";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipH?: boolean;
  flipV?: boolean;
  paragraphs: PptxParagraph[];
  bodyProps?: BodyProperties;
  hyperlink?: string;
  shadow?: PptxShadow;
  placeholderType?: string;
  placeholderIdx?: number;
  shapeLevelStyles?: PptxTextStyle[];
}

export interface PptxParagraph {
  alignment: "left" | "center" | "right" | "justify";
  /** True when the paragraph has an explicit algn attribute in pPr (not defaulted from theme) */
  explicitAlignment?: boolean;
  runs: PptxTextRun[];
  bulletChar: string | null;
  bulletLevel: number;
  lineSpacing?: number;     // as multiplier (1.5 = 150%)
  spaceBefore?: number;     // px
  spaceAfter?: number;      // px
  indent?: number;          // px (first line indent)
  marginLeft?: number;      // px (paragraph left margin, separate from bullet level)
  bulletAutoNum?: {
    type: string;           // e.g., "arabicPeriod", "alphaLcPeriod", "romanUcPeriod"
    startAt: number;
  };
  bulletFont?: string;
  bulletColor?: string;
  bulletSizePercent?: number; // relative to text size, e.g., 100
  tabStops?: { pos: number; align: string }[];  // pos in px (converted from EMU)
}

export interface PptxTextRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  underlineStyle?: string;   // raw OOXML underline type (sng, dbl, heavy, dotted, dash, wavy, etc.)
  underlineColor?: string;   // hex color for underline
  strikethrough?: "single" | "double";
  baseline?: number; // positive = superscript, negative = subscript (in 1000ths of %)
  fontSize: number;
  fontFamily: string;
  color: string;
  letterSpacing?: number;
  caps?: "all" | "small";
  highlight?: string;        // hex color for text background highlight
  kern?: number;             // minimum font size in hundredths of a point for kerning
  eaFont?: string;           // East Asian font
  csFont?: string;           // Complex Script font
  hyperlink?: string; // external URL or "slide:N" for internal links
  shadow?: PptxShadow;
}

export interface PptxImage {
  type: "image";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipH?: boolean;
  flipV?: boolean;
  dataUrl: string;
  opacity?: number;
  hyperlink?: string;
  crop?: {
    left: number;    // percentage 0-100
    top: number;     // percentage 0-100
    right: number;   // percentage 0-100
    bottom: number;  // percentage 0-100
  };
  shadow?: PptxShadow;
  reflection?: {
    blurRadius: number;   // px
    startOpacity: number; // 0-1
    endOpacity: number;   // 0-1
    distance: number;     // px gap between image and reflection
    direction: number;    // degrees (typically 90 = below)
    size: number;         // percentage of image height to reflect (0-100)
  };
}

export interface ArrowHead {
  type: "triangle" | "stealth" | "diamond" | "oval" | "arrow";
  width?: "sm" | "med" | "lg";
  length?: "sm" | "med" | "lg";
}

export interface PptxShape {
  type: "shape";
  shapeType: "rect" | "ellipse" | "line" | "arrow" | "roundRect" | "other";
  presetGeometry?: string;  // raw DrawingML preset name (e.g., "triangle", "star5", "flowChartDecision")
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipH?: boolean;
  flipV?: boolean;
  fill: PptxFill | null;
  stroke: string | null;
  strokeWidth: number;
  dashStyle?: string;
  text: PptxParagraph[];
  headArrow?: ArrowHead;
  tailArrow?: ArrowHead;
  bodyProps?: BodyProperties;
  hyperlink?: string;
  shadow?: PptxShadow;
  glow?: { radius: number; color: string; alpha: number };
  softEdge?: number;  // radius in px
  placeholderType?: string;
  placeholderIdx?: number;
  shapeLevelStyles?: PptxTextStyle[];
}

export type PptxFill =
  | { type: "solid"; color: string; alpha?: number }
  | { type: "linear"; angle: number; stops: PptxGradientStop[] }
  | { type: "radial"; stops: PptxGradientStop[] }
  | { type: "pattern"; preset?: string; foreground: string; background?: string }
  | { type: "picture"; dataUrl: string; stretch?: boolean; tile?: boolean; crop?: { left: number; top: number; right: number; bottom: number } };

export interface PptxGradientStop {
  position: number;
  color: string;
  alpha?: number;
}

export interface PptxShadow {
  offsetX: number;  // px
  offsetY: number;  // px
  blur: number;     // px
  color: string;    // hex
  alpha: number;    // 0-1
}

export interface PptxChart {
  type: "chart";
  x: number;
  y: number;
  width: number;
  height: number;
  chartType: "bar" | "line" | "pie" | "area" | "scatter" | "doughnut" | "radar" | "bubble" | "other";
  series: PptxChartSeries[];
  categories: string[];
  title?: string;
  legend?: {
    position: "top" | "bottom" | "left" | "right";
    entries?: string[];
  };
  axes?: {
    categoryAxis?: { title?: string; visible: boolean };
    valueAxis?: { title?: string; visible: boolean; numberFormat?: string };
  };
  showDataLabels?: boolean;
  dataLabelType?: "value" | "category" | "percentage";
  /** Data label position from dLblPos: "t" | "b" | "l" | "r" | "ctr" | "outEnd" | "inEnd" | "inBase" */
  dataLabelPosition?: string;
  /** Secondary value axis (when chart has two valAx elements) */
  secondaryAxis?: {
    title?: string;
    visible: boolean;
    numberFormat?: string;
  };
}

export interface PptxChartSeries {
  name: string;
  values: number[];
  color: string | null;
  /** X coordinates for bubble/scatter charts */
  xValues?: number[];
  /** Bubble sizes for bubble charts */
  bubbleSizes?: number[];
  /** Which axis this series belongs to — "right" for secondary axis */
  axisId?: string;
  /** Trendline configuration */
  trendline?: {
    type: "linear" | "exponential" | "polynomial" | "power" | "logarithmic";
    order?: number;
    forward?: number;
    backward?: number;
  };
}

export interface PptxTableStylePart {
  fill?: string;  // hex color
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;
  fontColor?: string;
}

export interface PptxTableStyle {
  wholeTbl?: PptxTableStylePart;
  band1H?: PptxTableStylePart;
  band2H?: PptxTableStylePart;
  band1V?: PptxTableStylePart;
  band2V?: PptxTableStylePart;
  firstRow?: PptxTableStylePart;
  lastRow?: PptxTableStylePart;
  firstCol?: PptxTableStylePart;
  lastCol?: PptxTableStylePart;
}

export interface PptxTable {
  type: "table";
  x: number;
  y: number;
  width: number;
  height: number;
  rows: PptxTableRow[];
  style?: PptxTableStyle;
  bandRow?: boolean;
  bandCol?: boolean;
  firstRow?: boolean;
  lastRow?: boolean;
  firstCol?: boolean;
  lastCol?: boolean;
}

export interface PptxTableRow {
  height: number;
  cells: PptxTableCell[];
}

export interface CellBorder {
  width: number;    // px
  color: string;    // hex
  dash?: string;    // CSS border-style
  none?: boolean;   // true if noFill
}

export interface PptxTableCell {
  width: number;
  paragraphs: PptxParagraph[];
  fill: string | PptxFill | null;  // string for hex color, PptxFill for gradient/pattern
  colspan: number;
  rowspan: number;
  borders?: {
    left?: CellBorder;
    right?: CellBorder;
    top?: CellBorder;
    bottom?: CellBorder;
  };
  margins?: {
    left: number;   // px
    top: number;    // px
    right: number;  // px
    bottom: number; // px
  };
  verticalAlign?: 'top' | 'center' | 'bottom';
}

export interface PptxGroup {
  type: "group";
  x: number;
  y: number;
  width: number;
  height: number;
  flipH?: boolean;
  flipV?: boolean;
  children: PptxElement[];
}

export interface PptxBackground {
  fill: PptxFill | null;
  imageDataUrl: string | null;
  tiled?: boolean;
}

export interface PptxTheme {
  colors: Record<string, string>;
  fonts: { heading: string; body: string };
  defaultFontSize?: number;  // from theme objectDefaults, in hundredths of point (e.g., 2400 = 24pt)
  defaultAlignment?: 'left' | 'center' | 'right' | 'justify';  // from theme objectDefaults spDef
  clrMap?: Record<string, string>;
  tableStyles?: Map<string, PptxTableStyle>;
}

export interface PptxPlaceholder {
  type: string; // e.g., "title", "body", "ctrTitle", "subTitle", "dt", "ftr", "sldNum"
  idx?: number; // placeholder index
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PptxSlideLayout {
  name: string;
  shapes: PptxElement[];
  placeholders: PptxPlaceholder[];
  background: PptxBackground | null;
}

export interface PptxSlideMaster {
  shapes: PptxElement[];
  placeholders: PptxPlaceholder[];
  background: PptxBackground | null;
  titleStyle?: PptxTextStyle;
  bodyStyle?: PptxTextStyle;
  otherStyle?: PptxTextStyle;
  titleLevelStyles?: PptxTextStyle[];
  bodyLevelStyles?: PptxTextStyle[];
  otherLevelStyles?: PptxTextStyle[];
  clrMap?: Record<string, string>;
}

export interface PptxTextStyle {
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  alignment?: 'left' | 'center' | 'right' | 'justify';
  bulletChar?: string;
  bulletAutoNumType?: string;
  bulletFont?: string;
  bulletColor?: string;
  bulletSizePercent?: number;
}

export interface PptxComment {
  author: string;
  date: string;
  text: string;
  x: number;  // EMU position on slide
  y: number;  // EMU position on slide
}

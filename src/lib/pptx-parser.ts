import JSZip from "jszip";
import type {
  PptxPresentation,
  PptxSlide,
  PptxElement,
  PptxTextBox,
  PptxImage,
  PptxShape,
  PptxTable,
  PptxTableRow,
  PptxTableCell,
  CellBorder,
  PptxChart,
  PptxChartSeries,
  PptxGroup,
  PptxBackground,
  PptxTheme,
  PptxFill,
  PptxParagraph,
  PptxSlideMaster,
  PptxSlideLayout,
  PptxPlaceholder,
  PptxTextStyle,
  PptxTableStyle,
  PptxTableStylePart,
  PptxComment,
  PptxSection,
} from "./pptx-types";

// ---------------------------------------------------------------------------
// Imports from extracted modules
// ---------------------------------------------------------------------------

// Internal use + re-exported
import {
  readXml,
  readRels,
  parseRelationships,
  normalizePath,
  qs,
  qsa,
  getAttr,
  intAttr,
} from "./pptx-xml-utils";

// Re-export everything from pptx-xml-utils for backward compat
export {
  parseXmlString,
  readXml,
  readRels,
  parseRelationships,
  normalizePath,
  qs,
  qsa,
  getAttr,
  intAttr,
} from "./pptx-xml-utils";

// Internal use only
import { resolveColor } from "./pptx-colors";

// Re-export everything from pptx-colors for backward compat
export {
  DEFAULT_CLR_MAP,
  resolveColor,
  resolveColorWithAlpha,
  hexToHsl,
  hslToHex,
  hexToRgbComponents,
  rgbComponentsToHex,
  srgbToLinear,
  linearToSrgb,
  applyColorTransforms,
} from "./pptx-colors";

// Internal use
import {
  parseBodyProperties,
  parseParagraphs,
  parseTextStyleDef,
  parseTextStyleLevels,
  parseTextStyles,
  resolveHyperlink,
} from "./pptx-text-parser";

// Re-export for backward compat
export {
  parseBodyProperties,
  parseTextRuns,
  parseTextStyleLevels,
  resolveHyperlinkElement,
} from "./pptx-text-parser";

// Internal use
import {
  parseEffects,
  parseReflection,
  parseFill,
  parseGradientFill,
  parseStroke,
  parseShadow,
  parseStyleFillRef,
} from "./pptx-shape-parser";

export type { EffectsResult } from "./pptx-shape-parser";

// Re-export for backward compat
export {
  parseEffects,
  parseReflection,
  parseFill,
  parseGradientFill,
  parseStroke,
} from "./pptx-shape-parser";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function parsePptx(bytes: Uint8Array): Promise<PptxPresentation> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error("Invalid or corrupted PPTX file — could not unzip");
  }

  const presentationXml = await readXml(zip, "ppt/presentation.xml");
  if (!presentationXml) {
    throw new Error("Invalid PPTX — missing ppt/presentation.xml");
  }

  const { slideWidth, slideHeight } = parseSlideDimensions(presentationXml);
  const slideRIds = parseSlideRIds(presentationXml);

  const presRels = await readXml(zip, "ppt/_rels/presentation.xml.rels");
  const rIdToPath = presRels ? parseRelationships(presRels) : {};

  const theme = await parseTheme(zip);

  // --- Parse slide masters and layouts ---
  const masters: PptxSlideMaster[] = [];
  const layouts: PptxSlideLayout[] = [];
  const layoutPathToIndex = new Map<string, number>();
  const masterPathToIndex = new Map<string, number>();
  const layoutToMasterIndex = new Map<string, number>();

  const masterRIds = presRels ? parseMasterRIds(presRels) : [];

  for (const masterRId of masterRIds) {
    const masterRelPath = rIdToPath[masterRId];
    if (!masterRelPath) continue;
    const masterPath = normalizePath("ppt", masterRelPath);

    const masterIndex = masters.length;
    const master = await parseSlideMaster(zip, masterPath, theme);
    masters.push(master);
    masterPathToIndex.set(masterPath, masterIndex);

    const masterRels = await readRels(zip, masterPath);
    for (const [, target] of Object.entries(masterRels)) {
      if (target.includes("slideLayout")) {
        const masterDir = masterPath.substring(0, masterPath.lastIndexOf("/"));
        const layoutPath = normalizePath(masterDir, target);
        if (layoutPathToIndex.has(layoutPath)) continue;

        const layoutIndex = layouts.length;
        const layout = await parseSlideLayout(zip, layoutPath, theme);
        layouts.push(layout);
        layoutPathToIndex.set(layoutPath, layoutIndex);
        layoutToMasterIndex.set(layoutPath, masterIndex);
      }
    }
  }

  // Set theme clrMap from the first master
  if (masters.length > 0 && masters[0].clrMap) {
    theme.clrMap = masters[0].clrMap;
  }

  // --- Parse comment authors (presentation-level, once) ---
  const commentAuthors = await parseCommentAuthors(zip);

  // --- Parse slides and resolve layout/master indices ---
  const slides: PptxSlide[] = [];
  for (let i = 0; i < slideRIds.length; i++) {
    const slidePath = rIdToPath[slideRIds[i]];
    if (!slidePath) continue;

    const normalizedPath = normalizePath("ppt", slidePath);

    // Check for per-slide clrMap override
    const masterClrMap = theme.clrMap;
    const slideDoc = await readXml(zip, normalizedPath);
    if (slideDoc) {
      const clrMapOvr = qs(slideDoc.documentElement, "clrMapOvr");
      if (clrMapOvr) {
        const override = qs(clrMapOvr, "overrideClrMapping");
        if (override) {
          const slideClrMap: Record<string, string> = { ...masterClrMap };
          const clrMapAttrs = ["bg1", "tx1", "bg2", "tx2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
          for (const attr of clrMapAttrs) {
            const val = getAttr(override, attr);
            if (val) slideClrMap[attr] = val;
          }
          theme.clrMap = slideClrMap;
        }
      }
    }

    const slide = await parseSlide(zip, normalizedPath, i, theme);

    // Restore original clrMap
    theme.clrMap = masterClrMap;

    // Resolve layout for this slide
    const slideRels = await readRels(zip, normalizedPath);
    const slideDir = normalizedPath.substring(0, normalizedPath.lastIndexOf("/"));
    for (const [, target] of Object.entries(slideRels)) {
      if (target.includes("slideLayout")) {
        const layoutPath = normalizePath(slideDir, target);
        const li = layoutPathToIndex.get(layoutPath);
        if (li !== undefined) {
          slide.layoutIndex = li;
          slide.masterIndex = layoutToMasterIndex.get(layoutPath);
        }
        break;
      }
    }

    // Parse slide comments
    const slideComments = await parseSlideComments(zip, slideRels, slideDir, commentAuthors);
    if (slideComments.length > 0) {
      slide.comments = slideComments;
    }

    slides.push(slide);
  }

  // --- Parse sections ---
  const sections = parseSections(presentationXml);

  // --- Parse presentation-level default text style ---
  const defaultTextStyleEl = qs(presentationXml, "defaultTextStyle");
  const defaultTextStyle = defaultTextStyleEl ? parseTextStyleDef(defaultTextStyleEl, theme) : null;
  const defaultTextLevelStyles = defaultTextStyleEl ? parseTextStyleLevels(defaultTextStyleEl, theme) : undefined;

  const presentation: PptxPresentation = {
    slideWidth, slideHeight, slides, theme, masters, layouts,
    ...(sections ? { sections } : {}),
    defaultTextStyle: defaultTextStyle ?? undefined,
    defaultTextLevelStyles: defaultTextLevelStyles?.length ? defaultTextLevelStyles : undefined,
  };
  resolveInheritance(presentation);
  return presentation;
}

// ---------------------------------------------------------------------------
// Presentation metadata
// ---------------------------------------------------------------------------

function parseSlideDimensions(doc: Document): { slideWidth: number; slideHeight: number } {
  const sldSz = qs(doc, "sldSz");
  if (!sldSz) return { slideWidth: 9144000, slideHeight: 5143500 }; // default 16:9
  return {
    slideWidth: intAttr(sldSz, "cx", 9144000),
    slideHeight: intAttr(sldSz, "cy", 5143500),
  };
}

function parseSlideRIds(doc: Document): string[] {
  const ids: string[] = [];
  const sldIdLst = qs(doc, "sldIdLst");
  if (!sldIdLst) return ids;
  const sldIds = qsa(sldIdLst, "sldId");
  for (const el of sldIds) {
    const rId = el.getAttributeNS(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "id",
    ) || getAttr(el, "r:id");
    if (rId) ids.push(rId);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const SCHEME_COLOR_MAP: Record<string, string> = {
  dk1: "dk1", dk2: "dk2", lt1: "lt1", lt2: "lt2",
  accent1: "accent1", accent2: "accent2", accent3: "accent3",
  accent4: "accent4", accent5: "accent5", accent6: "accent6",
  hlink: "hlink", folHlink: "folHlink",
};

async function parseTheme(zip: JSZip): Promise<PptxTheme> {
  const defaults: PptxTheme = {
    colors: {},
    fonts: { heading: "Calibri", body: "Calibri" },
  };

  const doc = await readXml(zip, "ppt/theme/theme1.xml");
  if (!doc) return defaults;

  // Colors
  const clrScheme = qs(doc, "clrScheme");
  if (clrScheme) {
    for (const name of Object.keys(SCHEME_COLOR_MAP)) {
      const el = qs(clrScheme, name);
      if (el) {
        const color = extractThemeColor(el);
        if (color) defaults.colors[name] = color;
      }
    }
  }

  // Fonts
  const majorFont = qs(doc, "majorFont");
  const minorFont = qs(doc, "minorFont");
  if (majorFont) {
    const latin = qs(majorFont, "latin");
    if (latin) defaults.fonts.heading = getAttr(latin, "typeface") ?? "Calibri";
  }
  if (minorFont) {
    const latin = qs(minorFont, "latin");
    if (latin) defaults.fonts.body = getAttr(latin, "typeface") ?? "Calibri";
  }

  // Default font size from theme objectDefaults > spDef
  const spDef = qs(doc, "spDef");
  if (spDef) {
    const spDefRPr = qs(spDef, "defRPr");
    if (spDefRPr) {
      const sz = getAttr(spDefRPr, "sz");
      if (sz) defaults.defaultFontSize = parseInt(sz, 10);
    }
    // Default alignment from spDef lstStyle
    const spDefLstStyle = qs(spDef, "lstStyle");
    if (spDefLstStyle) {
      const spDefPPr = qs(spDefLstStyle, "defPPr");
      if (spDefPPr) {
        const algnVal = getAttr(spDefPPr, "algn");
        const algnMap: Record<string, PptxTheme["defaultAlignment"]> = { l: "left", ctr: "center", r: "right", just: "justify" };
        if (algnVal && algnMap[algnVal]) defaults.defaultAlignment = algnMap[algnVal];
      }
    }
  }

  // Table styles from theme XML
  const tableStyles = parseTableStylesFromDoc(doc, defaults);

  // Also try standalone tableStyles.xml
  const tableStylesDoc = await readXml(zip, "ppt/tableStyles.xml");
  if (tableStylesDoc) {
    const tblStyleLst = qs(tableStylesDoc, "tblStyleLst");
    if (tblStyleLst) {
      const styleEls = qsa(tblStyleLst, "tblStyle");
      for (const styleEl of styleEls) {
        const styleId = getAttr(styleEl, "styleId");
        if (styleId && !tableStyles.has(styleId)) {
          tableStyles.set(styleId, parseTableStyleElement(styleEl, defaults));
        }
      }
    }
  }

  if (tableStyles.size > 0) {
    defaults.tableStyles = tableStyles;
  }

  return defaults;
}

function parseTableStylesFromDoc(doc: Document, theme: PptxTheme): Map<string, PptxTableStyle> {
  const styles = new Map<string, PptxTableStyle>();
  const tblStyleLst = qs(doc, "tblStyleLst");
  if (tblStyleLst) {
    const styleEls = qsa(tblStyleLst, "tblStyle");
    for (const styleEl of styleEls) {
      const styleId = getAttr(styleEl, "styleId");
      if (!styleId) continue;
      styles.set(styleId, parseTableStyleElement(styleEl, theme));
    }
  }
  return styles;
}

/**
 * Generate a table style for common built-in Office table styles.
 * These styles aren't in tableStyles.xml — they're hardcoded in PowerPoint.
 * We map the style GUID to an accent color and generate a reasonable approximation.
 */
function generateBuiltinTableStyle(styleId: string, theme: PptxTheme): PptxTableStyle | undefined {
  // Map of built-in style GUIDs to accent color keys
  // Medium Style 2 - Accent N
  const mediumStyle2: Record<string, string> = {
    "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}": "accent1",
    "{21E4AEA4-8DFA-4A89-87EB-49C32662AFE0}": "accent2",
    "{C4B1156A-380E-4F78-BDF5-A137D16BA284}": "accent3",
    "{7DF18680-E054-41AD-8BC1-D1AEF088D02A}": "accent4",
    "{327F97BB-C833-4FB7-BDE5-3F7075034690}": "accent5",
    "{638B1855-1B75-4FBE-930C-398BA8C253C6}": "accent6",
  };
  // Light Style 1 - Accent N
  const lightStyle1: Record<string, string> = {
    "{3B4B98B0-60AC-42C2-AFA5-B58CD77FA1E5}": "accent1",
    "{0E3FDE45-AF77-4B5C-9715-49D594BDF05E}": "accent2",
    "{C083E6E3-FA7D-4D7B-A595-EF9225AFEA82}": "accent3",
    "{D27102A9-8310-4765-A935-A1911B00CA55}": "accent4",
    "{5FD0F851-EC5A-4D38-B0AD-8093EC10F338}": "accent5",
    "{68D230F3-CF80-4859-8CE7-A43EE81993B5}": "accent6",
  };

  let accent = mediumStyle2[styleId];
  if (accent) {
    const fillColor = theme.colors[accent] ?? "#4472C4";
    return {
      firstRow: { fill: fillColor, fontColor: "#FFFFFF", bold: true },
      band1H: { fill: fillColor + "33" }, // 20% opacity
    };
  }

  accent = lightStyle1[styleId];
  if (accent) {
    const fillColor = theme.colors[accent] ?? "#4472C4";
    return {
      firstRow: { fill: fillColor, fontColor: "#FFFFFF", bold: true },
    };
  }

  return undefined;
}

export function parseTableStyleElement(styleEl: Element, theme: PptxTheme): PptxTableStyle {
  const result: PptxTableStyle = {};
  const parts: Array<keyof PptxTableStyle> = [
    "wholeTbl", "band1H", "band2H", "band1V", "band2V",
    "firstRow", "lastRow", "firstCol", "lastCol",
  ];
  for (const part of parts) {
    const partEl = qs(styleEl, part);
    if (!partEl) continue;

    const stylePart: PptxTableStylePart = {};
    let hasValues = false;

    const tcStyle = qs(partEl, "tcStyle");
    if (tcStyle) {
      const fillEl = qs(tcStyle, "fill");
      if (fillEl) {
        const solidFill = qs(fillEl, "solidFill");
        if (solidFill) {
          const color = resolveColor(solidFill, theme);
          if (color) { stylePart.fill = color; hasValues = true; }
        }
      }
    }

    const tcTxStyle = qs(partEl, "tcTxStyle");
    if (tcTxStyle) {
      const b = getAttr(tcTxStyle, "b");
      if (b === "on") { stylePart.bold = true; hasValues = true; }
      const i = getAttr(tcTxStyle, "i");
      if (i === "on") { stylePart.italic = true; hasValues = true; }
      const fontColor = resolveColor(tcTxStyle, theme);
      if (fontColor) { stylePart.fontColor = fontColor; hasValues = true; }
    }

    if (hasValues) result[part] = stylePart;
  }
  return result;
}

function extractThemeColor(el: Element): string | null {
  const srgb = qs(el, "srgbClr");
  if (srgb) return `#${getAttr(srgb, "val") ?? "000000"}`;
  const sys = qs(el, "sysClr");
  if (sys) return `#${getAttr(sys, "lastClr") ?? getAttr(sys, "val") ?? "000000"}`;
  return null;
}

// ---------------------------------------------------------------------------
// Slide parsing
// ---------------------------------------------------------------------------

async function parseSlide(
  zip: JSZip,
  slidePath: string,
  index: number,
  theme: PptxTheme,
): Promise<PptxSlide> {
  const doc = await readXml(zip, slidePath);
  if (!doc) {
    return { index, elements: [], background: null, notes: "", searchText: "" };
  }

  const rels = await readRels(zip, slidePath);
  const slideDir = slidePath.substring(0, slidePath.lastIndexOf("/"));

  const elements = await parseElements(doc.documentElement, rels, zip, slideDir, theme, index);
  const background = await parseBackground(doc, theme, rels, zip);
  const notes = await parseNotes(zip, slidePath, rels);
  const searchText = extractSearchText(elements, notes);

  // Parse header/footer visibility from <p:hf> element
  const headerFooter = parseHeaderFooter(doc);

  return { index, elements, background, notes, searchText, headerFooter };
}

/**
 * Parse `<p:hf>` element from slide XML to determine header/footer visibility.
 * In OOXML, absent attribute or "1" = visible, "0" = hidden.
 * Safe default when no `<p:hf>` element exists: all hidden (preserve current behavior).
 */
function parseHeaderFooter(doc: Document): PptxSlide["headerFooter"] | undefined {
  const hf = qs(doc.documentElement, "hf");
  if (!hf) return undefined;

  const dtAttr = getAttr(hf, "dt");
  const ftrAttr = getAttr(hf, "ftr");
  const sldNumAttr = getAttr(hf, "sldNum");

  // Some PPTX files store footer/date text as attributes on p:hf
  const ftrText = getAttr(hf, "ftrText") ?? undefined;
  const dtText = getAttr(hf, "dtText") ?? undefined;

  return {
    showDate: dtAttr !== "0",
    showFooter: ftrAttr !== "0",
    showSlideNum: sldNumAttr !== "0",
    dateText: dtText,
    footerText: ftrText,
  };
}

// ---------------------------------------------------------------------------
// Element parsing (text boxes, images, shapes, groups)
// ---------------------------------------------------------------------------

async function parseElements(
  parent: Element,
  rels: Record<string, string>,
  zip: JSZip,
  slideDir: string,
  theme: PptxTheme,
  slideIndex = 0,
): Promise<PptxElement[]> {
  const elements: PptxElement[] = [];

  // Direct children — spTree or cSld > spTree
  const spTree = qs(parent, "spTree") ?? parent;

  for (let i = 0; i < spTree.children.length; i++) {
    const child = spTree.children[i];
    const ln = child.localName;

    if (ln === "sp") {
      const el = await parseShapeOrTextBox(child, theme, rels, slideIndex, zip, slideDir);
      if (el) elements.push(el);
    } else if (ln === "pic") {
      const el = await parsePicture(child, rels, zip, slideDir, theme);
      if (el) elements.push(el);
    } else if (ln === "graphicFrame") {
      const el = await parseGraphicFrame(child, rels, zip, slideDir, theme);
      if (el) elements.push(el);
    } else if (ln === "grpSp") {
      const el = await parseGroup(child, rels, zip, slideDir, theme, slideIndex);
      if (el) elements.push(el);
    }
  }

  return elements;
}

function getTransform(el: Element): { x: number; y: number; width: number; height: number; rotation: number; flipH: boolean; flipV: boolean } {
  const xfrm = qs(el, "xfrm");
  const off = xfrm ? qs(xfrm, "off") : null;
  const ext = xfrm ? qs(xfrm, "ext") : null;
  const rot = xfrm ? intAttr(xfrm, "rot", 0) : 0;
  const flipH = xfrm ? getAttr(xfrm, "flipH") === "1" : false;
  const flipV = xfrm ? getAttr(xfrm, "flipV") === "1" : false;
  return {
    x: off ? intAttr(off, "x") : 0,
    y: off ? intAttr(off, "y") : 0,
    width: ext ? intAttr(ext, "cx") : 0,
    height: ext ? intAttr(ext, "cy") : 0,
    rotation: rot / 60000, // 60000ths of degree → degrees
    flipH,
    flipV,
  };
}

// ---------------------------------------------------------------------------
// Text box / shape
// ---------------------------------------------------------------------------

async function parseShapeOrTextBox(el: Element, theme: PptxTheme, rels?: Record<string, string>, slideIndex = 0, zip?: JSZip, slideDir?: string): Promise<PptxTextBox | PptxShape | null> {
  const txBody = qs(el, "txBody");
  const spPr = qs(el, "spPr");
  const prstGeom = spPr ? qs(spPr, "prstGeom") : null;
  const preset = prstGeom ? getAttr(prstGeom, "prst") : null;

  const transform = getTransform(el);

  const bodyProps = txBody ? parseBodyProperties(txBody) : undefined;

  // Parse shape-level lstStyle from txBody
  const shapeLstStyle = txBody ? qs(txBody, "lstStyle") : null;
  const shapeLevelStyles = shapeLstStyle ? parseTextStyleLevels(shapeLstStyle, theme) : undefined;
  const validShapeLevelStyles = shapeLevelStyles?.length ? shapeLevelStyles : undefined;

  // Check for shape-level hyperlink on cNvPr
  const nvSpPr = qs(el, "nvSpPr");
  const cNvPr = nvSpPr ? qs(nvSpPr, "cNvPr") : null;
  const shapeHyperlink = cNvPr ? resolveHyperlink(cNvPr, rels) : undefined;

  // Detect placeholder info (nvSpPr > nvPr > ph)
  let placeholderType: string | undefined;
  let placeholderIdx: number | undefined;
  const nvPr = nvSpPr ? qs(nvSpPr, "nvPr") : null;
  const ph = nvPr ? qs(nvPr, "ph") : null;
  if (ph) {
    placeholderType = getAttr(ph, "type") ?? "body";
    const idxStr = getAttr(ph, "idx");
    if (idxStr) {
      const parsed = parseInt(idxStr, 10);
      if (!isNaN(parsed)) placeholderIdx = parsed;
    }
  }

  // Effects (shadow, glow, soft edge from spPr effectLst)
  const effects = spPr ? parseEffects(spPr, theme) : {};
  const shadow = effects.shadow;
  const glow = effects.glow;
  const softEdge = effects.softEdge;

  // If it has text and no geometry preset, treat as textbox
  if (txBody && !preset) {
    let paragraphs = parseParagraphs(txBody, theme, rels);
    if (placeholderType === "sldNum") {
      paragraphs = injectSlideNumber(paragraphs, slideIndex);
    }
    if (paragraphs.length === 0 && !placeholderType) {
      // Empty shape with no text and no preset geometry — skip.
      // These are decorative elements (circles, arcs, background overlays)
      // that would render incorrectly as colored rectangles.
      return null;
    }
    return { type: "textbox", ...transform, paragraphs, bodyProps, hyperlink: shapeHyperlink, placeholderType, placeholderIdx, shadow, shapeLevelStyles: validShapeLevelStyles };
  }

  // Shape
  const shapeType = mapPresetGeometry(preset);
  let fill = spPr ? parseFill(spPr, theme) : null;

  // Fallback: parse <p:style> fill reference when spPr has no fill.
  // Only apply for shapes with text — empty shapes with <p:style> fills are typically
  // decorative background elements (circles, bars, overlays) that render incorrectly
  // as solid rectangles when we can't reproduce their exact visual appearance.
  const hasText = txBody && qsa(txBody, "r").length > 0;
  if (!fill && hasText) {
    fill = parseStyleFillRef(el, theme);
  }

  // Picture fill (blipFill inside spPr) — overrides other fills
  if (spPr && zip && slideDir && rels) {
    const blipFillEl = qs(spPr, "blipFill");
    if (blipFillEl) {
      const blip = qs(blipFillEl, "blip");
      const embedId = blip?.getAttributeNS(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "embed",
      ) || (blip ? getAttr(blip, "r:embed") : null);
      if (embedId && rels[embedId]) {
        const mediaPath = normalizePath(slideDir, rels[embedId]);
        const dataUrl = await extractImageDataUrl(zip, mediaPath);
        if (dataUrl) {
          const stretch = !!qs(blipFillEl, "stretch");
          const tile = !!qs(blipFillEl, "tile");
          fill = { type: "picture", dataUrl, stretch, tile };
        }
      }
    }
  }

  let { stroke, strokeWidth, dashStyle, headArrow, tailArrow } = spPr
    ? parseStroke(spPr, theme)
    : { stroke: null, strokeWidth: 0, dashStyle: undefined, headArrow: undefined, tailArrow: undefined };

  // Fallback: parse stroke from <p:style> lnRef — only for shapes with text
  if (!stroke && hasText) {
    const pStyle = qs(el, "style");
    if (pStyle) {
      const lnRef = qs(pStyle, "lnRef");
      if (lnRef) {
        const idx = intAttr(lnRef, "idx", 0);
        if (idx > 0) {
          const lnColor = resolveColor(lnRef, theme);
          if (lnColor) {
            stroke = lnColor;
            strokeWidth = Math.max(1, idx * 0.5);
          }
        }
      }
    }
  }
  let text = txBody ? parseParagraphs(txBody, theme, rels) : [];
  if (placeholderType === "sldNum") {
    text = injectSlideNumber(text, slideIndex);
  }

  return {
    type: "shape",
    shapeType,
    presetGeometry: preset ?? undefined,
    ...transform,
    fill,
    stroke,
    strokeWidth,
    dashStyle,
    text,
    ...(headArrow ? { headArrow } : {}),
    ...(tailArrow ? { tailArrow } : {}),
    bodyProps,
    hyperlink: shapeHyperlink,
    placeholderType,
    placeholderIdx,
    shadow,
    ...(glow ? { glow } : {}),
    ...(softEdge ? { softEdge } : {}),
    shapeLevelStyles: validShapeLevelStyles,
  };
}

/**
 * For sldNum placeholders: if text runs are empty, inject the 1-based slide number.
 */
function injectSlideNumber(paragraphs: PptxParagraph[], slideIndex: number): PptxParagraph[] {
  const slideNum = String(slideIndex + 1);
  const hasText = paragraphs.some(p => p.runs.some(r => r.text.trim().length > 0));
  if (!hasText) {
    if (paragraphs.length === 0) {
      return [{
        alignment: "center",
        runs: [{ text: slideNum, bold: false, italic: false, underline: false, fontSize: 10, fontFamily: "", color: "#666666" }],
        bulletChar: null,
        bulletLevel: 0,
      }];
    }
    const baseParagraph = paragraphs[0];
    const baseRun = baseParagraph.runs[0];
    return [{
      ...baseParagraph,
      runs: [{ ...(baseRun ?? { text: "", bold: false, italic: false, underline: false, fontSize: 10, fontFamily: "", color: "#666666" }), text: slideNum }],
    }];
  }
  return paragraphs;
}

function mapPresetGeometry(preset: string | null): PptxShape["shapeType"] {
  if (!preset) return "rect";
  const map: Record<string, PptxShape["shapeType"]> = {
    rect: "rect", rectangle: "rect",
    roundRect: "roundRect",
    ellipse: "ellipse",
    line: "line",
    straightConnector1: "line",
    // Note: rightArrow, leftArrow, upArrow, downArrow etc. are block arrow SHAPES
    // (filled preset geometries), not lines. They fall through to "other" and get
    // rendered via PresetShapeRenderer with SVG paths.
  };
  return map[preset] ?? "other";
}

// Body properties, spacing helpers, hyperlinks, paragraphs, text runs, text styles
// are now in pptx-text-parser.ts and imported at the top of this file.

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

async function parsePicture(
  el: Element,
  rels: Record<string, string>,
  zip: JSZip,
  slideDir: string,
  theme: PptxTheme,
): Promise<PptxImage | null> {
  const transform = getTransform(el);

  const blipFill = qs(el, "blipFill");
  if (!blipFill) return null;

  const blip = qs(blipFill, "blip");
  if (!blip) return null;

  const embedId = blip.getAttributeNS(
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "embed",
  ) || getAttr(blip, "r:embed");

  // Check for linked (external) image via r:link
  const linkId = blip.getAttributeNS(
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "link",
  ) || getAttr(blip, "r:link");

  let dataUrl: string | null = null;

  if (embedId && rels[embedId]) {
    const mediaPath = normalizePath(slideDir, rels[embedId]);
    dataUrl = await extractImageDataUrl(zip, mediaPath);
  } else if (linkId && rels[linkId]) {
    const externalUrl = rels[linkId];
    if (externalUrl.startsWith("http://") || externalUrl.startsWith("https://")) {
      dataUrl = externalUrl;
    }
  }
  if (!dataUrl) return null;

  // Parse image crop from srcRect (values in 1/1000ths of a percent)
  const srcRect = qs(blipFill, "srcRect");
  let crop: PptxImage['crop'] | undefined;
  if (srcRect) {
    const l = intAttr(srcRect, "l", 0) / 1000;
    const t = intAttr(srcRect, "t", 0) / 1000;
    const r = intAttr(srcRect, "r", 0) / 1000;
    const b = intAttr(srcRect, "b", 0) / 1000;
    if (l > 0 || t > 0 || r > 0 || b > 0) {
      crop = { left: l, top: t, right: r, bottom: b };
    }
  }

  // Also check fillRect inside stretch — alternative crop definition
  const stretch = qs(blipFill, "stretch");
  if (!crop && stretch) {
    const fillRect = qs(stretch, "fillRect");
    if (fillRect) {
      const l = intAttr(fillRect, "l", 0) / 1000;
      const t = intAttr(fillRect, "t", 0) / 1000;
      const r = intAttr(fillRect, "r", 0) / 1000;
      const b = intAttr(fillRect, "b", 0) / 1000;
      if (l > 0 || t > 0 || r > 0 || b > 0) {
        crop = { left: l, top: t, right: r, bottom: b };
      }
    }
  }

  // Image transparency via alphaModFix on blip (amt is in 1/100000ths, e.g., 50000 = 50%)
  let opacity: number | undefined;
  const alphaModFix = qs(blip, "alphaModFix");
  if (alphaModFix) {
    const amt = alphaModFix.getAttribute("amt");
    if (amt) {
      opacity = parseInt(amt, 10) / 100000;
    }
  }

  // Check for hyperlink on the picture element
  const nvPicPr = qs(el, "nvPicPr");
  const picCNvPr = nvPicPr ? qs(nvPicPr, "cNvPr") : null;
  const picHyperlink = picCNvPr ? resolveHyperlink(picCNvPr, rels) : undefined;

  // Shadow on pictures
  const picSpPr = qs(el, "spPr");
  const picShadow = picSpPr ? parseShadow(picSpPr, theme) : undefined;

  // Reflection effect on pictures
  const reflection = picSpPr ? parseReflection(picSpPr) : undefined;

  return { type: "image", ...transform, dataUrl, ...(opacity !== undefined ? { opacity } : {}), crop, hyperlink: picHyperlink, shadow: picShadow, reflection };
}

async function extractImageDataUrl(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path);
  if (!file) return null;

  const data = await file.async("base64");
  const ext = path.split(".").pop()?.toLowerCase() ?? "png";
  const mimeMap: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", bmp: "image/bmp", svg: "image/svg+xml",
    tiff: "image/tiff", tif: "image/tiff", wmf: "image/x-wmf",
    emf: "image/x-emf", webp: "image/webp",
  };
  const mime = mimeMap[ext] ?? "image/png";
  return `data:${mime};base64,${data}`;
}

// ---------------------------------------------------------------------------
// Graphic frames (tables, charts, SmartArt)
// ---------------------------------------------------------------------------

export async function parseGraphicFrame(
  el: Element,
  rels: Record<string, string>,
  zip: JSZip,
  slideDir: string,
  theme: PptxTheme,
): Promise<PptxElement | null> {
  const transform = getTransform(el);

  // Check for table
  const tbl = qs(el, "tbl");
  if (tbl) return parseTable(tbl, transform, theme, rels);

  // Check for chart
  const chartRef = findChartRef(el);
  if (chartRef) {
    const chartPath = rels[chartRef];
    if (chartPath) {
      return await parseChart(zip, normalizePath(slideDir, chartPath), transform);
    }
  }

  // Check for SmartArt — try to find fallback image
  const dgmRels = findDiagramRels(el);
  if (dgmRels.length > 0) {
    for (const rId of dgmRels) {
      const target = rels[rId];
      if (target && /\.(png|jpg|jpeg|gif|svg|emf|wmf)$/i.test(target)) {
        const dataUrl = await extractImageDataUrl(zip, normalizePath(slideDir, target));
        if (dataUrl) {
          return { type: "image", ...transform, dataUrl };
        }
      }
    }
    // No fallback image — return a placeholder shape
    return {
      type: "shape",
      shapeType: "other",
      ...transform,
      fill: null,
      stroke: "#999999",
      strokeWidth: 1,
      text: [{ alignment: "center", runs: [{ text: "SmartArt", bold: false, italic: true, underline: false, fontSize: 12, fontFamily: "sans-serif", color: "#999999" }], bulletChar: null, bulletLevel: 0 }],
    };
  }

  // Check for OLE object — try to extract a preview/fallback image
  const oleObj = qs(el, "oleObj");
  if (oleObj) {
    // Approach 1: Check if the OLE relationship points directly to an image file
    const oleRId = oleObj.getAttributeNS(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "id",
    ) || getAttr(oleObj, "r:id");

    if (oleRId && rels[oleRId]) {
      const target = rels[oleRId];
      if (/\.(png|jpg|jpeg|gif|svg|emf|wmf|tiff?)$/i.test(target)) {
        const imgPath = normalizePath(slideDir, target);
        const dataUrl = await extractImageDataUrl(zip, imgPath);
        if (dataUrl) {
          return { type: "image", ...transform, dataUrl };
        }
      }
    }

    // Approach 2: Look for a VML drawing that contains the OLE preview image
    // VML drawings are referenced in slide rels and contain <v:imagedata> elements
    for (const [rIdKey, target] of Object.entries(rels)) {
      if (oleRId && rIdKey === oleRId) continue; // already checked above
      if (target.includes("vmlDrawing")) {
        const vmlPath = normalizePath(slideDir, target);
        const vmlDoc = await readXml(zip, vmlPath);
        if (vmlDoc) {
          const imageDataEls = qsa(vmlDoc, "imagedata");
          for (const imgData of imageDataEls) {
            const imgRId = getAttr(imgData, "r:id") || imgData.getAttributeNS(
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
              "id",
            );
            if (imgRId) {
              const vmlRels = await readRels(zip, vmlPath);
              const imgTarget = vmlRels[imgRId];
              if (imgTarget) {
                const vmlDir = vmlPath.substring(0, vmlPath.lastIndexOf("/"));
                const imgPath = normalizePath(vmlDir, imgTarget);
                const dataUrl = await extractImageDataUrl(zip, imgPath);
                if (dataUrl) {
                  return { type: "image", ...transform, dataUrl };
                }
              }
            }
          }
        }
      }
    }

    // Fallback: render a placeholder
    return {
      type: "shape",
      shapeType: "other",
      ...transform,
      fill: null,
      stroke: "#999999",
      strokeWidth: 1,
      text: [{
        alignment: "center" as const,
        runs: [{
          text: oleObj.getAttribute("name") || "Embedded Object",
          bold: false, italic: true, underline: false,
          fontSize: 10, fontFamily: "sans-serif", color: "#999999",
        }],
        bulletChar: null,
        bulletLevel: 0,
      }],
    };
  }

  return null;
}

function findChartRef(el: Element): string | null {
  // Look for c:chart element with r:id
  const chart = qs(el, "chart");
  if (chart) {
    return chart.getAttributeNS(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "id",
    ) || getAttr(chart, "r:id");
  }
  return null;
}

function findDiagramRels(el: Element): string[] {
  const rIds: string[] = [];
  // Look for dgm:relIds or similar diagram references
  const relIds = qs(el, "relIds");
  if (relIds) {
    for (const attrName of ["r:dm", "r:lo", "r:qs", "r:cs"]) {
      const v = getAttr(relIds, attrName);
      if (v) rIds.push(v);
    }
  }
  return rIds;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function parseCellBorder(ln: Element, theme: PptxTheme): CellBorder | undefined {
  const noFill = qs(ln, "noFill");
  if (noFill) return { width: 0, color: "transparent", none: true };

  const w = intAttr(ln, "w", 12700);
  const widthPx = Math.max(1, Math.round(w / 12700));
  const color = resolveColor(ln, theme) ?? "#000000";

  // Map OOXML dash types to CSS border-style
  const prstDash = qs(ln, "prstDash");
  let dash: string | undefined;
  if (prstDash) {
    const val = getAttr(prstDash, "val");
    if (val === "dash" || val === "lgDash" || val === "sysDash") dash = "dashed";
    else if (val === "dot" || val === "sysDot") dash = "dotted";
    else if (val === "dashDot" || val === "lgDashDot" || val === "lgDashDotDot" || val === "sysDashDot" || val === "sysDashDotDot") dash = "dashed";
  }

  return { width: widthPx, color, dash };
}

function parseCellBorders(tcPr: Element, theme: PptxTheme): PptxTableCell["borders"] | undefined {
  const lnL = qs(tcPr, "lnL");
  const lnR = qs(tcPr, "lnR");
  const lnT = qs(tcPr, "lnT");
  const lnB = qs(tcPr, "lnB");

  if (!lnL && !lnR && !lnT && !lnB) return undefined;

  return {
    left: lnL ? parseCellBorder(lnL, theme) : undefined,
    right: lnR ? parseCellBorder(lnR, theme) : undefined,
    top: lnT ? parseCellBorder(lnT, theme) : undefined,
    bottom: lnB ? parseCellBorder(lnB, theme) : undefined,
  };
}

function parseTable(
  tbl: Element,
  transform: { x: number; y: number; width: number; height: number },
  theme: PptxTheme,
  rels?: Record<string, string>,
): PptxTable {
  const rows: PptxTableRow[] = [];

  // Parse table properties (style GUID and banding flags)
  const tblPr = qs(tbl, "tblPr");
  let style: PptxTableStyle | undefined;
  let bandRow: boolean | undefined;
  let bandCol: boolean | undefined;
  let firstRowFlag: boolean | undefined;
  let lastRowFlag: boolean | undefined;
  let firstColFlag: boolean | undefined;
  let lastColFlag: boolean | undefined;

  if (tblPr) {
    const tblStyleId = getAttr(tblPr, "tblStyle");
    if (tblStyleId && theme.tableStyles) {
      style = theme.tableStyles.get(tblStyleId);
    }
    // Fallback: generate a style from theme accent colors for common built-in table styles
    // Built-in styles (Medium Style 2, etc.) aren't in tableStyles.xml — they're baked into PowerPoint.
    if (!style && tblStyleId) {
      style = generateBuiltinTableStyle(tblStyleId, theme);
    }
    bandRow = getAttr(tblPr, "bandRow") === "1" ? true : undefined;
    bandCol = getAttr(tblPr, "bandCol") === "1" ? true : undefined;
    firstRowFlag = getAttr(tblPr, "firstRow") === "1" ? true : undefined;
    lastRowFlag = getAttr(tblPr, "lastRow") === "1" ? true : undefined;
    firstColFlag = getAttr(tblPr, "firstCol") === "1" ? true : undefined;
    lastColFlag = getAttr(tblPr, "lastCol") === "1" ? true : undefined;
  }

  // Column widths from tblGrid
  const tblGrid = qs(tbl, "tblGrid");
  const colWidths: number[] = [];
  if (tblGrid) {
    const gridCols = qsa(tblGrid, "gridCol");
    for (const gc of gridCols) {
      colWidths.push(intAttr(gc, "w", 0));
    }
  }

  const trEls = qsa(tbl, "tr");
  for (const tr of trEls) {
    const height = intAttr(tr, "h", 0);
    const cells: PptxTableCell[] = [];
    const tcEls = qsa(tr, "tc");
    let colIndex = 0;

    for (const tc of tcEls) {
      const gridSpan = intAttr(tc, "gridSpan", 1);
      const rowSpan = intAttr(tc, "rowSpan", 1);
      const vMerge = getAttr(tc, "vMerge") === "1";
      const hMerge = getAttr(tc, "hMerge") === "1";

      // Skip merged continuation cells
      if (vMerge || hMerge) {
        cells.push({
          width: colWidths[colIndex] ?? 0,
          paragraphs: [],
          fill: null,
          colspan: 0, // indicates merged-away cell
          rowspan: 0,
        });
        colIndex += gridSpan;
        continue;
      }

      const txBody = qs(tc, "txBody");
      const paragraphs = txBody ? parseParagraphs(txBody, theme, rels) : [];

      // Cell properties
      const tcPr = qs(tc, "tcPr");
      let fill: string | PptxFill | null = null;
      let borders: PptxTableCell["borders"] | undefined;
      let margins: PptxTableCell["margins"] | undefined;
      let verticalAlign: PptxTableCell["verticalAlign"] | undefined;
      if (tcPr) {
        const gradFill = qs(tcPr, "gradFill");
        if (gradFill) {
          fill = parseGradientFill(gradFill, theme);
        } else {
          const solidFill = qs(tcPr, "solidFill");
          if (solidFill) fill = resolveColor(solidFill, theme);
        }

        // Borders
        borders = parseCellBorders(tcPr, theme);

        // Margins (EMU → px, divide by 9525)
        const marL = intAttr(tcPr, "marL", -1);
        const marR = intAttr(tcPr, "marR", -1);
        const marT = intAttr(tcPr, "marT", -1);
        const marB = intAttr(tcPr, "marB", -1);
        // Only set margins if at least one attribute is explicitly present
        if (marL >= 0 || marR >= 0 || marT >= 0 || marB >= 0) {
          margins = {
            left: (marL >= 0 ? marL : 91440) / 9525,
            right: (marR >= 0 ? marR : 91440) / 9525,
            top: (marT >= 0 ? marT : 45720) / 9525,
            bottom: (marB >= 0 ? marB : 45720) / 9525,
          };
        }

        // Vertical alignment
        const anchor = getAttr(tcPr, "anchor");
        if (anchor === "ctr") verticalAlign = "center";
        else if (anchor === "b") verticalAlign = "bottom";
        else if (anchor === "t") verticalAlign = "top";
      }

      const cellWidth = colWidths.slice(colIndex, colIndex + gridSpan).reduce((a, b) => a + b, 0) || (colWidths[colIndex] ?? 0);

      cells.push({
        width: cellWidth,
        paragraphs,
        fill,
        colspan: gridSpan,
        rowspan: rowSpan,
        borders,
        margins,
        verticalAlign,
      });

      colIndex += gridSpan;
    }

    rows.push({ height, cells });
  }

  // Use the larger of xfrm width vs sum of column widths — xfrm may be a default/placeholder
  const colWidthSum = colWidths.reduce((a, b) => a + b, 0);
  const tableWidth = Math.max(transform.width, colWidthSum);
  // Same for height — use sum of row heights if larger
  const rowHeightSum = rows.reduce((a, r) => a + r.height, 0);
  const tableHeight = Math.max(transform.height, rowHeightSum);

  const result: PptxTable = { type: "table", ...transform, width: tableWidth, height: tableHeight, rows };
  if (style) result.style = style;
  if (bandRow) result.bandRow = bandRow;
  if (bandCol) result.bandCol = bandCol;
  if (firstRowFlag) result.firstRow = firstRowFlag;
  if (lastRowFlag) result.lastRow = lastRowFlag;
  if (firstColFlag) result.firstCol = firstColFlag;
  if (lastColFlag) result.lastCol = lastColFlag;
  return result;
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

async function parseChart(
  zip: JSZip,
  chartPath: string,
  transform: { x: number; y: number; width: number; height: number },
): Promise<PptxChart> {
  const doc = await readXml(zip, chartPath);
  if (!doc) {
    return {
      type: "chart", ...transform,
      chartType: "other", series: [], categories: [],
    };
  }

  // Detect chart type
  const chartTypeMap: Record<string, PptxChart["chartType"]> = {
    barChart: "bar", bar3DChart: "bar",
    lineChart: "line", line3DChart: "line",
    pieChart: "pie", pie3DChart: "pie",
    areaChart: "area", area3DChart: "area",
    scatterChart: "scatter",
    doughnutChart: "doughnut",
    radarChart: "radar",
    bubbleChart: "bubble",
  };

  let chartType: PptxChart["chartType"] = "other";
  let chartEl: Element | null = null;
  const additionalChartEls: Element[] = [];

  for (const [tag, ct] of Object.entries(chartTypeMap)) {
    const plotArea = qs(doc, "plotArea");
    const allOfType = plotArea ? qsa(plotArea, tag) : [];
    if (allOfType.length > 0) {
      if (!chartEl) {
        chartType = ct;
        chartEl = allOfType[0];
        // Additional chart type elements of the same type
        for (let i = 1; i < allOfType.length; i++) additionalChartEls.push(allOfType[i]);
      } else {
        // Different chart type overlaid (e.g., barChart + lineChart)
        for (const el of allOfType) additionalChartEls.push(el);
      }
    }
  }
  // Fallback: try without plotArea if nothing found
  if (!chartEl) {
    for (const [tag, ct] of Object.entries(chartTypeMap)) {
      const found = qs(doc, tag);
      if (found) {
        chartType = ct;
        chartEl = found;
        break;
      }
    }
  }

  if (!chartEl) {
    return { type: "chart", ...transform, chartType: "other", series: [], categories: [] };
  }

  // Parse bar direction (barDir: "bar" = horizontal, "col" = vertical/column)
  let barDirection: PptxChart["barDirection"];
  if (chartType === "bar") {
    const barDir = qs(chartEl, "barDir");
    if (barDir) {
      const dirVal = getAttr(barDir, "val");
      barDirection = dirVal === "bar" ? "horizontal" : "vertical";
    }
  }

  // Parse series from primary and additional chart type elements
  const series: PptxChartSeries[] = [];
  const categories: string[] = [];
  const allSerEls = [...qsa(chartEl, "ser")];
  for (const addEl of additionalChartEls) {
    allSerEls.push(...qsa(addEl, "ser"));
  }
  const serEls = allSerEls;

  for (const ser of serEls) {
    const txEl = qs(ser, "tx");
    let name = "";
    if (txEl) {
      const strRef = qs(txEl, "strRef");
      const strCache = strRef ? qs(strRef, "strCache") : null;
      const pt = strCache ? qs(strCache, "pt") : null;
      const v = pt ? qs(pt, "v") : null;
      name = v?.textContent ?? "";
    }

    // Values (yVal for bubble charts, val/numRef for others)
    const values: number[] = [];
    const yValEl = qs(ser, "yVal");
    const valSource = yValEl ?? qs(ser, "numRef") ?? qs(ser, "val");
    const valNumRef = valSource?.localName === "numRef" ? valSource : (valSource ? qs(valSource, "numRef") : null);
    const valCache = valNumRef ? qs(valNumRef, "numCache") : (valSource ? qs(valSource, "numCache") : null);
    if (valCache) {
      const pts = qsa(valCache, "pt");
      for (const pt of pts) {
        const v = qs(pt, "v");
        values.push(v ? parseFloat(v.textContent ?? "0") : 0);
      }
    }

    // X values (for bubble/scatter charts)
    let xValues: number[] | undefined;
    const xValEl = qs(ser, "xVal");
    if (xValEl) {
      xValues = [];
      const xRef = qs(xValEl, "numRef");
      const xCache = xRef ? qs(xRef, "numCache") : null;
      if (xCache) {
        const pts = qsa(xCache, "pt");
        for (const pt of pts) {
          const v = qs(pt, "v");
          xValues.push(v ? parseFloat(v.textContent ?? "0") : 0);
        }
      }
    }

    // Bubble sizes
    let bubbleSizes: number[] | undefined;
    const bubbleSizeEl = qs(ser, "bubbleSize");
    if (bubbleSizeEl) {
      bubbleSizes = [];
      const bRef = qs(bubbleSizeEl, "numRef");
      const bCache = bRef ? qs(bRef, "numCache") : null;
      if (bCache) {
        const pts = qsa(bCache, "pt");
        for (const pt of pts) {
          const v = qs(pt, "v");
          bubbleSizes.push(v ? parseFloat(v.textContent ?? "0") : 0);
        }
      }
    }

    // Categories (from first series only)
    if (categories.length === 0) {
      const catEl = qs(ser, "cat");
      if (catEl) {
        const catRef = qs(catEl, "strRef") ?? qs(catEl, "numRef");
        const catCache = catRef ? (qs(catRef, "strCache") ?? qs(catRef, "numCache")) : null;
        if (catCache) {
          const pts = qsa(catCache, "pt");
          for (const pt of pts) {
            const v = qs(pt, "v");
            categories.push(v?.textContent ?? "");
          }
        }
      }
    }

    // Color
    let color: string | null = null;
    const spPr = qs(ser, "spPr");
    if (spPr) {
      const solidFill = qs(spPr, "solidFill");
      if (solidFill) {
        const srgb = qs(solidFill, "srgbClr");
        if (srgb) color = `#${getAttr(srgb, "val") ?? "000000"}`;
      }
    }

    series.push({ name, values, color, xValues, bubbleSizes });
  }

  // Parse chart title (c:title > c:tx > c:rich > a:p > a:r > a:t)
  let title: string | undefined;
  const titleEl = qs(doc, "title");
  if (titleEl) {
    const tx = qs(titleEl, "tx");
    if (tx) {
      const rich = qs(tx, "rich");
      if (rich) {
        const texts: string[] = [];
        const titleRuns = qsa(rich, "r");
        for (const r of titleRuns) {
          const t = qs(r, "t");
          if (t?.textContent) texts.push(t.textContent);
        }
        title = texts.join("") || undefined;
      }
      // String reference title (c:tx > c:strRef > c:strCache > c:pt > c:v)
      if (!title) {
        const strCache = qs(tx, "strCache");
        if (strCache) {
          const pt = qs(strCache, "pt");
          const v = pt ? qs(pt, "v") : null;
          if (v?.textContent) title = v.textContent;
        }
      }
    }
    // Auto-title: <c:title> exists but has no <c:tx> — use first series name
    if (!title) {
      const autoDeleted = qs(doc, "autoTitleDeleted");
      const isAutoDeleted = autoDeleted && getAttr(autoDeleted, "val") === "1";
      if (!isAutoDeleted && series.length > 0) {
        title = series[0].name || undefined;
      }
    }
  }

  // Parse legend (c:legend > c:legendPos)
  let legend: PptxChart["legend"] | undefined;
  const legendEl = qs(doc, "legend");
  if (legendEl) {
    const legendPos = qs(legendEl, "legendPos");
    const posVal = legendPos ? getAttr(legendPos, "val") : "b";
    const posMap: Record<string, string> = { t: "top", b: "bottom", l: "left", r: "right", tr: "right" };
    legend = { position: (posMap[posVal ?? "b"] ?? "bottom") as "top" | "bottom" | "left" | "right" };
  }

  // Parse axes (c:catAx, c:valAx)
  let axes: PptxChart["axes"] | undefined;
  const catAx = qs(doc, "catAx");
  const valAx = qs(doc, "valAx");
  if (catAx || valAx) {
    axes = {};
    if (catAx) {
      const delEl = qs(catAx, "delete");
      const visible = !(delEl && getAttr(delEl, "val") === "1");
      let axTitle: string | undefined;
      const axTitleEl = qs(catAx, "title");
      if (axTitleEl) {
        const axRich = qs(axTitleEl, "rich");
        if (axRich) {
          const texts: string[] = [];
          for (const r of qsa(axRich, "r")) {
            const t = qs(r, "t");
            if (t?.textContent) texts.push(t.textContent);
          }
          axTitle = texts.join("") || undefined;
        }
      }
      axes.categoryAxis = { title: axTitle, visible };
    }
    if (valAx) {
      const delEl = qs(valAx, "delete");
      const visible = !(delEl && getAttr(delEl, "val") === "1");
      let axTitle: string | undefined;
      const axTitleEl = qs(valAx, "title");
      if (axTitleEl) {
        const axRich = qs(axTitleEl, "rich");
        if (axRich) {
          const texts: string[] = [];
          for (const r of qsa(axRich, "r")) {
            const t = qs(r, "t");
            if (t?.textContent) texts.push(t.textContent);
          }
          axTitle = texts.join("") || undefined;
        }
      }
      const numFmt = qs(valAx, "numFmt");
      const numberFormat = numFmt ? (getAttr(numFmt, "formatCode") ?? undefined) : undefined;
      axes.valueAxis = { title: axTitle, visible, numberFormat };
    }
  }

  // Parse data labels
  let showDataLabels: boolean | undefined;
  let dataLabelType: PptxChart["dataLabelType"] | undefined;
  let dataLabelPosition: string | undefined;
  const dLbls = qs(chartEl, "dLbls");
  if (dLbls) {
    const showVal = qs(dLbls, "showVal");
    const showCatName = qs(dLbls, "showCatName");
    const showPercent = qs(dLbls, "showPercent");
    const showSerName = qs(dLbls, "showSerName");
    if (showVal && getAttr(showVal, "val") === "1") {
      showDataLabels = true;
      dataLabelType = "value";
    } else if (showPercent && getAttr(showPercent, "val") === "1") {
      showDataLabels = true;
      dataLabelType = "percentage";
    } else if (showCatName && getAttr(showCatName, "val") === "1") {
      showDataLabels = true;
      dataLabelType = "category";
    } else if (showSerName && getAttr(showSerName, "val") === "1") {
      showDataLabels = true;
      dataLabelType = "value"; // fallback — show values when series name is requested
    }
    // Parse data label position
    const dLblPos = qs(dLbls, "dLblPos");
    const posVal = dLblPos ? getAttr(dLblPos, "val") : undefined;
    dataLabelPosition = posVal ?? undefined;
  }

  // Parse secondary axis — find all valAx elements
  let secondaryAxis: PptxChart["secondaryAxis"] | undefined;
  const allValAx = qsa(doc, "valAx");
  if (allValAx.length >= 2) {
    const secAx = allValAx[1];
    const delEl = qs(secAx, "delete");
    const visible = !(delEl && getAttr(delEl, "val") === "1");
    let axTitle: string | undefined;
    const axTitleEl = qs(secAx, "title");
    if (axTitleEl) {
      const axRich = qs(axTitleEl, "rich");
      if (axRich) {
        const texts: string[] = [];
        for (const r of qsa(axRich, "r")) {
          const t = qs(r, "t");
          if (t?.textContent) texts.push(t.textContent);
        }
        axTitle = texts.join("") || undefined;
      }
    }
    const numFmt = qs(secAx, "numFmt");
    const numberFormat = numFmt ? (getAttr(numFmt, "formatCode") ?? undefined) : undefined;
    secondaryAxis = { title: axTitle, visible, numberFormat };

    // Determine which series belong to the secondary axis.
    // In OOXML, a plotArea can have multiple chart type elements (e.g., barChart + lineChart).
    // Each chart type element has axId references. Series in the second chart type use the secondary axis.
    // Get the secondary axis ID
    const secAxIdEl = qs(secAx, "axId");
    const secAxId = secAxIdEl ? getAttr(secAxIdEl, "val") : null;
    if (secAxId) {
      // Find all chart type elements in the plotArea and check which reference the secondary axis
      const plotArea = qs(doc, "plotArea");
      if (plotArea) {
        for (const [tag] of Object.entries(chartTypeMap)) {
          const chartTypeEls = qsa(plotArea, tag);
          for (const ctEl of chartTypeEls) {
            if (ctEl === chartEl) continue; // skip the primary chart type element
            // Check if this chart type element references the secondary axis
            const axIdEls = qsa(ctEl, "axId");
            const refsSecondary = axIdEls.some(a => getAttr(a, "val") === secAxId);
            if (refsSecondary) {
              // Mark all series from this chart type element as secondary
              const secSerEls = qsa(ctEl, "ser");
              for (const secSer of secSerEls) {
                const secIdx = qs(secSer, "idx");
                const secIdxVal = secIdx ? getAttr(secIdx, "val") : null;
                if (secIdxVal !== null) {
                  const idx = parseInt(secIdxVal, 10);
                  if (idx < series.length) {
                    series[idx].axisId = "right";
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // Parse trendlines on each series
  for (let si = 0; si < serEls.length; si++) {
    const trendlineEl = qs(serEls[si], "trendline");
    if (trendlineEl && si < series.length) {
      const trendTypeEl = qs(trendlineEl, "trendlineType");
      const typeVal = trendTypeEl ? getAttr(trendTypeEl, "val") : "linear";
      const typeMap: Record<string, "linear" | "exponential" | "polynomial" | "power" | "logarithmic"> = {
        linear: "linear", exp: "exponential", poly: "polynomial",
        power: "power", log: "logarithmic",
      };
      const trendType = typeMap[typeVal ?? "linear"] ?? "linear";
      const orderEl = qs(trendlineEl, "order");
      const forwardEl = qs(trendlineEl, "forward");
      const backwardEl = qs(trendlineEl, "backward");
      series[si].trendline = {
        type: trendType,
        order: orderEl ? parseInt(getAttr(orderEl, "val") ?? "2", 10) : undefined,
        forward: forwardEl ? parseFloat(getAttr(forwardEl, "val") ?? "0") : undefined,
        backward: backwardEl ? parseFloat(getAttr(backwardEl, "val") ?? "0") : undefined,
      };
    }
  }

  return {
    type: "chart", ...transform, chartType, series, categories,
    title, legend, axes, showDataLabels, dataLabelType,
    dataLabelPosition, secondaryAxis, barDirection,
  };
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

async function parseGroup(
  el: Element,
  rels: Record<string, string>,
  zip: JSZip,
  slideDir: string,
  theme: PptxTheme,
  slideIndex = 0,
): Promise<PptxGroup> {
  const grpSpPr = qs(el, "grpSpPr");
  const xfrm = grpSpPr ? qs(grpSpPr, "xfrm") : null;
  const off = xfrm ? qs(xfrm, "off") : null;
  const ext = xfrm ? qs(xfrm, "ext") : null;

  const x = off ? intAttr(off, "x") : 0;
  const y = off ? intAttr(off, "y") : 0;
  const width = ext ? intAttr(ext, "cx") : 0;
  const height = ext ? intAttr(ext, "cy") : 0;
  const flipH = xfrm ? getAttr(xfrm, "flipH") === "1" : false;
  const flipV = xfrm ? getAttr(xfrm, "flipV") === "1" : false;

  // Child offset (group internal coordinate system)
  const chOff = xfrm ? qs(xfrm, "chOff") : null;
  const chOffX = chOff ? intAttr(chOff, "x") : 0;
  const chOffY = chOff ? intAttr(chOff, "y") : 0;

  const children = await parseElements(el, rels, zip, slideDir, theme, slideIndex);

  // Offset children by group origin
  for (const child of children) {
    child.x -= chOffX;
    child.y -= chOffY;
  }

  return { type: "group", x, y, width, height, flipH, flipV, children };
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

async function parseBackground(
  doc: Document,
  theme: PptxTheme,
  rels?: Record<string, string>,
  zip?: JSZip,
): Promise<PptxBackground | null> {
  const bg = qs(doc, "bg");
  if (!bg) return null;

  const bgPr = qs(bg, "bgPr");
  if (bgPr) {
    // Check for image background (blipFill)
    const blipFill = qs(bgPr, "blipFill");
    if (blipFill && rels && zip) {
      const blip = qs(blipFill, "blip");
      const embedId = blip ? getAttr(blip, "r:embed") : null;
      if (embedId && rels[embedId]) {
        const mediaPath = `ppt/${rels[embedId].replace(/^\.\.\//, "").replace(/^\.\//, "")}`;
        const imageDataUrl = await extractImageDataUrl(zip, mediaPath);
        if (imageDataUrl) {
          // Check for tile fill mode
          const tile = qs(blipFill, "tile");
          return { fill: null, imageDataUrl, tiled: !!tile };
        }
      }
    }

    const fill = parseFill(bgPr, theme);
    return { fill, imageDataUrl: null };
  }

  const bgRef = qs(bg, "bgRef");
  if (bgRef) {
    const color = resolveColor(bgRef, theme);
    if (color) return { fill: { type: "solid", color }, imageDataUrl: null };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Speaker notes
// ---------------------------------------------------------------------------

async function parseNotes(
  zip: JSZip,
  slidePath: string,
  slideRels: Record<string, string>,
): Promise<string> {
  // Find notes relationship
  for (const [, target] of Object.entries(slideRels)) {
    if (target.includes("notesSlide")) {
      const slideDir = slidePath.substring(0, slidePath.lastIndexOf("/"));
      const notesPath = normalizePath(slideDir, target);
      const doc = await readXml(zip, notesPath);
      if (!doc) return "";
      return extractNotesText(doc);
    }
  }
  return "";
}

function extractNotesText(doc: Document): string {
  const txBodies = qsa(doc, "txBody");
  const lines: string[] = [];

  for (const txBody of txBodies) {
    // Skip the slide number placeholder — only extract text from the notes body
    const parent = txBody.parentElement;
    if (parent) {
      const nvSpPr = qs(parent, "nvSpPr");
      if (nvSpPr) {
        const nvPr = qs(nvSpPr, "nvPr");
        if (nvPr) {
          const ph = qs(nvPr, "ph");
          if (ph) {
            const phType = getAttr(ph, "type");
            // Only extract from "body" placeholder, skip "sldNum", "dt", "hdr", "ftr"
            if (phType && phType !== "body") continue;
          }
        }
      }
    }

    const pEls = qsa(txBody, "p");
    for (const p of pEls) {
      let lineText = "";
      for (let i = 0; i < p.children.length; i++) {
        const child = p.children[i];
        if (child.localName === "r") {
          const t = qs(child, "t");
          if (t) lineText += t.textContent ?? "";
        }
      }
      if (lineText) lines.push(lineText);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Slide masters & layouts
// ---------------------------------------------------------------------------

/** Extract slide master relationship IDs from presentation.xml.rels */
function parseMasterRIds(presRels: Document): string[] {
  const ids: string[] = [];
  const rels = presRels.getElementsByTagName("Relationship");
  for (let i = 0; i < rels.length; i++) {
    const rel = rels[i];
    const type = rel.getAttribute("Type") ?? "";
    if (type.endsWith("/slideMaster")) {
      const id = rel.getAttribute("Id");
      if (id) ids.push(id);
    }
  }
  return ids;
}

/** Extract placeholders from a shape tree element */
function extractPlaceholders(spTree: Element, theme?: PptxTheme): PptxPlaceholder[] {
  const placeholders: PptxPlaceholder[] = [];

  for (let i = 0; i < spTree.children.length; i++) {
    const child = spTree.children[i];
    if (child.localName !== "sp") continue;

    const nvSpPr = qs(child, "nvSpPr");
    if (!nvSpPr) continue;
    const nvPr = qs(nvSpPr, "nvPr");
    if (!nvPr) continue;
    const ph = qs(nvPr, "ph");
    if (!ph) continue;

    const phType = getAttr(ph, "type") ?? "body";
    const idxStr = getAttr(ph, "idx");
    const idx = idxStr ? parseInt(idxStr, 10) : undefined;

    const transform = getTransform(child);

    // Parse lstStyle from the placeholder's txBody for text style inheritance
    let levelStyles: PptxTextStyle[] | undefined;
    if (theme) {
      const txBody = qs(child, "txBody");
      const lstStyle = txBody ? qs(txBody, "lstStyle") : null;
      if (lstStyle) {
        const parsed = parseTextStyleLevels(lstStyle, theme);
        if (parsed.length > 0) levelStyles = parsed;
      }
    }

    placeholders.push({
      type: phType,
      idx: idx !== undefined && !isNaN(idx) ? idx : undefined,
      x: transform.x,
      y: transform.y,
      width: transform.width,
      height: transform.height,
      levelStyles,
    });
  }

  return placeholders;
}

// ---------------------------------------------------------------------------
// Comment parsing
// ---------------------------------------------------------------------------

async function parseCommentAuthors(zip: JSZip): Promise<Map<number, string>> {
  const doc = await readXml(zip, "ppt/commentAuthors.xml");
  if (!doc) return new Map();
  const authors = new Map<number, string>();
  const cmAuthorEls = qsa(doc, "cmAuthor");
  for (const el of cmAuthorEls) {
    const id = intAttr(el, "id", -1);
    const name = getAttr(el, "name") ?? "Unknown";
    if (id >= 0) authors.set(id, name);
  }
  return authors;
}

async function parseSlideComments(
  zip: JSZip,
  slideRels: Record<string, string>,
  slideDir: string,
  authors: Map<number, string>,
): Promise<PptxComment[]> {
  const comments: PptxComment[] = [];
  for (const [, target] of Object.entries(slideRels)) {
    if (!target.includes("comment")) continue;
    const commentPath = normalizePath(slideDir, target);
    const doc = await readXml(zip, commentPath);
    if (!doc) continue;

    const cmEls = qsa(doc, "cm");
    for (const cm of cmEls) {
      const authorIdx = intAttr(cm, "authorId", 0);
      const dt = getAttr(cm, "dt") ?? "";
      const pos = qs(cm, "pos");
      const x = pos ? intAttr(pos, "x", 0) : 0;
      const y = pos ? intAttr(pos, "y", 0) : 0;
      const textEl = qs(cm, "text");
      const text = textEl?.textContent ?? "";

      comments.push({
        author: authors.get(authorIdx) ?? "Unknown",
        date: dt,
        text,
        x,
        y,
      });
    }
  }
  return comments;
}

// ---------------------------------------------------------------------------
// Section parsing
// ---------------------------------------------------------------------------

function parseSections(presentationXml: Document): PptxSection[] | undefined {
  const sectionLst = qs(presentationXml, "sectionLst");
  if (!sectionLst) return undefined;

  const sectionEls = qsa(sectionLst, "section");
  if (sectionEls.length === 0) return undefined;

  const sections: PptxSection[] = [];
  let slideIdx = 0;
  for (const sec of sectionEls) {
    const name = getAttr(sec, "name") ?? "Untitled";
    sections.push({ name, startSlide: slideIdx });
    const sldIdLst = qs(sec, "sldIdLst");
    const sldIds = sldIdLst ? qsa(sldIdLst, "sldId") : [];
    slideIdx += sldIds.length;
  }

  return sections.length > 0 ? sections : undefined;
}

async function parseSlideMaster(
  zip: JSZip,
  masterPath: string,
  theme: PptxTheme,
): Promise<PptxSlideMaster> {
  const doc = await readXml(zip, masterPath);
  if (!doc) {
    return { shapes: [], placeholders: [], background: null };
  }

  const rels = await readRels(zip, masterPath);
  const masterDir = masterPath.substring(0, masterPath.lastIndexOf("/"));

  // Parse clrMap FIRST — it must be set on theme before parsing shapes/background
  // so that scheme colors (bg1, tx1, etc.) resolve correctly through clrMap
  const clrMapEl = qs(doc.documentElement, "clrMap");
  let clrMap: Record<string, string> | undefined;
  if (clrMapEl) {
    clrMap = {};
    const clrMapAttrs = ["bg1", "tx1", "bg2", "tx2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
    for (const attr of clrMapAttrs) {
      const val = getAttr(clrMapEl, attr);
      if (val) clrMap[attr] = val;
    }
    // Set on theme immediately so shapes/background parsed below use it
    theme.clrMap = clrMap;
  }

  const spTree = qs(doc.documentElement, "spTree");
  const shapes = spTree
    ? await parseElements(doc.documentElement, rels, zip, masterDir, theme)
    : [];
  const placeholders = spTree ? extractPlaceholders(spTree, theme) : [];
  const background = await parseBackground(doc, theme, rels, zip);
  const tsResult = parseTextStyles(doc, theme);

  return {
    shapes,
    placeholders,
    background,
    titleStyle: tsResult.titleStyle ?? undefined,
    bodyStyle: tsResult.bodyStyle ?? undefined,
    otherStyle: tsResult.otherStyle ?? undefined,
    titleLevelStyles: tsResult.titleLevelStyles.length > 0 ? tsResult.titleLevelStyles : undefined,
    bodyLevelStyles: tsResult.bodyLevelStyles.length > 0 ? tsResult.bodyLevelStyles : undefined,
    otherLevelStyles: tsResult.otherLevelStyles.length > 0 ? tsResult.otherLevelStyles : undefined,
    clrMap,
  };
}

async function parseSlideLayout(
  zip: JSZip,
  layoutPath: string,
  theme: PptxTheme,
): Promise<PptxSlideLayout> {
  const doc = await readXml(zip, layoutPath);
  if (!doc) {
    return { name: "", shapes: [], placeholders: [], background: null };
  }

  const rels = await readRels(zip, layoutPath);
  const layoutDir = layoutPath.substring(0, layoutPath.lastIndexOf("/"));

  const cSld = qs(doc, "cSld");
  const name = cSld ? getAttr(cSld, "name") ?? "" : "";

  const spTree = qs(doc.documentElement, "spTree");
  const shapes = spTree
    ? await parseElements(doc.documentElement, rels, zip, layoutDir, theme)
    : [];
  const placeholders = spTree ? extractPlaceholders(spTree, theme) : [];
  const background = await parseBackground(doc, theme, rels, zip);

  return { name, shapes, placeholders, background };
}

// ---------------------------------------------------------------------------
// Inheritance resolution (master -> layout -> slide)
// ---------------------------------------------------------------------------

/**
 * Resolves master/layout inheritance for each slide:
 * 1. Merges shape trees (z-order: master -> layout -> slide)
 * 2. Inherits background from layout or master if slide has none
 * 3. Inherits placeholder positions from layout/master for empty placeholders
 */
export function resolveInheritance(presentation: PptxPresentation): void {
  const theme = presentation.theme;

  for (const slide of presentation.slides) {
    const layout =
      slide.layoutIndex !== undefined
        ? presentation.layouts[slide.layoutIndex]
        : undefined;
    const master =
      slide.masterIndex !== undefined
        ? presentation.masters[slide.masterIndex]
        : undefined;

    // 1. Background inheritance: slide -> layout -> master
    if (!slide.background) {
      slide.background = layout?.background ?? master?.background ?? null;
    }

    // 2. Placeholder position inheritance for slide elements with empty xfrm
    for (const el of slide.elements) {
      if (
        (el.type === "textbox" || el.type === "shape") &&
        el.placeholderType
      ) {
        if (el.width === 0 && el.height === 0) {
          const match = findMatchingPlaceholder(
            el.placeholderType,
            el.placeholderIdx,
            layout,
            master,
          );
          if (match) {
            el.x = match.x;
            el.y = match.y;
            el.width = match.width;
            el.height = match.height;
          }
        }
      }
    }

    // 3. Merge shape trees -- only include non-placeholder (decorative) shapes.
    // Placeholder shapes (title, body, subtitle, dt, ftr, sldNum, etc.) contain
    // template text like "Click to edit Master title style" and must not render.
    // Only decorative elements (logos, lines, background graphics) should inherit.
    const isDecorativeShape = (el: PptxElement): boolean => {
      if (el.type === "textbox" || el.type === "shape") {
        if (el.placeholderType) return false;
      }
      return true;
    };

    slide.masterShapes = master ? master.shapes.filter(isDecorativeShape) : [];
    slide.layoutShapes = layout ? layout.shapes.filter(isDecorativeShape) : [];

    // 4. Apply text style cascade defaults to all text elements
    // Cascade order (lowest to highest priority):
    //   Hardcoded defaults (18pt, left, black, body font)
    //   → presentation defaultTextStyle
    //   → master otherStyle (non-placeholders) / titleStyle|bodyStyle (placeholders)
    //   → shape lstStyle
    //   → paragraph defRPr (already applied during parsing)
    //   → run rPr (already applied during parsing)
    const defaultFs = (theme.defaultFontSize ?? 1800) / 100;

    for (const el of slide.elements) {
      if (el.type !== "textbox" && el.type !== "shape") continue;

      const isTitlePlaceholder =
        el.placeholderType === "title" || el.placeholderType === "ctrTitle";

      const paragraphs = el.type === "textbox" ? el.paragraphs : el.text;
      const shapeLevelStyles = el.shapeLevelStyles;

      // Find matching layout placeholder for text style inheritance.
      // Strip alignment from layout styles — layout alignment is for template
      // placeholder text ("Click to edit..."), not for slide content.
      let layoutPlaceholderStyles: PptxTextStyle[] | undefined;
      if (el.placeholderType && layout) {
        const layoutPh = layout.placeholders.find(
          (p) => p.type === el.placeholderType && (el.placeholderIdx === undefined || p.idx === el.placeholderIdx),
        );
        if (layoutPh?.levelStyles) {
          layoutPlaceholderStyles = layoutPh.levelStyles.map(({ alignment: _, ...rest }) => rest);
        }
      }

      for (const p of paragraphs) {
        // Build cascade defaults for this paragraph's bullet level
        const cascadeDefaults = buildRunDefaults(
          el.placeholderType,
          p.bulletLevel,
          master,
          shapeLevelStyles,
          presentation,
          layoutPlaceholderStyles,
        );

        // Apply cascade alignment only when the paragraph has NO explicit algn attribute.
        if (!p.explicitAlignment && cascadeDefaults.alignment) {
          p.alignment = cascadeDefaults.alignment;
        }

        // Apply cascade bullets when paragraph has no explicit bullet.
        // Skip for title/subtitle placeholders — they don't use body bullets.
        const skipBullets = isTitlePlaceholder || el.placeholderType === "subTitle";
        if (!skipBullets && !p.bulletChar && !p.bulletAutoNum) {
          if (cascadeDefaults.bulletChar) {
            p.bulletChar = cascadeDefaults.bulletChar;
            if (cascadeDefaults.bulletFont) p.bulletFont = cascadeDefaults.bulletFont;
            if (cascadeDefaults.bulletColor) p.bulletColor = cascadeDefaults.bulletColor;
            if (cascadeDefaults.bulletSizePercent) p.bulletSizePercent = cascadeDefaults.bulletSizePercent;
          } else if (cascadeDefaults.bulletAutoNumType) {
            p.bulletAutoNum = { type: cascadeDefaults.bulletAutoNumType, startAt: 1 };
            if (cascadeDefaults.bulletFont) p.bulletFont = cascadeDefaults.bulletFont;
            if (cascadeDefaults.bulletColor) p.bulletColor = cascadeDefaults.bulletColor;
            if (cascadeDefaults.bulletSizePercent) p.bulletSizePercent = cascadeDefaults.bulletSizePercent;
          }
        }

        for (const run of p.runs) {
          // Apply cascade defaults only when the run has the "default" value
          // (i.e., no explicit value was set during parsing)
          if (run.fontSize === defaultFs && cascadeDefaults.fontSize && cascadeDefaults.fontSize !== defaultFs) {
            run.fontSize = cascadeDefaults.fontSize;
          }
          if (run.color === "#000000" && cascadeDefaults.color && cascadeDefaults.color !== "#000000") {
            run.color = cascadeDefaults.color;
          }
          if (!run.bold && cascadeDefaults.bold) {
            run.bold = true;
          }
          if (!run.italic && cascadeDefaults.italic) {
            run.italic = true;
          }
          if (cascadeDefaults.fontFamily && run.fontFamily === theme.fonts.body && cascadeDefaults.fontFamily !== theme.fonts.body) {
            run.fontFamily = cascadeDefaults.fontFamily;
          }
        }
      }

      // Title placeholders use heading font
      if (isTitlePlaceholder) {
        for (const p of paragraphs) {
          for (const run of p.runs) {
            if (run.fontFamily === theme.fonts.body && theme.fonts.heading !== theme.fonts.body) {
              run.fontFamily = theme.fonts.heading;
            }
          }
        }
      }
    }
  }
}

/**
 * Build cascaded text defaults for a shape element by walking the OOXML cascade.
 * Returns the resolved defaults — the first non-undefined value wins (top-down priority).
 */
function buildRunDefaults(
  placeholderType: string | undefined,
  bulletLevel: number,
  master: PptxSlideMaster | undefined,
  shapeLevelStyles: PptxTextStyle[] | undefined,
  presentation: PptxPresentation,
  layoutPlaceholderStyles?: PptxTextStyle[],
): PptxTextStyle {
  const defaults: PptxTextStyle = {};

  // Apply from highest to lowest priority — applyStyleIfEmpty only sets unset fields,
  // so the first (highest priority) value wins.

  // 1. Shape lstStyle (highest cascade priority below explicit rPr/defRPr)
  if (shapeLevelStyles) {
    const lvlIdx = Math.min(bulletLevel, shapeLevelStyles.length - 1);
    if (lvlIdx >= 0) applyStyleIfEmpty(defaults, shapeLevelStyles[lvlIdx]);
  }

  // 1b. Layout placeholder lstStyle (between shape and master)
  if (layoutPlaceholderStyles) {
    const lvlIdx = Math.min(bulletLevel, layoutPlaceholderStyles.length - 1);
    if (lvlIdx >= 0) applyStyleIfEmpty(defaults, layoutPlaceholderStyles[lvlIdx]);
  }

  // 2. Master styles (depends on placeholder type)
  if (master) {
    const isTitlePlaceholder = placeholderType === "title" || placeholderType === "ctrTitle";
    const isBodyPlaceholder = placeholderType === "body" || placeholderType === "subTitle";

    if (isTitlePlaceholder) {
      if (master.titleLevelStyles) {
        const lvlIdx = Math.min(bulletLevel, master.titleLevelStyles.length - 1);
        if (lvlIdx >= 0) applyStyleIfEmpty(defaults, master.titleLevelStyles[lvlIdx]);
      }
      if (master.titleStyle) applyStyleIfEmpty(defaults, master.titleStyle);
    } else if (isBodyPlaceholder) {
      if (master.bodyLevelStyles) {
        const lvlIdx = Math.min(bulletLevel, master.bodyLevelStyles.length - 1);
        if (lvlIdx >= 0) applyStyleIfEmpty(defaults, master.bodyLevelStyles[lvlIdx]);
      }
      if (master.bodyStyle) applyStyleIfEmpty(defaults, master.bodyStyle);
    } else {
      // Non-placeholder: use otherStyle
      if (master.otherLevelStyles) {
        const lvlIdx = Math.min(bulletLevel, master.otherLevelStyles.length - 1);
        if (lvlIdx >= 0) applyStyleIfEmpty(defaults, master.otherLevelStyles[lvlIdx]);
      }
      if (master.otherStyle) applyStyleIfEmpty(defaults, master.otherStyle);
    }
  }

  // 3. Presentation defaultTextStyle (lowest cascade priority)
  if (presentation.defaultTextLevelStyles) {
    const lvlIdx = Math.min(bulletLevel, presentation.defaultTextLevelStyles.length - 1);
    if (lvlIdx >= 0) applyStyleIfEmpty(defaults, presentation.defaultTextLevelStyles[lvlIdx]);
  }
  if (presentation.defaultTextStyle) {
    applyStyleIfEmpty(defaults, presentation.defaultTextStyle);
  }

  return defaults;
}

/** Apply style properties to defaults only where the default is not yet set. */
function applyStyleIfEmpty(defaults: PptxTextStyle, style: PptxTextStyle): void {
  if (style.fontSize !== undefined && defaults.fontSize === undefined) defaults.fontSize = style.fontSize;
  if (style.fontFamily !== undefined && defaults.fontFamily === undefined) defaults.fontFamily = style.fontFamily;
  if (style.color !== undefined && defaults.color === undefined) defaults.color = style.color;
  if (style.bold !== undefined && defaults.bold === undefined) defaults.bold = style.bold;
  if (style.italic !== undefined && defaults.italic === undefined) defaults.italic = style.italic;
  if (style.alignment !== undefined && defaults.alignment === undefined) defaults.alignment = style.alignment;
  if (style.bulletChar !== undefined && defaults.bulletChar === undefined) defaults.bulletChar = style.bulletChar;
  if (style.bulletAutoNumType !== undefined && defaults.bulletAutoNumType === undefined) defaults.bulletAutoNumType = style.bulletAutoNumType;
  if (style.bulletFont !== undefined && defaults.bulletFont === undefined) defaults.bulletFont = style.bulletFont;
  if (style.bulletColor !== undefined && defaults.bulletColor === undefined) defaults.bulletColor = style.bulletColor;
  if (style.bulletSizePercent !== undefined && defaults.bulletSizePercent === undefined) defaults.bulletSizePercent = style.bulletSizePercent;
}

/** Find a matching placeholder in layout then master by type + idx */
function findMatchingPlaceholder(
  phType: string,
  phIdx: number | undefined,
  layout?: PptxSlideLayout,
  master?: PptxSlideMaster,
): PptxPlaceholder | undefined {
  // Try layout first, then master
  for (const source of [layout, master]) {
    if (!source) continue;
    const match = source.placeholders.find(
      (p) => p.type === phType && (phIdx === undefined || p.idx === phIdx),
    );
    if (match && match.width > 0 && match.height > 0) return match;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Search text extraction
// ---------------------------------------------------------------------------

function extractSearchText(elements: PptxElement[], notes: string): string {
  const parts: string[] = [];

  const extractFromElements = (els: PptxElement[]) => {
    for (const el of els) {
      if (el.type === "textbox" || el.type === "shape") {
        const paragraphs = el.type === "textbox" ? el.paragraphs : el.text;
        for (const p of paragraphs) {
          const text = p.runs.map(r => r.text).join("");
          if (text) parts.push(text);
        }
      } else if (el.type === "table") {
        for (const row of el.rows) {
          for (const cell of row.cells) {
            for (const p of cell.paragraphs) {
              const text = p.runs.map(r => r.text).join("");
              if (text) parts.push(text);
            }
          }
        }
      } else if (el.type === "group") {
        extractFromElements(el.children);
      }
    }
  };

  extractFromElements(elements);
  if (notes) parts.push(notes);

  return parts.join(" ");
}

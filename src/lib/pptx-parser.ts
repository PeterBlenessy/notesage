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
  PptxGradientStop,
  PptxParagraph,
  PptxTextRun,
  BodyProperties,
  PptxSlideMaster,
  PptxSlideLayout,
  PptxPlaceholder,
  PptxTextStyle,
  PptxShadow,
  ArrowHead,
  PptxTableStyle,
  PptxTableStylePart,
  PptxComment,
  PptxSection,
} from "./pptx-types";

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

  // --- Parse comment authors (presentation-level, once) ---
  const commentAuthors = await parseCommentAuthors(zip);

  // --- Parse slides and resolve layout/master indices ---
  const slides: PptxSlide[] = [];
  for (let i = 0; i < slideRIds.length; i++) {
    const slidePath = rIdToPath[slideRIds[i]];
    if (!slidePath) continue;

    const normalizedPath = normalizePath("ppt", slidePath);
    const slide = await parseSlide(zip, normalizedPath, i, theme);

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

  const presentation: PptxPresentation = { slideWidth, slideHeight, slides, theme, masters, layouts, ...(sections ? { sections } : {}) };
  resolveInheritance(presentation);
  return presentation;
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

function parseXmlString(text: string): Document {
  return new DOMParser().parseFromString(text, "application/xml");
}

async function readXml(zip: JSZip, path: string): Promise<Document | null> {
  const file = zip.file(path);
  if (!file) return null;
  const text = await file.async("text");
  return parseXmlString(text);
}

async function readRels(zip: JSZip, slidePath: string): Promise<Record<string, string>> {
  const dir = slidePath.substring(0, slidePath.lastIndexOf("/"));
  const name = slidePath.substring(slidePath.lastIndexOf("/") + 1);
  const relsPath = `${dir}/_rels/${name}.rels`;
  const doc = await readXml(zip, relsPath);
  return doc ? parseRelationships(doc) : {};
}

function parseRelationships(doc: Document): Record<string, string> {
  const map: Record<string, string> = {};
  const rels = doc.getElementsByTagName("Relationship");
  for (let i = 0; i < rels.length; i++) {
    const rel = rels[i];
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (id && target) map[id] = target;
  }
  return map;
}

function normalizePath(base: string, relative: string): string {
  if (relative.startsWith("/")) return relative.substring(1);
  const parts = `${base}/${relative}`.split("/");
  const resolved: string[] = [];
  for (const p of parts) {
    if (p === "..") resolved.pop();
    else if (p !== ".") resolved.push(p);
  }
  return resolved.join("/");
}

/** Get text content of first element matching a local-name selector */
function qs(parent: Element | Document, localName: string): Element | null {
  return parent.querySelector(`*|${localName}`) ??
    findByLocalName(parent, localName);
}

function qsa(parent: Element | Document, localName: string): Element[] {
  const result = parent.querySelectorAll(`*|${localName}`);
  if (result.length > 0) return Array.from(result);
  return findAllByLocalName(parent, localName);
}

function findByLocalName(parent: Element | Document, name: string): Element | null {
  const children = parent instanceof Document ? parent.documentElement?.children : parent.children;
  if (!children) return null;
  for (let i = 0; i < children.length; i++) {
    if (children[i].localName === name) return children[i];
    const found = findByLocalName(children[i], name);
    if (found) return found;
  }
  return null;
}

function findAllByLocalName(parent: Element | Document, name: string): Element[] {
  const results: Element[] = [];
  const root = parent instanceof Document ? parent.documentElement : parent;
  if (!root) return results;
  const walk = (el: Element) => {
    for (let i = 0; i < el.children.length; i++) {
      const child = el.children[i];
      if (child.localName === name) results.push(child);
      walk(child);
    }
  };
  walk(root);
  return results;
}

function getAttr(el: Element, name: string): string | null {
  return el.getAttribute(name);
}

function intAttr(el: Element, name: string, fallback = 0): number {
  const v = el.getAttribute(name);
  return v ? parseInt(v, 10) || fallback : fallback;
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
    if (paragraphs.length === 0 && !placeholderType) return null;
    return { type: "textbox", ...transform, paragraphs, bodyProps, hyperlink: shapeHyperlink, placeholderType, placeholderIdx, shadow };
  }

  // Shape
  const shapeType = mapPresetGeometry(preset);
  let fill = spPr ? parseFill(spPr, theme) : null;

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

  const { stroke, strokeWidth, dashStyle, headArrow, tailArrow } = spPr
    ? parseStroke(spPr, theme)
    : { stroke: null, strokeWidth: 0, dashStyle: undefined, headArrow: undefined, tailArrow: undefined };
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
    rightArrow: "arrow", leftArrow: "arrow", upArrow: "arrow", downArrow: "arrow",
    bentArrow: "arrow", stripedRightArrow: "arrow",
  };
  return map[preset] ?? "other";
}

// ---------------------------------------------------------------------------
// Body properties
// ---------------------------------------------------------------------------

function parseBodyProperties(txBody: Element): BodyProperties | undefined {
  const bodyPr = qs(txBody, "bodyPr");
  if (!bodyPr) return undefined;

  const anchorAttr = getAttr(bodyPr, "anchor");
  const anchorMap: Record<string, BodyProperties["anchor"]> = {
    t: "top", ctr: "center", b: "bottom",
  };
  const anchor = anchorMap[anchorAttr ?? ""] ?? "top";

  const marginLeft = intAttr(bodyPr, "lIns", 91440);
  const marginTop = intAttr(bodyPr, "tIns", 45720);
  const marginRight = intAttr(bodyPr, "rIns", 91440);
  const marginBottom = intAttr(bodyPr, "bIns", 45720);

  let fontScale = 1;
  const normAutofit = qs(bodyPr, "normAutofit");
  if (normAutofit) {
    const scaleVal = intAttr(normAutofit, "fontScale", 100000);
    fontScale = scaleVal / 100000;
  }

  const autoFit = !!qs(bodyPr, "spAutoFit");

  const wrapAttr = getAttr(bodyPr, "wrap");
  const wrap = wrapAttr !== "none";

  return { anchor, marginLeft, marginTop, marginRight, marginBottom, fontScale, autoFit, wrap };
}

// ---------------------------------------------------------------------------
// Spacing helpers
// ---------------------------------------------------------------------------

function parseSpacingValue(el: Element | null): number | undefined {
  if (!el) return undefined;
  const spcPct = qs(el, "spcPct");
  if (spcPct) {
    const val = intAttr(spcPct, "val", 0);
    return val / 100000; // e.g., 150000 -> 1.5 multiplier
  }
  const spcPts = qs(el, "spcPts");
  if (spcPts) {
    const val = intAttr(spcPts, "val", 0);
    return val / 100 * 1.333; // hundredths of points -> points -> px
  }
  return undefined;
}

function parseParagraphSpacing(pPr: Element | null): {
  lineSpacing?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  indent?: number;
  marginLeft?: number;
} {
  if (!pPr) return {};

  const lnSpc = qs(pPr, "lnSpc");
  const lineSpacing = parseSpacingValue(lnSpc);

  const spcBef = qs(pPr, "spcBef");
  const spaceBefore = parseSpacingValue(spcBef);

  const spcAft = qs(pPr, "spcAft");
  const spaceAfter = parseSpacingValue(spcAft);

  const indentEmu = intAttr(pPr, "indent", 0);
  const indent = indentEmu !== 0 ? indentEmu / 9525 : undefined;

  const marLEmu = intAttr(pPr, "marL", 0);
  const marginLeft = marLEmu !== 0 ? marLEmu / 9525 : undefined;

  return { lineSpacing, spaceBefore, spaceAfter, indent, marginLeft };
}

// ---------------------------------------------------------------------------
// Hyperlink helpers
// ---------------------------------------------------------------------------

function resolveHyperlinkElement(hlinkEl: Element, rels?: Record<string, string>): string | undefined {
  const rId = hlinkEl.getAttributeNS(
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "id",
  ) || getAttr(hlinkEl, "r:id");

  // Internal slide link (action)
  const action = getAttr(hlinkEl, "action");
  if (action && action.startsWith("ppaction://hlinksldjump")) {
    if (rId && rels?.[rId]) {
      const target = rels[rId];
      const match = target.match(/slide(\d+)\.xml/i);
      if (match) return `slide:${parseInt(match[1], 10)}`;
    }
    return undefined;
  }

  if (rId && rels?.[rId]) {
    const target = rels[rId];
    if (target.startsWith("http://") || target.startsWith("https://") || target.startsWith("mailto:")) {
      return target;
    }
  }

  return undefined;
}

function resolveHyperlink(cNvPr: Element, rels?: Record<string, string>): string | undefined {
  const hlinkClick = qs(cNvPr, "hlinkClick");
  if (!hlinkClick) return undefined;
  return resolveHyperlinkElement(hlinkClick, rels);
}

// ---------------------------------------------------------------------------
// Paragraphs & text runs
// ---------------------------------------------------------------------------

function parseParagraphs(txBody: Element, theme: PptxTheme, rels?: Record<string, string>): PptxParagraph[] {
  const paragraphs: PptxParagraph[] = [];
  const pEls = qsa(txBody, "p");

  for (const pEl of pEls) {
    const pPr = qs(pEl, "pPr");
    const alignment = parseAlignment(pPr);
    const bullet = parseBullet(pPr, theme);
    const spacing = parseParagraphSpacing(pPr);
    const defRPr = pPr ? qs(pPr, "defRPr") : null;
    const runs = parseTextRuns(pEl, theme, rels, defRPr);

    // Parse tab stops from pPr > tabLst > tab
    let tabStops: { pos: number; align: string }[] | undefined;
    if (pPr) {
      const tabLst = qs(pPr, "tabLst");
      if (tabLst) {
        const tabs = qsa(tabLst, "tab");
        if (tabs.length > 0) {
          tabStops = tabs.map(tab => ({
            pos: intAttr(tab, "pos", 0) / 9525,
            align: getAttr(tab, "algn") ?? "l",
          }));
        }
      }
    }

    // Skip empty paragraphs with no text at all
    if (runs.length === 0 && !bullet.bulletChar && !bullet.bulletAutoNum) continue;

    paragraphs.push({
      alignment,
      runs,
      bulletChar: bullet.bulletChar,
      bulletLevel: bullet.bulletLevel,
      ...spacing,
      bulletAutoNum: bullet.bulletAutoNum,
      bulletFont: bullet.bulletFont,
      bulletColor: bullet.bulletColor,
      bulletSizePercent: bullet.bulletSizePercent,
      tabStops,
    });
  }

  return paragraphs;
}

function parseAlignment(pPr: Element | null): PptxParagraph["alignment"] {
  if (!pPr) return "left";
  const algn = getAttr(pPr, "algn");
  const map: Record<string, PptxParagraph["alignment"]> = {
    l: "left", ctr: "center", r: "right", just: "justify",
  };
  return map[algn ?? ""] ?? "left";
}

interface BulletInfo {
  bulletChar: string | null;
  bulletLevel: number;
  bulletAutoNum?: { type: string; startAt: number };
  bulletFont?: string;
  bulletColor?: string;
  bulletSizePercent?: number;
}

function parseBullet(pPr: Element | null, theme: PptxTheme): BulletInfo {
  if (!pPr) return { bulletChar: null, bulletLevel: 0 };
  const level = intAttr(pPr, "lvl", 0);

  // Parse shared bullet styling
  const buFont = qs(pPr, "buFont");
  const bulletFont = buFont ? (getAttr(buFont, "typeface") ?? undefined) : undefined;

  const buClr = qs(pPr, "buClr");
  const bulletColor = buClr ? (resolveColor(buClr, theme) ?? undefined) : undefined;

  const buSzPct = qs(pPr, "buSzPct");
  const bulletSizePercent = buSzPct ? (intAttr(buSzPct, "val", 100000) / 1000) : undefined;

  const buChar = qs(pPr, "buChar");
  if (buChar) {
    return {
      bulletChar: getAttr(buChar, "char") ?? "•",
      bulletLevel: level,
      bulletFont, bulletColor, bulletSizePercent,
    };
  }

  const buAutoNum = qs(pPr, "buAutoNum");
  if (buAutoNum) {
    const type = getAttr(buAutoNum, "type") ?? "arabicPeriod";
    const startAt = intAttr(buAutoNum, "startAt", 1);
    return {
      bulletChar: null, // rendered dynamically
      bulletLevel: level,
      bulletAutoNum: { type, startAt },
      bulletFont, bulletColor, bulletSizePercent,
    };
  }

  // buNone explicitly disables bullets
  const buNone = qs(pPr, "buNone");
  if (buNone) return { bulletChar: null, bulletLevel: 0 };

  return { bulletChar: null, bulletLevel: level };
}

export function parseTextRuns(pEl: Element, theme: PptxTheme, rels?: Record<string, string>, defRPr?: Element | null): PptxTextRun[] {
  const runs: PptxTextRun[] = [];

  for (let i = 0; i < pEl.children.length; i++) {
    const child = pEl.children[i];
    const ln = child.localName;

    if (ln === "r") {
      const tEl = qs(child, "t");
      const text = tEl?.textContent ?? "";
      if (!text) continue;

      const rPr = qs(child, "rPr");

      // Resolve properties with defRPr fallback
      const effectiveRPr = rPr ?? defRPr ?? null;

      // Character spacing (spc is in 1/100ths of a point)
      const spc = rPr ? intAttr(rPr, "spc", 0) : (defRPr ? intAttr(defRPr, "spc", 0) : 0);

      // Text caps
      const capAttr = rPr ? getAttr(rPr, "cap") : (defRPr ? getAttr(defRPr, "cap") : null);
      const caps = capAttr === "all" ? "all" as const
        : capAttr === "small" ? "small" as const
        : undefined;

      // Strikethrough
      const strike = rPr ? getAttr(rPr, "strike") : (defRPr ? getAttr(defRPr, "strike") : null);
      let strikethrough: PptxTextRun["strikethrough"];
      if (strike === "sngStrike") strikethrough = "single";
      else if (strike === "dblStrike") strikethrough = "double";

      // Baseline (superscript/subscript)
      const baseline = rPr ? intAttr(rPr, "baseline", 0) : (defRPr ? intAttr(defRPr, "baseline", 0) : 0);

      // Underline style and color
      const uAttr = effectiveRPr ? getAttr(effectiveRPr, "u") : null;
      const underline = effectiveRPr ? (uAttr ?? "none") !== "none" : false;
      const underlineStyle = underline && uAttr ? uAttr : undefined;
      const uFill = rPr ? qs(rPr, "uFill") : null;
      const uSolidFill = uFill ? qs(uFill, "solidFill") : null;
      const underlineColor = uSolidFill ? resolveColor(uSolidFill, theme) ?? undefined : undefined;

      // Highlight (text background)
      const highlightEl = effectiveRPr ? qs(effectiveRPr, "highlight") : null;
      const highlight = highlightEl ? resolveColor(highlightEl, theme) ?? undefined : undefined;

      // Kerning
      const kern = rPr ? intAttr(rPr, "kern", 0) : (defRPr ? intAttr(defRPr, "kern", 0) : 0);

      // East Asian and Complex Script fonts
      const eaEl = effectiveRPr ? qs(effectiveRPr, "ea") : null;
      let eaFont: string | undefined;
      if (eaEl) {
        const tf = getAttr(eaEl, "typeface");
        if (tf === "+mj-ea") eaFont = theme.fonts.heading;
        else if (tf === "+mn-ea") eaFont = theme.fonts.body;
        else if (tf) eaFont = tf;
      }

      const csEl = effectiveRPr ? qs(effectiveRPr, "cs") : null;
      let csFont: string | undefined;
      if (csEl) {
        const tf = getAttr(csEl, "typeface");
        if (tf === "+mj-cs") csFont = theme.fonts.heading;
        else if (tf === "+mn-cs") csFont = theme.fonts.body;
        else if (tf) csFont = tf;
      }

      // Hyperlink on the run
      const hlinkClick = rPr ? qs(rPr, "hlinkClick") : null;
      const hyperlink = hlinkClick ? resolveHyperlinkElement(hlinkClick, rels) : undefined;

      // Bold/italic/underline with defRPr fallback
      const bold = rPr ? getAttr(rPr, "b") === "1"
        : (defRPr ? getAttr(defRPr, "b") === "1" : false);
      const italic = rPr ? getAttr(rPr, "i") === "1"
        : (defRPr ? getAttr(defRPr, "i") === "1" : false);

      // Font size with defRPr fallback
      const defFontSize = defRPr ? intAttr(defRPr, "sz", 1800) : 1800;
      const fontSize = rPr ? intAttr(rPr, "sz", defFontSize) / 100 : defFontSize / 100;

      const fontFamily = parseFontFamily(effectiveRPr, theme);

      runs.push({
        text,
        bold,
        italic,
        underline,
        ...(underlineStyle ? { underlineStyle } : {}),
        ...(underlineColor ? { underlineColor } : {}),
        strikethrough,
        baseline: baseline !== 0 ? baseline : undefined,
        fontSize,
        fontFamily,
        color: parseRunColor(effectiveRPr, theme),
        ...(spc !== 0 ? { letterSpacing: spc / 100 } : {}),
        ...(caps ? { caps } : {}),
        ...(highlight ? { highlight } : {}),
        ...(kern !== 0 ? { kern } : {}),
        ...(eaFont && eaFont !== fontFamily ? { eaFont } : {}),
        ...(csFont && csFont !== fontFamily ? { csFont } : {}),
        hyperlink,
      });
    } else if (ln === "br") {
      runs.push({
        text: "\n",
        bold: false, italic: false, underline: false,
        fontSize: 18, fontFamily: theme.fonts.body, color: "#000000",
      });
    }
  }

  return runs;
}

function parseFontFamily(rPr: Element | null, theme: PptxTheme): string {
  if (!rPr) return theme.fonts.body;
  const latin = qs(rPr, "latin");
  if (latin) {
    const tf = getAttr(latin, "typeface");
    if (tf) {
      if (tf === "+mj-lt") return theme.fonts.heading;
      if (tf === "+mn-lt") return theme.fonts.body;
      return tf;
    }
  }
  return theme.fonts.body;
}

function parseRunColor(rPr: Element | null, theme: PptxTheme): string {
  if (!rPr) return "#000000";
  return resolveColor(rPr, theme) ?? "#000000";
}

// ---------------------------------------------------------------------------
// Color resolution
// ---------------------------------------------------------------------------

function resolveColor(parent: Element, theme: PptxTheme): string | null {
  const srgb = qs(parent, "srgbClr");
  if (srgb) return applyColorTransforms(srgb, `#${getAttr(srgb, "val") ?? "000000"}`);

  const schemeClr = qs(parent, "schemeClr");
  if (schemeClr) {
    const val = getAttr(schemeClr, "val");
    if (val && theme.colors[val]) {
      return applyColorTransforms(schemeClr, theme.colors[val]);
    }
    // Map bg1/bg2/tx1/tx2 to lt1/lt2/dk1/dk2
    const altMap: Record<string, string> = { bg1: "lt1", bg2: "lt2", tx1: "dk1", tx2: "dk2" };
    if (val && altMap[val] && theme.colors[altMap[val]]) {
      return applyColorTransforms(schemeClr, theme.colors[altMap[val]]);
    }
  }

  return null;
}

/** Like resolveColor but also extracts alpha from the color element's children. */
function resolveColorWithAlpha(parent: Element, theme: PptxTheme): { color: string; alpha?: number } | null {
  const srgb = qs(parent, "srgbClr");
  if (srgb) {
    const color = applyColorTransforms(srgb, `#${getAttr(srgb, "val") ?? "000000"}`);
    const alpha = extractAlpha(srgb);
    return { color, alpha };
  }

  const schemeClr = qs(parent, "schemeClr");
  if (schemeClr) {
    const val = getAttr(schemeClr, "val");
    const altMap: Record<string, string> = { bg1: "lt1", bg2: "lt2", tx1: "dk1", tx2: "dk2" };
    const baseKey = (val && theme.colors[val]) ? val : (val && altMap[val] && theme.colors[altMap[val]]) ? altMap[val] : null;
    if (baseKey) {
      const color = applyColorTransforms(schemeClr, theme.colors[baseKey]);
      const alpha = extractAlpha(schemeClr);
      return { color, alpha };
    }
  }

  return null;
}

/** Extract alpha value from a color element's alpha child (values in 1/1000ths of percent). */
function extractAlpha(colorEl: Element): number | undefined {
  const alphaEl = qs(colorEl, "alpha");
  if (!alphaEl) return undefined;
  const val = intAttr(alphaEl, "val", 100000);
  if (val >= 100000) return undefined; // fully opaque, no need to set
  return val / 100000;
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const raw = hex.replace("#", "");
  const r = parseInt(raw.substring(0, 2), 16) / 255;
  const g = parseInt(raw.substring(2, 4), 16) / 255;
  const b = parseInt(raw.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6;
  } else {
    h = ((r - g) / d + 4) / 6;
  }

  return { h: h * 360, s, l };
}

export function hslToHex(h: number, s: number, l: number): string {
  // Clamp values
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));

  if (s === 0) {
    const v = Math.round(l * 255);
    return `#${v.toString(16).padStart(2, "0")}${v.toString(16).padStart(2, "0")}${v.toString(16).padStart(2, "0")}`;
  }

  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hNorm = h / 360;

  const r = Math.round(hue2rgb(p, q, hNorm + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, hNorm) * 255);
  const b = Math.round(hue2rgb(p, q, hNorm - 1 / 3) * 255);

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export function applyColorTransforms(parent: Element, baseColor: string): string {
  const hueMod = qs(parent, "hueMod");
  const hueOff = qs(parent, "hueOff");
  const satMod = qs(parent, "satMod");
  const satOff = qs(parent, "satOff");
  const lumMod = qs(parent, "lumMod");
  const lumOff = qs(parent, "lumOff");
  const tint = qs(parent, "tint");
  const shade = qs(parent, "shade");

  // Early return if no transforms present
  if (!hueMod && !hueOff && !satMod && !satOff && !lumMod && !lumOff && !tint && !shade) {
    return baseColor;
  }

  const hsl = hexToHsl(baseColor);

  // 1. Hue modulation and offset
  if (hueMod) {
    hsl.h = hsl.h * (intAttr(hueMod, "val", 100000) / 100000);
  }
  if (hueOff) {
    // hueOff is in 60000ths of a degree
    hsl.h = hsl.h + intAttr(hueOff, "val", 0) / 60000;
  }

  // 2. Saturation modulation and offset
  if (satMod) {
    hsl.s = hsl.s * (intAttr(satMod, "val", 100000) / 100000);
  }
  if (satOff) {
    hsl.s = hsl.s + intAttr(satOff, "val", 0) / 100000;
  }

  // 3. Luminance modulation and offset: L_new = L * lumMod + lumOff
  if (lumMod || lumOff) {
    const lm = lumMod ? intAttr(lumMod, "val", 100000) / 100000 : 1;
    const lo = lumOff ? intAttr(lumOff, "val", 0) / 100000 : 0;
    hsl.l = hsl.l * lm + lo;
  }

  // 4. Tint — mix toward white: L_new = L + (1 - L) * tint
  if (tint) {
    const t = intAttr(tint, "val", 100000) / 100000;
    hsl.l = hsl.l + (1 - hsl.l) * t;
  }

  // 5. Shade — mix toward black: L_new = L * shade
  if (shade) {
    const sh = intAttr(shade, "val", 100000) / 100000;
    hsl.l = hsl.l * sh;
  }

  // 6. Alpha — ignored for now (task #2)

  return hslToHex(hsl.h, hsl.s, hsl.l);
}

// ---------------------------------------------------------------------------
// Shadows
// ---------------------------------------------------------------------------

interface EffectsResult {
  shadow?: PptxShadow;
  glow?: { radius: number; color: string; alpha: number };
  softEdge?: number;
}

export function parseEffects(spPr: Element, theme: PptxTheme): EffectsResult {
  const effectLst = qs(spPr, "effectLst");
  if (!effectLst) return {};

  const result: EffectsResult = {};

  // Shadow (outerShdw)
  const outerShdw = qs(effectLst, "outerShdw");
  if (outerShdw) {
    const blurRad = intAttr(outerShdw, "blurRad", 0) / 12700;
    const dist = intAttr(outerShdw, "dist", 0) / 12700;
    const dir = intAttr(outerShdw, "dir", 0) / 60000;
    const dirRad = (dir * Math.PI) / 180;
    const offsetX = Math.round(dist * Math.sin(dirRad) * 10) / 10;
    const offsetY = Math.round(dist * Math.cos(dirRad) * 10) / 10;
    const colorResult = resolveColorWithAlpha(outerShdw, theme);
    result.shadow = {
      offsetX, offsetY, blur: blurRad,
      color: colorResult?.color ?? "#000000",
      alpha: colorResult?.alpha ?? 0.5,
    };
  }

  // Glow
  const glowEl = qs(effectLst, "glow");
  if (glowEl) {
    const rad = intAttr(glowEl, "rad", 0) / 12700;
    const colorResult = resolveColorWithAlpha(glowEl, theme);
    result.glow = {
      radius: rad,
      color: colorResult?.color ?? "#000000",
      alpha: colorResult?.alpha ?? 0.5,
    };
  }

  // Soft edge
  const softEdgeEl = qs(effectLst, "softEdge");
  if (softEdgeEl) {
    result.softEdge = intAttr(softEdgeEl, "rad", 0) / 12700;
  }

  return result;
}

/** @deprecated Use parseEffects instead. Kept for backward compat with picture shadow parsing. */
function parseShadow(spPr: Element, theme: PptxTheme): PptxShadow | undefined {
  return parseEffects(spPr, theme).shadow;
}

export function parseReflection(spPr: Element): PptxImage['reflection'] | undefined {
  const effectLst = qs(spPr, "effectLst");
  if (!effectLst) return undefined;
  const reflEl = qs(effectLst, "reflection");
  if (!reflEl) return undefined;

  const blurRadius = intAttr(reflEl, "blurRad", 0) / 12700;        // EMU to pt
  const startOpacity = intAttr(reflEl, "stA", 100000) / 100000;    // start alpha
  const endOpacity = intAttr(reflEl, "endA", 0) / 100000;          // end alpha
  const distance = intAttr(reflEl, "dist", 0) / 12700;             // EMU to pt
  const direction = intAttr(reflEl, "dir", 5400000) / 60000;       // 60000ths of degree
  const sy = intAttr(reflEl, "sy", -100000);                       // scale Y (negative = flip)
  const size = Math.abs(sy) / 1000;                                // percentage

  return { blurRadius, startOpacity, endOpacity, distance, direction, size };
}

// ---------------------------------------------------------------------------
// Fill & stroke
// ---------------------------------------------------------------------------

export function parseFill(spPr: Element, theme: PptxTheme): PptxFill | null {
  // Solid fill
  const solidFill = qs(spPr, "solidFill");
  if (solidFill) {
    const result = resolveColorWithAlpha(solidFill, theme);
    if (result) return { type: "solid", color: result.color, alpha: result.alpha };
  }

  // Gradient fill
  const gradFill = qs(spPr, "gradFill");
  if (gradFill) return parseGradientFill(gradFill, theme);

  // Pattern fill with preset, foreground and background colors
  const pattFill = qs(spPr, "pattFill");
  if (pattFill) {
    const preset = getAttr(pattFill, "prst") ?? "solid";
    const fgClr = qs(pattFill, "fgClr");
    const bgClr = qs(pattFill, "bgClr");
    const fg = fgClr ? resolveColor(fgClr, theme) ?? "#000000" : "#000000";
    const bg = bgClr ? resolveColor(bgClr, theme) ?? "#ffffff" : "#ffffff";
    return { type: "pattern", preset, foreground: fg, background: bg };
  }

  // No fill
  const noFill = qs(spPr, "noFill");
  if (noFill) return null;

  return null;
}

export function parseGradientFill(gradFill: Element, theme: PptxTheme): PptxFill {
  const stops: PptxGradientStop[] = [];
  const gsLst = qs(gradFill, "gsLst");
  if (gsLst) {
    const gsEls = qsa(gsLst, "gs");
    for (const gs of gsEls) {
      const pos = intAttr(gs, "pos", 0) / 1000; // 0–100000 → 0–100
      const result = resolveColorWithAlpha(gs, theme);
      stops.push({ position: pos, color: result?.color ?? "#000000", alpha: result?.alpha });
    }
  }

  // Check for linear
  const lin = qs(gradFill, "lin");
  if (lin) {
    const ang = intAttr(lin, "ang", 0) / 60000; // 60000ths of degree → degrees
    return { type: "linear", angle: ang, stops };
  }

  // Check for radial (path)
  const path = qs(gradFill, "path");
  if (path) {
    return { type: "radial", stops };
  }

  // Default to linear 0 degrees
  return { type: "linear", angle: 0, stops };
}

interface StrokeResult {
  stroke: string | null;
  strokeWidth: number;
  dashStyle?: string;
  headArrow?: ArrowHead;
  tailArrow?: ArrowHead;
}

export function parseStroke(spPr: Element, theme: PptxTheme): StrokeResult {
  const ln = qs(spPr, "ln");
  if (!ln) return { stroke: null, strokeWidth: 0 };

  const noFill = qs(ln, "noFill");
  if (noFill) return { stroke: null, strokeWidth: 0 };

  const width = intAttr(ln, "w", 12700) / 12700; // EMUs → pt (approx)
  const color = resolveColor(ln, theme);

  // Dash style
  const prstDash = qs(ln, "prstDash");
  const dashVal = prstDash ? getAttr(prstDash, "val") : null;

  const headArrow = parseArrowEnd(ln, "headEnd");
  const tailArrow = parseArrowEnd(ln, "tailEnd");

  return { stroke: color, strokeWidth: width, dashStyle: dashVal ?? undefined, headArrow, tailArrow };
}

const ARROW_TYPE_MAP: Record<string, ArrowHead["type"]> = {
  triangle: "triangle",
  stealth: "stealth",
  diamond: "diamond",
  oval: "oval",
  arrow: "arrow",
};

const ARROW_SIZE_MAP: Record<string, "sm" | "med" | "lg"> = {
  sm: "sm",
  med: "med",
  lg: "lg",
};

function parseArrowEnd(ln: Element, tagSuffix: string): ArrowHead | undefined {
  const el = qs(ln, tagSuffix);
  if (!el) return undefined;

  const rawType = getAttr(el, "type");
  if (!rawType || rawType === "none") return undefined;

  const type = ARROW_TYPE_MAP[rawType] ?? "triangle";
  const rawW = getAttr(el, "w");
  const rawLen = getAttr(el, "len");

  const arrow: ArrowHead = { type };
  if (rawW && ARROW_SIZE_MAP[rawW]) arrow.width = ARROW_SIZE_MAP[rawW];
  if (rawLen && ARROW_SIZE_MAP[rawLen]) arrow.length = ARROW_SIZE_MAP[rawLen];

  return arrow;
}

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

async function parseGraphicFrame(
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

  const result: PptxTable = { type: "table", ...transform, height: transform.height, rows };
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
    const rich = qs(titleEl, "rich");
    if (rich) {
      const texts: string[] = [];
      const titleRuns = qsa(rich, "r");
      for (const r of titleRuns) {
        const t = qs(r, "t");
        if (t?.textContent) texts.push(t.textContent);
      }
      title = texts.join("") || undefined;
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
    dataLabelPosition, secondaryAxis,
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
function extractPlaceholders(spTree: Element): PptxPlaceholder[] {
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

    placeholders.push({
      type: phType,
      idx: idx !== undefined && !isNaN(idx) ? idx : undefined,
      x: transform.x,
      y: transform.y,
      width: transform.width,
      height: transform.height,
    });
  }

  return placeholders;
}

/** Parse default text styles from a slide master's p:txStyles */
function parseTextStyles(doc: Document, theme: PptxTheme): { titleStyle?: PptxTextStyle; bodyStyle?: PptxTextStyle } {
  const txStyles = qs(doc, "txStyles");
  if (!txStyles) return {};

  const titleStyle = parseTextStyleDef(qs(txStyles, "titleStyle"), theme);
  const bodyStyle = parseTextStyleDef(qs(txStyles, "bodyStyle"), theme);

  return {
    titleStyle: titleStyle ?? undefined,
    bodyStyle: bodyStyle ?? undefined,
  };
}

function parseTextStyleDef(styleEl: Element | null, theme: PptxTheme): PptxTextStyle | null {
  if (!styleEl) return null;

  const lvl1 = qs(styleEl, "lvl1pPr");
  if (!lvl1) return null;

  const style: PptxTextStyle = {};

  const algn = getAttr(lvl1, "algn");
  if (algn) {
    const map: Record<string, PptxTextStyle["alignment"]> = {
      l: "left", ctr: "center", r: "right", just: "justify",
    };
    style.alignment = map[algn];
  }

  const defRPr = qs(lvl1, "defRPr");
  if (defRPr) {
    const sz = getAttr(defRPr, "sz");
    if (sz) style.fontSize = parseInt(sz, 10) / 100;

    if (getAttr(defRPr, "b") === "1") style.bold = true;
    if (getAttr(defRPr, "i") === "1") style.italic = true;

    const latin = qs(defRPr, "latin");
    if (latin) {
      const tf = getAttr(latin, "typeface");
      if (tf) {
        if (tf === "+mj-lt") style.fontFamily = theme.fonts.heading;
        else if (tf === "+mn-lt") style.fontFamily = theme.fonts.body;
        else style.fontFamily = tf;
      }
    }

    const color = resolveColor(defRPr, theme);
    if (color) style.color = color;
  }

  return Object.keys(style).length > 0 ? style : null;
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

  const spTree = qs(doc.documentElement, "spTree");
  const shapes = spTree
    ? await parseElements(doc.documentElement, rels, zip, masterDir, theme)
    : [];
  const placeholders = spTree ? extractPlaceholders(spTree) : [];
  const background = await parseBackground(doc, theme, rels, zip);
  const { titleStyle, bodyStyle } = parseTextStyles(doc, theme);

  return { shapes, placeholders, background, titleStyle, bodyStyle };
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
  const placeholders = spTree ? extractPlaceholders(spTree) : [];
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
function resolveInheritance(presentation: PptxPresentation): void {
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
  }
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

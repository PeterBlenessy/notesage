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

  // --- Parse slides and resolve layout/master indices ---
  const slides: PptxSlide[] = [];
  for (let i = 0; i < slideRIds.length; i++) {
    const slidePath = rIdToPath[slideRIds[i]];
    if (!slidePath) continue;

    const normalizedPath = normalizePath("ppt", slidePath);
    const slide = await parseSlide(zip, normalizedPath, i, theme);

    // Resolve layout for this slide
    const slideRels = await readRels(zip, normalizedPath);
    for (const [, target] of Object.entries(slideRels)) {
      if (target.includes("slideLayout")) {
        const slideDir = normalizedPath.substring(0, normalizedPath.lastIndexOf("/"));
        const layoutPath = normalizePath(slideDir, target);
        const li = layoutPathToIndex.get(layoutPath);
        if (li !== undefined) {
          slide.layoutIndex = li;
          slide.masterIndex = layoutToMasterIndex.get(layoutPath);
        }
        break;
      }
    }

    slides.push(slide);
  }

  const presentation: PptxPresentation = { slideWidth, slideHeight, slides, theme, masters, layouts };
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

  return defaults;
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

  const elements = await parseElements(doc.documentElement, rels, zip, slideDir, theme);
  const background = parseBackground(doc, theme);
  const notes = await parseNotes(zip, slidePath, rels);
  const searchText = extractSearchText(elements, notes);

  return { index, elements, background, notes, searchText };
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
): Promise<PptxElement[]> {
  const elements: PptxElement[] = [];

  // Direct children — spTree or cSld > spTree
  const spTree = qs(parent, "spTree") ?? parent;

  for (let i = 0; i < spTree.children.length; i++) {
    const child = spTree.children[i];
    const ln = child.localName;

    if (ln === "sp") {
      const el = parseShapeOrTextBox(child, theme, rels);
      if (el) elements.push(el);
    } else if (ln === "pic") {
      const el = await parsePicture(child, rels, zip, slideDir, theme);
      if (el) elements.push(el);
    } else if (ln === "graphicFrame") {
      const el = await parseGraphicFrame(child, rels, zip, slideDir, theme);
      if (el) elements.push(el);
    } else if (ln === "grpSp") {
      const el = await parseGroup(child, rels, zip, slideDir, theme);
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

function parseShapeOrTextBox(el: Element, theme: PptxTheme, rels?: Record<string, string>): PptxTextBox | PptxShape | null {
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

  // Shadow (from spPr effectLst)
  const shadow = spPr ? parseShadow(spPr, theme) : undefined;

  // If it has text and no geometry preset, treat as textbox
  if (txBody && !preset) {
    const paragraphs = parseParagraphs(txBody, theme, rels);
    if (paragraphs.length === 0) return null;
    return { type: "textbox", ...transform, paragraphs, bodyProps, hyperlink: shapeHyperlink, placeholderType, placeholderIdx, shadow };
  }

  // Shape
  const shapeType = mapPresetGeometry(preset);
  const fill = spPr ? parseFill(spPr, theme) : null;
  const { stroke, strokeWidth, dashStyle } = spPr ? parseStroke(spPr, theme) : { stroke: null, strokeWidth: 0, dashStyle: undefined };
  const text = txBody ? parseParagraphs(txBody, theme, rels) : [];

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
    bodyProps,
    hyperlink: shapeHyperlink,
    placeholderType,
    placeholderIdx,
    shadow,
  };
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
    const runs = parseTextRuns(pEl, theme, rels);

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

function parseTextRuns(pEl: Element, theme: PptxTheme, rels?: Record<string, string>): PptxTextRun[] {
  const runs: PptxTextRun[] = [];

  for (let i = 0; i < pEl.children.length; i++) {
    const child = pEl.children[i];
    const ln = child.localName;

    if (ln === "r") {
      const tEl = qs(child, "t");
      const text = tEl?.textContent ?? "";
      if (!text) continue;

      const rPr = qs(child, "rPr");

      // Strikethrough
      const strike = rPr ? getAttr(rPr, "strike") : null;
      let strikethrough: PptxTextRun["strikethrough"];
      if (strike === "sngStrike") strikethrough = "single";
      else if (strike === "dblStrike") strikethrough = "double";

      // Baseline (superscript/subscript)
      const baseline = rPr ? intAttr(rPr, "baseline", 0) : 0;

      // Hyperlink on the run
      const hlinkClick = rPr ? qs(rPr, "hlinkClick") : null;
      const hyperlink = hlinkClick ? resolveHyperlinkElement(hlinkClick, rels) : undefined;

      runs.push({
        text,
        bold: rPr ? getAttr(rPr, "b") === "1" : false,
        italic: rPr ? getAttr(rPr, "i") === "1" : false,
        underline: rPr ? (getAttr(rPr, "u") ?? "none") !== "none" : false,
        strikethrough,
        baseline: baseline !== 0 ? baseline : undefined,
        fontSize: rPr ? intAttr(rPr, "sz", 1800) / 100 : 18,
        fontFamily: parseFontFamily(rPr, theme),
        color: parseRunColor(rPr, theme),
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

function parseShadow(spPr: Element, theme: PptxTheme): PptxShadow | undefined {
  const effectLst = qs(spPr, "effectLst");
  if (!effectLst) return undefined;
  const outerShdw = qs(effectLst, "outerShdw");
  if (!outerShdw) return undefined;

  const blurRad = intAttr(outerShdw, "blurRad", 0) / 12700; // EMU to pt approx
  const dist = intAttr(outerShdw, "dist", 0) / 12700;
  const dir = intAttr(outerShdw, "dir", 0) / 60000; // 60000ths of degree to degrees

  // Convert polar (dist, dir) to cartesian (x, y)
  const dirRad = (dir * Math.PI) / 180;
  const offsetX = Math.round(dist * Math.sin(dirRad) * 10) / 10;
  const offsetY = Math.round(dist * Math.cos(dirRad) * 10) / 10;

  // Color (use resolveColorWithAlpha to get alpha from color children)
  const colorResult = resolveColorWithAlpha(outerShdw, theme);
  const color = colorResult?.color ?? "#000000";
  const alpha = colorResult?.alpha ?? 0.5;

  return { offsetX, offsetY, blur: blurRad, color, alpha };
}

// ---------------------------------------------------------------------------
// Fill & stroke
// ---------------------------------------------------------------------------

function parseFill(spPr: Element, theme: PptxTheme): PptxFill | null {
  // Solid fill
  const solidFill = qs(spPr, "solidFill");
  if (solidFill) {
    const result = resolveColorWithAlpha(solidFill, theme);
    if (result) return { type: "solid", color: result.color, alpha: result.alpha };
  }

  // Gradient fill
  const gradFill = qs(spPr, "gradFill");
  if (gradFill) return parseGradientFill(gradFill, theme);

  // Pattern fill — fallback to foreground color
  const pattFill = qs(spPr, "pattFill");
  if (pattFill) {
    const fgClr = qs(pattFill, "fgClr");
    if (fgClr) {
      const color = resolveColor(fgClr, theme);
      if (color) return { type: "pattern", foreground: color };
    }
  }

  // No fill
  const noFill = qs(spPr, "noFill");
  if (noFill) return null;

  return null;
}

function parseGradientFill(gradFill: Element, theme: PptxTheme): PptxFill {
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

function parseStroke(spPr: Element, theme: PptxTheme): { stroke: string | null; strokeWidth: number; dashStyle?: string } {
  const ln = qs(spPr, "ln");
  if (!ln) return { stroke: null, strokeWidth: 0 };

  const noFill = qs(ln, "noFill");
  if (noFill) return { stroke: null, strokeWidth: 0 };

  const width = intAttr(ln, "w", 12700) / 12700; // EMUs → pt (approx)
  const color = resolveColor(ln, theme);

  // Dash style
  const prstDash = qs(ln, "prstDash");
  const dashVal = prstDash ? getAttr(prstDash, "val") : null;

  return { stroke: color, strokeWidth: width, dashStyle: dashVal ?? undefined };
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

  if (!embedId || !rels[embedId]) return null;

  const mediaPath = normalizePath(slideDir, rels[embedId]);
  const dataUrl = await extractImageDataUrl(zip, mediaPath);
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

  // Check for hyperlink on the picture element
  const nvPicPr = qs(el, "nvPicPr");
  const picCNvPr = nvPicPr ? qs(nvPicPr, "cNvPr") : null;
  const picHyperlink = picCNvPr ? resolveHyperlink(picCNvPr, rels) : undefined;

  // Shadow on pictures
  const picSpPr = qs(el, "spPr");
  const picShadow = picSpPr ? parseShadow(picSpPr, theme) : undefined;

  return { type: "image", ...transform, dataUrl, crop, hyperlink: picHyperlink, shadow: picShadow };
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
      let fill: string | null = null;
      let borders: PptxTableCell["borders"] | undefined;
      let margins: PptxTableCell["margins"] | undefined;
      let verticalAlign: PptxTableCell["verticalAlign"] | undefined;
      if (tcPr) {
        const solidFill = qs(tcPr, "solidFill");
        if (solidFill) fill = resolveColor(solidFill, theme);

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

  return { type: "table", ...transform, height: transform.height, rows };
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

  for (const [tag, ct] of Object.entries(chartTypeMap)) {
    const found = qs(doc, tag);
    if (found) {
      chartType = ct;
      chartEl = found;
      break;
    }
  }

  if (!chartEl) {
    return { type: "chart", ...transform, chartType: "other", series: [], categories: [] };
  }

  // Parse series
  const series: PptxChartSeries[] = [];
  const categories: string[] = [];
  const serEls = qsa(chartEl, "ser");

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
  const dLbls = qs(chartEl, "dLbls");
  if (dLbls) {
    const showVal = qs(dLbls, "showVal");
    const showCatName = qs(dLbls, "showCatName");
    const showPercent = qs(dLbls, "showPercent");
    if (showVal && getAttr(showVal, "val") === "1") {
      showDataLabels = true;
      dataLabelType = "value";
    } else if (showPercent && getAttr(showPercent, "val") === "1") {
      showDataLabels = true;
      dataLabelType = "percentage";
    } else if (showCatName && getAttr(showCatName, "val") === "1") {
      showDataLabels = true;
      dataLabelType = "category";
    }
  }

  return { type: "chart", ...transform, chartType, series, categories, title, legend, axes, showDataLabels, dataLabelType };
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

  const children = await parseElements(el, rels, zip, slideDir, theme);

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

function parseBackground(doc: Document, theme: PptxTheme): PptxBackground | null {
  const bg = qs(doc, "bg");
  if (!bg) return null;

  const bgPr = qs(bg, "bgPr");
  if (bgPr) {
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
  const background = parseBackground(doc, theme);
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
  const background = parseBackground(doc, theme);

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

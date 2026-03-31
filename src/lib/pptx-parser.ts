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
  PptxChart,
  PptxChartSeries,
  PptxGroup,
  PptxBackground,
  PptxTheme,
  PptxFill,
  PptxGradientStop,
  PptxParagraph,
  PptxTextRun,
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

  const slides: PptxSlide[] = [];
  for (let i = 0; i < slideRIds.length; i++) {
    const slidePath = rIdToPath[slideRIds[i]];
    if (!slidePath) continue;

    const normalizedPath = normalizePath("ppt", slidePath);
    const slide = await parseSlide(zip, normalizedPath, i, theme);
    slides.push(slide);
  }

  return { slideWidth, slideHeight, slides, theme };
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
      const el = parseShapeOrTextBox(child, theme);
      if (el) elements.push(el);
    } else if (ln === "pic") {
      const el = await parsePicture(child, rels, zip, slideDir);
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

function getTransform(el: Element): { x: number; y: number; width: number; height: number; rotation: number } {
  const xfrm = qs(el, "xfrm");
  const off = xfrm ? qs(xfrm, "off") : null;
  const ext = xfrm ? qs(xfrm, "ext") : null;
  const rot = xfrm ? intAttr(xfrm, "rot", 0) : 0;
  return {
    x: off ? intAttr(off, "x") : 0,
    y: off ? intAttr(off, "y") : 0,
    width: ext ? intAttr(ext, "cx") : 0,
    height: ext ? intAttr(ext, "cy") : 0,
    rotation: rot / 60000, // 60000ths of degree → degrees
  };
}

// ---------------------------------------------------------------------------
// Text box / shape
// ---------------------------------------------------------------------------

function parseShapeOrTextBox(el: Element, theme: PptxTheme): PptxTextBox | PptxShape | null {
  const txBody = qs(el, "txBody");
  const spPr = qs(el, "spPr");
  const prstGeom = spPr ? qs(spPr, "prstGeom") : null;
  const preset = prstGeom ? getAttr(prstGeom, "prst") : null;

  const transform = getTransform(el);

  // If it has text and no geometry preset, treat as textbox
  if (txBody && !preset) {
    const paragraphs = parseParagraphs(txBody, theme);
    if (paragraphs.length === 0) return null;
    return { type: "textbox", ...transform, paragraphs };
  }

  // Shape
  const shapeType = mapPresetGeometry(preset);
  const fill = spPr ? parseFill(spPr, theme) : null;
  const { stroke, strokeWidth } = spPr ? parseStroke(spPr, theme) : { stroke: null, strokeWidth: 0 };
  const text = txBody ? parseParagraphs(txBody, theme) : [];

  return {
    type: "shape",
    shapeType,
    ...transform,
    fill,
    stroke,
    strokeWidth,
    text,
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
// Paragraphs & text runs
// ---------------------------------------------------------------------------

function parseParagraphs(txBody: Element, theme: PptxTheme): PptxParagraph[] {
  const paragraphs: PptxParagraph[] = [];
  const pEls = qsa(txBody, "p");

  for (const pEl of pEls) {
    const pPr = qs(pEl, "pPr");
    const alignment = parseAlignment(pPr);
    const { bulletChar, bulletLevel } = parseBullet(pPr);
    const runs = parseTextRuns(pEl, theme);

    // Skip empty paragraphs with no text at all
    if (runs.length === 0 && !bulletChar) continue;

    paragraphs.push({ alignment, runs, bulletChar, bulletLevel });
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

function parseBullet(pPr: Element | null): { bulletChar: string | null; bulletLevel: number } {
  if (!pPr) return { bulletChar: null, bulletLevel: 0 };
  const level = intAttr(pPr, "lvl", 0);

  const buChar = qs(pPr, "buChar");
  if (buChar) return { bulletChar: getAttr(buChar, "char") ?? "•", bulletLevel: level };

  const buAutoNum = qs(pPr, "buAutoNum");
  if (buAutoNum) return { bulletChar: "•", bulletLevel: level }; // simplified

  // buNone explicitly disables bullets
  const buNone = qs(pPr, "buNone");
  if (buNone) return { bulletChar: null, bulletLevel: 0 };

  return { bulletChar: null, bulletLevel: level };
}

function parseTextRuns(pEl: Element, theme: PptxTheme): PptxTextRun[] {
  const runs: PptxTextRun[] = [];

  for (let i = 0; i < pEl.children.length; i++) {
    const child = pEl.children[i];
    const ln = child.localName;

    if (ln === "r") {
      const tEl = qs(child, "t");
      const text = tEl?.textContent ?? "";
      if (!text) continue;

      const rPr = qs(child, "rPr");
      runs.push({
        text,
        bold: rPr ? getAttr(rPr, "b") === "1" : false,
        italic: rPr ? getAttr(rPr, "i") === "1" : false,
        underline: rPr ? (getAttr(rPr, "u") ?? "none") !== "none" : false,
        fontSize: rPr ? intAttr(rPr, "sz", 1800) / 100 : 18,
        fontFamily: parseFontFamily(rPr, theme),
        color: parseRunColor(rPr, theme),
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

function applyColorTransforms(parent: Element, baseColor: string): string {
  // Handle luminance modulation/offset for tints/shades
  const lumMod = qs(parent, "lumMod");
  const lumOff = qs(parent, "lumOff");
  if (!lumMod && !lumOff) return baseColor;

  // Simple approximation — full HSL transform is complex
  // Just return the base color for now
  return baseColor;
}

// ---------------------------------------------------------------------------
// Fill & stroke
// ---------------------------------------------------------------------------

function parseFill(spPr: Element, theme: PptxTheme): PptxFill | null {
  // Solid fill
  const solidFill = qs(spPr, "solidFill");
  if (solidFill) {
    const color = resolveColor(solidFill, theme);
    if (color) return { type: "solid", color };
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
      const color = resolveColor(gs, theme) ?? "#000000";
      stops.push({ position: pos, color });
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

function parseStroke(spPr: Element, theme: PptxTheme): { stroke: string | null; strokeWidth: number } {
  const ln = qs(spPr, "ln");
  if (!ln) return { stroke: null, strokeWidth: 0 };

  const noFill = qs(ln, "noFill");
  if (noFill) return { stroke: null, strokeWidth: 0 };

  const width = intAttr(ln, "w", 12700) / 12700; // EMUs → pt (approx)
  const color = resolveColor(ln, theme);

  return { stroke: color, strokeWidth: width };
}

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

async function parsePicture(
  el: Element,
  rels: Record<string, string>,
  zip: JSZip,
  slideDir: string,
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

  return { type: "image", ...transform, dataUrl };
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
  if (tbl) return parseTable(tbl, transform, theme);

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

function parseTable(
  tbl: Element,
  transform: { x: number; y: number; width: number; height: number },
  theme: PptxTheme,
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
      const paragraphs = txBody ? parseParagraphs(txBody, theme) : [];

      // Cell fill
      const tcPr = qs(tc, "tcPr");
      let fill: string | null = null;
      if (tcPr) {
        const solidFill = qs(tcPr, "solidFill");
        if (solidFill) fill = resolveColor(solidFill, theme);
      }

      const cellWidth = colWidths.slice(colIndex, colIndex + gridSpan).reduce((a, b) => a + b, 0) || (colWidths[colIndex] ?? 0);

      cells.push({
        width: cellWidth,
        paragraphs,
        fill,
        colspan: gridSpan,
        rowspan: rowSpan,
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

    // Values
    const values: number[] = [];
    const numRef = qs(ser, "numRef") ?? qs(ser, "val");
    const numCache = numRef ? qs(numRef, "numCache") : null;
    if (numCache) {
      const pts = qsa(numCache, "pt");
      for (const pt of pts) {
        const v = qs(pt, "v");
        values.push(v ? parseFloat(v.textContent ?? "0") : 0);
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

    series.push({ name, values, color });
  }

  return { type: "chart", ...transform, chartType, series, categories };
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

  return { type: "group", x, y, width, height, children };
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

import type {
  PptxTheme,
  PptxParagraph,
  PptxTextRun,
  PptxTextStyle,
  BodyProperties,
  PptxShadow,
} from "./pptx-types";
import { qs, qsa, getAttr, intAttr } from "./pptx-xml-utils";
import { resolveColor, resolveColorWithAlpha } from "./pptx-colors";

// ---------------------------------------------------------------------------
// Body properties
// ---------------------------------------------------------------------------

export function parseBodyProperties(txBody: Element): BodyProperties | undefined {
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

export function resolveHyperlinkElement(hlinkEl: Element, rels?: Record<string, string>): string | undefined {
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

export function resolveHyperlink(cNvPr: Element, rels?: Record<string, string>): string | undefined {
  const hlinkClick = qs(cNvPr, "hlinkClick");
  if (!hlinkClick) return undefined;
  return resolveHyperlinkElement(hlinkClick, rels);
}

// ---------------------------------------------------------------------------
// Paragraphs & text runs
// ---------------------------------------------------------------------------

export function parseParagraphs(txBody: Element, theme: PptxTheme, rels?: Record<string, string>): PptxParagraph[] {
  const paragraphs: PptxParagraph[] = [];
  const pEls = qsa(txBody, "p");

  for (const pEl of pEls) {
    const pPr = qs(pEl, "pPr");
    const { alignment, explicit: explicitAlignment } = parseAlignment(pPr, theme);
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
      explicitAlignment: explicitAlignment || undefined,
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

function parseAlignment(pPr: Element | null, theme?: PptxTheme): { alignment: PptxParagraph["alignment"]; explicit: boolean } {
  const defaultAlign = theme?.defaultAlignment ?? "left";
  if (!pPr) return { alignment: defaultAlign, explicit: false };
  const algn = getAttr(pPr, "algn");
  if (!algn) return { alignment: defaultAlign, explicit: false };
  const map: Record<string, PptxParagraph["alignment"]> = {
    l: "left", ctr: "center", r: "right", just: "justify",
  };
  return { alignment: map[algn] ?? defaultAlign, explicit: true };
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

      // Text-level shadow
      const runEffectLst = effectiveRPr ? qs(effectiveRPr, "effectLst") : null;
      const runOuterShdw = runEffectLst ? qs(runEffectLst, "outerShdw") : null;
      let runShadow: PptxShadow | undefined;
      if (runOuterShdw) {
        const shdBlurRad = intAttr(runOuterShdw, "blurRad", 0) / 12700;
        const shdDist = intAttr(runOuterShdw, "dist", 0) / 12700;
        const shdDir = intAttr(runOuterShdw, "dir", 0) / 60000;
        const shdDirRad = (shdDir * Math.PI) / 180;
        const shdOffsetX = Math.round(shdDist * Math.sin(shdDirRad) * 10) / 10;
        const shdOffsetY = Math.round(shdDist * Math.cos(shdDirRad) * 10) / 10;
        const shdColorResult = resolveColorWithAlpha(runOuterShdw, theme);
        runShadow = {
          offsetX: shdOffsetX, offsetY: shdOffsetY, blur: shdBlurRad,
          color: shdColorResult?.color ?? "#000000", alpha: shdColorResult?.alpha ?? 0.5,
        };
      }

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
      const themeFontSize = theme.defaultFontSize ?? 1800;
      const defFontSize = defRPr ? intAttr(defRPr, "sz", themeFontSize) : themeFontSize;
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
        ...(runShadow ? { shadow: runShadow } : {}),
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
// Text style parsing
// ---------------------------------------------------------------------------

export function parseTextStyleDef(styleEl: Element | null, theme: PptxTheme): PptxTextStyle | null {
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

/** Parse per-level text styles (lvl1pPr through lvl9pPr) from a text style definition. */
export function parseTextStyleLevels(styleEl: Element | null, theme: PptxTheme): PptxTextStyle[] {
  if (!styleEl) return [];

  const levels: PptxTextStyle[] = [];
  for (let i = 1; i <= 9; i++) {
    const lvl = qs(styleEl, `lvl${i}pPr`);
    if (!lvl) {
      levels.push({});
      continue;
    }

    const style: PptxTextStyle = {};
    const algn = getAttr(lvl, "algn");
    if (algn) {
      const map: Record<string, PptxTextStyle["alignment"]> = { l: "left", ctr: "center", r: "right", just: "justify" };
      style.alignment = map[algn];
    }

    const defRPr = qs(lvl, "defRPr");
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

    // Parse bullet info from level pPr
    const buChar = qs(lvl, "buChar");
    if (buChar) {
      style.bulletChar = getAttr(buChar, "char") ?? "•";
    }
    const buAutoNum = qs(lvl, "buAutoNum");
    if (buAutoNum) {
      style.bulletAutoNumType = getAttr(buAutoNum, "type") ?? "arabicPeriod";
    }
    const buFont = qs(lvl, "buFont");
    if (buFont) {
      style.bulletFont = getAttr(buFont, "typeface") ?? undefined;
    }
    const buClr = qs(lvl, "buClr");
    if (buClr) {
      style.bulletColor = resolveColor(buClr, theme) ?? undefined;
    }
    const buSzPct = qs(lvl, "buSzPct");
    if (buSzPct) {
      style.bulletSizePercent = intAttr(buSzPct, "val", 100000) / 1000;
    }

    levels.push(Object.keys(style).length > 0 ? style : {});
  }

  // Trim trailing empty entries
  while (levels.length > 0 && Object.keys(levels[levels.length - 1]).length === 0) {
    levels.pop();
  }

  return levels;
}

export function parseTextStyles(doc: Document, theme: PptxTheme): {
  titleStyle: PptxTextStyle | null;
  bodyStyle: PptxTextStyle | null;
  otherStyle: PptxTextStyle | null;
  titleLevelStyles: PptxTextStyle[];
  bodyLevelStyles: PptxTextStyle[];
  otherLevelStyles: PptxTextStyle[];
} {
  const txStyles = qs(doc, "txStyles");

  const titleStyleEl = txStyles ? qs(txStyles, "titleStyle") : null;
  const bodyStyleEl = txStyles ? qs(txStyles, "bodyStyle") : null;
  const otherStyleEl = txStyles ? qs(txStyles, "otherStyle") : null;

  const titleStyle = parseTextStyleDef(titleStyleEl, theme);
  const bodyStyle = parseTextStyleDef(bodyStyleEl, theme);
  const otherStyle = parseTextStyleDef(otherStyleEl, theme);

  const titleLevelStyles = titleStyleEl ? parseTextStyleLevels(titleStyleEl, theme) : [];
  const bodyLevelStyles = bodyStyleEl ? parseTextStyleLevels(bodyStyleEl, theme) : [];
  const otherLevelStyles = otherStyleEl ? parseTextStyleLevels(otherStyleEl, theme) : [];

  return {
    titleStyle: titleStyle ?? null,
    bodyStyle: bodyStyle ?? null,
    otherStyle: otherStyle ?? null,
    titleLevelStyles,
    bodyLevelStyles,
    otherLevelStyles,
  };
}

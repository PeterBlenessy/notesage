import { parse, stringify } from 'yaml';

export interface Frontmatter {
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Document Style — per-document typography via `style:` frontmatter
// ---------------------------------------------------------------------------

/** Style properties applicable to a text element (body, headings, code, blockquote). */
export interface DocumentStyleElement {
  font?: string;
  size?: string;         // e.g. "10.5pt", "16px", "1.2em"
  weight?: string | number; // e.g. "bold", "normal", 400, 700
  lineHeight?: number | string; // multiplier or CSS value
  color?: string;
  textAlign?: string;    // "left" | "center" | "right" | "justify"
  align?: string;        // alias for textAlign
  letterSpacing?: string; // e.g. "2pt", "0.05em"
  textTransform?: string; // "uppercase" | "lowercase" | "capitalize" | "none"
  style?: string;        // font-style: "italic" | "normal"
  pageBreakBefore?: boolean;
}

/** Page-level settings in the style block. */
export interface DocumentStylePage {
  size?: string;         // e.g. "A4", "Letter", "A5"
  margin?: string;       // e.g. "2.5cm", "1in"
}

/** Full document style parsed from `style:` frontmatter. */
export interface DocumentStyle {
  page?: DocumentStylePage;
  body?: DocumentStyleElement;
  h1?: DocumentStyleElement;
  h2?: DocumentStyleElement;
  h3?: DocumentStyleElement;
  h4?: DocumentStyleElement;
  h5?: DocumentStyleElement;
  h6?: DocumentStyleElement;
  code?: DocumentStyleElement;
  blockquote?: DocumentStyleElement;
}

/**
 * Extract and validate a `DocumentStyle` from parsed frontmatter.
 * Returns null if no `style` key is present or it is not an object.
 */
export function parseDocumentStyle(frontmatter: Frontmatter | null): DocumentStyle | null {
  if (!frontmatter || typeof frontmatter.style !== 'object' || frontmatter.style === null || Array.isArray(frontmatter.style)) {
    return null;
  }

  const raw = frontmatter.style as Record<string, unknown>;
  const style: DocumentStyle = {};

  // Parse page
  if (raw.page && typeof raw.page === 'object' && !Array.isArray(raw.page)) {
    const p = raw.page as Record<string, unknown>;
    style.page = {};
    if (typeof p.size === 'string') style.page.size = p.size;
    if (typeof p.margin === 'string') style.page.margin = p.margin;
  }

  // Parse element sections
  const elementKeys = ['body', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'code', 'blockquote'] as const;
  for (const key of elementKeys) {
    if (raw[key] && typeof raw[key] === 'object' && !Array.isArray(raw[key])) {
      style[key] = parseStyleElement(raw[key] as Record<string, unknown>);
    }
  }

  // Return null if completely empty
  if (Object.keys(style).length === 0) return null;

  return style;
}

/** Parse a single style element section from raw YAML data. */
function parseStyleElement(raw: Record<string, unknown>): DocumentStyleElement {
  const el: DocumentStyleElement = {};
  if (typeof raw.font === 'string') el.font = raw.font;
  if (typeof raw.size === 'string' || typeof raw.size === 'number') el.size = String(raw.size);
  if (typeof raw.weight === 'string' || typeof raw.weight === 'number') el.weight = raw.weight;
  if (typeof raw.lineHeight === 'number' || typeof raw.lineHeight === 'string') el.lineHeight = raw.lineHeight;
  if (typeof raw.color === 'string') el.color = raw.color;
  if (typeof raw.textAlign === 'string') el.textAlign = raw.textAlign;
  if (typeof raw.align === 'string') el.align = raw.align;
  if (typeof raw.letterSpacing === 'string') el.letterSpacing = raw.letterSpacing;
  if (typeof raw.textTransform === 'string') el.textTransform = raw.textTransform;
  if (typeof raw.style === 'string') el.style = raw.style;
  if (typeof raw.pageBreakBefore === 'boolean') el.pageBreakBefore = raw.pageBreakBefore;
  return el;
}

// ---------------------------------------------------------------------------
// DocumentStyle → CSS conversion (for HTML export)
// ---------------------------------------------------------------------------

/**
 * Convert a DocumentStyle to a CSS string for HTML export.
 * Produces rules for body, h1-h6, code/pre, blockquote, and @page.
 */
export function documentStyleToCSS(style: DocumentStyle): string {
  const rules: string[] = [];

  // @page rule
  if (style.page) {
    const pageProps: string[] = [];
    if (style.page.size) pageProps.push(`size: ${style.page.size}`);
    if (style.page.margin) pageProps.push(`margin: ${style.page.margin}`);
    if (pageProps.length > 0) {
      rules.push(`@page { ${pageProps.join('; ')}; }`);
    }
  }

  // Element rules
  const mapping: Array<{ key: keyof DocumentStyle; selector: string }> = [
    { key: 'body', selector: 'body' },
    { key: 'h1', selector: 'h1' },
    { key: 'h2', selector: 'h2' },
    { key: 'h3', selector: 'h3' },
    { key: 'h4', selector: 'h4' },
    { key: 'h5', selector: 'h5' },
    { key: 'h6', selector: 'h6' },
    { key: 'code', selector: 'code, pre' },
    { key: 'blockquote', selector: 'blockquote' },
  ];

  for (const { key, selector } of mapping) {
    const el = style[key] as DocumentStyleElement | undefined;
    if (!el) continue;
    const props = elementToCSS(el);
    if (props.length > 0) {
      rules.push(`${selector} { ${props.join('; ')}; }`);
    }
  }

  return rules.join('\n');
}

// ---------------------------------------------------------------------------
// DocumentStyle → TypographyPresets conversion (for editor rendering)
// ---------------------------------------------------------------------------

/**
 * Parse a size string (e.g. "10.5pt", "16px", "1.2em") and return a value in px.
 * - `pt` values are converted to px (1pt = 4/3 px).
 * - `px` values are used as-is.
 * - `em` and `rem` values are multiplied by basePx (default 16).
 * - Plain numbers are treated as px.
 * Returns undefined if the string cannot be parsed.
 */
export function parseSizeToPx(value: string | undefined, basePx: number = 16): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();

  // Try to extract number and unit
  const match = trimmed.match(/^([0-9]*\.?[0-9]+)\s*(pt|px|em|rem)?$/i);
  if (!match) return undefined;

  const num = parseFloat(match[1]);
  if (isNaN(num)) return undefined;

  const unit = (match[2] ?? '').toLowerCase();
  switch (unit) {
    case 'pt': return Math.round(num * (4 / 3) * 10) / 10; // 1pt = 4/3 px
    case 'px': return num;
    case 'em':
    case 'rem': return Math.round(num * basePx * 10) / 10;
    case '': return num; // plain number = px
    default: return undefined;
  }
}

/**
 * Resolve a font-weight value (string or number) to a numeric weight.
 * Supports CSS keywords: "normal" → 400, "bold" → 700, "light" → 300, etc.
 */
export function parseFontWeight(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;
  const lower = value.toLowerCase().trim();
  const keywords: Record<string, number> = {
    thin: 100, hairline: 100,
    extralight: 200, ultralight: 200,
    light: 300,
    normal: 400, regular: 400,
    medium: 500,
    semibold: 600, demibold: 600,
    bold: 700,
    extrabold: 800, ultrabold: 800,
    black: 900, heavy: 900,
  };
  if (keywords[lower] !== undefined) return keywords[lower];
  const num = parseFloat(lower);
  return isNaN(num) ? undefined : num;
}

/**
 * Convert a DocumentStyle to a partial TypographyPresets object.
 * Only fields specified in the style are set; callers should merge over defaults.
 *
 * Returns null if the style is null or would produce no overrides.
 */
export function documentStyleToPresets(
  style: DocumentStyle | null,
): Record<string, Record<string, unknown>> | null {
  if (!style) return null;

  const result: Record<string, Record<string, unknown>> = {};

  // Map body → paragraph
  if (style.body) {
    result.paragraph = mapElementToPreset(style.body);
  }

  // Map h1-h6 → heading1-heading6
  const headingMap: Array<{ src: keyof DocumentStyle; dst: string }> = [
    { src: 'h1', dst: 'heading1' },
    { src: 'h2', dst: 'heading2' },
    { src: 'h3', dst: 'heading3' },
    { src: 'h4', dst: 'heading4' },
    { src: 'h5', dst: 'heading5' },
    { src: 'h6', dst: 'heading6' },
  ];
  for (const { src, dst } of headingMap) {
    const el = style[src] as DocumentStyleElement | undefined;
    if (el) {
      result[dst] = mapElementToPreset(el);
    }
  }

  // Map code → codeBlock
  if (style.code) {
    const mapped: Record<string, unknown> = {};
    if (style.code.font) mapped.fontFamily = style.code.font;
    const sizePx = parseSizeToPx(style.code.size);
    if (sizePx !== undefined) mapped.fontSize = sizePx;
    if (Object.keys(mapped).length > 0) result.codeBlock = mapped;
  }

  // Map blockquote
  if (style.blockquote) {
    const mapped: Record<string, unknown> = {};
    if (style.blockquote.font) mapped.fontFamily = style.blockquote.font;
    const sizePx = parseSizeToPx(style.blockquote.size);
    if (sizePx !== undefined) mapped.fontSize = sizePx;
    const weight = parseFontWeight(style.blockquote.weight);
    if (weight !== undefined) mapped.fontWeight = weight;
    if (style.blockquote.color) mapped.color = style.blockquote.color;
    if (Object.keys(mapped).length > 0) result.blockquote = mapped;
  }

  return Object.keys(result).length > 0 ? result : null;
}

// ---------------------------------------------------------------------------
// TypographyPresets → DocumentStyle conversion (for saving to frontmatter)
// ---------------------------------------------------------------------------

/**
 * Convert TypographyPresets to a DocumentStyle suitable for `style:` frontmatter.
 * Font sizes are written as `"Npx"`, font weights as numeric values,
 * and line heights as plain numbers.
 */
export function presetsToDocumentStyle(presets: {
  paragraph: { fontFamily: string; fontSize: number; fontWeight: number; lineHeight: number };
  heading1: { fontFamily: string; fontSize: number; fontWeight: number; lineHeight: number };
  heading2: { fontFamily: string; fontSize: number; fontWeight: number; lineHeight: number };
  heading3: { fontFamily: string; fontSize: number; fontWeight: number; lineHeight: number };
  heading4: { fontFamily: string; fontSize: number; fontWeight: number; lineHeight: number };
  heading5: { fontFamily: string; fontSize: number; fontWeight: number; lineHeight: number };
  heading6: { fontFamily: string; fontSize: number; fontWeight: number; lineHeight: number };
  codeBlock: { fontFamily: string; fontSize: number };
  blockquote: { fontFamily: string; fontSize: number; fontWeight: number; color?: string };
}): DocumentStyle {
  const style: DocumentStyle = {};

  // body ← paragraph
  style.body = presetToElement(presets.paragraph);

  // h1-h6
  const headingMap: Array<{ src: keyof typeof presets; dst: keyof DocumentStyle }> = [
    { src: 'heading1', dst: 'h1' },
    { src: 'heading2', dst: 'h2' },
    { src: 'heading3', dst: 'h3' },
    { src: 'heading4', dst: 'h4' },
    { src: 'heading5', dst: 'h5' },
    { src: 'heading6', dst: 'h6' },
  ];
  for (const { src, dst } of headingMap) {
    style[dst] = presetToElement(presets[src] as { fontFamily: string; fontSize: number; fontWeight: number; lineHeight: number });
  }

  // code
  style.code = {
    font: presets.codeBlock.fontFamily,
    size: `${presets.codeBlock.fontSize}px`,
  };

  // blockquote
  const bq: DocumentStyleElement = {
    font: presets.blockquote.fontFamily,
    size: `${presets.blockquote.fontSize}px`,
    weight: presets.blockquote.fontWeight,
  };
  if (presets.blockquote.color) bq.color = presets.blockquote.color;
  style.blockquote = bq;

  return style;
}

/** Convert a full block preset to a DocumentStyleElement. */
function presetToElement(block: {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
}): DocumentStyleElement {
  return {
    font: block.fontFamily,
    size: `${block.fontSize}px`,
    weight: block.fontWeight,
    lineHeight: block.lineHeight,
  };
}

/** Map a DocumentStyleElement to partial BlockTypeStyle fields. */
function mapElementToPreset(el: DocumentStyleElement): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  if (el.font) mapped.fontFamily = el.font;
  const sizePx = parseSizeToPx(el.size);
  if (sizePx !== undefined) mapped.fontSize = sizePx;
  const weight = parseFontWeight(el.weight);
  if (weight !== undefined) mapped.fontWeight = weight;
  if (typeof el.lineHeight === 'number') {
    mapped.lineHeight = el.lineHeight;
  } else if (typeof el.lineHeight === 'string') {
    const num = parseFloat(el.lineHeight);
    if (!isNaN(num)) mapped.lineHeight = num;
  }
  if (el.color) mapped.color = el.color;
  return mapped;
}

/** Convert a DocumentStyleElement to an array of CSS property declarations. */
function elementToCSS(el: DocumentStyleElement): string[] {
  const props: string[] = [];
  if (el.font) props.push(`font-family: ${el.font}`);
  if (el.size) props.push(`font-size: ${el.size}`);
  if (el.weight !== undefined) props.push(`font-weight: ${el.weight}`);
  if (el.lineHeight !== undefined) props.push(`line-height: ${el.lineHeight}`);
  if (el.color) props.push(`color: ${el.color}`);
  const align = el.textAlign ?? el.align;
  if (align) props.push(`text-align: ${align}`);
  if (el.letterSpacing) props.push(`letter-spacing: ${el.letterSpacing}`);
  if (el.textTransform) props.push(`text-transform: ${el.textTransform}`);
  if (el.style) props.push(`font-style: ${el.style}`);
  if (el.pageBreakBefore) props.push(`page-break-before: always`);
  return props;
}

export interface GoalFrontmatter extends Frontmatter {
  type: 'goal';
  template: string;
  created: string;
  title: string;
}

export interface NoteFrontmatter extends Frontmatter {
  type: 'note';
  created: string;
  title: string;
  tags: string[];
}

interface ParseResult {
  frontmatter: Frontmatter | null;
  content: string;
}

/**
 * Ensure a document has a UUID in its frontmatter.
 * If the frontmatter already has an `id`, it's returned unchanged.
 * Otherwise a new UUID is generated via `crypto.randomUUID()`.
 * If frontmatter is null, a new object with just `{ id }` is created.
 */
export function ensureDocumentId(frontmatter: Frontmatter | null): { frontmatter: Frontmatter; id: string } {
  if (frontmatter?.id && typeof frontmatter.id === 'string') {
    return { frontmatter, id: frontmatter.id };
  }

  const id = crypto.randomUUID();
  const updated = { ...frontmatter, id };
  return { frontmatter: updated, id };
}

/**
 * Parse frontmatter from a raw markdown string.
 *
 * Frontmatter must start at position 0 with `---` followed by a newline,
 * and be closed by another `---` followed by a newline (or end of string).
 * The YAML between the delimiters is parsed into an object.
 *
 * If no valid frontmatter block is found, returns null frontmatter
 * and the full raw string as content.
 */
export function parseFrontmatter(raw: string): ParseResult {
  // Check if the string starts with --- followed by a newline
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) {
    return { frontmatter: null, content: raw };
  }

  // Find the opening delimiter length
  const openDelimiterEnd = raw.startsWith('---\r\n') ? 5 : 4;

  // Search for closing delimiter after the opening one
  const closingIndex = findClosingDelimiter(raw, openDelimiterEnd);

  if (closingIndex === -1) {
    // No closing delimiter found, treat as no frontmatter
    return { frontmatter: null, content: raw };
  }

  // Extract the YAML string between the delimiters
  const yamlString = raw.substring(openDelimiterEnd, closingIndex);

  // Determine the length of the closing delimiter line
  const afterClosing = raw.substring(closingIndex);
  let closingDelimiterEnd: number;
  if (afterClosing.startsWith('---\r\n')) {
    closingDelimiterEnd = closingIndex + 5;
  } else if (afterClosing.startsWith('---\n')) {
    closingDelimiterEnd = closingIndex + 4;
  } else if (afterClosing === '---') {
    // Closing delimiter at end of string with no trailing newline
    closingDelimiterEnd = closingIndex + 3;
  } else {
    // Should not reach here given findClosingDelimiter logic
    return { frontmatter: null, content: raw };
  }

  // Parse the YAML — if it's invalid, treat as no frontmatter
  let parsed: unknown;
  try {
    parsed = parse(yamlString);
  } catch {
    // Expected: invalid YAML in frontmatter block — treat as no frontmatter
    return { frontmatter: null, content: raw };
  }

  // If parsed result is not a plain object, treat as no frontmatter
  if (parsed === null || parsed === undefined || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { frontmatter: null, content: raw };
  }

  // Extract content after closing delimiter, stripping one leading newline
  let content = raw.substring(closingDelimiterEnd);
  if (content.startsWith('\r\n')) {
    content = content.substring(2);
  } else if (content.startsWith('\n')) {
    content = content.substring(1);
  }

  return {
    frontmatter: parsed as Frontmatter,
    content,
  };
}

/**
 * Serialize frontmatter and content back into a raw markdown string.
 *
 * If frontmatter is null, returns content unchanged.
 * An empty object `{}` is still serialized as an empty frontmatter block.
 */
export function serializeFrontmatter(frontmatter: Frontmatter | null, content: string): string {
  if (frontmatter === null) {
    return content;
  }

  const yamlString = stringify(frontmatter);

  // stringify already adds a trailing newline, so we get:
  // ---\n{yaml}\n---\n\n{content}
  return `---\n${yamlString}---\n\n${content}`;
}

/**
 * Update a single key in the frontmatter of a raw markdown string.
 *
 * - If value is `undefined`, the key is removed from the frontmatter.
 * - If the markdown has no frontmatter, a new block is created (unless value is undefined).
 * - All other frontmatter keys are preserved unchanged.
 *
 * Returns the updated markdown string.
 */
export function updateFrontmatterKey(
  markdown: string,
  key: string,
  value: unknown,
): string {
  const { frontmatter, content } = parseFrontmatter(markdown);

  if (value === undefined) {
    // Remove the key
    if (!frontmatter || !(key in frontmatter)) {
      // Nothing to remove
      return markdown;
    }
    const updated = { ...frontmatter };
    delete updated[key];
    // If frontmatter is now empty, drop it entirely
    if (Object.keys(updated).length === 0) {
      return content;
    }
    return serializeFrontmatter(updated, content);
  }

  // Set the key
  const updated = { ...(frontmatter ?? {}), [key]: value };
  return serializeFrontmatter(updated, content);
}

/**
 * Find the position of the closing `---` delimiter.
 * The closing delimiter must appear at the start of a line.
 * Returns the index of the `---` or -1 if not found.
 */
function findClosingDelimiter(raw: string, startFrom: number): number {
  let pos = startFrom;

  while (pos < raw.length) {
    // Check if we're at a `---` at the start of a line
    if (raw.startsWith('---', pos)) {
      const afterDashes = pos + 3;
      // Valid closing delimiter if followed by \n, \r\n, or end of string
      if (
        afterDashes >= raw.length ||
        raw[afterDashes] === '\n' ||
        (raw[afterDashes] === '\r' && raw[afterDashes + 1] === '\n')
      ) {
        return pos;
      }
    }

    // Move to the next line
    const nextNewline = raw.indexOf('\n', pos);
    if (nextNewline === -1) {
      break;
    }
    pos = nextNewline + 1;
  }

  return -1;
}

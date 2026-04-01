/**
 * Document page settings — headers, footers, and variable templates.
 *
 * Stored in YAML frontmatter under the `page` key.
 * Used in the editor (paged view decorations) and all export pipelines.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface ThreeColumns {
  left: string;
  center: string;
  right: string;
}

export interface PageHeaderFooter {
  left: string;
  center: string;
  right: string;
  differentFirstPage: boolean;
  firstPage?: ThreeColumns;
  differentOddEven: boolean;
  oddPage?: ThreeColumns;
  evenPage?: ThreeColumns;
}

export interface DocumentPageSettings {
  header: PageHeaderFooter;
  footer: PageHeaderFooter;
  pageNumberStart: number;
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

export interface PageVariable {
  token: string;
  label: string;
  description: string;
}

export const PAGE_VARIABLES: PageVariable[] = [
  { token: '{page}', label: 'Page number', description: 'Current page number' },
  { token: '{pages}', label: 'Total pages', description: 'Total number of pages' },
  { token: '{title}', label: 'Title', description: 'Document title from frontmatter or filename' },
  { token: '{date}', label: 'Date', description: 'Current date' },
];

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function emptyHeaderFooter(): PageHeaderFooter {
  return {
    left: '',
    center: '',
    right: '',
    differentFirstPage: false,
    differentOddEven: false,
  };
}

export const PAGE_SETTINGS_DEFAULTS: DocumentPageSettings = {
  header: emptyHeaderFooter(),
  footer: emptyHeaderFooter(),
  pageNumberStart: 1,
};

// ---------------------------------------------------------------------------
// Parsing & serialization (frontmatter integration)
// ---------------------------------------------------------------------------

/**
 * Parse page settings from a frontmatter object's `page` key.
 * Returns defaults if the key is missing or malformed.
 */
export function parsePageSettings(frontmatter: Record<string, unknown> | null): DocumentPageSettings {
  if (!frontmatter || typeof frontmatter.page !== 'object' || frontmatter.page === null) {
    return { ...PAGE_SETTINGS_DEFAULTS };
  }

  const page = frontmatter.page as Record<string, unknown>;

  return {
    header: parseHeaderFooter(page.header),
    footer: parseHeaderFooter(page.footer),
    pageNumberStart: typeof page.pageNumberStart === 'number' ? page.pageNumberStart : 1,
  };
}

function parseThreeColumns(raw: unknown): ThreeColumns | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;
  return {
    left: typeof obj.left === 'string' ? obj.left : '',
    center: typeof obj.center === 'string' ? obj.center : '',
    right: typeof obj.right === 'string' ? obj.right : '',
  };
}

function parseHeaderFooter(raw: unknown): PageHeaderFooter {
  if (typeof raw !== 'object' || raw === null) {
    return emptyHeaderFooter();
  }

  const obj = raw as Record<string, unknown>;
  const result: PageHeaderFooter = {
    left: typeof obj.left === 'string' ? obj.left : '',
    center: typeof obj.center === 'string' ? obj.center : '',
    right: typeof obj.right === 'string' ? obj.right : '',
    differentFirstPage: typeof obj.differentFirstPage === 'boolean' ? obj.differentFirstPage : false,
    differentOddEven: typeof obj.differentOddEven === 'boolean' ? obj.differentOddEven : false,
  };

  if (result.differentFirstPage) {
    result.firstPage = parseThreeColumns(obj.firstPage);
  }
  if (result.differentOddEven) {
    result.oddPage = parseThreeColumns(obj.oddPage);
    result.evenPage = parseThreeColumns(obj.evenPage);
  }

  return result;
}

/**
 * Serialize page settings into an object suitable for YAML frontmatter.
 * Returns undefined if all settings are at defaults (keeps frontmatter clean).
 */
export function serializePageSettings(settings: DocumentPageSettings): Record<string, unknown> | undefined {
  if (isDefaultSettings(settings)) {
    return undefined;
  }

  const result: Record<string, unknown> = {};

  if (!isDefaultHeaderFooter(settings.header)) {
    result.header = serializeHeaderFooter(settings.header);
  }

  if (!isDefaultHeaderFooter(settings.footer)) {
    result.footer = serializeHeaderFooter(settings.footer);
  }

  if (settings.pageNumberStart !== 1) {
    result.pageNumberStart = settings.pageNumberStart;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function serializeThreeColumns(cols: ThreeColumns): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {};
  if (cols.left) result.left = cols.left;
  if (cols.center) result.center = cols.center;
  if (cols.right) result.right = cols.right;
  return Object.keys(result).length > 0 ? result : undefined;
}

function serializeHeaderFooter(hf: PageHeaderFooter): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (hf.left) result.left = hf.left;
  if (hf.center) result.center = hf.center;
  if (hf.right) result.right = hf.right;
  if (hf.differentFirstPage) {
    result.differentFirstPage = true;
    if (hf.firstPage) {
      const fp = serializeThreeColumns(hf.firstPage);
      if (fp) result.firstPage = fp;
    }
  }
  if (hf.differentOddEven) {
    result.differentOddEven = true;
    if (hf.oddPage) {
      const op = serializeThreeColumns(hf.oddPage);
      if (op) result.oddPage = op;
    }
    if (hf.evenPage) {
      const ep = serializeThreeColumns(hf.evenPage);
      if (ep) result.evenPage = ep;
    }
  }
  return result;
}

/**
 * Check whether a header/footer has any non-empty content.
 */
export function hasContent(hf: PageHeaderFooter): boolean {
  return !!(hf.left || hf.center || hf.right);
}

function isDefaultSettings(settings: DocumentPageSettings): boolean {
  return isDefaultHeaderFooter(settings.header) && isDefaultHeaderFooter(settings.footer) && settings.pageNumberStart === 1;
}

function isDefaultHeaderFooter(hf: PageHeaderFooter): boolean {
  return !hf.left && !hf.center && !hf.right && !hf.differentFirstPage && !hf.differentOddEven;
}

// ---------------------------------------------------------------------------
// Column resolution — pick the right content for a given page
// ---------------------------------------------------------------------------

/**
 * Get the effective columns (left/center/right) for a header or footer
 * on a specific page, considering differentFirstPage and differentOddEven.
 */
export function getEffectiveColumns(hf: PageHeaderFooter, displayPage: number): ThreeColumns {
  if (displayPage === 1 && hf.differentFirstPage && hf.firstPage) {
    return hf.firstPage;
  }
  if (hf.differentOddEven) {
    if (displayPage % 2 === 1 && hf.oddPage) return hf.oddPage;
    if (displayPage % 2 === 0 && hf.evenPage) return hf.evenPage;
  }
  return hf;
}

// ---------------------------------------------------------------------------
// Variable resolution
// ---------------------------------------------------------------------------

export interface VariableContext {
  page: number;
  pages: number;
  title: string;
  date: string;
}

/**
 * Resolve variable placeholders in a header/footer template string.
 * Unknown variables are left as-is.
 */
export function resolveVariables(template: string, context: VariableContext): string {
  if (!template) return '';

  return template
    .replace(/\{page\}/g, String(context.page))
    .replace(/\{pages\}/g, String(context.pages))
    .replace(/\{title\}/g, context.title)
    .replace(/\{date\}/g, context.date);
}

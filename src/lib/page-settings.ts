/**
 * Document page settings — headers, footers, and variable templates.
 *
 * Stored in YAML frontmatter under the `page` key.
 * Used in the editor (paged view decorations) and all export pipelines.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface PageHeaderFooter {
  left: string;
  center: string;
  right: string;
  differentFirstPage: boolean;
  firstPage?: {
    left: string;
    center: string;
    right: string;
  };
}

export interface DocumentPageSettings {
  header: PageHeaderFooter;
  footer: PageHeaderFooter;
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
  };
}

export const PAGE_SETTINGS_DEFAULTS: DocumentPageSettings = {
  header: emptyHeaderFooter(),
  footer: emptyHeaderFooter(),
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
  };

  if (result.differentFirstPage && typeof obj.firstPage === 'object' && obj.firstPage !== null) {
    const fp = obj.firstPage as Record<string, unknown>;
    result.firstPage = {
      left: typeof fp.left === 'string' ? fp.left : '',
      center: typeof fp.center === 'string' ? fp.center : '',
      right: typeof fp.right === 'string' ? fp.right : '',
    };
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
      const fp: Record<string, unknown> = {};
      if (hf.firstPage.left) fp.left = hf.firstPage.left;
      if (hf.firstPage.center) fp.center = hf.firstPage.center;
      if (hf.firstPage.right) fp.right = hf.firstPage.right;
      if (Object.keys(fp).length > 0) result.firstPage = fp;
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
  return isDefaultHeaderFooter(settings.header) && isDefaultHeaderFooter(settings.footer);
}

function isDefaultHeaderFooter(hf: PageHeaderFooter): boolean {
  return !hf.left && !hf.center && !hf.right && !hf.differentFirstPage;
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

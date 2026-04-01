import { describe, it, expect } from 'vitest';
import {
  parsePageSettings,
  serializePageSettings,
  resolveVariables,
  hasContent,
  PAGE_SETTINGS_DEFAULTS,
  PAGE_VARIABLES,
  type DocumentPageSettings,
  type PageHeaderFooter,
  type VariableContext,
} from '../page-settings';

// ---------------------------------------------------------------------------
// parsePageSettings
// ---------------------------------------------------------------------------

describe('parsePageSettings', () => {
  it('returns defaults for null frontmatter', () => {
    const result = parsePageSettings(null);
    expect(result).toEqual(PAGE_SETTINGS_DEFAULTS);
  });

  it('returns defaults when page key is missing', () => {
    const result = parsePageSettings({ title: 'Test' });
    expect(result.header.left).toBe('');
    expect(result.footer.right).toBe('');
  });

  it('returns defaults when page key is not an object', () => {
    expect(parsePageSettings({ page: 'string' })).toEqual(PAGE_SETTINGS_DEFAULTS);
    expect(parsePageSettings({ page: 42 })).toEqual(PAGE_SETTINGS_DEFAULTS);
    expect(parsePageSettings({ page: null })).toEqual(PAGE_SETTINGS_DEFAULTS);
    expect(parsePageSettings({ page: true })).toEqual(PAGE_SETTINGS_DEFAULTS);
  });

  it('parses header and footer fields', () => {
    const result = parsePageSettings({
      page: {
        header: { left: 'My Report', center: '', right: 'Page {page}' },
        footer: { left: '{date}', center: '', right: '' },
      },
    });
    expect(result.header.left).toBe('My Report');
    expect(result.header.right).toBe('Page {page}');
    expect(result.footer.left).toBe('{date}');
  });

  it('parses differentFirstPage and firstPage', () => {
    const result = parsePageSettings({
      page: {
        header: {
          left: '', center: '', right: '{page}',
          differentFirstPage: true,
          firstPage: { left: '', center: '{title}', right: '' },
        },
      },
    });
    expect(result.header.differentFirstPage).toBe(true);
    expect(result.header.firstPage?.center).toBe('{title}');
  });

  it('ignores firstPage when differentFirstPage is false', () => {
    const result = parsePageSettings({
      page: {
        header: {
          left: '', center: '', right: '',
          differentFirstPage: false,
          firstPage: { left: 'ignored', center: '', right: '' },
        },
      },
    });
    expect(result.header.firstPage).toBeUndefined();
  });

  it('handles partial header/footer objects gracefully', () => {
    const result = parsePageSettings({
      page: { header: { right: 'Only right' } },
    });
    expect(result.header.left).toBe('');
    expect(result.header.center).toBe('');
    expect(result.header.right).toBe('Only right');
    expect(result.footer.left).toBe('');
  });

  it('handles non-string field values gracefully', () => {
    const result = parsePageSettings({
      page: { header: { left: 42, center: true, right: null } },
    });
    expect(result.header.left).toBe('');
    expect(result.header.center).toBe('');
    expect(result.header.right).toBe('');
  });
});

// ---------------------------------------------------------------------------
// serializePageSettings
// ---------------------------------------------------------------------------

describe('serializePageSettings', () => {
  it('returns undefined for all-default settings', () => {
    expect(serializePageSettings(PAGE_SETTINGS_DEFAULTS)).toBeUndefined();
  });

  it('returns undefined for empty strings everywhere', () => {
    const settings: DocumentPageSettings = {
      header: { left: '', center: '', right: '', differentFirstPage: false },
      footer: { left: '', center: '', right: '', differentFirstPage: false },
    };
    expect(serializePageSettings(settings)).toBeUndefined();
  });

  it('serializes header with content', () => {
    const settings: DocumentPageSettings = {
      header: { left: '{title}', center: '', right: '{page}', differentFirstPage: false },
      footer: { left: '', center: '', right: '', differentFirstPage: false },
    };
    const result = serializePageSettings(settings);
    expect(result).toBeDefined();
    expect(result!.header).toEqual({ left: '{title}', right: '{page}' });
    expect(result!.footer).toBeUndefined();
  });

  it('serializes differentFirstPage with firstPage', () => {
    const settings: DocumentPageSettings = {
      header: {
        left: '', center: '', right: '{page}',
        differentFirstPage: true,
        firstPage: { left: '', center: '{title}', right: '' },
      },
      footer: { left: '', center: '', right: '', differentFirstPage: false },
    };
    const result = serializePageSettings(settings);
    expect(result).toBeDefined();
    const hdr = result!.header as Record<string, unknown>;
    expect(hdr.right).toBe('{page}');
    expect(hdr.differentFirstPage).toBe(true);
    expect(hdr.firstPage).toEqual({ center: '{title}' });
  });

  it('omits empty firstPage fields', () => {
    const settings: DocumentPageSettings = {
      header: {
        left: 'Title', center: '', right: '',
        differentFirstPage: true,
        firstPage: { left: '', center: '', right: '' },
      },
      footer: { left: '', center: '', right: '', differentFirstPage: false },
    };
    const result = serializePageSettings(settings);
    const hdr = result!.header as Record<string, unknown>;
    expect(hdr.firstPage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveVariables
// ---------------------------------------------------------------------------

describe('resolveVariables', () => {
  const ctx: VariableContext = { page: 3, pages: 10, title: 'My Report', date: '2026-04-01' };

  it('resolves {page}', () => {
    expect(resolveVariables('{page}', ctx)).toBe('3');
  });

  it('resolves {pages}', () => {
    expect(resolveVariables('{pages}', ctx)).toBe('10');
  });

  it('resolves {title}', () => {
    expect(resolveVariables('{title}', ctx)).toBe('My Report');
  });

  it('resolves {date}', () => {
    expect(resolveVariables('{date}', ctx)).toBe('2026-04-01');
  });

  it('resolves multiple variables in one string', () => {
    expect(resolveVariables('Page {page} of {pages}', ctx)).toBe('Page 3 of 10');
  });

  it('resolves multiple occurrences of same variable', () => {
    expect(resolveVariables('{page}-{page}', ctx)).toBe('3-3');
  });

  it('leaves unknown variables as-is', () => {
    expect(resolveVariables('{unknown}', ctx)).toBe('{unknown}');
  });

  it('returns empty string for empty template', () => {
    expect(resolveVariables('', ctx)).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(resolveVariables('No variables here', ctx)).toBe('No variables here');
  });
});

// ---------------------------------------------------------------------------
// hasContent
// ---------------------------------------------------------------------------

describe('hasContent', () => {
  it('returns false for empty header/footer', () => {
    const hf: PageHeaderFooter = { left: '', center: '', right: '', differentFirstPage: false };
    expect(hasContent(hf)).toBe(false);
  });

  it('returns true when left has content', () => {
    expect(hasContent({ left: 'text', center: '', right: '', differentFirstPage: false })).toBe(true);
  });

  it('returns true when center has content', () => {
    expect(hasContent({ left: '', center: 'text', right: '', differentFirstPage: false })).toBe(true);
  });

  it('returns true when right has content', () => {
    expect(hasContent({ left: '', center: '', right: 'text', differentFirstPage: false })).toBe(true);
  });

  it('does not consider differentFirstPage alone as having content', () => {
    expect(hasContent({ left: '', center: '', right: '', differentFirstPage: true })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PAGE_VARIABLES constant
// ---------------------------------------------------------------------------

describe('PAGE_VARIABLES', () => {
  it('contains 4 variables', () => {
    expect(PAGE_VARIABLES).toHaveLength(4);
  });

  it('includes {page}, {pages}, {title}, {date}', () => {
    const tokens = PAGE_VARIABLES.map((v) => v.token);
    expect(tokens).toContain('{page}');
    expect(tokens).toContain('{pages}');
    expect(tokens).toContain('{title}');
    expect(tokens).toContain('{date}');
  });
});

// ---------------------------------------------------------------------------
// Round-trip: serialize → parse
// ---------------------------------------------------------------------------

describe('page settings round-trip', () => {
  it('round-trips simple header/footer through serialize/parse', () => {
    const original: DocumentPageSettings = {
      header: { left: '{title}', center: '', right: '{page}', differentFirstPage: false },
      footer: { left: '{date}', center: '', right: '', differentFirstPage: false },
    };

    const serialized = serializePageSettings(original);
    expect(serialized).toBeDefined();

    const frontmatter = { page: serialized };
    const parsed = parsePageSettings(frontmatter);

    expect(parsed.header.left).toBe('{title}');
    expect(parsed.header.right).toBe('{page}');
    expect(parsed.footer.left).toBe('{date}');
  });

  it('round-trips differentFirstPage through serialize/parse', () => {
    const original: DocumentPageSettings = {
      header: {
        left: '', center: '', right: 'Page {page}',
        differentFirstPage: true,
        firstPage: { left: '', center: '{title}', right: '' },
      },
      footer: { left: '', center: '', right: '', differentFirstPage: false },
    };

    const serialized = serializePageSettings(original);
    const parsed = parsePageSettings({ page: serialized });

    expect(parsed.header.differentFirstPage).toBe(true);
    expect(parsed.header.firstPage?.center).toBe('{title}');
    expect(parsed.header.right).toBe('Page {page}');
  });

  it('defaults survive round-trip (serialize returns undefined, parse returns defaults)', () => {
    const serialized = serializePageSettings(PAGE_SETTINGS_DEFAULTS);
    expect(serialized).toBeUndefined();

    const parsed = parsePageSettings({ title: 'Test' });
    expect(parsed.header.left).toBe('');
    expect(parsed.footer.right).toBe('');
  });
});

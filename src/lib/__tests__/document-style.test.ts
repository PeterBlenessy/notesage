import { describe, it, expect } from 'vitest';
import {
  parseFrontmatter,
  parseDocumentStyle,
  documentStyleToPresets,
  documentStyleToCSS,
  parseSizeToPx,
  parseFontWeight,
  type DocumentStyle,
} from '../frontmatter';
import { mergePresets, DEFAULT_PRESETS } from '../typography-presets';
import type { BlockTypeStyle } from '../typography-presets';

// ---------------------------------------------------------------------------
// parseDocumentStyle
// ---------------------------------------------------------------------------

describe('parseDocumentStyle', () => {
  it('returns null when frontmatter is null', () => {
    expect(parseDocumentStyle(null)).toBeNull();
  });

  it('returns null when frontmatter has no style key', () => {
    expect(parseDocumentStyle({ title: 'Test' })).toBeNull();
  });

  it('returns null when style is not an object', () => {
    expect(parseDocumentStyle({ style: 'invalid' })).toBeNull();
    expect(parseDocumentStyle({ style: 42 })).toBeNull();
    expect(parseDocumentStyle({ style: ['array'] })).toBeNull();
  });

  it('returns null when style is an empty object', () => {
    expect(parseDocumentStyle({ style: {} })).toBeNull();
  });

  it('parses a full style block from frontmatter YAML', () => {
    const raw = `---
title: My Document
style:
  page:
    size: A4
    margin: 2.5cm
  body:
    font: Georgia
    size: 10.5pt
    lineHeight: 1.45
    color: "#1a1a1a"
    textAlign: justify
  h1:
    font: Georgia
    size: 26pt
    weight: normal
    align: center
  h2:
    font: Georgia
    size: 12pt
    textTransform: uppercase
    letterSpacing: 2pt
  code:
    font: JetBrains Mono
    size: 9pt
---

# Hello`;

    const { frontmatter } = parseFrontmatter(raw);
    const style = parseDocumentStyle(frontmatter);

    expect(style).not.toBeNull();
    expect(style!.page).toEqual({ size: 'A4', margin: '2.5cm' });
    expect(style!.body).toEqual({
      font: 'Georgia',
      size: '10.5pt',
      lineHeight: 1.45,
      color: '#1a1a1a',
      textAlign: 'justify',
    });
    expect(style!.h1).toEqual({
      font: 'Georgia',
      size: '26pt',
      weight: 'normal',
      align: 'center',
    });
    expect(style!.h2).toEqual({
      font: 'Georgia',
      size: '12pt',
      textTransform: 'uppercase',
      letterSpacing: '2pt',
    });
    expect(style!.code).toEqual({
      font: 'JetBrains Mono',
      size: '9pt',
    });
  });

  it('parses pageBreakBefore as boolean', () => {
    const style = parseDocumentStyle({
      style: {
        h1: { pageBreakBefore: true },
        h2: { pageBreakBefore: false },
      },
    });
    expect(style!.h1!.pageBreakBefore).toBe(true);
    expect(style!.h2!.pageBreakBefore).toBe(false);
  });

  it('parses font-style via style field', () => {
    const style = parseDocumentStyle({
      style: {
        blockquote: { style: 'italic', font: 'Georgia' },
      },
    });
    expect(style!.blockquote!.style).toBe('italic');
    expect(style!.blockquote!.font).toBe('Georgia');
  });

  it('ignores array and non-object sections', () => {
    const style = parseDocumentStyle({
      style: {
        body: { font: 'Georgia' },
        h1: 'not an object',
        h2: ['array'],
        code: null,
      },
    });
    expect(style!.body).toEqual({ font: 'Georgia' });
    expect(style!.h1).toBeUndefined();
    expect(style!.h2).toBeUndefined();
    expect(style!.code).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseSizeToPx
// ---------------------------------------------------------------------------

describe('parseSizeToPx', () => {
  it('converts pt to px (1pt = 4/3 px)', () => {
    expect(parseSizeToPx('12pt')).toBeCloseTo(16, 0);
    expect(parseSizeToPx('10.5pt')).toBeCloseTo(14, 0);
    expect(parseSizeToPx('9pt')).toBeCloseTo(12, 0);
  });

  it('passes through px values', () => {
    expect(parseSizeToPx('16px')).toBe(16);
    expect(parseSizeToPx('14.5px')).toBe(14.5);
  });

  it('converts em to px using base', () => {
    expect(parseSizeToPx('1.5em', 16)).toBe(24);
    expect(parseSizeToPx('2rem', 16)).toBe(32);
  });

  it('treats plain numbers as px', () => {
    expect(parseSizeToPx('16')).toBe(16);
    expect(parseSizeToPx('14.5')).toBe(14.5);
  });

  it('returns undefined for invalid values', () => {
    expect(parseSizeToPx(undefined)).toBeUndefined();
    expect(parseSizeToPx('')).toBeUndefined();
    expect(parseSizeToPx('abc')).toBeUndefined();
    expect(parseSizeToPx('10vw')).toBeUndefined();
  });

  it('handles whitespace', () => {
    expect(parseSizeToPx(' 12pt ')).toBeCloseTo(16, 0);
  });
});

// ---------------------------------------------------------------------------
// parseFontWeight
// ---------------------------------------------------------------------------

describe('parseFontWeight', () => {
  it('returns numeric values as-is', () => {
    expect(parseFontWeight(400)).toBe(400);
    expect(parseFontWeight(700)).toBe(700);
  });

  it('converts CSS keywords to numbers', () => {
    expect(parseFontWeight('normal')).toBe(400);
    expect(parseFontWeight('bold')).toBe(700);
    expect(parseFontWeight('light')).toBe(300);
    expect(parseFontWeight('semibold')).toBe(600);
    expect(parseFontWeight('medium')).toBe(500);
  });

  it('is case-insensitive', () => {
    expect(parseFontWeight('Bold')).toBe(700);
    expect(parseFontWeight('NORMAL')).toBe(400);
  });

  it('parses numeric strings', () => {
    expect(parseFontWeight('600')).toBe(600);
  });

  it('returns undefined for invalid values', () => {
    expect(parseFontWeight(undefined)).toBeUndefined();
    expect(parseFontWeight('invalid')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// documentStyleToPresets
// ---------------------------------------------------------------------------

describe('documentStyleToPresets', () => {
  it('returns null for null style', () => {
    expect(documentStyleToPresets(null)).toBeNull();
  });

  it('returns null for empty style', () => {
    expect(documentStyleToPresets({})).toBeNull();
  });

  it('maps body to paragraph', () => {
    const partial = documentStyleToPresets({
      body: { font: 'Georgia', size: '12pt', lineHeight: 1.45, weight: 'normal' },
    });
    expect(partial).not.toBeNull();
    expect(partial!.paragraph).toEqual({
      fontFamily: 'Georgia',
      fontSize: parseSizeToPx('12pt'),
      lineHeight: 1.45,
      fontWeight: 400,
    });
  });

  it('maps h1-h6 to heading1-heading6', () => {
    const partial = documentStyleToPresets({
      h1: { font: 'Georgia', size: '26pt', weight: 700 },
      h3: { size: '16pt' },
    });
    expect(partial!.heading1).toEqual({
      fontFamily: 'Georgia',
      fontSize: parseSizeToPx('26pt'),
      fontWeight: 700,
    });
    expect(partial!.heading3).toEqual({
      fontSize: parseSizeToPx('16pt'),
    });
    expect(partial!.heading2).toBeUndefined();
  });

  it('maps code to codeBlock', () => {
    const partial = documentStyleToPresets({
      code: { font: 'JetBrains Mono', size: '9pt' },
    });
    expect(partial!.codeBlock).toEqual({
      fontFamily: 'JetBrains Mono',
      fontSize: parseSizeToPx('9pt'),
    });
  });

  it('maps blockquote with color', () => {
    const partial = documentStyleToPresets({
      blockquote: { font: 'Georgia', size: '14pt', weight: 'light', color: '#666' },
    });
    expect(partial!.blockquote).toEqual({
      fontFamily: 'Georgia',
      fontSize: parseSizeToPx('14pt'),
      fontWeight: 300,
      color: '#666',
    });
  });

  it('integrates with mergePresets to produce full TypographyPresets', () => {
    const style: DocumentStyle = {
      body: { font: 'Georgia', size: '11pt', lineHeight: 1.5 },
      h1: { font: 'Georgia', size: '26pt', weight: 'bold' },
    };
    const partial = documentStyleToPresets(style);
    const merged = mergePresets(
      partial as Record<string, Partial<BlockTypeStyle>>,
      DEFAULT_PRESETS,
    );

    // Body overrides applied
    expect(merged.paragraph.fontFamily).toBe('Georgia');
    expect(merged.paragraph.fontSize).toBeCloseTo(14.7, 0);
    expect(merged.paragraph.lineHeight).toBe(1.5);
    // Defaults preserved for unspecified fields
    expect(merged.paragraph.fontWeight).toBe(DEFAULT_PRESETS.paragraph.fontWeight);
    expect(merged.paragraph.spacingAfter).toBe(DEFAULT_PRESETS.paragraph.spacingAfter);

    // H1 overrides applied
    expect(merged.heading1.fontFamily).toBe('Georgia');
    expect(merged.heading1.fontWeight).toBe(700);

    // H2 should be unchanged defaults
    expect(merged.heading2.fontFamily).toBe(DEFAULT_PRESETS.heading2.fontFamily);
    expect(merged.heading2.fontSize).toBe(DEFAULT_PRESETS.heading2.fontSize);

    // Code block should be unchanged defaults
    expect(merged.codeBlock.fontFamily).toBe(DEFAULT_PRESETS.codeBlock.fontFamily);
  });
});

// ---------------------------------------------------------------------------
// documentStyleToCSS
// ---------------------------------------------------------------------------

describe('documentStyleToCSS', () => {
  it('returns empty string for empty style', () => {
    expect(documentStyleToCSS({})).toBe('');
  });

  it('generates @page rule from page settings', () => {
    const css = documentStyleToCSS({
      page: { size: 'A4', margin: '2.5cm' },
    });
    expect(css).toContain('@page');
    expect(css).toContain('size: A4');
    expect(css).toContain('margin: 2.5cm');
  });

  it('generates body rule with font and size', () => {
    const css = documentStyleToCSS({
      body: { font: 'Georgia', size: '10.5pt', lineHeight: 1.45, color: '#1a1a1a', textAlign: 'justify' },
    });
    expect(css).toContain('body {');
    expect(css).toContain('font-family: Georgia');
    expect(css).toContain('font-size: 10.5pt');
    expect(css).toContain('line-height: 1.45');
    expect(css).toContain('color: #1a1a1a');
    expect(css).toContain('text-align: justify');
  });

  it('generates heading rules', () => {
    const css = documentStyleToCSS({
      h1: { font: 'Georgia', size: '26pt', weight: 'normal', align: 'center' },
      h2: { textTransform: 'uppercase', letterSpacing: '2pt' },
    });
    expect(css).toContain('h1 {');
    expect(css).toContain('font-weight: normal');
    expect(css).toContain('text-align: center');
    expect(css).toContain('h2 {');
    expect(css).toContain('text-transform: uppercase');
    expect(css).toContain('letter-spacing: 2pt');
  });

  it('generates code rule with code, pre selector', () => {
    const css = documentStyleToCSS({
      code: { font: 'JetBrains Mono', size: '9pt' },
    });
    expect(css).toContain('code, pre {');
    expect(css).toContain('font-family: JetBrains Mono');
    expect(css).toContain('font-size: 9pt');
  });

  it('generates blockquote rule with font-style', () => {
    const css = documentStyleToCSS({
      blockquote: { style: 'italic', font: 'Georgia' },
    });
    expect(css).toContain('blockquote {');
    expect(css).toContain('font-style: italic');
    expect(css).toContain('font-family: Georgia');
  });

  it('generates pageBreakBefore rule', () => {
    const css = documentStyleToCSS({
      h1: { pageBreakBefore: true },
    });
    expect(css).toContain('page-break-before: always');
  });

  it('prefers textAlign over align', () => {
    const css = documentStyleToCSS({
      body: { textAlign: 'center', align: 'left' },
    });
    expect(css).toContain('text-align: center');
    expect(css).not.toContain('text-align: left');
  });

  it('falls back to align when textAlign is not set', () => {
    const css = documentStyleToCSS({
      body: { align: 'right' },
    });
    expect(css).toContain('text-align: right');
  });

  it('generates a complete stylesheet from a full style object', () => {
    const style: DocumentStyle = {
      page: { size: 'A4', margin: '2.5cm' },
      body: { font: 'Georgia', size: '10.5pt', lineHeight: 1.45 },
      h1: { font: 'Georgia', size: '26pt' },
      code: { font: 'JetBrains Mono', size: '9pt' },
    };
    const css = documentStyleToCSS(style);
    const lines = css.split('\n');
    expect(lines.length).toBe(4); // @page, body, h1, code
    expect(lines[0]).toContain('@page');
    expect(lines[1]).toContain('body');
    expect(lines[2]).toContain('h1');
    expect(lines[3]).toContain('code, pre');
  });
});

// ---------------------------------------------------------------------------
// Integration: YAML → parse → convert → merge round-trip
// ---------------------------------------------------------------------------

describe('full YAML → presets pipeline', () => {
  it('parses frontmatter YAML and produces valid TypographyPresets', () => {
    const raw = `---
style:
  body:
    font: Georgia
    size: 12pt
    lineHeight: 1.6
  h1:
    font: Georgia
    size: 24pt
    weight: bold
  code:
    font: Fira Code
    size: 10pt
---

# Content`;

    const { frontmatter } = parseFrontmatter(raw);
    const docStyle = parseDocumentStyle(frontmatter);
    expect(docStyle).not.toBeNull();

    const partial = documentStyleToPresets(docStyle!);
    expect(partial).not.toBeNull();

    const presets = mergePresets(
      partial as Record<string, Partial<BlockTypeStyle>>,
      DEFAULT_PRESETS,
    );

    // Body → paragraph
    expect(presets.paragraph.fontFamily).toBe('Georgia');
    expect(presets.paragraph.fontSize).toBe(16); // 12pt = 16px
    expect(presets.paragraph.lineHeight).toBe(1.6);

    // H1
    expect(presets.heading1.fontFamily).toBe('Georgia');
    expect(presets.heading1.fontSize).toBe(32); // 24pt = 32px
    expect(presets.heading1.fontWeight).toBe(700);

    // Code
    expect(presets.codeBlock.fontFamily).toBe('Fira Code');
    expect(presets.codeBlock.fontSize).toBeCloseTo(13.3, 0); // 10pt ~= 13.3px

    // Unmodified defaults preserved
    expect(presets.heading2.fontFamily).toBe(DEFAULT_PRESETS.heading2.fontFamily);
    expect(presets.blockquote.fontFamily).toBe(DEFAULT_PRESETS.blockquote.fontFamily);
  });
});

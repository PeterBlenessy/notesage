import { describe, it, expect } from 'vitest';
import { generatePrintCSS } from '../print-css';

describe('generatePrintCSS', () => {
  it('produces @page { size: A4 } for a4 page size', () => {
    const css = generatePrintCSS({ pageSize: 'a4', includePageNumbers: false });
    expect(css).toContain('size: A4;');
  });

  it('produces @page { size: letter } for letter page size', () => {
    const css = generatePrintCSS({ pageSize: 'letter', includePageNumbers: false });
    expect(css).toContain('size: letter;');
  });

  it('produces @page { size: A5 } for a5 page size', () => {
    const css = generatePrintCSS({ pageSize: 'a5', includePageNumbers: false });
    expect(css).toContain('size: A5;');
  });

  it('falls back to A4 for unknown page size', () => {
    const css = generatePrintCSS({ pageSize: 'unknown', includePageNumbers: false });
    expect(css).toContain('size: A4;');
  });

  it('includes @bottom-center when page numbers are enabled', () => {
    const css = generatePrintCSS({ pageSize: 'a4', includePageNumbers: true });
    expect(css).toContain('@bottom-center');
    expect(css).toContain('counter(page)');
  });

  it('omits @bottom-center when page numbers are disabled', () => {
    const css = generatePrintCSS({ pageSize: 'a4', includePageNumbers: false });
    expect(css).not.toContain('@bottom-center');
    expect(css).not.toContain('counter(page)');
  });

  it('contains break-inside: avoid rules', () => {
    const css = generatePrintCSS({ pageSize: 'a4', includePageNumbers: false });
    expect(css).toContain('break-inside: avoid');
  });

  it('contains orphans: 3 and widows: 3', () => {
    const css = generatePrintCSS({ pageSize: 'a4', includePageNumbers: false });
    expect(css).toContain('orphans: 3');
    expect(css).toContain('widows: 3');
  });

  it('uses default margin of 1in', () => {
    const css = generatePrintCSS({ pageSize: 'a4', includePageNumbers: false });
    expect(css).toContain('margin: 1in;');
  });

  it('uses custom margin when provided', () => {
    const css = generatePrintCSS({ pageSize: 'a4', includePageNumbers: false, margin: '0.5in' });
    expect(css).toContain('margin: 0.5in;');
  });

  it('wraps output in @media print block', () => {
    const css = generatePrintCSS({ pageSize: 'a4', includePageNumbers: false });
    expect(css).toContain('@media print');
  });

  it('includes page-break-after: avoid for headings', () => {
    const css = generatePrintCSS({ pageSize: 'a4', includePageNumbers: false });
    expect(css).toContain('page-break-after: avoid');
  });
});

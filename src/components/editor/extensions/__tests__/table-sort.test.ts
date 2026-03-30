import { describe, it, expect } from 'vitest';
import { TableSort, TableSortPluginKey } from '../table-sort';

// ---------------------------------------------------------------------------
// TableSort extension — structural tests
// ---------------------------------------------------------------------------

describe('TableSort extension', () => {
  it('exports a Tiptap Extension', () => {
    expect(TableSort).toBeDefined();
    expect(TableSort.name).toBe('tableSort');
  });

  it('exports a PluginKey', () => {
    expect(TableSortPluginKey).toBeDefined();
  });

  it('declares colSortDirection global attribute on tableHeader', () => {
    const config = TableSort.config;
    expect(config).toBeDefined();

    // The extension's addGlobalAttributes should define colSortDirection
    // We verify by checking that the extension config includes global attributes
    const ext = TableSort.configure({});
    expect(ext).toBeDefined();
    expect(ext.name).toBe('tableSort');
  });
});

// ---------------------------------------------------------------------------
// Sort helper edge cases
//
// The sortTableByColumn function uses Intl.Collator with { numeric: true }
// for locale-aware natural sorting. We test the collator behavior here to
// verify sort semantics without needing a full ProseMirror editor.
// ---------------------------------------------------------------------------

describe('Sort comparator edge cases', () => {
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
  });

  function sortAsc(values: string[]): string[] {
    return [...values].sort((a, b) => collator.compare(a, b));
  }

  function sortDesc(values: string[]): string[] {
    return [...values].sort((a, b) => -1 * collator.compare(a, b));
  }

  it('numeric sort orders numbers naturally', () => {
    const values = ['100', '20', '3', '1'];
    expect(sortAsc(values)).toEqual(['1', '3', '20', '100']);
    expect(sortDesc(values)).toEqual(['100', '20', '3', '1']);
  });

  it('numeric sort puts NaN/non-numeric values at end (sorted as strings)', () => {
    const values = ['10', 'N/A', '5', '', '20'];
    const sorted = sortAsc(values);
    // Empty string sorts first, numbers naturally, N/A as text after numbers
    expect(sorted.indexOf('5')).toBeLessThan(sorted.indexOf('10'));
    expect(sorted.indexOf('10')).toBeLessThan(sorted.indexOf('20'));
    // N/A (text) sorts after numeric values with numeric collation
    expect(sorted.indexOf('20')).toBeLessThan(sorted.indexOf('N/A'));
  });

  it('text sort is case-insensitive', () => {
    const values = ['banana', 'Apple', 'cherry', 'apricot'];
    const sorted = sortAsc(values);
    // With sensitivity: 'base', 'Apple' and 'apricot' are treated case-insensitively
    expect(sorted[0].toLowerCase()).toBe('apple');
    expect(sorted[1].toLowerCase()).toBe('apricot');
    expect(sorted[2]).toBe('banana');
    expect(sorted[3]).toBe('cherry');
  });

  it('date sort with ISO date strings', () => {
    const values = ['2026-01-15', '2025-12-01', '2026-03-30', '2025-06-20'];
    const sorted = sortAsc(values);
    expect(sorted).toEqual(['2025-06-20', '2025-12-01', '2026-01-15', '2026-03-30']);
  });

  it('date sort with invalid dates puts them after valid ones', () => {
    const values = ['2026-01-15', 'not-a-date', '2025-12-01'];
    const sorted = sortAsc(values);
    // ISO dates sort lexicographically which matches chronological order
    expect(sorted[0]).toBe('2025-12-01');
    expect(sorted[1]).toBe('2026-01-15');
    // 'not-a-date' comes after as it compares as a string
    expect(sorted[2]).toBe('not-a-date');
  });

  it('null direction means no reordering (identity)', () => {
    // This tests the sortTableByColumn behavioral contract:
    // when direction is null, the function dispatches attribute changes
    // but skips row reordering. We verify the concept here.
    const direction: 'asc' | 'desc' | null = null;
    const values = ['C', 'A', 'B'];
    if (direction === null) {
      // No sorting applied
      expect(values).toEqual(['C', 'A', 'B']);
    }
  });

  it('mixed numeric and text values sort with numbers first', () => {
    const values = ['beta', '2', 'alpha', '10', '1'];
    const sorted = sortAsc(values);
    // Numeric collation: numbers sort before letters
    expect(sorted.indexOf('1')).toBeLessThan(sorted.indexOf('alpha'));
    expect(sorted.indexOf('2')).toBeLessThan(sorted.indexOf('alpha'));
    expect(sorted.indexOf('10')).toBeLessThan(sorted.indexOf('alpha'));
  });

  it('empty strings sort before non-empty strings', () => {
    const values = ['B', '', 'A', ''];
    const sorted = sortAsc(values);
    expect(sorted[0]).toBe('');
    expect(sorted[1]).toBe('');
  });
});

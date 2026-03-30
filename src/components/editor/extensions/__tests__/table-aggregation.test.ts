import { describe, it, expect } from 'vitest';
import { computeAggregations } from '../table-aggregation';
import type { AggregationResult } from '../table-aggregation';

// ---------------------------------------------------------------------------
// Mock helper — builds a minimal table-like ProseMirror node structure
// ---------------------------------------------------------------------------

interface MockHeader {
  text: string;
  colType?: string;
  colCurrency?: string | null;
  colAggregation?: string | null;
}

function mockTable(headers: MockHeader[], rows: string[][]): unknown {
  const headerCells = headers.map((h) => ({
    type: { name: 'tableHeader' },
    attrs: {
      colType: h.colType || 'text',
      colCurrency: h.colCurrency ?? null,
      colAggregation: h.colAggregation ?? null,
    },
    textContent: h.text,
  }));

  const headerRow = {
    type: { name: 'tableRow' },
    childCount: headerCells.length,
    child: (i: number) => headerCells[i],
    forEach: (fn: (node: unknown, offset: number, index: number) => void) => {
      headerCells.forEach((cell, i) => fn(cell, 0, i));
    },
  };

  const dataRows = rows.map((row) => {
    const cells = row.map((text) => ({
      type: { name: 'tableCell' },
      attrs: {},
      textContent: text,
    }));
    return {
      type: { name: 'tableRow' },
      childCount: cells.length,
      child: (i: number) => cells[i],
      forEach: (fn: (node: unknown, offset: number, index: number) => void) => {
        cells.forEach((cell, i) => fn(cell, 0, i));
      },
    };
  });

  const allRows = [headerRow, ...dataRows];

  return {
    type: { name: 'table' },
    childCount: allRows.length,
    forEach: (fn: (node: unknown, offset: number, index: number) => void) => {
      allRows.forEach((row, i) => fn(row, 0, i));
    },
    child: (i: number) => allRows[i],
  };
}

// ---------------------------------------------------------------------------
// Helper to find a result by column index
// ---------------------------------------------------------------------------

function resultFor(results: AggregationResult[], colIndex: number): AggregationResult | undefined {
  return results.find((r) => r.colIndex === colIndex);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeAggregations', () => {
  it('returns empty array when no aggregation is configured', () => {
    const table = mockTable(
      [
        { text: 'Name' },
        { text: 'Value', colType: 'number' },
      ],
      [['Alice', '10'], ['Bob', '20']],
    );
    expect(computeAggregations(table as never)).toEqual([]);
  });

  it('computes sum of a numeric column', () => {
    const table = mockTable(
      [
        { text: 'Name' },
        { text: 'Amount', colType: 'number', colAggregation: 'sum' },
      ],
      [['Alice', '10'], ['Bob', '20'], ['Charlie', '30']],
    );
    const results = computeAggregations(table as never);
    expect(results).toHaveLength(1);
    const r = resultFor(results, 1)!;
    expect(r.type).toBe('sum');
    expect(r.value).toBe(60);
    expect(r.formattedValue).toBe('60');
  });

  it('computes average of a numeric column', () => {
    const table = mockTable(
      [
        { text: 'Score', colType: 'number', colAggregation: 'avg' },
      ],
      [['10'], ['20'], ['30']],
    );
    const results = computeAggregations(table as never);
    const r = resultFor(results, 0)!;
    expect(r.type).toBe('avg');
    expect(r.value).toBeCloseTo(20);
    expect(r.formattedValue).toBe('20');
  });

  it('computes count of all non-empty cells', () => {
    const table = mockTable(
      [
        { text: 'Item', colType: 'text', colAggregation: 'count' },
      ],
      [['Apple'], [''], ['Banana'], ['Cherry']],
    );
    const results = computeAggregations(table as never);
    const r = resultFor(results, 0)!;
    expect(r.type).toBe('count');
    expect(r.value).toBe(3);
    expect(r.formattedValue).toBe('3');
  });

  it('computes min of a numeric column', () => {
    const table = mockTable(
      [
        { text: 'Price', colType: 'number', colAggregation: 'min' },
      ],
      [['50'], ['10'], ['30']],
    );
    const results = computeAggregations(table as never);
    const r = resultFor(results, 0)!;
    expect(r.type).toBe('min');
    expect(r.value).toBe(10);
  });

  it('computes max of a numeric column', () => {
    const table = mockTable(
      [
        { text: 'Price', colType: 'number', colAggregation: 'max' },
      ],
      [['50'], ['10'], ['30']],
    );
    const results = computeAggregations(table as never);
    const r = resultFor(results, 0)!;
    expect(r.type).toBe('max');
    expect(r.value).toBe(50);
  });

  it('formats currency column aggregation with $ symbol', () => {
    const table = mockTable(
      [
        { text: 'Revenue', colType: 'currency', colCurrency: 'USD', colAggregation: 'sum' },
      ],
      [['$1,000'], ['$2,500'], ['$500']],
    );
    const results = computeAggregations(table as never);
    const r = resultFor(results, 0)!;
    expect(r.value).toBe(4000);
    expect(r.formattedValue).toBe('$4,000.00');
  });

  it('formats percentage column aggregation', () => {
    const table = mockTable(
      [
        { text: 'Rate', colType: 'percentage', colAggregation: 'avg' },
      ],
      [['85%'], ['90%'], ['75%']],
    );
    const results = computeAggregations(table as never);
    const r = resultFor(results, 0)!;
    // parseNumericValue with percentage type divides by 100
    expect(r.value).toBeCloseTo(0.8333, 3);
    // formatValue for percentage multiplies by 100 and adds %
    expect(r.formattedValue).toBe('83.33%');
  });

  it('skips non-numeric cells for sum/avg/min/max', () => {
    const table = mockTable(
      [
        { text: 'Mixed', colType: 'number', colAggregation: 'sum' },
      ],
      [['10'], ['N/A'], ['20'], ['unknown'], ['30']],
    );
    const results = computeAggregations(table as never);
    const r = resultFor(results, 0)!;
    expect(r.value).toBe(60);
  });

  it('counts all non-empty cells for count (including non-numeric)', () => {
    const table = mockTable(
      [
        { text: 'Mixed', colType: 'number', colAggregation: 'count' },
      ],
      [['10'], ['N/A'], ['20'], [''], ['text']],
    );
    const results = computeAggregations(table as never);
    const r = resultFor(results, 0)!;
    expect(r.value).toBe(4); // 10, N/A, 20, text — empty excluded
  });

  it('handles empty table (no data rows)', () => {
    const table = mockTable(
      [
        { text: 'Amount', colType: 'number', colAggregation: 'sum' },
        { text: 'Score', colType: 'number', colAggregation: 'avg' },
        { text: 'Items', colType: 'text', colAggregation: 'count' },
        { text: 'Low', colType: 'number', colAggregation: 'min' },
        { text: 'High', colType: 'number', colAggregation: 'max' },
      ],
      [],
    );
    const results = computeAggregations(table as never);
    expect(results).toHaveLength(5);

    expect(resultFor(results, 0)!.value).toBe(0);       // sum → 0
    expect(resultFor(results, 1)!.value).toBeNaN();      // avg → NaN
    expect(resultFor(results, 2)!.value).toBe(0);        // count → 0
    expect(resultFor(results, 3)!.value).toBeNaN();      // min → NaN
    expect(resultFor(results, 4)!.value).toBeNaN();      // max → NaN
  });

  it('handles all non-numeric cells', () => {
    const table = mockTable(
      [
        { text: 'Val', colType: 'number', colAggregation: 'sum' },
        { text: 'Val2', colType: 'number', colAggregation: 'avg' },
      ],
      [['foo'], ['bar'], ['baz']],
    );
    const results = computeAggregations(table as never);
    expect(resultFor(results, 0)!.value).toBe(0);    // sum of nothing → 0
    expect(resultFor(results, 1)!.value).toBeNaN();   // avg of nothing → NaN
  });

  it('handles single value for all aggregation types', () => {
    const table = mockTable(
      [
        { text: 'Sum', colType: 'number', colAggregation: 'sum' },
        { text: 'Avg', colType: 'number', colAggregation: 'avg' },
        { text: 'Count', colType: 'text', colAggregation: 'count' },
        { text: 'Min', colType: 'number', colAggregation: 'min' },
        { text: 'Max', colType: 'number', colAggregation: 'max' },
      ],
      [['42', '42', 'hello', '42', '42']],
    );
    const results = computeAggregations(table as never);
    expect(resultFor(results, 0)!.value).toBe(42);
    expect(resultFor(results, 1)!.value).toBe(42);
    expect(resultFor(results, 2)!.value).toBe(1);
    expect(resultFor(results, 3)!.value).toBe(42);
    expect(resultFor(results, 4)!.value).toBe(42);
  });

  it('supports multiple columns with different aggregations', () => {
    const table = mockTable(
      [
        { text: 'Name' },
        { text: 'Quantity', colType: 'number', colAggregation: 'sum' },
        { text: 'Price', colType: 'currency', colCurrency: 'EUR', colAggregation: 'avg' },
        { text: 'Notes', colType: 'text', colAggregation: 'count' },
      ],
      [
        ['Widget', '100', '€10.00', 'Good'],
        ['Gadget', '200', '€20.00', ''],
        ['Doohickey', '50', '€15.00', 'Fair'],
      ],
    );
    const results = computeAggregations(table as never);
    expect(results).toHaveLength(3);

    const qty = resultFor(results, 1)!;
    expect(qty.type).toBe('sum');
    expect(qty.value).toBe(350);

    const price = resultFor(results, 2)!;
    expect(price.type).toBe('avg');
    expect(price.value).toBeCloseTo(15);

    const notes = resultFor(results, 3)!;
    expect(notes.type).toBe('count');
    expect(notes.value).toBe(2); // empty cell excluded
  });

  it('returns empty array for a table with zero rows', () => {
    const table = {
      type: { name: 'table' },
      childCount: 0,
      forEach: () => {},
      child: () => { throw new Error('no children'); },
    };
    expect(computeAggregations(table as never)).toEqual([]);
  });

  it('formats count as plain number even for currency columns', () => {
    const table = mockTable(
      [
        { text: 'Revenue', colType: 'currency', colCurrency: 'USD', colAggregation: 'count' },
      ],
      [['$100'], ['$200'], ['']],
    );
    const results = computeAggregations(table as never);
    const r = resultFor(results, 0)!;
    expect(r.value).toBe(2);
    expect(r.formattedValue).toBe('2'); // plain number, not "$2.00"
  });
});

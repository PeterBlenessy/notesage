// Source-code mechanical test: verifies the project multi-select <Check />
// icons in ChatFooter have both the expected size class and strokeWidth.
// RED before implementation (h-3 w-3, no strokeWidth), GREEN after.

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';

const SOURCE = readFileSync(
  resolve(__dirname, '../ChatFooter.tsx'),
  'utf-8',
);

// The project multi-select Check icons are on lines that also contain the
// condition that gates their visibility: `allSelected` or `isChecked`.
const CHECK_LINES = SOURCE
  .split('\n')
  .filter(
    (l) =>
      l.includes('<Check') &&
      (l.includes('allSelected') || l.includes('isChecked')),
  );

describe('ChatFooter.tsx — project multi-select Check prominence', () => {
  it('finds at least 2 selection-indicator Check icons (allSelected + isChecked branches)', () => {
    expect(CHECK_LINES.length).toBeGreaterThanOrEqual(2);
  });

  it('every selection-indicator Check uses size-3.5 (h-3.5 w-3.5)', () => {
    for (const line of CHECK_LINES) {
      expect(line).toContain('h-3.5');
      expect(line).toContain('w-3.5');
    }
  });

  it('every selection-indicator Check has strokeWidth >= 2.5', () => {
    for (const line of CHECK_LINES) {
      const match = line.match(/strokeWidth=\{([0-9.]+)\}/);
      expect(match).not.toBeNull();
      expect(parseFloat(match![1])).toBeGreaterThanOrEqual(2.5);
    }
  });
});

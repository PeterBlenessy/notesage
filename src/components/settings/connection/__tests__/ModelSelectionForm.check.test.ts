// Source-code mechanical test: verifies the selection-indicator <Check />
// icon in ModelSelectionForm has both the expected size class and strokeWidth.
// RED before implementation (missing strokeWidth), GREEN after.

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';

const SOURCE = readFileSync(
  resolve(__dirname, '../ModelSelectionForm.tsx'),
  'utf-8',
);

// The model-selection Check is the one that toggles opacity-100/opacity-0
// to show/hide the active row indicator.
const SELECTION_CHECK_LINE = SOURCE
  .split('\n')
  .find((l) => l.includes('<Check') && l.includes('opacity-100') && l.includes('opacity-0'));

describe('ModelSelectionForm.tsx — model picker Check prominence', () => {
  it('selection-indicator Check renders with size-3.5 (h-3.5 w-3.5)', () => {
    expect(SELECTION_CHECK_LINE).toBeDefined();
    expect(SELECTION_CHECK_LINE).toContain('h-3.5');
    expect(SELECTION_CHECK_LINE).toContain('w-3.5');
  });

  it('selection-indicator Check renders with strokeWidth >= 2.5', () => {
    expect(SELECTION_CHECK_LINE).toBeDefined();
    const match = SELECTION_CHECK_LINE!.match(/strokeWidth=\{([0-9.]+)\}/);
    expect(match).not.toBeNull();
    expect(parseFloat(match![1])).toBeGreaterThanOrEqual(2.5);
  });
});

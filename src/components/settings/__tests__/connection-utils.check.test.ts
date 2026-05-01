// Source-code regression guard: verifies that connection-utils.tsx never
// introduces a full-row accent fill on any selection-indicator row.
// This test is expected GREEN before and after the implementation — it acts
// as a regression lock ensuring the fix is not accidentally reverted.

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';

const SOURCE = readFileSync(
  resolve(__dirname, '../connection-utils.tsx'),
  'utf-8',
);

describe('connection-utils.tsx — selection indicator style', () => {
  it('contains no full-row accent fill on any selection-indicator row', () => {
    // The selected-row branch must NOT use bg-[var(--color-accent-primary)].
    // Discrete checkmark only — no dual-indicator pattern.
    expect(SOURCE).not.toContain('bg-[var(--color-accent-primary)]');
  });
});

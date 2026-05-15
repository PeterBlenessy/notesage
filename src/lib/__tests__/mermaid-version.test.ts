/**
 * Verifies that the installed mermaid package meets the minimum version
 * required to close four open Dependabot security alerts (CSS/HTML injection
 * and DoS in ≤ 11.14.x).
 */
import { describe, it, expect } from 'vitest';

describe('mermaid dependency version', () => {
  it('is at least 11.15.0 to close Dependabot alerts #62–#65', async () => {
    const { version } = await import('mermaid/package.json');
    const [major, minor, patch] = version.split('.').map(Number);
    const meetsMinimum =
      major > 11 ||
      (major === 11 && minor > 15) ||
      (major === 11 && minor === 15 && patch >= 0);
    expect(meetsMinimum, `mermaid ${version} is below the required 11.15.0`).toBe(true);
  });
});

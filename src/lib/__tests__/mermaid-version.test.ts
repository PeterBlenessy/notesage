import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

describe('mermaid dependency version', () => {
  it('is at least 11.15.0 to close Dependabot alerts #62–#65', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pkg = require('mermaid/package.json') as any;
    const version: string = pkg.version as string;
    const [major, minor] = version.split('.').map(Number);
    const isAtLeast11_15 = major > 11 || (major === 11 && minor >= 15);
    expect(isAtLeast11_15).toBe(true);
  });
});

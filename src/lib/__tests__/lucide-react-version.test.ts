import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('lucide-react dependency version', () => {
  it('is pinned to ^1.16.0 in package.json', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')
    );
    const version: string = pkg.dependencies['lucide-react'] ?? '';
    // Extract the numeric part — strip leading ^ ~ or nothing
    const numeric = version.replace(/^[\^~]/, '');
    const [, minor] = numeric.split('.').map(Number);
    expect(minor).toBeGreaterThanOrEqual(16);
  });
});

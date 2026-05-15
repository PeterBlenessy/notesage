import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// Regression-lock for issue #230: lucide-react must be at 1.16.0.
// This test fails if someone downgrades the package or if the bump was not applied.

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const pkgPath = path.join(repoRoot, 'package.json');

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function loadPackageJson(): PackageJson {
  return JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJson;
}

describe('lucide-react dependency version', () => {
  it('is pinned to ^1.16.0 in package.json', () => {
    const pkg = loadPackageJson();
    const version =
      pkg.dependencies?.['lucide-react'] ??
      pkg.devDependencies?.['lucide-react'];
    expect(version).toBeDefined();
    // Accept exact "1.16.0" or caret "^1.16.0" — either satisfies the bump.
    const semverBase = version?.replace(/^\^/, '');
    const [major, minor] = (semverBase ?? '').split('.').map(Number);
    expect(major).toBe(1);
    expect(minor).toBeGreaterThanOrEqual(16);
  });
});

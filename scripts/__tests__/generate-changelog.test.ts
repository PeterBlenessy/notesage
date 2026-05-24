import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { checkPlaceholderGuard } from '../generate-changelog.js';

describe('checkPlaceholderGuard', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(process.cwd(), `.test-tmp-changelog-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes (returns true) when hasTierA is false even if file has placeholder', () => {
    const file = join(tmpDir, 'release.md');
    writeFileSync(
      file,
      '# Release v1.0.0\n\n## Changes\n\n_No user-visible changes._\n',
    );
    expect(checkPlaceholderGuard(file, false)).toBe(true);
  });

  it('passes (returns true) when filePath is undefined', () => {
    expect(checkPlaceholderGuard(undefined, true)).toBe(true);
  });

  it('passes (returns true) when hasTierA is true but file has real prose', () => {
    const file = join(tmpDir, 'release.md');
    writeFileSync(
      file,
      '# Release v1.0.0\n\n## Changes\n\n### Features\n\n- Some real feature for users\n',
    );
    expect(checkPlaceholderGuard(file, true)).toBe(true);
  });

  it('blocks (returns false) when hasTierA is true AND file has placeholder in ## Changes', () => {
    const file = join(tmpDir, 'release.md');
    writeFileSync(
      file,
      '# Release v1.0.0\n\n## Changes\n\n_No user-visible changes._\n\n## Under the hood\n\n- Some PR (#1)\n',
    );
    expect(checkPlaceholderGuard(file, true)).toBe(false);
  });

  it('passes (returns true) when file does not exist', () => {
    const nonExistent = join(tmpDir, 'does-not-exist.md');
    expect(checkPlaceholderGuard(nonExistent, true)).toBe(true);
  });
});

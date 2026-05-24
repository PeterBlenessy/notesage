// Regression-lock test for the bundled llama.cpp version pin.
//
// Issue #248 — bump the llama-server sidecar from b8648 to a recent stable
// tagged release (b9000+). This test asserts:
//   1. The version string is in `b{number}` format (llama.cpp release tag).
//   2. The build number is at least 9000 (ensures the pin is current).
//
// Fails on the old b8648 pin; passes once bumped to b9000 or later.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const VERSION_FILE = resolve(__dirname, '../../../src-tauri/binaries/LLAMA_CPP_VERSION');

describe('LLAMA_CPP_VERSION pin', () => {
  it('is in bNNNN format', () => {
    const version = readFileSync(VERSION_FILE, 'utf8').trim();
    expect(version).toMatch(/^b\d+$/);
  });

  it('is at least b9000 (recent stable tagged release)', () => {
    const version = readFileSync(VERSION_FILE, 'utf8').trim();
    const buildNum = parseInt(version.slice(1), 10);
    expect(buildNum).toBeGreaterThanOrEqual(9000);
  });
});

/**
 * Regression-lock tests for the post-merge real-app performance tracking CI job.
 * Issue #286: Add post-merge real-app perf job (e2e-real-perf)
 *
 * These tests assert:
 * 1. `e2e-real/tests/performance.test.ts` is NOT skipped (no `describe.skip`)
 * 2. `.github/workflows/test-perf-e2e.yml` exists and has correct triggers
 * 3. The workflow targets `macos-latest` and uses the real E2E infrastructure
 * 4. Timing measurements are captured and uploaded as a CI artifact (≥14-day retention)
 * 5. The job does NOT appear in `test.yml` (does not block PR merges)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../../..');

const PERF_SPEC = resolve(ROOT, 'e2e-real/tests/performance.test.ts');
const PERF_WORKFLOW = resolve(ROOT, '.github/workflows/test-perf-e2e.yml');
const TEST_WORKFLOW = resolve(ROOT, '.github/workflows/test.yml');

// ── Helper ────────────────────────────────────────────────────────────────────

function readFile(path: string): string {
  return readFileSync(path, 'utf-8');
}

// ── Performance spec — must NOT be skipped ────────────────────────────────────

describe('e2e-real/tests/performance.test.ts — not skipped', () => {
  it('file exists', () => {
    expect(existsSync(PERF_SPEC)).toBe(true);
  });

  it('does not contain describe.skip', () => {
    const content = readFile(PERF_SPEC);
    // The top-level Performance suite must not be skipped
    expect(content).not.toMatch(/describe\.skip\s*\(\s*['"]Performance['"]/);
  });

  it('does not contain the 6-line skip comment block from PR #291', () => {
    const content = readFile(PERF_SPEC);
    expect(content).not.toContain('SKIPPED 2026-05-16');
  });
});

// ── test-perf-e2e.yml — must exist ───────────────────────────────────────────

describe('.github/workflows/test-perf-e2e.yml — exists', () => {
  it('file exists', () => {
    expect(existsSync(PERF_WORKFLOW)).toBe(true);
  });
});

// ── test-perf-e2e.yml — triggers ─────────────────────────────────────────────

describe('.github/workflows/test-perf-e2e.yml — triggers', () => {
  it('triggers on push to main', () => {
    const content = readFile(PERF_WORKFLOW);
    // Must have a push trigger scoped to main branch
    expect(content).toMatch(/on:/);
    expect(content).toMatch(/push:/);
    expect(content).toMatch(/branches.*main|main.*branches/s);
  });

  it('does NOT have a pull_request trigger', () => {
    const content = readFile(PERF_WORKFLOW);
    // The workflow must not run on pull_request events
    expect(content).not.toMatch(/^\s*pull_request\s*:/m);
  });

  it('does NOT have a workflow_call trigger (not a PR gate)', () => {
    const content = readFile(PERF_WORKFLOW);
    expect(content).not.toMatch(/workflow_call/);
  });
});

// ── test-perf-e2e.yml — runner and infrastructure ────────────────────────────

describe('.github/workflows/test-perf-e2e.yml — infrastructure', () => {
  it('uses macos-latest runner', () => {
    const content = readFile(PERF_WORKFLOW);
    expect(content).toContain('macos-latest');
  });

  it('references tauri-webdriver (real E2E infrastructure)', () => {
    const content = readFile(PERF_WORKFLOW);
    expect(content).toContain('tauri-webdriver');
  });

  it('builds or runs the Tauri app (pnpm tauri:test or test:e2e-real)', () => {
    const content = readFile(PERF_WORKFLOW);
    const hasRealE2E =
      content.includes('tauri:test') ||
      content.includes('test:e2e-real') ||
      content.includes('run-real-e2e');
    expect(hasRealE2E).toBe(true);
  });
});

// ── test-perf-e2e.yml — artifact upload ──────────────────────────────────────

describe('.github/workflows/test-perf-e2e.yml — artifact upload', () => {
  it('uploads an artifact', () => {
    const content = readFile(PERF_WORKFLOW);
    expect(content).toContain('upload-artifact');
  });

  it('artifact retention is at least 14 days', () => {
    const content = readFile(PERF_WORKFLOW);
    // Find retention-days: N and assert N >= 14
    const match = content.match(/retention-days:\s*(\d+)/);
    expect(match).not.toBeNull();
    const days = parseInt(match![1], 10);
    expect(days).toBeGreaterThanOrEqual(14);
  });

  it('artifact upload uses if: always() so it runs even on test failure', () => {
    const content = readFile(PERF_WORKFLOW);
    expect(content).toMatch(/if:\s*always\(\)/);
  });
});

// ── test.yml — must NOT reference the new job (PR gate unchanged) ─────────────

describe('.github/workflows/test.yml — PR gate unaffected', () => {
  it('does not reference test-perf-e2e job', () => {
    const content = readFile(TEST_WORKFLOW);
    expect(content).not.toContain('test-perf-e2e');
  });
});

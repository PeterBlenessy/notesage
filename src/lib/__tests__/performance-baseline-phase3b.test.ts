// Regression-lock test for the Phase 3b performance baseline entry (issue #134).
//
// docs/performance-baseline.md is the authoritative regression baseline.
// Phase 3b (streaming hydrate + parse cache) shipped 2026-05-07 and the
// headline numbers must be recorded here so future regression-watch and PRD
// reviews can compare against the right baseline.
//
// This test parses the file for the required content sections and assertions.
// It will stay green as long as the entry is present and complete.

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const BASELINE_PATH = path.resolve(__dirname, '../../../docs/performance-baseline.md');

function readBaseline(): string {
  return fs.readFileSync(BASELINE_PATH, 'utf-8');
}

describe('docs/performance-baseline.md — Phase 3b entry (issue #134)', () => {
  let content: string;

  beforeAll(() => {
    content = readBaseline();
  });

  it('has a "Load File Performance" section', () => {
    expect(content).toContain('## Load File Performance');
  });

  it('has the Phase 3b entry header', () => {
    expect(content).toContain(
      '### 2026-05-07 — Phase 3b (streaming hydrate + parse cache), Book 506 KB'
    );
  });

  it('records the commit hash for the Phase 3b implementation', () => {
    // The latest of the four Phase 3b commits listed in the issue
    expect(content).toContain('a28af3a4');
  });

  it('records methodology and machine spec', () => {
    // Machine spec section must reference Apple M3 (consistent with existing entries)
    const phase3bSection = content.slice(
      content.indexOf('### 2026-05-07 — Phase 3b')
    );
    expect(phase3bSection).toMatch(/Apple M3/);
  });

  it('records first-load (cold) time of ~5 s', () => {
    const phase3bSection = content.slice(
      content.indexOf('### 2026-05-07 — Phase 3b')
    );
    // Accept "5 s", "~5 s", "5s", or "~5s" or "5,000 ms" etc.
    expect(phase3bSection).toMatch(/[~≈]?\s*5\s*[s]/i);
  });

  it('records cache-hit (revisit) time of ~2.8 s', () => {
    const phase3bSection = content.slice(
      content.indexOf('### 2026-05-07 — Phase 3b')
    );
    expect(phase3bSection).toMatch(/2\.8\s*[s]/i);
  });

  it('records per-component breakdown including previewMs', () => {
    const phase3bSection = content.slice(
      content.indexOf('### 2026-05-07 — Phase 3b')
    );
    expect(phase3bSection).toContain('previewMs');
  });

  it('records per-component breakdown including pipelineMs', () => {
    const phase3bSection = content.slice(
      content.indexOf('### 2026-05-07 — Phase 3b')
    );
    expect(phase3bSection).toContain('pipelineMs');
  });

  it('records per-component breakdown including setContentMs', () => {
    const phase3bSection = content.slice(
      content.indexOf('### 2026-05-07 — Phase 3b')
    );
    expect(phase3bSection).toContain('setContentMs');
  });

  it('records chunkCount metric', () => {
    const phase3bSection = content.slice(
      content.indexOf('### 2026-05-07 — Phase 3b')
    );
    expect(phase3bSection).toContain('chunkCount');
  });

  it('includes comparison vs Phase 2 baseline commit 19d1b00f', () => {
    const phase3bSection = content.slice(
      content.indexOf('### 2026-05-07 — Phase 3b')
    );
    expect(phase3bSection).toContain('19d1b00f');
  });

  it('includes comparison vs prod 0.40.0', () => {
    const phase3bSection = content.slice(
      content.indexOf('### 2026-05-07 — Phase 3b')
    );
    expect(phase3bSection).toContain('0.40.0');
  });

  it('frames streaming as a yieldability win (not a total-time win)', () => {
    const phase3bSection = content.slice(
      content.indexOf('### 2026-05-07 — Phase 3b')
    );
    expect(phase3bSection).toMatch(/yield/i);
  });

  it('mentions open follow-up issue #131', () => {
    const phase3bSection = content.slice(
      content.indexOf('### 2026-05-07 — Phase 3b')
    );
    expect(phase3bSection).toContain('#131');
  });

  it('mentions open follow-up issue #132', () => {
    const phase3bSection = content.slice(
      content.indexOf('### 2026-05-07 — Phase 3b')
    );
    expect(phase3bSection).toContain('#132');
  });
});

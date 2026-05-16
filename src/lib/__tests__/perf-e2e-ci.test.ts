// Regression-lock tests for the post-merge real-app performance tracking
// CI job (issue #286).
//
// Verifies that:
// 1. test-perf-e2e.yml exists and triggers ONLY on push to main — not pull_request.
// 2. The workflow runs on macos-latest with the real Tauri build.
// 3. The workflow uploads a timing-results artifact with at least 14 days retention.
// 4. All specs in e2e-real/tests/performance.test.ts are un-skipped
//    (no .skip / xdescribe / xit markers).
//
// A job failure in test-perf-e2e.yml must NOT block PR merges — this is guaranteed
// structurally by the workflow having no pull_request trigger (criterion 1 above).

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';

interface StepYaml {
  uses?: string;
  run?: string;
  if?: string;
  name?: string;
  with?: Record<string, unknown>;
  [key: string]: unknown;
}

interface JobYaml {
  'runs-on'?: string;
  steps?: StepYaml[];
  [key: string]: unknown;
}

interface OnPushYaml {
  branches?: string[];
}

interface WorkflowOnYaml {
  push?: OnPushYaml;
  pull_request?: unknown;
  [key: string]: unknown;
}

interface WorkflowYaml {
  on: WorkflowOnYaml;
  jobs: Record<string, JobYaml>;
}

const WORKFLOW_PATH = resolve(__dirname, '../../../.github/workflows/test-perf-e2e.yml');
const PERF_TEST_PATH = resolve(__dirname, '../../../e2e-real/tests/performance.test.ts');

describe('Post-merge perf E2E CI (#286)', () => {
  describe('test-perf-e2e.yml — existence', () => {
    it('the workflow file exists', () => {
      expect(existsSync(WORKFLOW_PATH)).toBe(true);
    });
  });

  describe('test-perf-e2e.yml — trigger configuration', () => {
    let wf: WorkflowYaml;

    beforeEach(() => {
      wf = parseYaml(readFileSync(WORKFLOW_PATH, 'utf-8')) as WorkflowYaml;
    });

    it('triggers on push to main branch', () => {
      const pushOn = wf.on?.push;
      expect(pushOn).toBeDefined();
      expect(pushOn?.branches).toContain('main');
    });

    it('does NOT have a pull_request trigger', () => {
      // A pull_request trigger would make the job run on PRs and could
      // block merge if timing assertions fail on the slower CI runners.
      expect(wf.on?.pull_request).toBeUndefined();
    });
  });

  describe('test-perf-e2e.yml — job configuration', () => {
    let wf: WorkflowYaml;

    beforeEach(() => {
      wf = parseYaml(readFileSync(WORKFLOW_PATH, 'utf-8')) as WorkflowYaml;
    });

    it('has at least one job', () => {
      expect(Object.keys(wf.jobs).length).toBeGreaterThan(0);
    });

    it('runs on macos-latest', () => {
      const jobNames = Object.keys(wf.jobs);
      const firstJob = wf.jobs[jobNames[0]];
      expect(firstJob?.['runs-on']).toBe('macos-latest');
    });

    it('has a step that runs the performance test spec', () => {
      const jobNames = Object.keys(wf.jobs);
      const firstJob = wf.jobs[jobNames[0]];
      const steps = firstJob?.steps ?? [];
      const hasPerformanceSpec = steps.some(
        (s) =>
          typeof s.run === 'string' &&
          s.run.includes('performance.test.ts'),
      );
      expect(hasPerformanceSpec).toBe(true);
    });

    it('uploads a timing-results artifact with at least 14 days retention', () => {
      const jobNames = Object.keys(wf.jobs);
      const firstJob = wf.jobs[jobNames[0]];
      const steps = firstJob?.steps ?? [];
      const uploadStep = steps.find(
        (s) =>
          typeof s.uses === 'string' &&
          s.uses.startsWith('actions/upload-artifact'),
      );
      expect(uploadStep).toBeDefined();
      const retentionDays = (uploadStep?.with?.['retention-days'] as number) ?? 0;
      expect(retentionDays).toBeGreaterThanOrEqual(14);
    });
  });

  describe('e2e-real/tests/performance.test.ts — no skipped specs', () => {
    let source: string;

    beforeEach(() => {
      source = readFileSync(PERF_TEST_PATH, 'utf-8');
    });

    it('has no it.skip() calls', () => {
      expect(source).not.toMatch(/\bit\.skip\s*\(/);
    });

    it('has no xit() calls', () => {
      expect(source).not.toMatch(/\bxit\s*\(/);
    });

    it('has no describe.skip() calls', () => {
      expect(source).not.toMatch(/\bdescribe\.skip\s*\(/);
    });

    it('has no xdescribe() calls', () => {
      expect(source).not.toMatch(/\bxdescribe\s*\(/);
    });

    it('writes timing results to a JSON file', () => {
      // The test must write timing results to a JSON file so the CI
      // workflow can upload it as a structured artifact.
      expect(source).toMatch(/perf-results\.json/);
    });
  });
});

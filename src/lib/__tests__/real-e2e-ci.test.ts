// Regression-lock tests for real Tauri E2E CI plumbing (issue #254).
//
// Verifies that:
// 1. test.yml has a push-to-main trigger so real-E2E runs after every merge.
// 2. test.yml has a `real-e2e-tests` job that runs on macos-26 (pinned —
//    see the job-level test for the why).
// 3. The job runs on pull_request events (required by branch protection)
//    BUT may be skipped for docs-only PRs (the `check-changes` outputs
//    gate it via `needs.check-changes.outputs.code == 'true' || ...`).
//    Branch protection treats skipped jobs as passing (post-2023 rules)
//    so the docs-only skip is safe — see PR #329.
// 4. The job installs tauri-driver with cargo + actions/cache.
// 5. The job runs `pnpm test:e2e-real-full`.
// 6. The job uploads logs on failure for triage.
// 7. release.yml's alpha-cut step verifies the real-E2E run on main
//    was green within 24h.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';

interface StepYaml {
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
  name?: string;
  [key: string]: unknown;
}

interface JobYaml {
  'runs-on'?: string;
  if?: string;
  steps?: StepYaml[];
  needs?: string | string[];
  [key: string]: unknown;
}

interface OnPushYaml {
  branches?: string[];
  tags?: string[];
}

interface WorkflowOnYaml {
  push?: OnPushYaml;
  pull_request?: { branches?: string[] };
  workflow_dispatch?: unknown;
  workflow_call?: unknown;
  [key: string]: unknown;
}

interface WorkflowYaml {
  on: WorkflowOnYaml;
  jobs: Record<string, JobYaml>;
}

function loadWorkflow(name: string): WorkflowYaml {
  const path = resolve(__dirname, '../../../.github/workflows', `${name}.yml`);
  return parseYaml(readFileSync(path, 'utf-8')) as WorkflowYaml;
}

function hasStepWith(steps: StepYaml[], predicate: (s: StepYaml) => boolean): boolean {
  return steps.some(predicate);
}

describe('Real E2E CI plumbing (#254)', () => {
  describe('test.yml — triggers', () => {
    const wf = loadWorkflow('test');

    it('has a push trigger on the main branch', () => {
      const pushOn = wf.on?.push;
      expect(pushOn).toBeDefined();
      expect(pushOn?.branches).toContain('main');
    });
  });

  describe('test.yml — real-e2e-tests job', () => {
    const wf = loadWorkflow('test');
    const job = wf.jobs?.['real-e2e-tests'];

    it('has a real-e2e-tests job', () => {
      expect(job).toBeDefined();
    });

    it('runs on macos-26 (pinned to escape the Safari 26.5 WKWebView regression on macos-15)', () => {
      // Was `macos-latest` until 2026-05-24. Image macos-15-arm64/20260520
      // bumped Safari to 26.5 which has a WKWebView regression that breaks
      // every `openFile → ProseMirror render` test path. macos-26 image
      // 20260520 stayed on Safari 26.4 and runs the suite cleanly. See
      // issue #334 for the underlying-bug record; this lock-in is the
      // workaround. Revisit if/when GitHub rotates macos-26 to Safari 26.5
      // — at that point we fall back to a self-hosted runner.
      expect(job?.['runs-on']).toBe('macos-26');
    });

    it('runs on pull_request events (with docs-only skip via check-changes)', () => {
      // Branch protection on `main` requires this check to pass on PRs.
      // PR #329 added a docs-only-skip optimisation: the job is gated on
      // `needs.check-changes.outputs.code == 'true' || github.event_name
      // != 'pull_request'`. Per GitHub's post-2023 rules a skipped job
      // counts as passing for required checks, so the docs-only skip is
      // safe under branch protection.
      //
      // What we lock in here:
      // 1. `on.pull_request` is set so the workflow fires on PRs at all.
      // 2. The job has a `check-changes` dependency so the docs-only-skip
      //    plumbing is in place.
      // 3. The `if` condition references `check-changes.outputs.code` so
      //    the job DOES run on PRs that touch code (the common case).
      const wf = loadWorkflow('test');
      expect(wf.on.pull_request).toBeDefined();

      const needs = Array.isArray(job?.needs)
        ? job?.needs
        : job?.needs
          ? [job.needs]
          : [];
      expect(needs).toContain('check-changes');

      const condition = job?.if ?? '';
      expect(condition).toMatch(/check-changes\.outputs\.code/);
    });

    it('has an actions/cache step keyed on tauri-webdriver', () => {
      // The crate / binary name is `tauri-webdriver`, not `tauri-driver`
      // (some older Tauri docs use the latter). `scripts/run-real-e2e.sh`
      // greps for `tauri-webdriver` in PATH; the workflow must match.
      const steps = job?.steps ?? [];
      const cacheStep = steps.find(
        (s) =>
          typeof s.uses === 'string' &&
          s.uses.startsWith('actions/cache') &&
          JSON.stringify(s.with ?? {}).toLowerCase().includes('tauri-webdriver'),
      );
      expect(cacheStep).toBeDefined();
    });

    it('installs tauri-webdriver via cargo install', () => {
      const steps = job?.steps ?? [];
      expect(
        hasStepWith(steps, (s) =>
          typeof s.run === 'string' && s.run.includes('cargo install tauri-webdriver'),
        ),
      ).toBe(true);
    });

    it('runs pnpm test:e2e-real-full', () => {
      const steps = job?.steps ?? [];
      expect(
        hasStepWith(steps, (s) =>
          typeof s.run === 'string' && s.run.includes('pnpm test:e2e-real-full'),
        ),
      ).toBe(true);
    });

    it('uploads logs or report artifact on failure', () => {
      const steps = job?.steps ?? [];
      const uploadStep = steps.find(
        (s) =>
          typeof s.uses === 'string' &&
          s.uses.startsWith('actions/upload-artifact') &&
          (s.if === 'failure()' || String(s.if ?? '').includes('failure')),
      );
      expect(uploadStep).toBeDefined();
    });
  });

  describe('release.yml — alpha-cut gate', () => {
    const wf = loadWorkflow('release');
    const alphaJob = wf.jobs?.['update-latest-alpha'];

    it('update-latest-alpha job exists', () => {
      expect(alphaJob).toBeDefined();
    });

    it('has a step that verifies the real-E2E run on main within 24h', () => {
      const steps = alphaJob?.steps ?? [];
      // The step should reference 'real' (as in real-e2e) and '24' (hours) in
      // either its name or its script body.
      const gatestep = steps.find((s) => {
        const body = JSON.stringify(s).toLowerCase();
        return body.includes('real') && body.includes('24');
      });
      expect(gatestep).toBeDefined();
    });
  });
});

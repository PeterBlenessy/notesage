// Regression-lock tests for release.yml to prevent reintroducing the
// orphan-draft bug fixed in issue #203.
//
// Root cause: when `tauri-action@v0` is given `tagName` alongside `releaseId`,
// newer versions of the action try to create a release for that tag even
// though `releaseId` already points to an existing release. This produces
// either an `already_exists` error (if the tag already has a release) or an
// orphan draft release that requires manual cleanup.
//
// The fix: the `build-tauri` step should pass ONLY `releaseId` to
// tauri-action. `tagName`, `releaseName`, and `releaseBody` are only needed
// when creating a new release — they are redundant (and dangerous) when
// `releaseId` is already provided.
//
// These tests parse `release.yml` and lock in the safe shape:
//   1. `createRelease` is called exactly once, in the `create-release` job.
//   2. The `tauri-action` step in `build-tauri` does NOT pass `tagName`
//      (which would trigger release-creation logic even when `releaseId` is set).
//   3. `publish-release` uses `updateRelease`, not `createRelease`.
//
// Parsing the YAML rather than testing runtime behavior: GitHub releases API
// interactions happen server-side; there is no local mock that can reproduce
// the `already_exists` race. Locking the YAML shape is the most reliable way
// to catch future drift at PR-review time rather than at production-incident time.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';

interface Step {
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
  run?: string;
  [key: string]: unknown;
}

interface Job {
  steps?: Step[];
  [key: string]: unknown;
}

interface Workflow {
  jobs: Record<string, Job>;
}

function loadReleaseWorkflow(): Workflow {
  const path = resolve(__dirname, '../../../.github/workflows/release.yml');
  return parseYaml(readFileSync(path, 'utf-8')) as Workflow;
}

/** Collect all github-script step bodies across all jobs, with their job name. */
function collectGithubScripts(wf: Workflow): Array<{ job: string; body: string }> {
  const results: Array<{ job: string; body: string }> = [];
  for (const [jobName, job] of Object.entries(wf.jobs)) {
    for (const step of job.steps ?? []) {
      if (typeof step.uses === 'string' && step.uses.includes('actions/github-script')) {
        const script = step.with?.script;
        if (typeof script === 'string') {
          results.push({ job: jobName, body: script });
        }
      }
    }
  }
  return results;
}

/** Return all tauri-action steps, keyed by job name. */
function collectTauriActionSteps(wf: Workflow): Array<{ job: string; step: Step }> {
  const results: Array<{ job: string; step: Step }> = [];
  for (const [jobName, job] of Object.entries(wf.jobs)) {
    for (const step of job.steps ?? []) {
      if (typeof step.uses === 'string' && step.uses.includes('tauri-apps/tauri-action')) {
        results.push({ job: jobName, step });
      }
    }
  }
  return results;
}

describe('release.yml — orphan-draft regression lock (#203)', () => {
  const wf = loadReleaseWorkflow();

  describe('createRelease is called exactly once, only in create-release', () => {
    const scripts = collectGithubScripts(wf);
    const creators = scripts.filter(s => s.body.includes('createRelease'));

    it('there is exactly one createRelease call across all jobs', () => {
      expect(creators).toHaveLength(1);
    });

    it('the sole createRelease call lives in the create-release job (not build-tauri or publish-release)', () => {
      expect(creators[0]?.job).toBe('create-release');
    });
  });

  describe('publish-release does not call createRelease', () => {
    const publishJob = wf.jobs['publish-release'];

    it('publish-release job exists', () => {
      expect(publishJob).toBeDefined();
    });

    it('publish-release scripts do not contain createRelease', () => {
      const scripts = collectGithubScripts(wf).filter(s => s.job === 'publish-release');
      const hasCreate = scripts.some(s => s.body.includes('createRelease'));
      expect(hasCreate).toBe(false);
    });

    it('publish-release calls updateRelease to flip draft:false', () => {
      const scripts = collectGithubScripts(wf).filter(s => s.job === 'publish-release');
      const hasUpdate = scripts.some(s => s.body.includes('updateRelease'));
      expect(hasUpdate).toBe(true);
    });
  });

  describe('tauri-action step does not carry tagName when releaseId is provided', () => {
    const tauriSteps = collectTauriActionSteps(wf);

    it('there is exactly one tauri-action step', () => {
      expect(tauriSteps).toHaveLength(1);
    });

    it('the tauri-action step provides releaseId', () => {
      const step = tauriSteps[0]?.step;
      expect(step?.with?.releaseId).toBeDefined();
    });

    it('the tauri-action step does NOT pass tagName (tagName triggers release-creation logic that conflicts with the pre-created releaseId)', () => {
      const step = tauriSteps[0]?.step;
      // tagName must not be present when releaseId is already provided —
      // passing both causes tauri-action to attempt a second createRelease
      // call for the same tag, producing the already_exists error or orphan draft.
      expect(step?.with?.tagName).toBeUndefined();
    });

    it('the tauri-action step does NOT pass releaseName when releaseId is provided', () => {
      const step = tauriSteps[0]?.step;
      expect(step?.with?.releaseName).toBeUndefined();
    });
  });
});

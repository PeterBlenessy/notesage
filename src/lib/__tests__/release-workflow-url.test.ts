// Regression-lock for the latest.json URL fix in release.yml (#271).
//
// Root cause: tauri-action@v0 generates latest.json with
//   `releases/latest/download/...` URLs when tagName is omitted.
// For prereleases, `releases/latest` resolves to the most recent *stable*
// release — not the prerelease — so installed alpha builds "update" to a
// stale stable build, restart, see the prerelease still advertised, and loop.
//
// The existing orphan-draft regression lock (release-workflow.test.ts) prevents
// restoring tagName to tauri-action (passing tagName alongside releaseId causes
// tauri-action to attempt a second createRelease call, producing an
// already_exists error or orphan draft). So the fix is to post-process
// latest.json in the publish-release job: patch the URL before publication,
// then verify after publication.
//
// These tests assert the publish-release job contains those two steps.
// They catch drift at PR-review time rather than at production-incident time.

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

/** Return all text content of a step — either run script or github-script body. */
function stepText(step: Step): string {
  const script = step.with?.script;
  return (step.run ?? (typeof script === 'string' ? script : '')) as string;
}

describe('release.yml — latest.json URL patch (#271 — no infinite update loop)', () => {
  const wf = loadReleaseWorkflow();
  const job = wf.jobs['publish-release']!;

  const getPublishIdx = () => job.steps!.findIndex((s) => s.name === 'Publish Release');
  const preSteps = () => job.steps!.slice(0, getPublishIdx());
  const postSteps = () => job.steps!.slice(getPublishIdx() + 1);

  it('"Publish Release" step exists in the publish-release job', () => {
    expect(getPublishIdx()).toBeGreaterThanOrEqual(0);
  });

  it('publish-release has a step BEFORE "Publish Release" that patches latest.json URLs', () => {
    // The step must contain logic that handles both the wrong URL pattern
    // (releases/latest/download/) and the correct URL pattern (releases/download/)
    const patchStep = preSteps().find((s) => {
      const text = stepText(s);
      return text.includes('latest.json') && text.includes('releases/latest/download/');
    });
    expect(
      patchStep,
      'Expected a step before "Publish Release" to patch latest.json — tauri-action generates ' +
        'releases/latest/download/ URLs for prereleases, which causes the infinite update loop ' +
        'described in issue #271. Add a patch step that replaces them with releases/download/{tag}/',
    ).toBeDefined();
  });

  it('the pre-publish patch step replaces releases/latest/download/ with releases/download/{tag}/', () => {
    const patchStep = preSteps().find((s) => {
      const text = stepText(s);
      return text.includes('releases/latest/download/') && text.includes('releases/download/');
    });
    expect(
      patchStep,
      'The patch step must replace the wrong URL pattern with a tag-specific one. ' +
        'Expected both "releases/latest/download/" (the wrong pattern to find) and ' +
        '"releases/download/" (the correct pattern to substitute) in the step script.',
    ).toBeDefined();
  });

  it('publish-release has a step AFTER "Publish Release" that fails if releases/latest/download/ is in latest.json', () => {
    const verifyStep = postSteps().find((s) => {
      const text = stepText(s);
      return (
        text.includes('releases/latest/download/') &&
        (text.includes('exit 1') || text.includes('setFailed') || text.includes('::error::'))
      );
    });
    expect(
      verifyStep,
      'Expected a verification step after "Publish Release" that downloads latest.json and ' +
        'fails the workflow if it contains releases/latest/download/ URLs. ' +
        'This is the regression guard that catches the issue before users receive an update.',
    ).toBeDefined();
  });
});

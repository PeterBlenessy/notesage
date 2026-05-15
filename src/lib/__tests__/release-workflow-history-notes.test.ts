/**
 * Regression-lock tests for the history-file-based release notes feature.
 *
 * Issue #268: The release workflow must generate release notes from
 * `docs/history/*-release-v{tag}.md` instead of a `git log` commit dump.
 *
 * These tests parse `release.yml` and lock in the required shape:
 *   1. The "Generate release notes" step reads a `docs/history/` file
 *      matching the pushed tag — NOT `git log` or `git describe`.
 *   2. The step hard-fails when no matching history file is found.
 *   3. The GitHub release body (`createRelease`) is populated from the
 *      history file content, not a raw commit list.
 *   4. `tauri-action@v0`'s `releaseBody` is populated from the same
 *      history file content so `latest.json`'s `notes` field is correct.
 *   5. The extraction covers the user-facing section (between `## Changes`
 *      and `## Under the hood` / end-of-file) — no "## Under the hood"
 *      content leaks into the release body.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';

interface Step {
  name?: string;
  id?: string;
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

function getReleaseNotesStep(wf: Workflow): Step | undefined {
  return wf.jobs['create-release']?.steps?.find(
    (s) => s.id === 'release_notes' || s.name === 'Generate release notes',
  );
}

function getCreateReleaseStep(wf: Workflow): Step | undefined {
  return wf.jobs['create-release']?.steps?.find(
    (s) => s.name === 'Create Release',
  );
}

function getTauriActionStep(wf: Workflow): Step | undefined {
  return wf.jobs['build-tauri']?.steps?.find(
    (s) => typeof s.uses === 'string' && s.uses.includes('tauri-apps/tauri-action'),
  );
}

describe('release.yml — history-file release notes (#268)', () => {
  const wf = loadReleaseWorkflow();

  describe('Generate release notes step reads docs/history/', () => {
    const step = getReleaseNotesStep(wf);

    it('the Generate release notes step exists', () => {
      expect(step).toBeDefined();
    });

    it('reads a docs/history/ file matching the pushed tag', () => {
      const run = step?.run ?? '';
      expect(run).toMatch(/docs\/history/);
    });

    it('does NOT use git log to build release notes (no commit dump fallback)', () => {
      const run = step?.run ?? '';
      expect(run).not.toMatch(/git log/);
    });

    it('does NOT use git describe to find a previous tag', () => {
      const run = step?.run ?? '';
      expect(run).not.toMatch(/git describe/);
    });

    it('does NOT produce a raw "## Changes" header filled with commit lines', () => {
      const run = step?.run ?? '';
      // The old step wrote a literal "## Changes" header and then appended
      // commit messages. After the fix this header must come from the history
      // file, not be hard-coded here.
      expect(run).not.toMatch(/echo\s+["']## Changes["']/);
    });
  });

  describe('Generate release notes step fails on missing history file', () => {
    const step = getReleaseNotesStep(wf);

    it('hard-fails when no matching docs/history/*-release-v{tag}.md file is found', () => {
      const run = step?.run ?? '';
      // Must exit non-zero (exit 1) with an error message when the file is absent.
      expect(run).toMatch(/exit 1/);
    });

    it('error message references the expected file path pattern', () => {
      const run = step?.run ?? '';
      // The required error message from the acceptance criteria.
      expect(run).toMatch(/No history file found/);
    });
  });

  describe('Create Release step uses history-file content as the release body', () => {
    const createStep = getCreateReleaseStep(wf);

    it('Create Release step exists', () => {
      expect(createStep).toBeDefined();
    });

    it('the release body is sourced from the release_notes step output', () => {
      // The body must reference the release_notes step output, not be
      // constructed inline from git log output.
      const script = (createStep?.with?.script as string) ?? '';
      const env = createStep?.env as Record<string, string> | undefined;

      // Either the step uses an env var that references release_notes output,
      // or the script directly reads the step output. Check both patterns.
      const referencesReleaseNotes =
        script.includes('release_notes') ||
        script.includes('RELEASE_NOTES') ||
        JSON.stringify(env ?? {}).includes('release_notes');

      expect(referencesReleaseNotes).toBe(true);
    });
  });

  describe('tauri-action step passes release notes to releaseBody', () => {
    const tauriStep = getTauriActionStep(wf);

    it('tauri-action step exists', () => {
      expect(tauriStep).toBeDefined();
    });

    it('tauri-action step passes releaseBody from the history file content', () => {
      // releaseBody must be wired to the release_notes step output so that
      // latest.json's `notes` field contains user-facing content, not a
      // commit dump.
      const releaseBody = tauriStep?.with?.releaseBody as string | undefined;
      expect(releaseBody).toBeDefined();
      expect(String(releaseBody)).toMatch(/release_notes/);
    });
  });

  describe('Release notes extraction covers user-facing sections only', () => {
    const step = getReleaseNotesStep(wf);

    it('extraction terminates at ## Under the hood (does not leak implementation details)', () => {
      const run = step?.run ?? '';
      // The extraction must stop at "## Under the hood" so that internal
      // implementation notes do not appear in the public release body.
      expect(run).toMatch(/Under the hood/);
    });
  });
});

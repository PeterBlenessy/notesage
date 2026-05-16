/**
 * Regression-lock tests for release.yml — history-file release notes (#268).
 *
 * The release workflow must generate release notes from docs/history/ files,
 * not from a git log commit dump. This set of tests locks in the correct
 * behaviour to prevent regression.
 *
 * Key constraints:
 *   - "Generate release notes" step reads docs/history/*-release-v{tag}.md
 *   - No git log or commit-dump fallback
 *   - awk stop pattern stops ONLY at "## Under the hood" — NOT at
 *     "## Known issues" / "## Known limitations" (those are user-facing)
 *   - Hard-fails with required error message when no history file found
 *   - tauri-action step receives releaseBody from the release_notes output
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  [key: string]: unknown;
}

interface Job {
  steps?: Step[];
  outputs?: Record<string, unknown>;
  [key: string]: unknown;
}

interface Workflow {
  jobs: Record<string, Job>;
}

const RELEASE_YML_PATH = resolve(__dirname, '../../../.github/workflows/release.yml');
const RELEASE_YML = readFileSync(RELEASE_YML_PATH, 'utf-8');

function loadReleaseWorkflow(): Workflow {
  return parseYaml(RELEASE_YML) as Workflow;
}

function findStepByName(workflow: Workflow, stepName: string): Step | undefined {
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps ?? []) {
      if (step.name === stepName) return step;
    }
  }
  return undefined;
}

function findTauriActionStep(workflow: Workflow): Step | undefined {
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps ?? []) {
      if (typeof step.uses === 'string' && step.uses.includes('tauri-apps/tauri-action')) {
        return step;
      }
    }
  }
  return undefined;
}

describe('release.yml — history-file release notes (#268)', () => {
  const wf = loadReleaseWorkflow();

  describe('"Generate release notes" step reads from docs/history/, not git log', () => {
    const step = findStepByName(wf, 'Generate release notes');

    it('step exists in the workflow', () => {
      expect(step).toBeDefined();
    });

    it('does not use git log to generate release notes', () => {
      expect(step?.run).not.toMatch(/git\s+log/);
    });

    it('does not use git describe to find the previous tag', () => {
      expect(step?.run).not.toMatch(/git\s+describe/);
    });

    it('does not reference PREV_TAG (commit-dump fallback variable)', () => {
      expect(step?.run).not.toMatch(/PREV_TAG/);
    });

    it('reads from docs/history/ directory', () => {
      expect(step?.run).toMatch(/docs\/history\//);
    });

    it('matches docs/history/*-release-v{tag}.md pattern', () => {
      expect(step?.run).toMatch(/release-v/);
    });
  });

  describe('awk stop pattern stops only at "## Under the hood"', () => {
    const step = findStepByName(wf, 'Generate release notes');

    it('does NOT include "Known issues" in the awk stop pattern', () => {
      // "## Known issues" is a user-facing section that must be included
      // in the extracted release notes, not treated as a stop boundary.
      const awkStopPattern = extractAwkStopPattern(step?.run ?? '');
      expect(awkStopPattern).not.toMatch(/Known issues/);
    });

    it('does NOT include "Known limitations" in the awk stop pattern', () => {
      // "## Known limitations" is also user-facing and must be included.
      const awkStopPattern = extractAwkStopPattern(step?.run ?? '');
      expect(awkStopPattern).not.toMatch(/Known limitations/);
    });

    it('stop pattern fires on "## Under the hood"', () => {
      expect(step?.run).toMatch(/Under the hood/);
    });
  });

  describe('hard-fail when no matching history file found', () => {
    const step = findStepByName(wf, 'Generate release notes');

    it('exits with non-zero status when no history file is found', () => {
      expect(step?.run).toMatch(/exit 1/);
    });

    it('prints the required error message when no history file is found', () => {
      expect(step?.run).toMatch(/No history file found/);
      expect(step?.run).toMatch(/docs\/history\/\*-release-v/);
    });
  });

  describe('GitHub release body and latest.json notes receive history-file content', () => {
    it('create-release job exposes release_notes as a job output', () => {
      const createReleaseJob = wf.jobs['create-release'];
      expect(createReleaseJob?.outputs).toBeDefined();
      const outputs = createReleaseJob?.outputs ?? {};
      const hasReleaseNotes = Object.values(outputs).some(
        v => typeof v === 'string' && v.includes('release_notes')
      );
      expect(hasReleaseNotes).toBe(true);
    });

    it('tauri-action step passes releaseBody derived from the release_notes output', () => {
      const tauriStep = findTauriActionStep(wf);
      expect(tauriStep).toBeDefined();
      const releaseBody = tauriStep?.with?.releaseBody;
      expect(releaseBody).toBeDefined();
      expect(String(releaseBody ?? '')).toMatch(/release_notes/);
    });
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract all awk patterns that act as stop conditions in the step's run script.
 * Looks for lines matching `found && /pattern/{exit}` style patterns.
 */
function extractAwkStopPattern(runScript: string): string {
  // Match the awk command block if present
  const awkMatch = runScript.match(/awk\s+['"]([^'"]+)['"]/s);
  if (awkMatch) return awkMatch[1];

  // Also check for heredoc-style awk
  const heredocMatch = runScript.match(/awk\s+'([^']+)'/s);
  if (heredocMatch) return heredocMatch[1];

  // Return the whole script so the test can inspect it
  return runScript;
}

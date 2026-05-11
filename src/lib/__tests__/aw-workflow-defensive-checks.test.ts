// Regression-lock tests for the AW pipeline's defensive post-check pattern
// and turn-budget convention.
//
// Issue #101 — when aw-pipeline.yml's refine (or triage/slice/tdd) job's
// `claude-code-action` step exits cleanly but the agent did NOT complete its
// expected side-effects (no comment posted, labels not flipped), the job
// silently exits `success`. There is no red tile in the Actions audit trail.
//
// The fix has two parts:
//
// 1. Defensive post-check steps: after each `claude-code-action` step in
//    aw-pipeline.yml, add a bash step that queries the issue labels and
//    exits 1 with a ::error:: annotation if the expected labels are absent.
//    This produces a visible red tile and a diagnostic message.
//
// 2. Turn budget bump: raise `--max-turns` from 30 to 50 for the triage and
//    refine stages across all entry points (pipeline, sweep, standalones).
//    Slice (60) and tdd (200) are already above the threshold.
//
// These tests parse the actual YAML files so they catch any future drift at
// PR-review time rather than at production-incident time. YAML is the
// source of truth; the tests assert the convention.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';

interface StepYaml {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  id?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}

interface JobYaml {
  'runs-on'?: string;
  needs?: string | string[];
  if?: string;
  outputs?: Record<string, string>;
  concurrency?: { group: string; 'cancel-in-progress'?: boolean };
  steps?: StepYaml[];
  [key: string]: unknown;
}

interface WorkflowYaml {
  name: string;
  on?: unknown;
  jobs: Record<string, JobYaml>;
  concurrency?: { group: string; 'cancel-in-progress'?: boolean };
}

function loadWorkflow(name: string): WorkflowYaml {
  const path = resolve(__dirname, '../../../.github/workflows', `${name}.yml`);
  return parseYaml(readFileSync(path, 'utf-8')) as WorkflowYaml;
}

/** Return the index of the claude-code-action step in a job's steps array. */
function agentStepIndex(job: JobYaml): number {
  if (!job.steps) return -1;
  return job.steps.findIndex(
    (s) => typeof s.uses === 'string' && s.uses.includes('anthropics/claude-code-action'),
  );
}

/**
 * Return true iff the job has a bash step that contains `exit 1` at some
 * position AFTER the claude-code-action step. This is the defensive
 * post-check: if expected labels are missing, fail loudly.
 */
function hasVerifyStepAfterAgent(job: JobYaml): boolean {
  const idx = agentStepIndex(job);
  if (idx < 0 || !job.steps) return false;
  return job.steps
    .slice(idx + 1)
    .some((s) => typeof s.run === 'string' && s.run.includes('exit 1'));
}

/**
 * Parse `--max-turns N` from the claude_args string in a job's
 * claude-code-action step and return N, or -1 if not found.
 */
function getMaxTurns(job: JobYaml): number {
  if (!job.steps) return -1;
  for (const step of job.steps) {
    if (typeof step.uses !== 'string' || !step.uses.includes('anthropics/claude-code-action')) {
      continue;
    }
    const args = step.with?.claude_args as string | undefined;
    if (!args) return -1;
    const m = args.match(/--max-turns\s+(\d+)/);
    return m ? parseInt(m[1], 10) : -1;
  }
  return -1;
}

// ── Defensive post-check steps ──────────────────────────────────────────────

describe('AW pipeline defensive post-checks (#101)', () => {
  const pipeline = loadWorkflow('aw-pipeline');

  it('triage job has a verify step after the agent step that can exit 1', () => {
    expect(hasVerifyStepAfterAgent(pipeline.jobs.triage)).toBe(true);
  });

  it('refine job has a verify step after the agent step that can exit 1', () => {
    expect(hasVerifyStepAfterAgent(pipeline.jobs.refine)).toBe(true);
  });

  it('slice job has a verify step after the agent step that can exit 1', () => {
    expect(hasVerifyStepAfterAgent(pipeline.jobs.slice)).toBe(true);
  });

  it('tdd job has a verify step after the agent step that can exit 1', () => {
    expect(hasVerifyStepAfterAgent(pipeline.jobs.tdd)).toBe(true);
  });
});

// ── Turn budget — triage and refine must be >= 50 ───────────────────────────

describe('AW workflow turn budget (#101 — max-turns >= 50 for triage and refine)', () => {
  describe('aw-pipeline.yml', () => {
    const pipeline = loadWorkflow('aw-pipeline');

    it('triage job uses --max-turns >= 50', () => {
      expect(getMaxTurns(pipeline.jobs.triage)).toBeGreaterThanOrEqual(50);
    });

    it('refine job uses --max-turns >= 50', () => {
      expect(getMaxTurns(pipeline.jobs.refine)).toBeGreaterThanOrEqual(50);
    });
  });

  describe('aw-sweep.yml', () => {
    const sweep = loadWorkflow('aw-sweep');

    it('triage skill job uses --max-turns >= 50', () => {
      expect(getMaxTurns(sweep.jobs.triage)).toBeGreaterThanOrEqual(50);
    });

    it('refine skill job uses --max-turns >= 50', () => {
      expect(getMaxTurns(sweep.jobs.refine)).toBeGreaterThanOrEqual(50);
    });
  });

  describe('standalone aw-triage.yml', () => {
    const triage = loadWorkflow('aw-triage');
    it('uses --max-turns >= 50', () => {
      // The standalone has one job; find the one with the agent step.
      const jobWithAgent = Object.values(triage.jobs).find(
        (j) => agentStepIndex(j) >= 0,
      );
      expect(jobWithAgent).toBeDefined();
      expect(getMaxTurns(jobWithAgent!)).toBeGreaterThanOrEqual(50);
    });
  });

  describe('standalone aw-refine.yml', () => {
    const refine = loadWorkflow('aw-refine');
    it('uses --max-turns >= 50', () => {
      const jobWithAgent = Object.values(refine.jobs).find(
        (j) => agentStepIndex(j) >= 0,
      );
      expect(jobWithAgent).toBeDefined();
      expect(getMaxTurns(jobWithAgent!)).toBeGreaterThanOrEqual(50);
    });
  });
});

// ── aw-ci-repair workflow shape ───────────────────────────────────────────────

describe('aw-ci-repair.yml workflow shape', () => {
  const wf = loadWorkflow('aw-ci-repair');

  it('the ci_repair job has a step that finds the PR for the branch', () => {
    const ciRepairJob = wf.jobs.ci_repair;
    expect(ciRepairJob).toBeDefined();
    const hasFind = ciRepairJob.steps?.some(
      (s) => typeof s.run === 'string' && s.run.includes('gh pr list'),
    );
    expect(hasFind).toBe(true);
  });

  it('the ci_repair job has a PERF_BUDGET_MULTIPLIER env var', () => {
    const ciRepairJob = wf.jobs.ci_repair;
    const env = ciRepairJob.env as Record<string, string> | undefined;
    expect(env?.PERF_BUDGET_MULTIPLIER).toBeDefined();
  });
});

// ── Standalone workflows are workflow_dispatch-only ──────────────────────────

describe('Standalone workflows are workflow_dispatch-only (#101)', () => {
  const STAGES = ['triage', 'refine', 'slice', 'tdd'] as const;

  for (const stage of STAGES) {
    it(`aw-${stage}.yml has no schedule: trigger (standalones are manual-only)`, () => {
      const wf = loadWorkflow(`aw-${stage}`);
      const on = wf.on as Record<string, unknown> | null | undefined;
      // `schedule:` should not appear at all; standalones are workflow_dispatch only.
      expect(on?.schedule).toBeUndefined();
    });
  }
});

// ── Doc accuracy ─────────────────────────────────────────────────────────────

describe('docs/agentic-workflow.md accurately describes standalone trigger model (#101)', () => {
  const docPath = resolve(__dirname, '../../../docs/agentic-workflow.md');
  const doc = readFileSync(docPath, 'utf-8');

  it('glossary standalone entry does not mention issues.labeled as a standalone trigger', () => {
    // Extract the Glossary "Standalone workflow" bullet. It should say
    // workflow_dispatch-only, not "workflow_dispatch + issues.labeled".
    const match = doc.match(/\*\*Standalone workflow\*\*[^\n]*/);
    expect(match).not.toBeNull();
    const entry = match![0];
    // The entry must NOT pair workflow_dispatch with issues.labeled
    // (that was the stale description from before the sweep consolidation).
    expect(entry).not.toMatch(/workflow_dispatch.*issues\.labeled/);
  });

  it('glossary sweep entry mentions it is the auto-trigger backstop with cron and issues.labeled', () => {
    // The sweep is the auto-trigger; its glossary entry should mention this.
    const match = doc.match(/\*\*Sweep workflow\*\*[^\n]*/);
    expect(match).not.toBeNull();
    const entry = match![0];
    expect(entry).toMatch(/cron|auto-trigger|backstop/i);
  });
});

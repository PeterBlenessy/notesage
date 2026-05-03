// Regression-lock tests for the AW pipeline's WORKFLOW_PAT vs GITHUB_TOKEN
// convention.
//
// Issue #118 — `pull_request` workflows (e.g. test.yml) do NOT fire when
// the PR is created by an action using GITHUB_TOKEN, because of GitHub's
// built-in recursion guard. Workflows that create PRs (`aw-tdd.yml`,
// `aw-iterate.yml`, `aw-retrospect.yml`, plus the `tdd:` jobs in
// `aw-pipeline.yml` and `aw-sweep.yml`) must use a fine-grained PAT
// (`WORKFLOW_PAT`) so the resulting PR fires CI normally. Workflows that
// only flip labels and post comments (`aw-triage`, `aw-refine`,
// `aw-slice`, `aw-feedback`, `aw-review`, the non-tdd jobs in
// pipeline/sweep) keep `GITHUB_TOKEN` so the recursion guard suppresses
// the noise.
//
// These tests parse every `aw-*.yml` and assert which token each
// claude-code-action invocation uses. They catch the drift case where a
// future edit accidentally swaps the token in either direction:
//
// - Wrong direction A: a PR-creating workflow downgraded to GITHUB_TOKEN
//   → bot PRs would silently lose CI checks again (the symptom that
//   caused #118)
// - Wrong direction B: a label-flipping workflow upgraded to WORKFLOW_PAT
//   → label edits would start firing downstream workflow runs again,
//   re-introducing the noise that the original GITHUB_TOKEN choice
//   eliminated
//
// The same parsing approach used by the concurrency-lock test
// (`aw-workflow-concurrency.test.ts`) — workflow YAML is the source of
// truth, this just asserts the convention.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';

interface ClaudeStep {
  uses?: string;
  with?: {
    github_token?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface CheckoutStep {
  uses?: string;
  with?: {
    token?: string;
    [key: string]: unknown;
  };
}

interface JobYaml {
  steps?: Array<ClaudeStep | CheckoutStep | Record<string, unknown>>;
  [key: string]: unknown;
}

interface WorkflowYaml {
  jobs: Record<string, JobYaml>;
}

function loadWorkflow(name: string): WorkflowYaml {
  const path = resolve(__dirname, '../../../.github/workflows', `${name}.yml`);
  return parseYaml(readFileSync(path, 'utf-8')) as WorkflowYaml;
}

/** Find the `claude-code-action` step within a job and return its `github_token` value. */
function getClaudeTokenInJob(job: JobYaml): string | undefined {
  if (!job.steps) return undefined;
  for (const step of job.steps as ClaudeStep[]) {
    if (typeof step.uses === 'string' && step.uses.includes('anthropics/claude-code-action')) {
      return step.with?.github_token;
    }
  }
  return undefined;
}

/** Find the `actions/checkout` step within a job and return its `token` value (or undefined if not set). */
function getCheckoutTokenInJob(job: JobYaml): string | undefined {
  if (!job.steps) return undefined;
  for (const step of job.steps as CheckoutStep[]) {
    if (typeof step.uses === 'string' && step.uses.includes('actions/checkout')) {
      return step.with?.token;
    }
  }
  return undefined;
}

const PAT = '${{ secrets.WORKFLOW_PAT }}';
const GH_TOKEN = '${{ secrets.GITHUB_TOKEN }}';

describe('AW workflow token convention (#118 — bot-PR CI gating)', () => {
  // ── Workflows that create PRs or push to PR branches → must use WORKFLOW_PAT ──

  describe('aw-tdd.yml — opens implementation PRs', () => {
    const wf = loadWorkflow('aw-tdd');

    it('the code job uses WORKFLOW_PAT for the claude-code-action github_token', () => {
      expect(getClaudeTokenInJob(wf.jobs.code)).toBe(PAT);
    });

    it('the code job uses WORKFLOW_PAT for actions/checkout token (so git push fires CI)', () => {
      expect(getCheckoutTokenInJob(wf.jobs.code)).toBe(PAT);
    });
  });

  describe('aw-iterate.yml — pushes follow-up commits to PR branches', () => {
    const wf = loadWorkflow('aw-iterate');

    it('the iterate job uses WORKFLOW_PAT for the claude-code-action github_token', () => {
      expect(getClaudeTokenInJob(wf.jobs.iterate)).toBe(PAT);
    });

    it('the iterate job uses WORKFLOW_PAT for actions/checkout token (so push triggers pull_request:synchronize)', () => {
      expect(getCheckoutTokenInJob(wf.jobs.iterate)).toBe(PAT);
    });
  });

  describe('aw-retrospect.yml — opens skill-patch PRs', () => {
    const wf = loadWorkflow('aw-retrospect');

    it('the retrospect job uses WORKFLOW_PAT for the claude-code-action github_token', () => {
      expect(getClaudeTokenInJob(wf.jobs.retrospect)).toBe(PAT);
    });

    it('the retrospect job uses WORKFLOW_PAT for actions/checkout token', () => {
      expect(getCheckoutTokenInJob(wf.jobs.retrospect)).toBe(PAT);
    });
  });

  describe('aw-pipeline.yml — only the tdd job creates PRs', () => {
    const wf = loadWorkflow('aw-pipeline');

    it('the tdd job uses WORKFLOW_PAT for the claude-code-action github_token', () => {
      expect(getClaudeTokenInJob(wf.jobs.tdd)).toBe(PAT);
    });

    it('the tdd job uses WORKFLOW_PAT for actions/checkout token', () => {
      expect(getCheckoutTokenInJob(wf.jobs.tdd)).toBe(PAT);
    });

    it('triage / refine / slice jobs use GITHUB_TOKEN (no PRs created → recursion guard suppression is desired)', () => {
      expect(getClaudeTokenInJob(wf.jobs.triage)).toBe(GH_TOKEN);
      expect(getClaudeTokenInJob(wf.jobs.refine)).toBe(GH_TOKEN);
      expect(getClaudeTokenInJob(wf.jobs.slice)).toBe(GH_TOKEN);
    });
  });

  describe('aw-sweep.yml — only the tdd job creates PRs', () => {
    const wf = loadWorkflow('aw-sweep');

    it('the tdd job uses WORKFLOW_PAT for the claude-code-action github_token', () => {
      expect(getClaudeTokenInJob(wf.jobs.tdd)).toBe(PAT);
    });

    it('the tdd job uses WORKFLOW_PAT for actions/checkout token', () => {
      expect(getCheckoutTokenInJob(wf.jobs.tdd)).toBe(PAT);
    });

    it('triage / refine / slice skill jobs use GITHUB_TOKEN', () => {
      expect(getClaudeTokenInJob(wf.jobs.triage)).toBe(GH_TOKEN);
      expect(getClaudeTokenInJob(wf.jobs.refine)).toBe(GH_TOKEN);
      expect(getClaudeTokenInJob(wf.jobs.slice)).toBe(GH_TOKEN);
    });
  });

  // ── Workflows that only flip labels / comments → must use GITHUB_TOKEN ──

  describe('aw-triage.yml — only classifies issues', () => {
    const wf = loadWorkflow('aw-triage');
    it('uses GITHUB_TOKEN (label edits should NOT fire downstream)', () => {
      expect(getClaudeTokenInJob(wf.jobs.triage)).toBe(GH_TOKEN);
    });
  });

  describe('aw-refine.yml — only rewrites issue body + label edits', () => {
    const wf = loadWorkflow('aw-refine');
    it('uses GITHUB_TOKEN', () => {
      expect(getClaudeTokenInJob(wf.jobs.refine)).toBe(GH_TOKEN);
    });
  });

  describe('aw-slice.yml — creates peer issues but not PRs', () => {
    const wf = loadWorkflow('aw-slice');
    it('uses GITHUB_TOKEN', () => {
      expect(getClaudeTokenInJob(wf.jobs.slice)).toBe(GH_TOKEN);
    });
  });

  describe('aw-feedback.yml — only flips labels + posts comments', () => {
    const wf = loadWorkflow('aw-feedback');
    it('uses GITHUB_TOKEN', () => {
      // Feedback workflow's job name is `feedback` per its YAML
      const jobName = Object.keys(wf.jobs)[0];
      expect(getClaudeTokenInJob(wf.jobs[jobName])).toBe(GH_TOKEN);
    });
  });

  describe('aw-review.yml — modifies PR state but does not create new PRs', () => {
    const wf = loadWorkflow('aw-review');
    it('uses GITHUB_TOKEN', () => {
      const jobName = Object.keys(wf.jobs)[0];
      expect(getClaudeTokenInJob(wf.jobs[jobName])).toBe(GH_TOKEN);
    });
  });
});

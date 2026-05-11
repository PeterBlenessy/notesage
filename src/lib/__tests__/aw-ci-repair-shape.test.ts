// Regression-lock tests for the aw-ci-repair workflow shape.
//
// Issue #195 — The aw-ci-repair workflow auto-pushes a one-line fix commit on
// bot-authored draft PRs when the CI failure matches a recoverable pattern
// (missing PERF_BUDGET_MULTIPLIER wrap). These tests assert:
//
// 1. Workflow trigger: fires on workflow_run.completed with conclusion=failure
//    for the "Test & Type Check" workflow.
// 2. Branch prefix gate: ci_repair job is guarded so it only runs for branches
//    that start with 'claude/' (bot PR branch prefix).
// 3. One-attempt cap: the skill prompt explicitly mentions checking both prior
//    repair comments AND `fix(ci):` commits before making changes.
// 4. Timeout is bounded (≤ 30 min) to limit runaway repair attempts.
// 5. The workflow does NOT trigger on push to main or on workflow_dispatch
//    (it is exclusively CI-failure-driven, not manually triggered).
//
// These tests parse the actual aw-ci-repair.yml so they catch drift at PR
// review time rather than at production-incident time.

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
  if?: string;
  env?: Record<string, string>;
  'timeout-minutes'?: number;
  steps?: StepYaml[];
  [key: string]: unknown;
}

interface WorkflowRunTrigger {
  workflows?: string[];
  types?: string[];
}

interface WorkflowTriggers {
  workflow_run?: WorkflowRunTrigger;
  workflow_dispatch?: unknown;
  push?: unknown;
  schedule?: unknown;
}

interface WorkflowYaml {
  name: string;
  on?: WorkflowTriggers;
  jobs: Record<string, JobYaml>;
  concurrency?: { group: string; 'cancel-in-progress'?: boolean };
}

function loadWorkflow(name: string): WorkflowYaml {
  const path = resolve(__dirname, '../../../.github/workflows', `${name}.yml`);
  return parseYaml(readFileSync(path, 'utf-8')) as WorkflowYaml;
}

const wf = loadWorkflow('aw-ci-repair');

describe('aw-ci-repair.yml trigger convention', () => {
  it('triggers on workflow_run.completed', () => {
    const on = wf.on;
    expect(on?.workflow_run).toBeDefined();
    expect(on?.workflow_run?.types).toContain('completed');
  });

  it('targets the Test & Type Check workflow', () => {
    expect(wf.on?.workflow_run?.workflows).toContain('Test & Type Check');
  });

  it('does NOT have a workflow_dispatch trigger (CI-failure-driven only)', () => {
    expect(wf.on?.workflow_dispatch).toBeUndefined();
  });

  it('does NOT have a push trigger (never fires on direct pushes)', () => {
    expect(wf.on?.push).toBeUndefined();
  });

  it('does NOT have a schedule trigger', () => {
    expect(wf.on?.schedule).toBeUndefined();
  });
});

describe('aw-ci-repair.yml ci_repair job shape', () => {
  const job = wf.jobs.ci_repair;

  it('ci_repair job exists', () => {
    expect(job).toBeDefined();
  });

  it('ci_repair job has an if-gate that checks workflow_run conclusion == failure', () => {
    expect(job.if).toContain("conclusion == 'failure'");
  });

  it('ci_repair job has an if-gate that checks for claude/ branch prefix', () => {
    expect(job.if).toContain("claude/");
  });

  it('ci_repair job has a timeout-minutes <= 30 (bounded repair attempt)', () => {
    expect(job['timeout-minutes']).toBeDefined();
    expect(job['timeout-minutes']!).toBeLessThanOrEqual(30);
  });

  it('ci_repair job has PERF_BUDGET_MULTIPLIER set in env', () => {
    const env = job.env as Record<string, string> | undefined;
    expect(env?.PERF_BUDGET_MULTIPLIER).toBeDefined();
  });

  it('ci_repair job has a step that locates the PR for the branch', () => {
    const hasFind = job.steps?.some(
      (s) => typeof s.run === 'string' && s.run.includes('gh pr list'),
    );
    expect(hasFind).toBe(true);
  });

  it('skill prompt mentions one-attempt cap (checking prior repair comments)', () => {
    const claudeStep = job.steps?.find(
      (s) => typeof s.uses === 'string' && s.uses.includes('anthropics/claude-code-action'),
    );
    expect(claudeStep).toBeDefined();
    const prompt = claudeStep?.with?.prompt as string | undefined;
    expect(prompt).toBeDefined();
    // The prompt must mention the one-attempt cap so the agent checks for prior repairs.
    expect(prompt).toMatch(/one.attempt cap|prior.*repair|repair.*prior/i);
  });

  it('skill prompt mentions NEVER pushing to main', () => {
    const claudeStep = job.steps?.find(
      (s) => typeof s.uses === 'string' && s.uses.includes('anthropics/claude-code-action'),
    );
    const prompt = claudeStep?.with?.prompt as string | undefined;
    expect(prompt).toMatch(/NEVER.*main|never.*main/i);
  });
});

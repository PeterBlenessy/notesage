// Regression-lock tests for the aw-ci-repair skill + workflow.
//
// Issue #195 — aw-ci-repair is a narrow CI auto-repair skill that detects
// recurring perf-budget flake patterns on bot-authored draft PRs and applies
// one-line fixes. These tests assert the specific properties that make it
// safe:
//
// 1. The workflow triggers on `workflow_run.completed` AND `workflow_dispatch`
// 2. The workflow's if-clause gates on failure + claude/* branch prefix
// 3. SKILL.md documents a one-attempt cap (no infinite repair loops)
// 4. Patterns A and B are documented as auto-fixable; C, D, E comment-only
//
// Mirrors the shape of `aw-workflow-defensive-checks.test.ts`.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';

const ROOT = resolve(__dirname, '../../..');

function loadWorkflow(name: string): Record<string, unknown> {
  const path = resolve(ROOT, '.github/workflows', `${name}.yml`);
  return parseYaml(readFileSync(path, 'utf-8')) as Record<string, unknown>;
}

function loadSkill(name: string): string {
  const path = resolve(ROOT, `.claude/skills/${name}/SKILL.md`);
  return readFileSync(path, 'utf-8');
}

// ── Workflow trigger shape ───────────────────────────────────────────────────

describe('aw-ci-repair.yml — trigger shape', () => {
  const wf = loadWorkflow('aw-ci-repair');
  const on = wf.on as Record<string, unknown>;

  it('has a workflow_run trigger', () => {
    expect(on.workflow_run).toBeDefined();
  });

  it('workflow_run triggers on "completed" type', () => {
    const wr = on.workflow_run as Record<string, unknown>;
    const types = wr.types as string[];
    expect(types).toContain('completed');
  });

  it('has a workflow_dispatch trigger (manual entry point)', () => {
    expect(on.workflow_dispatch).toBeDefined();
  });

  it('workflow_dispatch accepts pr_number input', () => {
    const wd = on.workflow_dispatch as Record<string, unknown> | undefined;
    const inputs = (wd?.inputs ?? {}) as Record<string, unknown>;
    expect(inputs.pr_number).toBeDefined();
  });
});

// ── Job-level safety gate: only fires on failure + claude/* branch ───────────

describe('aw-ci-repair.yml — job if-clause guards', () => {
  const wf = loadWorkflow('aw-ci-repair');
  const jobs = wf.jobs as Record<string, Record<string, unknown>>;
  const jobNames = Object.keys(jobs);

  it('has at least one job', () => {
    expect(jobNames.length).toBeGreaterThan(0);
  });

  for (const jobName of jobNames) {
    const job = jobs[jobName];

    it(`${jobName} job if-clause checks conclusion == 'failure'`, () => {
      const ifClause = job.if as string | undefined;
      expect(ifClause).toBeDefined();
      expect(ifClause).toMatch(/failure/);
    });

    it(`${jobName} job if-clause restricts to claude/ branch prefix`, () => {
      const ifClause = job.if as string | undefined;
      expect(ifClause).toBeDefined();
      // Must contain either "claude/" or "startsWith" guard
      expect(ifClause).toMatch(/claude\//);
    });
  }
});

// ── SKILL.md — one-attempt cap ───────────────────────────────────────────────

describe('aw-ci-repair SKILL.md — one-attempt cap', () => {
  const skill = loadSkill('aw-ci-repair');

  it('SKILL.md exists', () => {
    expect(skill.length).toBeGreaterThan(0);
  });

  it('documents a one-attempt cap (no infinite repair loops)', () => {
    // Look for language expressing the one-attempt-per-PR constraint
    const hasOnce =
      /one.{0,20}attempt|one.{0,20}repair|≤1.{0,20}repair|prior.{0,20}repair/i.test(skill);
    expect(hasOnce).toBe(true);
  });

  it('checks for prior repair commits before acting', () => {
    const hasPriorCommitCheck = /fix\(ci\)|repair.{0,30}commit|commit.{0,30}repair/i.test(skill);
    expect(hasPriorCommitCheck).toBe(true);
  });
});

// ── SKILL.md — pattern coverage ─────────────────────────────────────────────

describe('aw-ci-repair SKILL.md — pattern A–E coverage', () => {
  const skill = loadSkill('aw-ci-repair');

  it('documents Pattern A (missing PERF_BUDGET_MULTIPLIER wrap)', () => {
    expect(skill).toMatch(/[Pp]attern.{0,5}A/);
    expect(skill).toMatch(/PERF_BUDGET_MULTIPLIER/);
  });

  it('documents Pattern B (missing env var in workflow yml)', () => {
    expect(skill).toMatch(/[Pp]attern.{0,5}B/);
  });

  it('documents Pattern C (snapshot drift) as comment-only', () => {
    expect(skill).toMatch(/[Pp]attern.{0,5}C/);
    expect(skill).toMatch(/snapshot/i);
  });

  it('documents Pattern D (DOM-changed assertion) as comment-only', () => {
    expect(skill).toMatch(/[Pp]attern.{0,5}D/);
    expect(skill).toMatch(/DOM|dom-changed/i);
  });

  it('documents Pattern E (catch-all) as comment-only', () => {
    expect(skill).toMatch(/[Pp]attern.{0,5}E/);
  });

  it('A and B are auto-fixable; C, D, E are comment-only', () => {
    // The skill must say patterns C/D/E only post a comment, not fix files
    const commentOnly = /C.{0,50}comment.{0,50}only|comment.{0,20}only.{0,50}C/is.test(skill);
    expect(commentOnly).toBe(true);
  });
});

// ── SKILL.md — hard gates ────────────────────────────────────────────────────

describe('aw-ci-repair SKILL.md — hard gates', () => {
  const skill = loadSkill('aw-ci-repair');

  it('requires typecheck to pass before commit', () => {
    expect(skill).toMatch(/typecheck/i);
  });

  it('limits files modified per repair (≤2)', () => {
    expect(skill).toMatch(/≤2|at most 2|two file/i);
  });

  it('prohibits force-push', () => {
    expect(skill).toMatch(/force.{0,10}push|--force/i);
  });
});

// Regression-lock tests for the AW pipeline's shared-concurrency convention.
//
// Issue #98 — when the pipeline, sweep, and standalone workflows for the
// same stage all use DIFFERENT concurrency groups (e.g. `aw-pipeline-{n}`
// vs `aw-slice-{n}` vs `aw-sweep-{run_id}`), GitHub treats them as
// independent queues and lets parallel runs of the same stage on the same
// issue both spawn agents. Three previous incidents (PRs #92/#93 from
// issue #88, the duplicate slice comments on issue #97, the duplicate
// aw-tdd runs on issue #98 itself) all trace back to that gap.
//
// The fix: every stage workflow shares a single concurrency-group key
// pattern `aw-stage-{stage}-{issue_or_run_id}`. Pipeline puts the group
// at the JOB level (workflow-level wouldn't apply per-stage); sweep splits
// each stage into a `find_<stage>` job whose output is the candidate
// issue number, then a `<stage>` skill job that uses the candidate in its
// concurrency expression; standalones use the group at the workflow level
// since they're single-stage workflows.
//
// These tests parse the actual YAML files and assert the convention. They
// catch any future workflow edit that drifts off the shared key (e.g. a
// rename to `aw-pipeline-{n}`, or a new workflow file forgetting to
// include the stage in its group key, or someone removing the `find_<stage>`
// job from the sweep).
//
// Why parse the YAML rather than test runtime behavior: GitHub Actions
// concurrency is enforced server-side by GitHub itself. There's no library
// to mock and no local way to run a real concurrency race. Parsing the YAML
// for the textual convention is the most reliable lock that catches drift
// at PR-review time, not at production-incident time.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';

interface WorkflowYaml {
  name: string;
  on?: unknown;
  jobs: Record<string, JobYaml>;
  concurrency?: ConcurrencyYaml;
}

interface JobYaml {
  'runs-on'?: string;
  needs?: string | string[];
  if?: string;
  outputs?: Record<string, string>;
  concurrency?: ConcurrencyYaml;
  steps?: unknown[];
}

interface ConcurrencyYaml {
  group: string;
  'cancel-in-progress'?: boolean;
}

function loadWorkflow(name: string): WorkflowYaml {
  const path = resolve(__dirname, '../../../.github/workflows', `${name}.yml`);
  return parseYaml(readFileSync(path, 'utf-8')) as WorkflowYaml;
}

const STAGES = ['triage', 'refine', 'slice', 'tdd'] as const;
type Stage = (typeof STAGES)[number];

describe('AW workflow concurrency convention (#98)', () => {
  describe('Standalone workflows — workflow-level concurrency on shared key', () => {
    for (const stage of STAGES) {
      describe(`aw-${stage}.yml`, () => {
        const wf = loadWorkflow(`aw-${stage}`);

        it('has workflow-level concurrency block', () => {
          expect(wf.concurrency).toBeDefined();
        });

        it(`uses the shared key pattern aw-stage-${stage}-{...}`, () => {
          expect(wf.concurrency!.group).toMatch(
            new RegExp(`^aw-stage-${stage}-`),
          );
        });

        it('uses cancel-in-progress: false (queue, do not kill in-flight work)', () => {
          expect(wf.concurrency!['cancel-in-progress']).toBe(false);
        });

        it('falls back to github.run_id when no issue number is available', () => {
          // Standalones can be invoked via workflow_dispatch with optional
          // issue_number input. The group expression must NEVER evaluate
          // to a malformed key like `aw-stage-tdd-` (trailing dash) when
          // the input is empty — fall back to run_id so empty-input runs
          // get isolated groups.
          expect(wf.concurrency!.group).toContain('github.run_id');
        });
      });
    }
  });

  describe('Pipeline workflow — per-job concurrency on shared keys', () => {
    const pipeline = loadWorkflow('aw-pipeline');

    it('has NO workflow-level concurrency (per-job groups instead)', () => {
      // Workflow-level concurrency would only block the SAME workflow file
      // from running twice on one issue — it would NOT prevent the
      // pipeline's slice job from racing with a sweep slice job. Per-job
      // groups, sharing keys with the sweep + standalone, do.
      expect(pipeline.concurrency).toBeUndefined();
    });

    for (const stage of STAGES) {
      describe(`${stage} job`, () => {
        it('exists in the pipeline', () => {
          expect(pipeline.jobs[stage]).toBeDefined();
        });

        it(`has job-level concurrency on aw-stage-${stage}-{issue}`, () => {
          const job = pipeline.jobs[stage];
          expect(job.concurrency).toBeDefined();
          expect(job.concurrency!.group).toBe(
            `aw-stage-${stage}-\${{ github.event.issue.number }}`,
          );
        });

        it('uses cancel-in-progress: false', () => {
          expect(pipeline.jobs[stage].concurrency!['cancel-in-progress']).toBe(false);
        });
      });
    }
  });

  describe('Sweep workflow — find/skill split + per-skill concurrency', () => {
    const sweep = loadWorkflow('aw-sweep');

    // Issue #103 — when `gh issue edit --add-label tdd --remove-label slice`
    // fires, GitHub emits TWO events (labeled + unlabeled) which can trigger
    // two concurrent sweep runs. A workflow-level concurrency block scoped to
    // the issue number collapses those two events into a single run.
    // `cancel-in-progress: true` ensures the second event (which delivers no
    // new information) cancels instead of racing the first.
    // The `github.run_id` fallback preserves isolation for cron ticks
    // (where `github.event.issue.number` is empty).
    it('has workflow-level concurrency block to prevent duplicate issue-event runs', () => {
      expect(sweep.concurrency).toBeDefined();
    });

    it('uses issue-scoped group with run_id fallback for cron isolation', () => {
      expect(sweep.concurrency!.group).toBe(
        "aw-sweep-${{ github.event.issue.number || github.run_id }}",
      );
    });

    it('uses cancel-in-progress: true to collapse duplicate labeled/unlabeled events', () => {
      expect(sweep.concurrency!['cancel-in-progress']).toBe(true);
    });

    for (const stage of STAGES) {
      describe(`${stage} stage`, () => {
        const findJob = `find_${stage}` as Stage extends 'triage'
          ? 'find_triage'
          : string;

        it(`has a find_${stage} precheck job that outputs candidate`, () => {
          const job = sweep.jobs[findJob];
          expect(job).toBeDefined();
          expect(job.outputs).toBeDefined();
          expect(job.outputs!.candidate).toBe(
            '${{ steps.find.outputs.candidate }}',
          );
        });

        it(`has a ${stage} skill job that needs find_${stage}`, () => {
          const job = sweep.jobs[stage];
          expect(job).toBeDefined();
          expect(job.needs).toBe(findJob);
        });

        it(`gates the ${stage} skill job on candidate being non-empty`, () => {
          const job = sweep.jobs[stage];
          expect(job.if).toBe(
            `needs.${findJob}.outputs.candidate != ''`,
          );
        });

        it(`uses aw-stage-${stage}-{candidate} as the skill job's concurrency group`, () => {
          const job = sweep.jobs[stage];
          expect(job.concurrency).toBeDefined();
          // The exact expression: candidate from the find job, with run_id
          // fallback so an empty-candidate run still gets a unique group.
          expect(job.concurrency!.group).toBe(
            `aw-stage-${stage}-\${{ needs.${findJob}.outputs.candidate || github.run_id }}`,
          );
        });

        it('uses cancel-in-progress: false', () => {
          expect(sweep.jobs[stage].concurrency!['cancel-in-progress']).toBe(false);
        });
      });
    }
  });

  describe('aw-ci-repair.yml — concurrency convention', () => {
    // aw-ci-repair is not a pipeline stage, so it does not appear in pipeline/sweep.
    // It is a standalone workflow with its own `aw-stage-ci-repair-{branch}` group.
    const ciRepair = loadWorkflow('aw-ci-repair');

    it('has workflow-level concurrency block', () => {
      expect(ciRepair.concurrency).toBeDefined();
    });

    it('uses the aw-stage-ci-repair- key prefix', () => {
      expect(ciRepair.concurrency!.group).toMatch(/^aw-stage-ci-repair-/);
    });

    it('uses cancel-in-progress: false (queue, do not kill in-flight repairs)', () => {
      expect(ciRepair.concurrency!['cancel-in-progress']).toBe(false);
    });

    it('falls back to github.run_id when no branch is available', () => {
      expect(ciRepair.concurrency!.group).toContain('github.run_id');
    });
  });

  describe('Cross-workflow consistency — same stage uses the same key prefix everywhere', () => {
    // The whole point of the convention: pipeline.slice + sweep.slice +
    // standalone slice all need a key starting with `aw-stage-slice-` so
    // GitHub treats them as one queue. This test enumerates all stage
    // workflows and asserts the prefix matches.
    for (const stage of STAGES) {
      it(`every aw-stage-${stage}-... appears in pipeline + sweep + standalone`, () => {
        const pipeline = loadWorkflow('aw-pipeline');
        const sweep = loadWorkflow('aw-sweep');
        const standalone = loadWorkflow(`aw-${stage}`);

        const pipelineGroup = pipeline.jobs[stage].concurrency!.group;
        const sweepGroup = sweep.jobs[stage].concurrency!.group;
        const standaloneGroup = standalone.concurrency!.group;

        const prefix = `aw-stage-${stage}-`;
        expect(pipelineGroup.startsWith(prefix)).toBe(true);
        expect(sweepGroup.startsWith(prefix)).toBe(true);
        expect(standaloneGroup.startsWith(prefix)).toBe(true);
      });
    }
  });
});

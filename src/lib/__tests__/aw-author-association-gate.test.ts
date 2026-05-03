// Regression-lock tests for the AW author-association gate.
//
// The gate exists because this is a public repo with `issues.opened`
// triggers wired into a bot pipeline that opens PRs and (post-#118)
// can modify .github/workflows/*.yml via WORKFLOW_PAT. A crafted
// external issue could ride the pipeline and produce a malicious draft
// PR. The gate stops untrusted issues at the entry point.
//
// Three layers asserted by these tests:
//
// 1. `aw-mark-external.yml` exists and labels non-trusted issues with
//    `external` (no LLM cost). Trusted authors (OWNER / COLLABORATOR /
//    MEMBER) bypass the gate.
// 2. `aw-pipeline.yml`'s triage job carries an `if:` clause that lets
//    through trusted authors OR explicitly-approved issues. Cascades to
//    all downstream stages via `needs:`.
// 3. Each `find_<stage>` precheck in `aw-sweep.yml` filters out
//    `external` issues unless they also carry `aw-approved`.
//
// If any of these protections regress, untrusted external issues would
// silently flow through the pipeline. These tests catch that drift at
// PR-review time, not at production-incident time.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';

interface JobYaml {
  if?: string;
  steps?: Array<{ run?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

interface WorkflowYaml {
  name?: string;
  on?: unknown;
  jobs: Record<string, JobYaml>;
}

function loadWorkflow(name: string): WorkflowYaml {
  const path = resolve(__dirname, '../../../.github/workflows', `${name}.yml`);
  return parseYaml(readFileSync(path, 'utf-8')) as WorkflowYaml;
}

function workflowExists(name: string): boolean {
  const path = resolve(__dirname, '../../../.github/workflows', `${name}.yml`);
  return existsSync(path);
}

const TRUSTED_ASSOCIATIONS = ['OWNER', 'COLLABORATOR', 'MEMBER'];

describe('AW author-association gate', () => {
  describe('aw-mark-external.yml — labels non-trusted authors', () => {
    it('exists', () => {
      expect(workflowExists('aw-mark-external')).toBe(true);
    });

    const wf = workflowExists('aw-mark-external') ? loadWorkflow('aw-mark-external') : null;

    it('triggers on issues.opened', () => {
      // The `on:` block needs to fire when issues are first opened.
      // Note: yaml.parse returns boolean `true` for the YAML `on` key
      // (it's a YAML 1.1 truthy value), so we need to access via 'on'
      // string OR true depending on the parser.
      const onBlock = (wf!.on ?? (wf as unknown as { true: unknown }).true) as
        | { issues?: { types?: string[] } }
        | undefined;
      expect(onBlock?.issues?.types).toContain('opened');
    });

    it('skips trusted authors via if: condition (mark job runs only for non-trusted)', () => {
      const ifClause = wf!.jobs.mark?.if ?? '';
      // The if: clause must require author_association NOT in the trusted set.
      // We verify by checking that each trusted association is referenced
      // with a `!=` comparison.
      for (const assoc of TRUSTED_ASSOCIATIONS) {
        expect(ifClause).toContain(`author_association != '${assoc}'`);
      }
    });

    it('only requires `issues: write` permission (no checkout, no LLM)', () => {
      const perms = (wf as unknown as { permissions?: Record<string, string> })
        .permissions;
      expect(perms?.issues).toBe('write');
      // Should NOT need contents:write (no code edits) or any LLM-related auth
      expect(perms?.contents).toBeUndefined();
    });

    it('does not invoke claude-code-action (zero LLM cost per fired event)', () => {
      const stepsRun = JSON.stringify(wf!.jobs.mark?.steps ?? []);
      expect(stepsRun).not.toContain('claude-code-action');
    });
  });

  describe('aw-pipeline.yml — triage job has author-association gate', () => {
    const wf = loadWorkflow('aw-pipeline');

    it('triage job has an if: clause', () => {
      expect(wf.jobs.triage?.if).toBeDefined();
    });

    it('triage if: lets through trusted authors (OWNER / COLLABORATOR / MEMBER)', () => {
      const ifClause = wf.jobs.triage?.if ?? '';
      for (const assoc of TRUSTED_ASSOCIATIONS) {
        expect(ifClause).toContain(`author_association == '${assoc}'`);
      }
    });

    it('triage if: lets through explicitly-approved issues (aw-approved label)', () => {
      const ifClause = wf.jobs.triage?.if ?? '';
      expect(ifClause).toContain("'aw-approved'");
    });

    it('downstream jobs (refine / slice / tdd) cascade via needs: from triage', () => {
      // Cascade is what makes the single triage gate cover all stages.
      expect(wf.jobs.refine?.needs).toBe('triage');
      expect(wf.jobs.slice?.needs).toBe('refine');
      expect(wf.jobs.tdd?.needs).toBe('slice');
    });
  });

  describe('aw-sweep.yml — every find_<stage> precheck filters external issues', () => {
    const wf = loadWorkflow('aw-sweep');

    const STAGES = ['triage', 'refine', 'slice', 'tdd'] as const;

    for (const stage of STAGES) {
      it(`find_${stage} precheck excludes external+unapproved issues`, () => {
        const findJob = wf.jobs[`find_${stage}`];
        expect(findJob).toBeDefined();

        // Find the precheck step's `run:` block and grep for the JQ
        // condition that filters external/aw-approved.
        const steps = findJob.steps ?? [];
        const precheckStep = steps.find(
          (s) => typeof s.run === 'string' && s.run.includes('gh issue list'),
        );
        expect(precheckStep).toBeDefined();

        const runScript = precheckStep!.run as string;
        // The JQ expression must reference both labels for the gate to work.
        expect(runScript).toContain('"external"');
        expect(runScript).toContain('"aw-approved"');
      });
    }
  });
});

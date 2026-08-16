// Regression-lock for the `chore(deps):` fast-path in aw-tier-prep.yml
// (named aw-alpha-prep.yml until 2026-08-15 — it classifies PR TIERS and
// never had anything to do with alphas).
//
// Background: dep-bump PRs that touch load-bearing paths (`/index/`,
// `/watcher.rs`, etc.) were classified Tier C even when the diff was a
// mechanical 15-line shim against an upstream changelog. Tier C requires
// human review, which for non-coding repo owners is the wrong reviewer.
//
// The fix: a `chore(deps):` fast-path that overrides the load-bearing
// check when the prod diff is small. Rationale captured in
// `feedback_aw_dep_upgrades.md`. The fast-path triggers when ALL hold:
//   - PR title starts with `chore(deps):`
//   - Originating issue has neither `hitl` nor `visual` label
//   - prod_additions < 50
//   - prod_count    ≤ 3
//
// These tests assert the rule is encoded correctly in the classifier
// script. They catch drift if someone:
//   - widens the prod-line ceiling without thinking (e.g. raises 50 → 200)
//   - drops the hitl/visual check (would let any `chore(deps):` PR through)
//   - reorders the steps so load-bearing C wins over deps A
//   - removes the title check (would let unrelated small PRs slip through)
//
// We parse the YAML and read the bash body of the `Classify PR` step.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';

const WORKFLOW_PATH = resolve(__dirname, '../../../.github/workflows/aw-tier-prep.yml');
const YAML_TEXT = readFileSync(WORKFLOW_PATH, 'utf-8');

interface Step {
  name?: string;
  run?: string;
}
interface Job {
  steps?: Step[];
}
interface Workflow {
  jobs: Record<string, Job>;
}

function classifyStepBody(): string {
  const wf = parseYaml(YAML_TEXT) as Workflow;
  const job = wf.jobs?.classify;
  expect(job, 'classify job must exist').toBeDefined();
  const step = (job?.steps ?? []).find((s) => s.name === 'Classify PR into Tier A / B / C');
  expect(step, '"Classify PR into Tier A / B / C" step must exist').toBeDefined();
  return step?.run ?? '';
}

describe('aw-tier-prep — chore(deps) fast-path', () => {
  const body = classifyStepBody();

  it('reads PR title into a pr_title variable', () => {
    // The classifier must request `title` in the `gh pr view --json` call
    // and assign it to `pr_title`. Without this, the title regex below
    // can't fire.
    expect(body).toMatch(/--json[^']*title[,)]?[^']*\)/);
    expect(body).toMatch(/pr_title=\$\(echo "\$pr_json" \| jq -r '\.title'\)/);
  });

  it('matches chore(deps): prefix via bash regex on pr_title', () => {
    // The regex is the trigger: PRs whose title starts with `chore(deps):`
    // (and only those) enter the fast-path. Match must use bash `=~` so
    // it survives across runner shells.
    expect(body).toMatch(/"\$pr_title"\s*=~\s*\^chore\\\(deps\\\):/);
  });

  it('enforces prod_additions < 50 ceiling', () => {
    // Above 50 lines, deps PRs go through the regular Tier B / C path.
    // The number 50 is the documented "small mechanical shim" threshold.
    expect(body).toMatch(/\$prod_additions\s+-lt\s+50\b/);
  });

  it('enforces prod_count ≤ 3 ceiling', () => {
    // Cargo.lock + Cargo.toml + one source shim = 3 files. Anything more
    // is a multi-file refactor disguised as a dep bump.
    expect(body).toMatch(/\$prod_count\s+-le\s+3\b/);
  });

  it('runs the fast-path AFTER the hitl/visual check', () => {
    // The fast-path body conditions on `$tier != "C"`, so a prior hitl/
    // visual flag still wins. Confirm the literal guard exists in the
    // deps block (the test-only fast-path uses the same guard).
    const depsBlockMatch = body.match(/# ----- Dependency-bump fast-path -----[\s\S]*?fi/);
    expect(depsBlockMatch, 'deps fast-path block must exist').not.toBeNull();
    expect(depsBlockMatch?.[0] ?? '').toMatch(/\$tier"?\s*!=\s*"C"/);
  });

  it('runs the fast-path BEFORE the load-bearing check', () => {
    // Ordering matters: if load-bearing C ran first, a chore(deps):
    // touching /index/ would already be tagged C before we got here.
    const depsIdx = body.indexOf('# ----- Dependency-bump fast-path -----');
    const loadBearingIdx = body.indexOf('# ----- Tier C: load-bearing files touched -----');
    expect(depsIdx, 'deps fast-path comment must exist').toBeGreaterThan(-1);
    expect(loadBearingIdx, 'load-bearing comment must exist').toBeGreaterThan(-1);
    expect(depsIdx).toBeLessThan(loadBearingIdx);
  });

  it('exits with tier:A label on a fast-path hit', () => {
    const depsBlockMatch = body.match(/# ----- Dependency-bump fast-path -----[\s\S]*?exit 0/);
    expect(depsBlockMatch, 'deps fast-path must end with exit 0').not.toBeNull();
    expect(depsBlockMatch?.[0] ?? '').toMatch(/label="tier:A"/);
    expect(depsBlockMatch?.[0] ?? '').toMatch(/gh pr edit "\$PR_NUMBER" --add-label "\$label"/);
  });
});

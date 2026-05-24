// Regression-lock for issue #351 — aw-alpha-cut preflight silently skips
// human-merged PRs without tier labels.
//
// Background: when a human merges a PR to main without applying a tier label,
// the preflight's step 2 searches for `label:tier:A,tier:B` PRs and finds
// zero — reporting "nothing to ship" even though a real PR landed. The
// workflow exits cleanly with `should_cut=false`, making it look like no
// work was done.
//
// The fix: before (or alongside) the tier:A/B check, query for merged PRs
// that carry NONE of the three tier labels. If any are found, refuse to cut
// and write a listing of those PRs (number + title) to the Actions step
// summary so the human knows exactly what to tier.
//
// These tests parse the actual workflow YAML to lock in the new logic.
// They catch any future drift where someone re-silences the unclassified-PR
// detection.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';

interface StepYaml {
  name?: string;
  id?: string;
  run?: string;
  env?: Record<string, string>;
  [key: string]: unknown;
}

interface JobYaml {
  steps?: StepYaml[];
  [key: string]: unknown;
}

interface WorkflowYaml {
  name: string;
  jobs: Record<string, JobYaml>;
}

const WORKFLOW_PATH = resolve(
  __dirname,
  '../../../.github/workflows/aw-alpha-cut.yml',
);
const YAML_TEXT = readFileSync(WORKFLOW_PATH, 'utf-8');

function checkStepBody(): string {
  const wf = parseYaml(YAML_TEXT) as WorkflowYaml;
  const job = wf.jobs?.preflight;
  expect(job, 'preflight job must exist').toBeDefined();
  const step = (job?.steps ?? []).find(
    (s) => s.id === 'check' || s.name === 'Determine whether to cut a new alpha',
  );
  expect(step, 'check step must exist in preflight job').toBeDefined();
  return step?.run ?? '';
}

describe('aw-alpha-cut preflight — unclassified PR detection (#351)', () => {
  const body = checkStepBody();

  it('queries for merged PRs with no tier label', () => {
    // The preflight must issue a gh pr list call that excludes tier:A, tier:B,
    // and tier:C — so that PRs merged without any tier label are surfaced.
    // The GitHub search syntax for exclusion is `-label:tier:A`.
    expect(body).toMatch(/-label:tier:A/);
    expect(body).toMatch(/-label:tier:B/);
    expect(body).toMatch(/-label:tier:C/);
  });

  it('requests number and title for unclassified PRs', () => {
    // The query for unclassified PRs must request both number and title fields
    // so they can be listed in the summary.
    const unclassifiedBlock = extractUnclassifiedBlock(body);
    expect(unclassifiedBlock).toMatch(/number/);
    expect(unclassifiedBlock).toMatch(/title/);
  });

  it('sets should_cut=false when unclassified PRs are found', () => {
    // The guard must emit should_cut=false into $GITHUB_OUTPUT before exiting.
    // Extract the block that runs when unclassified PRs are detected.
    const unclassifiedBlock = extractUnclassifiedBlock(body);
    expect(unclassifiedBlock).toMatch(/should_cut=false/);
  });

  it('writes the unclassified PR listing to GITHUB_STEP_SUMMARY', () => {
    // The human must be able to see which PRs need tiering. Writing to
    // $GITHUB_STEP_SUMMARY surfaces the listing in the workflow run UI.
    const unclassifiedBlock = extractUnclassifiedBlock(body);
    expect(unclassifiedBlock).toMatch(/GITHUB_STEP_SUMMARY/);
  });

  it('unclassified PR check runs before the no-Tier-A/B early exit', () => {
    // If the unclassified check ran AFTER the "no tier:A/B PRs" check, a
    // workflow with only unclassified PRs (no tier:A/B PRs at all) would
    // exit with "nothing to ship" before ever reaching the unclassified
    // guard — silently swallowing the unclassified work.
    const unclassifiedIdx = body.indexOf('-label:tier:A');
    const nothingToShipIdx = body.indexOf('nothing to ship');
    expect(unclassifiedIdx, 'unclassified PR query must appear in check body').toBeGreaterThan(-1);
    expect(nothingToShipIdx, '"nothing to ship" text must appear in check body').toBeGreaterThan(-1);
    expect(unclassifiedIdx).toBeLessThan(nothingToShipIdx);
  });

  it('exits without cutting when unclassified PRs exist', () => {
    // When unclassified PRs are found the step must not continue to set
    // should_cut=true — it must exit before reaching step 5 (compute version).
    // The exit 0 after the unclassified check is the gate.
    const unclassifiedBlock = extractUnclassifiedBlock(body);
    expect(unclassifiedBlock).toMatch(/exit 0/);
  });
});

// ── helper ──────────────────────────────────────────────────────────────────

/**
 * Extract the bash block that handles the case where unclassified PRs are
 * found. We look for the if-block that fires on a non-empty unclassified_prs
 * variable, which must appear BEFORE the "nothing to ship" comment.
 */
function extractUnclassifiedBlock(body: string): string {
  // Match the `if [[ -n "$unclassified..." ]]` block up to its closing `fi`.
  // We use `\nfi\b` (newline + fi + word-boundary) so we don't stop at `fi`
  // as a substring inside words like "Unclassified" or "refined".
  const match = body.match(
    /if\s*\[\[\s*-n\s*"\$unclassified[^"]*"\s*\]\][\s\S]*?\nfi\b/,
  );
  if (!match) return '';
  return match[0];
}

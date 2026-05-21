// Regression-lock tests for the GitHub Actions Node 24 migration.
//
// Issue #233 — GitHub will force Node 24 as the default runner on 2026-06-02
// and remove Node 20 entirely on 2026-09-16. Workflow files that pin actions
// using Node 20 emit deprecation annotations on every CI run today and will
// hard-break on the removal date.
//
// Verified bumps:
//   pnpm/action-setup: v4 (Node 20) → v5 (Node 24)
//   actions/checkout:  v4 (Node 20) → v6 (Node 24)  — standardise everywhere
//
// These tests parse the YAML directly (same strategy as aw-workflow-pat.test.ts
// and aw-workflow-concurrency.test.ts) so failures surface at PR-review time
// rather than when GitHub enables the forced migration.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';

const WORKFLOWS_DIR = resolve(__dirname, '../../../.github/workflows');

function allWorkflowNames(): string[] {
  return readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.yml'))
    .map((f) => f.replace(/\.yml$/, ''));
}

function loadWorkflowText(name: string): string {
  return readFileSync(resolve(WORKFLOWS_DIR, `${name}.yml`), 'utf-8');
}

// ---------------------------------------------------------------------------
// Helpers — extract all `uses:` values from a workflow file's raw text so we
// don't miss anything hidden in multi-line anchors or unusual YAML shapes.
// ---------------------------------------------------------------------------

function extractUsesValues(yaml: string): string[] {
  const results: string[] = [];
  // Match both forms that appear in GitHub Actions YAML:
  //   map-entry form:   "        uses: actions/checkout@v6"
  //   array-step form:  "      - uses: actions/checkout@v6"
  // The optional `(?:-\s+)?` handles the leading dash in step arrays.
  for (const line of yaml.split('\n')) {
    const m = line.match(/^\s*(?:-\s+)?uses:\s+([^\s#]+)/);
    if (m) results.push(m[1]);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Test 1: No actions/checkout@v4 — standardise on @v6 everywhere
// ---------------------------------------------------------------------------

describe('GitHub Actions Node 24 migration — actions/checkout (#233)', () => {
  it('no workflow file uses actions/checkout@v4 (must be @v6)', () => {
    const violations: string[] = [];
    for (const name of allWorkflowNames()) {
      const text = loadWorkflowText(name);
      if (extractUsesValues(text).some((u) => u === 'actions/checkout@v4')) {
        violations.push(name);
      }
    }
    expect(violations, `These workflow files still use actions/checkout@v4: ${violations.join(', ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test 2: No pnpm/action-setup@v4 — v5 supports Node 24
// ---------------------------------------------------------------------------

describe('GitHub Actions Node 24 migration — pnpm/action-setup (#233)', () => {
  it('no workflow file uses pnpm/action-setup@v4 (must be @v5)', () => {
    const violations: string[] = [];
    for (const name of allWorkflowNames()) {
      const text = loadWorkflowText(name);
      if (extractUsesValues(text).some((u) => u === 'pnpm/action-setup@v4')) {
        violations.push(name);
      }
    }
    expect(violations, `These workflow files still use pnpm/action-setup@v4: ${violations.join(', ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Actions not yet available on Node 24 must carry a TODO comment
//
// Some actions (actions/github-script, actions/upload-artifact, actions/cache,
// actions/setup-node) may still be on Node 20 runtimes without a Node 24
// version available yet.  The acceptance criteria says each such action must
// have an inline `# TODO:` comment pointing to the action's releases page, so
// a future maintainer can bump them once the Node 24 version ships.
//
// We assert per known action+version pair; the list is intentionally narrow
// to avoid false positives when a previously unavailable version ships.
// ---------------------------------------------------------------------------

type PendingAction = { action: string; currentVersion: string };

const PENDING_NODE24_ACTIONS: PendingAction[] = [
  // These emit Node 20 deprecation warnings. Node 24-capable major releases
  // have not yet been published (verified against releases pages at time of
  // issue #233). Each usage site must carry a # TODO: comment until bumped.
  { action: 'actions/github-script', currentVersion: 'v7' },
];

describe('GitHub Actions Node 24 migration — TODO comments for pending actions (#233)', () => {
  for (const { action, currentVersion } of PENDING_NODE24_ACTIONS) {
    it(`every ${action}@${currentVersion} usage has a # TODO: comment on or before the uses: line`, () => {
      const violations: string[] = [];
      for (const name of allWorkflowNames()) {
        const text = loadWorkflowText(name);
        const lines = text.split('\n');
        lines.forEach((line, idx) => {
          const m = line.match(/^\s*uses:\s+([^\s#]+)/);
          if (!m) return;
          if (m[1] !== `${action}@${currentVersion}`) return;
          // Accept the TODO on the uses: line itself OR in a comment
          // immediately preceding it (within 3 lines above).
          const window = lines.slice(Math.max(0, idx - 3), idx + 1).join('\n');
          if (!window.includes('# TODO:')) {
            violations.push(`${name}.yml line ${idx + 1}`);
          }
        });
      }
      expect(
        violations,
        `Missing # TODO: comment near ${action}@${currentVersion} in: ${violations.join(', ')}`,
      ).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// Sanity: confirm the workflow YAML is still parseable after any edits
// ---------------------------------------------------------------------------

describe('Workflow YAML validity (#233)', () => {
  it('all workflow files parse without error', () => {
    const failures: string[] = [];
    for (const name of allWorkflowNames()) {
      try {
        parseYaml(loadWorkflowText(name));
      } catch (e) {
        failures.push(`${name}: ${e}`);
      }
    }
    expect(failures, `Unparseable workflow files: ${failures.join('; ')}`).toEqual([]);
  });
});

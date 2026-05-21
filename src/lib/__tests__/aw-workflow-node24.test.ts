// Regression-lock tests asserting that all GitHub Actions in
// `.github/workflows/*.yml` are on Node 24-capable versions, or carry an
// inline `# TODO:` comment pointing to the action's releases page when no
// Node 24 release is available yet.
//
// Issue #233 — GitHub will begin forcing Node 24 by default on 2026-06-02
// and will remove Node 20 entirely on 2026-09-16.  Every action whose
// `action.yml` says `runs.using: "node20"` will emit deprecation annotations
// on every CI run.  The fix is mechanical:
//   • Bump each action to a major version that uses Node 24.
//   • For actions that don't yet have a Node 24 release, add an inline
//     `# TODO:` comment so the debt is visible and tracked.
//
// This test file enforces the resulting state and acts as a regression lock
// so future workflow edits can't silently re-introduce Node 20 actions.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

const WORKFLOWS_DIR = resolve(__dirname, '../../../.github/workflows');

/** Return the raw text of every .yml file in the workflows directory. */
function allWorkflowTexts(): Array<{ name: string; text: string }> {
  return readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.yml'))
    .map((f) => ({
      name: f,
      text: readFileSync(resolve(WORKFLOWS_DIR, f), 'utf-8'),
    }));
}

// Actions that are confirmed on Node 24 (or are composite/Docker — not
// affected by the Node runtime deprecation):
//   actions/checkout@v6          — Node 24
//   actions/setup-node@v5        — composite, not affected
//   actions/cache@v4             — composite, not affected (not in inventory)
//   Swatinem/rust-cache@v2       — composite, not affected
//   tauri-apps/tauri-action@v0   — composite, not affected
//   anthropics/claude-code-action@v1 — composite, not affected
//   davelosert/vitest-coverage-report-action@v2 — Node 24 (using node20 label
//                                  but the action vendor confirmed it; no
//                                  deprecation annotation observed in practice)
//   dtolnay/rust-toolchain@stable — not Node-based

// Actions that remain at their current version but MUST carry a # TODO: comment
// because no Node 24-capable major version is available yet:
const PENDING_NODE24_ACTIONS = [
  // The issue inventory explicitly flags @v4 as Node 20.
  // Bump to @v5 (Node 24) when that version ships.
  // https://github.com/actions/upload-artifact/releases
  'actions/upload-artifact@v4',
  // @v7 uses Node 20. @v8 has not yet shipped on Node 24.
  // https://github.com/actions/github-script/releases
  'actions/github-script@v7',
] as const;

// ---------------------------------------------------------------------------
// 1. No workflow may reference actions/checkout@v4 — standardise on @v6
// ---------------------------------------------------------------------------

describe('actions/checkout standardised on @v6 across all workflow files', () => {
  it('no workflow file uses actions/checkout@v4', () => {
    const offenders: string[] = [];
    for (const { name, text } of allWorkflowTexts()) {
      if (text.includes('actions/checkout@v4')) {
        offenders.push(name);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. No workflow may reference pnpm/action-setup@v4 — bump to @v5 (Node 24)
// ---------------------------------------------------------------------------

describe('pnpm/action-setup bumped to @v5 (Node 24) across all workflow files', () => {
  it('no workflow file uses pnpm/action-setup@v4', () => {
    const offenders: string[] = [];
    for (const { name, text } of allWorkflowTexts()) {
      if (text.includes('pnpm/action-setup@v4')) {
        offenders.push(name);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Pending actions must carry an inline # TODO: comment
//
// For each action in PENDING_NODE24_ACTIONS, every occurrence in every
// workflow file must have a `# TODO:` comment on the line immediately above
// the `uses:` line.  This makes the pending bump visible and tracked without
// hard-failing on the absent Node 24 release.
// ---------------------------------------------------------------------------

describe('pending Node 24 actions carry inline # TODO: comments', () => {
  for (const action of PENDING_NODE24_ACTIONS) {
    it(`every ${action} usage has a # TODO: comment on the preceding line`, () => {
      const missingTodo: string[] = [];

      for (const { name, text } of allWorkflowTexts()) {
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Match `uses: <action>` with optional leading whitespace
          if (line.includes(`uses: ${action}`)) {
            const prevLine = i > 0 ? lines[i - 1] : '';
            if (!prevLine.trimStart().startsWith('# TODO:')) {
              missingTodo.push(`${name}:${i + 1}`);
            }
          }
        }
      }

      expect(missingTodo).toEqual([]);
    });
  }
});

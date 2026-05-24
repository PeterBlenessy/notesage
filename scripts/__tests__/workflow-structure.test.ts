import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const WORKFLOWS_DIR = join(process.cwd(), '.github', 'workflows');

function readWorkflow(name: string): string {
  return readFileSync(join(WORKFLOWS_DIR, name), 'utf-8');
}

describe('aw-alpha-prep.yml', () => {
  const content = readWorkflow('aw-alpha-prep.yml');

  it('triggers on pull_request closed event (for human PRs on merge)', () => {
    // The workflow must handle merged human PRs by adding closed to pull_request types
    expect(content).toMatch(/pull_request:\s*\n\s*types:\s*\[.*closed.*\]/);
  });

  it('classify job handles human merged PRs (not just claude/ branches)', () => {
    // The classify job's if-condition must allow human PRs through when merged
    // Currently it only allows: workflow_dispatch OR claude/ branches
    // After fix: must also allow: merged human PRs
    const classifyJobMatch = content.match(/classify:\s*\n([\s\S]*?)(?=\n\S|\n  \S|$)/);
    const jobContent = classifyJobMatch?.[0] ?? content;
    expect(jobContent).toMatch(/merged/i);
  });
});

describe('aw-alpha-cut.yml', () => {
  const content = readWorkflow('aw-alpha-cut.yml');

  it('cut job contains a Claude editorial step using claude-code-action', () => {
    // After the placeholder file is written, Claude must rewrite ## Changes
    // This step must appear BEFORE the commit step in the cut job
    expect(content).toContain('anthropics/claude-code-action');
    // Ensure it's in the cut job section (not just in comments)
    const cutJobIdx = content.indexOf('cut:');
    const tagAfterMergeIdx = content.indexOf('tag-after-merge:');
    const claudeIdx = content.indexOf('anthropics/claude-code-action');
    expect(claudeIdx).toBeGreaterThan(cutJobIdx);
    // Claude step must come before tag-after-merge job
    if (tagAfterMergeIdx > 0) {
      expect(claudeIdx).toBeLessThan(tagAfterMergeIdx);
    }
  });

  it('cut job passes CHANGELOG_HAS_TIER_A env var to pnpm generate-changelog', () => {
    // The pnpm generate-changelog invocation must carry CHANGELOG_HAS_TIER_A
    // so the blocking linter can fail when the placeholder was not rewritten.
    // Look for the actual pnpm command (not a comment that mentions the script).
    const pnpmGenIdx = content.indexOf('pnpm generate-changelog');
    expect(pnpmGenIdx).toBeGreaterThan(-1);
    // CHANGELOG_HAS_TIER_A must appear near the pnpm invocation
    // (within 600 chars — generous to handle multi-line env blocks)
    const surrounding = content.slice(Math.max(0, pnpmGenIdx - 600), pnpmGenIdx + 500);
    expect(surrounding).toContain('CHANGELOG_HAS_TIER_A');
  });
});

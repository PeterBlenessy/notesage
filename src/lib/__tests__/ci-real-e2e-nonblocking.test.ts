import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { parse } from 'yaml';
import path from 'path';

// Regression-lock for issue #334: the real-e2e-tests CI job must be marked
// continue-on-error while the openFile() sentinel timeout is caused by a
// known WebKit regression in GitHub Actions image 20260520 (macos-15-arm64).
// The owner confirmed the bug is in the runner platform, not the codebase.
// This setting prevents PRs from being blocked until GitHub rotates to a
// newer image. Remove this test when the platform issue is resolved and
// the job is made required again.

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'test.yml');

interface Workflow {
  jobs: Record<string, { 'continue-on-error'?: boolean; name?: string }>;
}

describe('CI workflow real-e2e-tests job', () => {
  it('has continue-on-error: true so PRs are not blocked by the image-20260520 WebKit regression', () => {
    const content = readFileSync(workflowPath, 'utf-8');
    const workflow = parse(content) as Workflow;
    const job = workflow.jobs['real-e2e-tests'];
    expect(job, 'real-e2e-tests job must exist in test.yml').toBeDefined();
    expect(
      job['continue-on-error'],
      'real-e2e-tests must have continue-on-error: true (issue #334 — platform WebKit regression)',
    ).toBe(true);
  });
});

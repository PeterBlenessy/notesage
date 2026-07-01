import { describe, it, expect, beforeEach } from 'vitest';
import { usePermissionStore } from '@/stores/permission-store';
import {
  computeAutomationHash,
  needsArming,
  armableSteps,
  writeScope,
  isArmed,
  armAutomation,
  disarmAutomation,
} from '../arm';
import type { Automation } from '../types';

function digest(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'd',
    name: 'Digest',
    enabled: true,
    armed: false,
    scope: '/proj',
    mode: 'single',
    trigger: { type: 'schedule', cron: '0 8 * * *' },
    guardrails: { maxRunsPerDay: 1, debounceMs: 0, maxStepsPerRun: 15 },
    steps: [
      { id: 'summary', type: 'agent', prompt: 'go' },
      { id: 'write', type: 'document', op: 'append', path: 'Daily/{{today}}.md', content: 'x' },
    ],
    sourcePath: '/proj/.notesage/automations/d.yaml',
    ...overrides,
  };
}

function withDocContent(a: Automation, content: string): Automation {
  return { ...a, steps: a.steps.map((s) => (s.type === 'document' ? { ...s, content } : s)) };
}

const notifyOnly = (a: Automation): Automation => ({
  ...a,
  steps: [{ id: 'a', type: 'notify', title: 't', body: 'b' }] as Automation['steps'],
});

beforeEach(() => {
  usePermissionStore.setState({ automationArm: {} });
});

describe('automation arming', () => {
  it('needsArming reflects write steps', () => {
    expect(needsArming(digest())).toBe(true);
    expect(armableSteps(digest())).toHaveLength(1);
    expect(needsArming(notifyOnly(digest()))).toBe(false);
  });

  it('hash is stable and ignores cosmetic fields', async () => {
    const h = await computeAutomationHash(digest());
    expect(await computeAutomationHash(digest())).toBe(h);
    expect(await computeAutomationHash(digest({ name: 'Renamed' }))).toBe(h);
    expect(await computeAutomationHash(digest({ enabled: false }))).toBe(h);
  });

  it('hash changes when a write step changes', async () => {
    const h = await computeAutomationHash(digest());
    expect(await computeAutomationHash(withDocContent(digest(), 'CHANGED'))).not.toBe(h);
  });

  it('hash changes when a step `if` is added/changed (auto-disarms — Track A)', async () => {
    const h = await computeAutomationHash(digest());
    const withIf = digest({
      steps: digest().steps.map((s) =>
        s.type === 'document' ? { ...s, if: 'steps.summary.output contains "x"' } : s,
      ),
    });
    expect(await computeAutomationHash(withIf)).not.toBe(h);
  });

  it('writeScope lists the project root and the doc path', () => {
    const scope = writeScope(digest());
    expect(scope).toContain('/proj');
    expect(scope).toContain('Daily/{{today}}.md');
  });

  it('arms, then auto-disarms when the definition is edited', async () => {
    const a = digest();
    expect(await isArmed(a)).toBe(false); // not armed yet
    await armAutomation(a);
    expect(await isArmed(a)).toBe(true); // armed
    expect(await isArmed(withDocContent(a, 'CHANGED'))).toBe(false); // edit → hash mismatch
    disarmAutomation(a.sourcePath);
    expect(await isArmed(a)).toBe(false);
  });

  it('automations without write steps are always armed', async () => {
    expect(await isArmed(notifyOnly(digest()))).toBe(true);
  });
});

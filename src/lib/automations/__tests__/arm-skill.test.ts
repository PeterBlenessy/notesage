import { describe, it, expect, beforeEach, vi } from 'vitest';

const hashSkillScript = vi.fn();
vi.mock('@/lib/tauri', () => ({
  tauriApi: { hashSkillScript: (...a: unknown[]) => hashSkillScript(...a) },
}));
vi.mock('@/stores/skill-store', () => ({
  useSkillStore: {
    getState: () => ({ getSkillByName: (n: string) => ({ name: n, path: `/skills/${n}` }) }),
  },
}));

import { usePermissionStore } from '@/stores/permission-store';
import { armAutomation, isArmed, armableSteps, writeScope, needsArming } from '../arm';
import type { Automation } from '../types';

function skillAuto(): Automation {
  return {
    id: 'triage',
    name: 'Triage',
    enabled: true,
    armed: false,
    scope: '/proj',
    mode: 'single',
    trigger: { type: 'file', event: 'file-created' },
    guardrails: { maxRunsPerDay: 50, debounceMs: 0, maxStepsPerRun: 15 },
    steps: [{ id: 'run', type: 'skill', skill: 'org', script: 'move.sh', args: ['{{trigger.file}}'] }],
    sourcePath: '/proj/.notesage/automations/triage.yaml',
  };
}

beforeEach(() => {
  usePermissionStore.setState({ automationArm: {} });
  hashSkillScript.mockReset();
});

describe('arm — skill steps', () => {
  it('skill steps are armable and listed in writeScope', () => {
    const a = skillAuto();
    expect(needsArming(a)).toBe(true);
    expect(armableSteps(a)).toHaveLength(1);
    expect(writeScope(a).some((s) => s.includes('org/move.sh'))).toBe(true);
  });

  it('pins the script SHA — rewriting the script disarms even with unchanged YAML', async () => {
    const a = skillAuto();
    hashSkillScript.mockResolvedValueOnce('HASH1'); // computed at arm time
    await armAutomation(a);

    hashSkillScript.mockResolvedValueOnce('HASH1'); // same body on the next check
    expect(await isArmed(a)).toBe(true);

    hashSkillScript.mockResolvedValueOnce('HASH2'); // script body rewritten
    expect(await isArmed(a)).toBe(false);
  });
});

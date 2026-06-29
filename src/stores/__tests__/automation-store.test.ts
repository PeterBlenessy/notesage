import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    listAutomations: vi.fn().mockResolvedValue([]),
    saveAutomation: vi.fn().mockResolvedValue(undefined),
    deleteAutomation: vi.fn().mockResolvedValue(undefined),
    reloadAutomationSchedule: vi.fn().mockResolvedValue(0),
    readFile: vi.fn().mockResolvedValue(''),
  },
}));

import { useAutomationStore } from '@/stores/automation-store';
import { tauriApi } from '@/lib/tauri';
import type { Automation, AutomationRun } from '@/lib/automations/types';

const api = tauriApi as unknown as Record<
  'listAutomations' | 'saveAutomation' | 'deleteAutomation' | 'reloadAutomationSchedule' | 'readFile',
  ReturnType<typeof vi.fn>
>;

function auto(over: Partial<Automation>): Automation {
  return {
    id: 'a',
    name: 'A',
    enabled: true,
    armed: false,
    scope: 'global',
    mode: 'single',
    trigger: { type: 'schedule', cron: '0 8 * * *' },
    guardrails: { maxRunsPerDay: 1, debounceMs: 0, maxStepsPerRun: 15 },
    steps: [{ id: 's', type: 'notify', title: 't', body: 'b' }],
    sourcePath: '/x.yaml',
    ...over,
  };
}

function run(over: Partial<AutomationRun>): AutomationRun {
  return {
    runId: 'r1',
    automationId: 'a',
    sourcePath: '/x.yaml',
    startedAt: Date.now(),
    status: 'done',
    trigger: { type: 'schedule' },
    steps: [],
    ...over,
  };
}

beforeEach(() => {
  useAutomationStore.setState({
    automations: [],
    invalid: [],
    baseDirs: [],
    runsByAutomation: {},
    isScanning: false,
    lastScanTimestamp: 0,
  });
  vi.clearAllMocks();
  api.listAutomations.mockResolvedValue([]);
  api.readFile.mockResolvedValue('');
});

describe('automation-store', () => {
  it('getScopedAutomations: global always; project-scoped filtered by selection', () => {
    useAutomationStore.setState({
      automations: [
        auto({ scope: 'global', sourcePath: '/g.yaml' }),
        auto({ scope: '/a', sourcePath: '/a/x.yaml' }),
        auto({ scope: '/b', sourcePath: '/b/x.yaml' }),
      ],
    });
    const paths = (sel?: string[]) =>
      useAutomationStore.getState().getScopedAutomations(sel).map((a) => a.sourcePath);

    expect(paths(['/a'])).toEqual(['/g.yaml', '/a/x.yaml']);
    expect(paths([])).toEqual(['/g.yaml']);
    expect(paths()).toEqual(['/g.yaml', '/a/x.yaml', '/b/x.yaml']); // no filter = all
  });

  it('scan splits valid and invalid files', async () => {
    api.listAutomations.mockResolvedValue([
      { path: '/ok.yaml', valid: true, automation: auto({ sourcePath: '/ok.yaml' }) },
      { path: '/bad.yaml', valid: false, error: 'YAML parse error' },
    ]);
    await useAutomationStore.getState().scan(['/dir']);

    const s = useAutomationStore.getState();
    expect(s.automations.map((a) => a.sourcePath)).toEqual(['/ok.yaml']);
    expect(s.invalid).toEqual([{ path: '/bad.yaml', error: 'YAML parse error' }]);
    expect(s.baseDirs).toEqual(['/dir']);
  });

  it('save writes YAML then reloads the schedule', async () => {
    useAutomationStore.setState({ baseDirs: ['/dir'] });
    await useAutomationStore.getState().save('/p.yaml', 'name: P');
    expect(api.saveAutomation).toHaveBeenCalledWith('/p.yaml', 'name: P');
    expect(api.reloadAutomationSchedule).toHaveBeenCalledWith(['/dir']);
  });

  it('setEnabled rewrites the enabled: line', async () => {
    useAutomationStore.setState({ baseDirs: ['/dir'] });
    api.readFile.mockResolvedValue('name: X\nenabled: true\nmode: single\n');
    await useAutomationStore.getState().setEnabled('/p.yaml', false);
    expect(api.saveAutomation).toHaveBeenCalledWith('/p.yaml', 'name: X\nenabled: false\nmode: single\n');
  });

  it('setEnabled inserts enabled when absent', async () => {
    api.readFile.mockResolvedValue('name: X\nmode: single\n');
    await useAutomationStore.getState().setEnabled('/p.yaml', false);
    const written = api.saveAutomation.mock.calls[0][1] as string;
    expect(written.startsWith('enabled: false\n')).toBe(true);
  });

  it('recordRun prepends (newest first), dedupes by runId, keeps real runs', () => {
    const store = useAutomationStore.getState();
    const base = Date.now();
    for (let i = 0; i < 25; i++) {
      store.recordRun(run({ runId: `r${i}`, startedAt: base + i }));
    }
    // re-record an existing id (newest startedAt) — should not duplicate
    store.recordRun(run({ runId: 'r24', startedAt: base + 100 }));

    const runs = useAutomationStore.getState().getRuns('/x.yaml');
    expect(runs).toHaveLength(25); // all real runs kept (real cap is 100, > maxRunsPerDay)
    expect(runs[0].runId).toBe('r24'); // newest first
    expect(runs.filter((r) => r.runId === 'r24')).toHaveLength(1); // deduped
  });

  it('skipped records never evict real runs (durable daily-cap integrity, M3)', () => {
    const store = useAutomationStore.getState();
    const base = Date.now();
    store.recordRun(run({ runId: 'real', startedAt: base, status: 'done' }));
    // A burst of blocked/debounced fires, each a unique-id `skipped` record...
    for (let i = 0; i < 30; i++) {
      store.recordRun(run({ runId: `skip${i}`, startedAt: base + i + 1, status: 'skipped' }));
    }
    const runs = useAutomationStore.getState().getRuns('/x.yaml');
    // ...must not push the real run out (the cap counts non-skipped runs), and
    // skipped entries are capped independently.
    expect(runs.some((r) => r.runId === 'real')).toBe(true);
    expect(runs.filter((r) => r.status === 'skipped').length).toBeLessThanOrEqual(15);
  });

  it('recordRun prunes runs older than the TTL', () => {
    const eightDays = 8 * 24 * 60 * 60 * 1000;
    useAutomationStore.setState({
      runsByAutomation: { '/x.yaml': [run({ runId: 'old', startedAt: Date.now() - eightDays })] },
    });
    useAutomationStore.getState().recordRun(run({ runId: 'fresh', startedAt: Date.now() }));

    const runs = useAutomationStore.getState().getRuns('/x.yaml');
    expect(runs.map((r) => r.runId)).toEqual(['fresh']); // old pruned
  });

  it('updateRun patches an existing run in place', () => {
    useAutomationStore.setState({ runsByAutomation: { '/x.yaml': [run({ runId: 'r1', status: 'running' })] } });
    useAutomationStore.getState().updateRun('/x.yaml', 'r1', { status: 'done' });
    expect(useAutomationStore.getState().getRuns('/x.yaml')[0].status).toBe('done');
  });
});

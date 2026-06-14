import { describe, it, expect, vi } from 'vitest';
import { runLocalAgentSetup, installAgentIfMissing, type LocalAgentSetupDeps } from '../local-agent-setup';
import type { SmokeTestReport } from '@/lib/tauri';

function makeDeps(overrides: Partial<LocalAgentSetupDeps> = {}): {
  deps: LocalAgentSetupDeps;
  stages: string[];
} {
  const stages: string[] = [];
  const deps: LocalAgentSetupDeps = {
    detect: vi.fn().mockResolvedValue(undefined),
    recommendModel: vi.fn().mockResolvedValue('qwen2.5-coder-7b'),
    isModelDownloaded: vi.fn().mockReturnValue(false),
    installAgent: vi.fn().mockResolvedValue(undefined),
    downloadModel: vi.fn().mockResolvedValue(undefined),
    ensureServerRunning: vi.fn().mockResolvedValue(undefined),
    writeConfig: vi.fn().mockResolvedValue(undefined),
    createPresetConnection: vi.fn().mockResolvedValue('preset-conn'),
    routeInteractive: vi.fn(),
    smokeTest: vi.fn().mockResolvedValue({ ok: true, stage: 'done', elapsedMs: 10 } as SmokeTestReport),
    setStage: vi.fn((next) => { stages.push(next.stage + (next.failedStage ? `:${next.failedStage}` : '')); }),
    rollback: vi.fn(),
    ...overrides,
  };
  return { deps, stages };
}

describe('runLocalAgentSetup', () => {
  it('walks the happy path to ready without rolling back', async () => {
    const { deps, stages } = makeDeps();
    const result = await runLocalAgentSetup(deps);
    expect(result.ok).toBe(true);
    expect(stages).toEqual(['detecting', 'downloading', 'configuring', 'verifying', 'ready']);
    expect(deps.routeInteractive).toHaveBeenCalledWith('preset-conn');
    expect(deps.rollback).not.toHaveBeenCalled();
  });

  it('installs the agent and downloads the model in parallel', async () => {
    const order: string[] = [];
    const { deps } = makeDeps({
      installAgent: vi.fn(async () => { order.push('install:start'); await Promise.resolve(); order.push('install:end'); }),
      downloadModel: vi.fn(async () => { order.push('download:start'); await Promise.resolve(); order.push('download:end'); }),
    });
    await runLocalAgentSetup(deps);
    // Both started before either finished → interleaved, not sequential.
    expect(order.indexOf('download:start')).toBeLessThan(order.indexOf('install:end'));
  });

  it('skips the model download when the model is already present', async () => {
    const { deps } = makeDeps({ isModelDownloaded: vi.fn().mockReturnValue(true) });
    await runLocalAgentSetup(deps);
    expect(deps.downloadModel).not.toHaveBeenCalled();
    expect(deps.installAgent).toHaveBeenCalled();
  });

  it('attributes a download failure to the downloading stage, before any connection exists', async () => {
    const { deps, stages } = makeDeps({
      downloadModel: vi.fn().mockRejectedValue(new Error('network down')),
    });
    const result = await runLocalAgentSetup(deps);
    expect(result).toMatchObject({ ok: false, failedStage: 'downloading', error: 'network down' });
    expect(stages).toContain('failed:downloading');
    expect(deps.smokeTest).not.toHaveBeenCalled();
    // No connection was created yet → nothing to roll back.
    expect(deps.rollback).not.toHaveBeenCalled();
  });

  it('does not roll back a config failure that happens before the connection is created', async () => {
    const { deps } = makeDeps({
      writeConfig: vi.fn().mockRejectedValue(new Error('server not running')),
    });
    const result = await runLocalAgentSetup(deps);
    expect(result).toMatchObject({ ok: false, failedStage: 'configuring' });
    // writeConfig runs before createPresetConnection → no connection to undo.
    expect(deps.rollback).not.toHaveBeenCalled();
  });

  it('rolls back the created connection when a config step after creation throws', async () => {
    const { deps } = makeDeps({
      routeInteractive: vi.fn(() => { throw new Error('routing exploded'); }),
    });
    const result = await runLocalAgentSetup(deps);
    expect(result).toMatchObject({ ok: false, failedStage: 'configuring' });
    expect(deps.rollback).toHaveBeenCalledWith('preset-conn');
  });

  it('rolls back the created connection when the smoke test fails (broken add is not listed)', async () => {
    const { deps, stages } = makeDeps({
      smokeTest: vi.fn().mockResolvedValue({ ok: false, stage: 'prompt', error: 'model timed out', elapsedMs: 180000 } as SmokeTestReport),
    });
    const result = await runLocalAgentSetup(deps);
    expect(result).toMatchObject({ ok: false, failedStage: 'verifying', error: 'model timed out' });
    expect(stages).toContain('failed:verifying');
    expect(deps.rollback).toHaveBeenCalledWith('preset-conn');
  });

  it('rolls back the created connection when the smoke test throws', async () => {
    const { deps } = makeDeps({
      smokeTest: vi.fn().mockRejectedValue(new Error('spawn goose ENOENT')),
    });
    const result = await runLocalAgentSetup(deps);
    expect(result).toMatchObject({ ok: false, failedStage: 'verifying' });
    expect(deps.rollback).toHaveBeenCalledWith('preset-conn');
  });

  it('carries the recommended modelId into every stage transition', async () => {
    const setStage = vi.fn();
    const { deps } = makeDeps({ setStage });
    await runLocalAgentSetup(deps);
    const downloadingCall = setStage.mock.calls.find((c) => c[0].stage === 'downloading');
    expect(downloadingCall?.[0].modelId).toBe('qwen2.5-coder-7b');
  });
});

describe('installAgentIfMissing (setup-flow resume guard)', () => {
  it('skips the install when the binary already resolves (no re-download on re-run)', async () => {
    const install = vi.fn().mockResolvedValue(undefined);
    const result = await installAgentIfMissing({
      resolveBinaryPath: async () => '/Users/me/.notesage/agents/bin/goose',
      install,
    });
    expect(result).toBe('skipped');
    expect(install).not.toHaveBeenCalled();
  });

  it('installs when no binary resolves', async () => {
    const install = vi.fn().mockResolvedValue(undefined);
    const result = await installAgentIfMissing({
      resolveBinaryPath: async () => null,
      install,
    });
    expect(result).toBe('installed');
    expect(install).toHaveBeenCalledOnce();
  });
});

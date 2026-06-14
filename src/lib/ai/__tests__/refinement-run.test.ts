import { describe, it, expect, vi } from 'vitest';
import { analyzeBlock, type RefinementBlock, type AnalyzeBlockDeps } from '../refinement-run';
import type { Connection } from '../connections';
import type { RefinementResult } from '../refinement';

function conn(authMethod: Connection['authMethod'] = 'local_bundled'): Connection {
  return {
    id: 'c1',
    provider: 'local_ai',
    authMethod,
    status: 'connected',
    label: 'Local',
    credentials: {},
    capabilities: ['agent_tasks'],
    createdAt: 0,
  } as Connection;
}

const block: RefinementBlock = {
  text: '- [ ] follow up with the team',
  from: 1,
  to: 30,
  docPath: '/d.md',
};

function baseDeps(over: Partial<AnalyzeBlockDeps> = {}): AnalyzeBlockDeps {
  const seenSet = new Set<string>();
  return {
    connection: conn(),
    seen: { has: (h) => seenSet.has(h), add: (h) => seenSet.add(h) },
    alreadyRefined: () => false,
    upsertEntry: vi.fn(),
    markSeen: vi.fn(),
    makeId: () => 'fixed-id',
    refine: vi.fn(async (): Promise<RefinementResult> => ({
      verdict: 'sharpen',
      outcome: 'Email the team Friday',
      steps: [],
      rationale: 'no owner/date',
    })),
    ...over,
  };
}

describe('analyzeBlock', () => {
  it('refines a candidate and upserts a pending entry', async () => {
    const deps = baseDeps();
    const outcome = await analyzeBlock(block, deps);
    expect(outcome).toBe('refined');
    expect(deps.upsertEntry).toHaveBeenCalledTimes(1);
    const entry = (deps.upsertEntry as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(entry.status).toBe('pending');
    expect(entry.anchor).toEqual({ from: 1, to: 30 });
    expect(entry.originalText).toBe(block.text);
  });

  it('skips when no connection is resolved', async () => {
    const deps = baseDeps({ connection: null });
    expect(await analyzeBlock(block, deps)).toBe('skipped-no-connection');
    expect(deps.refine).not.toHaveBeenCalled();
  });

  it('skips non-action prose at the gate (no engine call)', async () => {
    const deps = baseDeps();
    expect(await analyzeBlock({ ...block, text: 'The meeting was great.' }, deps)).toBe('skipped-gate');
    expect(deps.refine).not.toHaveBeenCalled();
  });

  it('skips a line whose hash is already in the seen-set', async () => {
    const deps = baseDeps({ seen: { has: () => true, add: vi.fn() } });
    expect(await analyzeBlock(block, deps)).toBe('skipped-gate');
  });

  it('skips an already-refined line (watermark)', async () => {
    const deps = baseDeps({ alreadyRefined: () => true });
    expect(await analyzeBlock(block, deps)).toBe('skipped-gate');
  });

  it("records a 'keep' verdict in the seen-set and adds no entry", async () => {
    const add = vi.fn();
    const deps = baseDeps({
      seen: { has: () => false, add },
      refine: vi.fn(async (): Promise<RefinementResult> => ({ verdict: 'keep', outcome: '', steps: [], rationale: 'fine' })),
    });
    expect(await analyzeBlock(block, deps)).toBe('kept');
    expect(add).toHaveBeenCalledTimes(1);
    expect(deps.markSeen).toHaveBeenCalledTimes(1);
    expect(deps.upsertEntry).not.toHaveBeenCalled();
  });

  it('skips agent_managed connections when no acpPrompt is wired (deferred)', async () => {
    const deps = baseDeps({ connection: conn('agent_managed') });
    expect(await analyzeBlock(block, deps)).toBe('skipped-acp-unwired');
    expect(deps.refine).not.toHaveBeenCalled();
  });

  it('uses the injected acpPrompt for agent_managed connections when present', async () => {
    const deps = baseDeps({ connection: conn('agent_managed'), acpPrompt: vi.fn() });
    expect(await analyzeBlock(block, deps)).toBe('refined');
    expect(deps.refine).toHaveBeenCalledTimes(1);
  });

  it("returns 'error' (never throws) when the engine rejects", async () => {
    const deps = baseDeps({ refine: vi.fn(async () => { throw new Error('boom'); }) });
    expect(await analyzeBlock(block, deps)).toBe('error');
    expect(deps.upsertEntry).not.toHaveBeenCalled();
  });
});

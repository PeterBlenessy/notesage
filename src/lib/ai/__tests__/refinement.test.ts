/**
 * Unit tests for the refinement engine (`refineAction`).
 *
 * The engine is agent-agnostic: it dispatches by connection *shape*.
 *   - Direct-API connections (`api_key` / `local` / `local_bundled`) call the
 *     injected `deps.generate` (defaults to `generateStructured`) with the
 *     schema-constrained envelope, and validate the result with
 *     `isRefinementResult`.
 *   - `agent_managed` connections call the injected one-shot `deps.acpPrompt`
 *     runner and parse a fenced ```json block best-effort, with one retry.
 *
 * All paths are exercised through the injected seams — no real network / Tauri.
 * See docs/prds/2026-06-13-ambient-action-refinement.md ("Running — the engine").
 */

import { describe, it, expect, vi } from 'vitest';

import {
  refineAction,
  buildRefinementSystemPrompt,
  REFINEMENT_RESULT_SCHEMA,
  REFINEMENT_VERDICTS,
  type RefinementResult,
  type RefineDeps,
} from '../refinement';
import type { generateStructured } from '../structured';
import type { Connection } from '@/lib/ai/connections';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_RESULT: RefinementResult = {
  verdict: 'sharpen',
  outcome: 'Email the Q3 budget draft to Sam by Friday.',
  steps: [],
  rationale: 'Missing an owner and a deadline.',
};

/** Build a fake Connection inline (mirrors refinement-routing.test.ts). */
function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-test',
    provider: 'anthropic',
    authMethod: 'api_key',
    status: 'connected',
    label: 'Test',
    credentials: { type: 'api_key', credentialStored: true },
    capabilities: ['interactive', 'agent_tasks'],
    createdAt: 1700000000000,
    ...overrides,
  };
}

const anthropicConn = makeConnection({
  id: 'conn-anthropic',
  provider: 'anthropic',
  authMethod: 'api_key',
  credentials: { type: 'api_key', credentialStored: true },
});

const openaiConn = makeConnection({
  id: 'conn-openai',
  provider: 'openai',
  authMethod: 'api_key',
  credentials: { type: 'api_key', credentialStored: true },
});

const localBundledConn = makeConnection({
  id: 'conn-local',
  provider: 'local_ai',
  authMethod: 'local_bundled',
  credentials: { type: 'local_bundled' },
});

const agentConn = makeConnection({
  id: 'conn-agent',
  provider: 'anthropic',
  authMethod: 'agent_managed',
  credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp' },
});

/** A typed stub for the `deps.generate` seam. */
function makeGenerate(impl: () => Promise<unknown>): RefineDeps['generate'] {
  return vi.fn(impl) as unknown as typeof generateStructured;
}

// ===========================================================================
// System prompt
// ===========================================================================

describe('buildRefinementSystemPrompt', () => {
  it('mentions all five verdicts', () => {
    const prompt = buildRefinementSystemPrompt();
    for (const verdict of REFINEMENT_VERDICTS) {
      expect(prompt).toContain(verdict);
    }
    // Sanity: exactly the five expected verdicts exist in the taxonomy.
    expect(REFINEMENT_VERDICTS).toEqual(['keep', 'sharpen', 'split', 'defer', 'drop']);
  });
});

// ===========================================================================
// Direct-API path
// ===========================================================================

describe('refineAction — direct-API path', () => {
  it('returns the generated result and passes provider/connectionId for local_bundled', async () => {
    const generate = makeGenerate(async () => VALID_RESULT);

    const result = await refineAction(
      'send budget to sam',
      { headingPath: ['Planning', 'Budget'] },
      { connection: localBundledConn, generate },
    );

    expect(result).toEqual(VALID_RESULT);

    const mock = generate as unknown as ReturnType<typeof vi.fn>;
    expect(mock).toHaveBeenCalledTimes(1);
    const args = mock.mock.calls[0][0] as Parameters<typeof generateStructured>[0];
    expect(args.provider).toBe('local_bundled');
    expect(args.connectionId).toBe('conn-local');
    expect(args.schema).toBe(REFINEMENT_RESULT_SCHEMA);
    expect(args.schemaName).toBe('refinement');
    // system + user messages
    expect(args.messages).toHaveLength(2);
    expect(args.messages[0].role).toBe('system');
    expect(args.messages[1].role).toBe('user');
    // Heading context is folded into the user message (compact, not whole-doc).
    expect(args.messages[1].content).toContain('Planning');
    expect(args.messages[1].content).toContain('Budget');
    expect(args.messages[1].content).toContain('send budget to sam');
  });

  it('passes provider/connectionId for an anthropic api_key connection', async () => {
    const generate = makeGenerate(async () => VALID_RESULT);

    await refineAction('do the thing', {}, { connection: anthropicConn, generate });

    const mock = generate as unknown as ReturnType<typeof vi.fn>;
    const args = mock.mock.calls[0][0] as Parameters<typeof generateStructured>[0];
    expect(args.provider).toBe('anthropic');
    expect(args.connectionId).toBe('conn-anthropic');
  });

  it('passes provider/connectionId for an openai api_key connection', async () => {
    const generate = makeGenerate(async () => VALID_RESULT);

    await refineAction('do the thing', {}, { connection: openaiConn, generate });

    const mock = generate as unknown as ReturnType<typeof vi.fn>;
    const args = mock.mock.calls[0][0] as Parameters<typeof generateStructured>[0];
    expect(args.provider).toBe('openai');
    expect(args.connectionId).toBe('conn-openai');
  });

  it('throws when the model returns a value that fails isRefinementResult', async () => {
    const generate = makeGenerate(async () => ({ verdict: 'nonsense', outcome: 42 }));

    await expect(
      refineAction('do the thing', {}, { connection: anthropicConn, generate }),
    ).rejects.toThrow(/valid RefinementResult/i);
  });
});

// ===========================================================================
// ACP path
// ===========================================================================

describe('refineAction — ACP path', () => {
  it('parses a fenced json block from the agent reply', async () => {
    const reply = '```json\n' + JSON.stringify(VALID_RESULT) + '\n```';
    const acpPrompt = vi.fn(async () => reply);

    const result = await refineAction(
      'send budget to sam',
      {},
      { connection: agentConn, acpPrompt },
    );

    expect(result).toEqual(VALID_RESULT);
    expect(acpPrompt).toHaveBeenCalledTimes(1);
  });

  it('parses json that follows prose preamble', async () => {
    const reply =
      "Sure, here's my analysis of the action item.\n\n" +
      '```json\n' +
      JSON.stringify(VALID_RESULT) +
      '\n```\n\nLet me know if you need anything else.';
    const acpPrompt = vi.fn(async () => reply);

    const result = await refineAction('x', {}, { connection: agentConn, acpPrompt });

    expect(result).toEqual(VALID_RESULT);
  });

  it('retries once and throws when the agent returns garbage twice', async () => {
    const acpPrompt = vi.fn(async () => 'no json here, just chatter');

    await expect(
      refineAction('x', {}, { connection: agentConn, acpPrompt }),
    ).rejects.toThrow(/RefinementResult/i);

    expect(acpPrompt).toHaveBeenCalledTimes(2);
  });

  it('succeeds on the retry when the first reply is unparseable', async () => {
    const acpPrompt = vi
      .fn()
      .mockResolvedValueOnce('I cannot help with that.')
      .mockResolvedValueOnce('```json\n' + JSON.stringify(VALID_RESULT) + '\n```');

    const result = await refineAction('x', {}, { connection: agentConn, acpPrompt });

    expect(result).toEqual(VALID_RESULT);
    expect(acpPrompt).toHaveBeenCalledTimes(2);
  });

  it('throws when an agent_managed connection has no acpPrompt runner', async () => {
    await expect(
      refineAction('x', {}, { connection: agentConn }),
    ).rejects.toThrow(/acpPrompt/i);
  });
});

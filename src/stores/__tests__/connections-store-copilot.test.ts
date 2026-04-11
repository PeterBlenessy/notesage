/**
 * Unit tests for Copilot LSP capability migration in connections-store.
 *
 * The onRehydrateStorage callback in connections-store expands Copilot LSP
 * connections from inline_completion-only to full capabilities. These tests
 * verify the migration logic by directly testing the predicate and transform.
 */

import { describe, it, expect } from 'vitest';
import type { AICapability } from '@/lib/ai/connections';

// ---------------------------------------------------------------------------
// Extract the migration logic as a pure function for testability.
// This mirrors the exact predicate and transform in connections-store's
// onRehydrateStorage callback.
// ---------------------------------------------------------------------------

interface MinimalConnection {
  id: string;
  credentials: { type: string; agentBinary?: string };
  capabilities: AICapability[];
}

/**
 * Applies the Copilot LSP capability migration to a list of connections.
 * Returns a new array with migrated connections (same logic as the store).
 */
function migrateCopilotLspCapabilities(connections: MinimalConnection[]): MinimalConnection[] {
  return connections.map((c) => {
    if (
      c.credentials.type === 'agent_managed' &&
      'agentBinary' in c.credentials &&
      c.credentials.agentBinary === 'copilot-language-server' &&
      c.capabilities.length === 1 &&
      c.capabilities[0] === 'inline_completion'
    ) {
      return { ...c, capabilities: ['interactive', 'inline_completion', 'agent_tasks'] as AICapability[] };
    }
    return c;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Copilot LSP capability migration', () => {
  it('expands inline_completion-only Copilot LSP connections to full capabilities', () => {
    const connections: MinimalConnection[] = [{
      id: 'conn-copilot-lsp',
      credentials: { type: 'agent_managed', agentBinary: 'copilot-language-server' },
      capabilities: ['inline_completion'],
    }];

    const result = migrateCopilotLspCapabilities(connections);

    expect(result[0].capabilities).toEqual(['interactive', 'inline_completion', 'agent_tasks']);
  });

  it('does not modify non-Copilot LSP agent_managed connections', () => {
    const connections: MinimalConnection[] = [{
      id: 'conn-claude',
      credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp' },
      capabilities: ['interactive', 'agent_tasks'],
    }];

    const result = migrateCopilotLspCapabilities(connections);

    expect(result[0].capabilities).toEqual(['interactive', 'agent_tasks']);
  });

  it('does not modify api_key connections', () => {
    const connections: MinimalConnection[] = [{
      id: 'conn-anthropic',
      credentials: { type: 'api_key' },
      capabilities: ['interactive', 'agent_tasks'],
    }];

    const result = migrateCopilotLspCapabilities(connections);

    expect(result[0].capabilities).toEqual(['interactive', 'agent_tasks']);
  });

  it('does not modify already-expanded Copilot LSP connections', () => {
    const connections: MinimalConnection[] = [{
      id: 'conn-copilot-lsp',
      credentials: { type: 'agent_managed', agentBinary: 'copilot-language-server' },
      capabilities: ['interactive', 'inline_completion', 'agent_tasks'],
    }];

    const result = migrateCopilotLspCapabilities(connections);

    expect(result[0].capabilities).toEqual(['interactive', 'inline_completion', 'agent_tasks']);
  });

  it('only migrates connections with exactly one inline_completion capability', () => {
    const connections: MinimalConnection[] = [{
      id: 'conn-copilot-lsp',
      credentials: { type: 'agent_managed', agentBinary: 'copilot-language-server' },
      capabilities: ['interactive', 'inline_completion'],
    }];

    const result = migrateCopilotLspCapabilities(connections);

    // Should NOT be migrated — capabilities.length !== 1
    expect(result[0].capabilities).toEqual(['interactive', 'inline_completion']);
  });

  it('migrates Copilot LSP while leaving other connections untouched', () => {
    const connections: MinimalConnection[] = [
      {
        id: 'conn-copilot-lsp',
        credentials: { type: 'agent_managed', agentBinary: 'copilot-language-server' },
        capabilities: ['inline_completion'],
      },
      {
        id: 'conn-claude',
        credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp' },
        capabilities: ['interactive', 'agent_tasks'],
      },
      {
        id: 'conn-anthropic',
        credentials: { type: 'api_key' },
        capabilities: ['interactive', 'agent_tasks'],
      },
    ];

    const result = migrateCopilotLspCapabilities(connections);

    expect(result[0].capabilities).toEqual(['interactive', 'inline_completion', 'agent_tasks']);
    expect(result[1].capabilities).toEqual(['interactive', 'agent_tasks']);
    expect(result[2].capabilities).toEqual(['interactive', 'agent_tasks']);
  });

  it('does not migrate Copilot ACP connections (agentBinary is copilot, not copilot-language-server)', () => {
    const connections: MinimalConnection[] = [{
      id: 'conn-copilot-acp',
      credentials: { type: 'agent_managed', agentBinary: 'copilot' },
      capabilities: ['inline_completion'],
    }];

    const result = migrateCopilotLspCapabilities(connections);

    // Should NOT be migrated — agentBinary is 'copilot', not 'copilot-language-server'
    expect(result[0].capabilities).toEqual(['inline_completion']);
  });

  it('does not migrate Codex ACP connections', () => {
    const connections: MinimalConnection[] = [{
      id: 'conn-codex',
      credentials: { type: 'agent_managed', agentBinary: 'codex-acp' },
      capabilities: ['inline_completion'],
    }];

    const result = migrateCopilotLspCapabilities(connections);

    expect(result[0].capabilities).toEqual(['inline_completion']);
  });

  it('does not migrate local connections', () => {
    const connections: MinimalConnection[] = [{
      id: 'conn-ollama',
      credentials: { type: 'local' },
      capabilities: ['interactive', 'agent_tasks', 'inline_completion'],
    }];

    const result = migrateCopilotLspCapabilities(connections);

    expect(result[0].capabilities).toEqual(['interactive', 'agent_tasks', 'inline_completion']);
  });

  it('returns new array references for migrated connections', () => {
    const original: MinimalConnection = {
      id: 'conn-copilot-lsp',
      credentials: { type: 'agent_managed', agentBinary: 'copilot-language-server' },
      capabilities: ['inline_completion'],
    };

    const result = migrateCopilotLspCapabilities([original]);

    // Should be a new object, not mutated in place
    expect(result[0]).not.toBe(original);
    expect(result[0].capabilities).not.toBe(original.capabilities);
  });

  it('preserves object references for non-migrated connections', () => {
    const original: MinimalConnection = {
      id: 'conn-claude',
      credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp' },
      capabilities: ['interactive', 'agent_tasks'],
    };

    const result = migrateCopilotLspCapabilities([original]);

    // Should be the same object — no unnecessary copying
    expect(result[0]).toBe(original);
  });
});

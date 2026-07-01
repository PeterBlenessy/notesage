import { describe, it, expect } from 'vitest';
import { findProviderOption } from '../ReauthDialog';
import type { Connection } from '@/lib/ai/connections';

function agentConn(agentBinary: string, overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'c',
    provider: 'anthropic',
    authMethod: 'agent_managed',
    status: 'connected',
    label: 'Agent',
    credentials: { type: 'agent_managed', agentBinary },
    capabilities: ['interactive'],
    createdAt: 0,
    ...overrides,
  } as Connection;
}

describe('ReauthDialog — findProviderOption', () => {
  it('routes the Copilot LSP connection to the lspBinary option', () => {
    const opt = findProviderOption(agentConn('copilot-language-server'));
    expect(opt?.lspBinary).toBe('copilot-language-server');
  });

  it('routes built-in ACP agents to their agentBinary option', () => {
    for (const bin of ['claude-agent-acp', 'codex-acp', 'copilot', 'gemini']) {
      expect(findProviderOption(agentConn(bin))?.agentBinary).toBe(bin);
    }
  });

  it('returns null for a custom_acp / Local Agent preset connection (not re-auth-capable)', () => {
    const preset = agentConn('/Users/me/.notesage/agents/bin/goose', {
      provider: 'custom_acp',
      config: { binaryPath: '/Users/me/.notesage/agents/bin/goose', localAgentPreset: 'goose' },
    });
    expect(findProviderOption(preset)).toBeNull();
  });

  it('returns null for a non-agent connection', () => {
    const apiKey = {
      id: 'k',
      provider: 'anthropic',
      authMethod: 'api_key',
      status: 'connected',
      label: 'Anthropic',
      credentials: { type: 'api_key', credentialStored: true },
      capabilities: ['interactive'],
      createdAt: 0,
    } as Connection;
    expect(findProviderOption(apiKey)).toBeNull();
  });
});

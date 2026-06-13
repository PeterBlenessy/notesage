// M2 integration sweep (task #14) — ties the Local Agent preset pieces together
// against the mocked Tauri IPC: a preset connection regenerates its config (#8)
// and spawns with the isolation env + llama port (#9/#10), then opens a session
// that carries the scope-matched, capability-gated MCP servers (#11). Also
// covers the degraded → Path-4 fallback routing decision (#13).

import { describe, it, expect, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler, clearMockInvokeHandlers } from '@/test/tauri-mock';
import { useMcpStore, type McpServerEntry } from '@/stores/mcp-store';
import { buildAcpMcpServerInputs } from '@/lib/ai/acp-mcp';
import { restoreOrCreateAcpSession } from '@/lib/ai/acp-session-restore';
import { resolveInteractiveConnection } from '@/lib/ai/local-agent-routing';
import type { Connection } from '@/lib/ai/connections';
import type { AcpAgentCapabilities } from '@/lib/ai/acp-utils';

const presetConn: Connection = {
  id: 'preset',
  provider: 'custom_acp',
  authMethod: 'agent_managed',
  status: 'connected',
  label: 'Local Agent',
  credentials: { type: 'agent_managed', agentBinary: '/opt/goose' },
  capabilities: ['interactive'],
  config: { binaryPath: '/opt/goose', binaryArgs: ['acp'], localAgentPreset: 'goose' },
  createdAt: 0,
};

const localBundledConn: Connection = {
  id: 'lb',
  provider: 'local_ai',
  authMethod: 'local_bundled',
  status: 'connected',
  label: 'Local (bundled)',
  credentials: { type: 'local_bundled' },
  capabilities: ['interactive'],
  createdAt: 0,
};

const stdioCaps: AcpAgentCapabilities = { mcp: { stdio: {} }, loadSession: true };

function mcpServer(overrides: Partial<McpServerEntry> = {}): McpServerEntry {
  return {
    id: 'fs',
    name: 'Filesystem',
    command: '/usr/bin/mcp-fs',
    args: [],
    env: {},
    source: 'notesage-global',
    enabled: true,
    status: 'stopped',
    tools: [],
    transport: 'stdio',
    projectRoot: null,
    ...overrides,
  };
}

describe('Local Agent M2 integration (task #14)', () => {
  beforeEach(() => {
    clearMockInvokeHandlers();
    useMcpStore.setState({ servers: [], enabledOverrides: {}, rescanCounter: 0 });
  });

  it('preset: spawn injects isolation env + llama port, and session/new carries MCP servers', async () => {
    // The bundled-server config (#8) the preset regenerates before spawn.
    setMockInvokeHandler('local_agent_write_config', () => ({
      configPath: '/x/goose',
      env: {
        GOOSE_PROVIDER: 'openai',
        OPENAI_HOST: 'http://localhost:8137',
        GOOSE_MODEL: 'qwen2.5-coder-7b',
        XDG_CONFIG_HOME: '/x/goose/config',
      },
      configKey: '8137:qwen2.5-coder-7b',
      port: 8137,
      modelId: 'qwen2.5-coder-7b',
    }));
    let spawnArgs: Record<string, unknown> | null = null;
    setMockInvokeHandler('acp_agent_spawn', (args) => {
      spawnArgs = args as Record<string, unknown>;
      return { instance_id: 'inst-1', capabilities: stdioCaps };
    });
    setMockInvokeHandler('acp_agent_exists', () => true);
    setMockInvokeHandler('acp_agent_authenticate', () => { throw new Error('not implemented'); });
    let sessionArgs: Record<string, unknown> | null = null;
    setMockInvokeHandler('acp_session_new', (args) => {
      sessionArgs = args as Record<string, unknown>;
      return { session_id: 'sess-1', current_model: null, available_models: [], modes: null, config_options: null };
    });

    useMcpStore.setState({ servers: [mcpServer()] });

    const mod = await import('../acp-agent-state');
    mod.clearAcpAgent();
    const instanceId = await mod.ensureAcpAgent(presetConn, '/work', ['/work'], 'integration');

    // #10: respawn key is the live endpoint; #9/#8: isolation env + llama port reach the spawn.
    expect(mod.acpAgent!.configKey).toBe('8137:qwen2.5-coder-7b');
    expect((spawnArgs!.envVars as Record<string, string>).OPENAI_HOST).toBe('http://localhost:8137');
    expect((spawnArgs!.envVars as Record<string, string>).GOOSE_MODEL).toBe('qwen2.5-coder-7b');
    expect(spawnArgs!.extraLocalhostPorts).toEqual([8137]);

    // #11: the session carries the scope-matched, stdio-capability-gated server.
    const session = await restoreOrCreateAcpSession({
      instanceId,
      cwd: '/work',
      storedSessionId: undefined,
      capabilities: mod.acpAgent!.capabilities,
      mcpServers: buildAcpMcpServerInputs(mod.acpAgent!.capabilities, ['/work']),
    });
    expect(session.session_id).toBe('sess-1');
    const sentMcp = sessionArgs!.mcpServers as Array<{ id: string }>;
    expect(sentMcp.map((s) => s.id)).toEqual(['fs']);
  });

  it('an http-only MCP server is dropped when the agent only advertises stdio (#11 gating)', () => {
    useMcpStore.setState({
      servers: [
        mcpServer({ id: 'fs', transport: 'stdio' }),
        mcpServer({ id: 'remote', transport: 'http', command: '', url: 'https://x' }),
      ],
    });
    const inputs = buildAcpMcpServerInputs(stdioCaps, []);
    expect(inputs.map((s) => s.id)).toEqual(['fs']);
  });

  it('degraded preset routes to the local_bundled connection (#13 fallback)', () => {
    const conns = [presetConn, localBundledConn];
    expect(resolveInteractiveConnection(presetConn, conns, false)?.id).toBe('preset');
    expect(resolveInteractiveConnection(presetConn, conns, true)?.id).toBe('lb');
  });
});

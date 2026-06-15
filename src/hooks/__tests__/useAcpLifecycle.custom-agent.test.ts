// @vitest-environment jsdom
//
// Tests for task #4 of the local-ai-agents PRD (custom ACP agent connections).
// Locks three invariants:
//   (a) a `custom_acp` connection spawns via the same ACP pipeline with
//       `config.binaryPath` as the binary and `config.binaryArgs` as args
//       (env vars from `credentials.envVars`, unchanged);
//   (b) registration-time capability probing blocks registration on failure —
//       the rejection carries the agent's stderr tail and NOTHING is persisted;
//   (c) custom agents degrade safely where managed-provider lookups happen:
//       empty built-in domain allowlist, no managed install/update offers.
//
// Like `useAcpLifecycle.sandbox.test.ts`, this file uses the REAL
// `acp-agent-state` module so we observe actual `acp_agent_spawn` IPC calls.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';

import { useChatStore } from '@/stores/chat-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useConnectionsStore } from '@/stores/connections-store';
import type { Connection } from '@/lib/ai/connections';
import { PROVIDER_OPTIONS } from '@/lib/ai/connections';
import { canReauthenticate } from '@/lib/ai/reauth';

// ---------------------------------------------------------------------------
// Module mocks — must come before hook import
// ---------------------------------------------------------------------------

vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    getHomeDir: vi.fn().mockResolvedValue('/Users/test'),
    acpSessionSetMode: vi.fn().mockResolvedValue(undefined),
    acpSessionSetConfigOption: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/hooks/useAcpSessionListeners', () => ({
  setupAcpChatListeners: vi.fn().mockResolvedValue({
    unlistenUpdate: vi.fn(),
    unlistenPermission: vi.fn(),
    unlistenUsage: vi.fn(),
  }),
  buildAcpChatCleanup: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock('@/lib/ai/acp-session-restore', () => ({
  restoreOrCreateAcpSession: vi.fn().mockResolvedValue({
    session_id: 'sess-eager-1',
    current_model: null,
    available_models: [],
    modes: null,
    config_options: null,
  }),
}));

// ---------------------------------------------------------------------------
// Import the hook AFTER mocks. Import real `acp-agent-state` — NOT mocked.
// ---------------------------------------------------------------------------

import { useAcpLifecycle } from '@/hooks/useAcpLifecycle';
import { stopAllAcpAgents, registerCustomAcpConnection, resolveAgentLaunch } from '@/lib/ai/acp-agent-state';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BINARY_PATH = '/opt/agents/my-acp-agent';
const BINARY_ARGS = ['acp', '--verbose'];

function makeCustomConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-custom',
    provider: 'custom_acp',
    authMethod: 'agent_managed',
    status: 'connected',
    label: 'My Custom Agent',
    credentials: { type: 'agent_managed', agentBinary: BINARY_PATH, envVars: { MY_AGENT_KEY: 'secret' } },
    capabilities: ['interactive', 'agent_tasks'],
    config: { binaryPath: BINARY_PATH, binaryArgs: BINARY_ARGS },
    createdAt: Date.now(),
    ...overrides,
  } as Connection;
}

function installSpawnSpy(): { calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  setMockInvokeHandler('acp_agent_spawn', (args) => {
    calls.push((args ?? {}) as Record<string, unknown>);
    return {
      instance_id: `inst-${calls.length}`,
      agent_name: 'my-acp-agent',
      agent_version: '0.1.0',
      auth_methods: [],
      sandbox_enabled: false,
      network_sandbox_enabled: false,
      supports_images: false,
      capabilities: null,
    };
  });
  return { calls };
}

function installBaselineHandlers(): void {
  setMockInvokeHandler('acp_agent_stop', () => undefined);
  setMockInvokeHandler('acp_agent_exists', () => true);
  setMockInvokeHandler('acp_agent_authenticate', () => {
    throw new Error('not implemented');
  });
  setMockInvokeHandler('acp_is_agent_alive', () => true);
  setMockInvokeHandler('acp_permission_respond', () => undefined);
  setMockInvokeHandler('acp_session_cancel', () => undefined);
  setMockInvokeHandler('acp_session_new', () => ({
    session_id: 'sess-1',
    current_model: null,
    available_models: [],
    modes: null,
    config_options: null,
  }));
  setMockInvokeHandler('acp_session_prompt', () => undefined);
}

function seedConversation(projectPaths: string[]): void {
  useChatStore.setState({
    conversations: [{
      id: 'conv-test',
      title: '',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      projectPaths,
      segments: [{ projectPaths, sessionId: null, startMessageIndex: 0, historyIncluded: false }],
      activeSegmentIndex: 0,
      activeLeafId: null,
    }],
    activeConversationId: 'conv-test',
  });
}

function resetStores(): void {
  useChatStore.setState({ conversations: [], activeConversationId: null });
  useSettingsStore.setState({ crossProjectMode: false } as Partial<ReturnType<typeof useSettingsStore.getState>>);
  useWorkspaceStore.setState({ projects: [], explorerFolders: [] } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
  useConnectionsStore.setState({ connections: [] });
}

// ---------------------------------------------------------------------------
// (a) Spawn wiring — binaryPath/binaryArgs flow into acp_agent_spawn
// ---------------------------------------------------------------------------

describe('custom_acp — spawn wiring', () => {
  beforeEach(() => {
    installBaselineHandlers();
    resetStores();
    stopAllAcpAgents();
  });

  afterEach(() => {
    stopAllAcpAgents();
  });

  it('chat send spawns with config.binaryPath as binary, config.binaryArgs as args, credentials.envVars as env', async () => {
    const spawn = installSpawnSpy();
    seedConversation(['/work/projA']);

    const connection = makeCustomConnection();
    const { result } = renderHook(() =>
      useAcpLifecycle({ effectiveConnection: connection, acpSystemMessage: 'sys' }),
    );

    await act(async () => {
      await result.current.acpSendChatMessage('hello', []);
    });

    expect(spawn.calls.length).toBeGreaterThan(0);
    const last = spawn.calls[spawn.calls.length - 1];
    expect(last.agentBinary).toBe(BINARY_PATH);
    expect(last.agentArgs).toEqual(BINARY_ARGS);
    expect(last.envVars).toEqual({ MY_AGENT_KEY: 'secret' });
    // Keychain resolution inputs: the backend resolves each named var from
    // `notesage:<connectionId>:env:<KEY>`, overriding the IPC fallback above.
    expect(last.connectionId).toBe('conn-custom');
    expect(last.envVarKeys).toEqual(['MY_AGENT_KEY']);
  });

  it('config.binaryArgs absent → spawn args null (defaults to [])', async () => {
    const spawn = installSpawnSpy();
    seedConversation(['/work/projA']);

    const connection = makeCustomConnection({ config: { binaryPath: BINARY_PATH } });
    const { result } = renderHook(() =>
      useAcpLifecycle({ effectiveConnection: connection, acpSystemMessage: 'sys' }),
    );

    await act(async () => {
      await result.current.acpSendChatMessage('hello', []);
    });

    const last = spawn.calls[spawn.calls.length - 1];
    expect(last.agentBinary).toBe(BINARY_PATH);
    expect(last.agentArgs).toBeNull();
  });

  it('resolveAgentLaunch throws only when BOTH config.binaryPath AND credentials.agentBinary are absent', () => {
    const broken = makeCustomConnection({
      config: {},
      credentials: { type: 'agent_managed', agentBinary: '', envVars: {} },
    });
    expect(() => resolveAgentLaunch(broken)).toThrow(/no binary path/i);
  });

  it('resolveAgentLaunch falls back to credentials.agentBinary when config.binaryPath is missing (self-heal)', () => {
    // Regression lock: a 0.46.0-alpha.28 Local Agent preset connection was
    // observed in prod with `credentials.agentBinary` set but no `config` object
    // (config dropped/never-persisted). The old config-only read threw "has no
    // binary path configured", bricking the agent. The fallback heals it without
    // re-running setup.
    const healed = makeCustomConnection({
      config: {},
      credentials: { type: 'agent_managed', agentBinary: '/Users/me/.notesage/agents/bin/goose' },
    });
    expect(resolveAgentLaunch(healed)).toEqual({
      agentBinary: '/Users/me/.notesage/agents/bin/goose',
      agentArgs: [],
      envVars: null,
      envVarKeys: null,
    });
  });

  it('resolveAgentLaunch keeps managed connections on credentials.agentBinary', () => {
    const managed: Connection = {
      id: 'conn-managed',
      provider: 'anthropic',
      authMethod: 'agent_managed',
      status: 'connected',
      label: 'Claude Code',
      credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp', agentArgs: ['--flag'] },
      capabilities: ['interactive', 'agent_tasks'],
      createdAt: Date.now(),
    };
    expect(resolveAgentLaunch(managed)).toEqual({
      agentBinary: 'claude-agent-acp',
      agentArgs: ['--flag'],
      envVars: null,
      envVarKeys: null,
    });
  });
});

// ---------------------------------------------------------------------------
// (b) Registration-time probe — failure blocks registration, error carries
//     the agent's stderr tail
// ---------------------------------------------------------------------------

describe('custom_acp — registration probe', () => {
  beforeEach(() => {
    installBaselineHandlers();
    resetStores();
    stopAllAcpAgents();
  });

  afterEach(() => {
    stopAllAcpAgents();
  });

  it('probe failure → rejection includes stderr tail AND no connection is persisted', async () => {
    const backendError =
      'ACP initialize failed: connection closed\nAgent stderr (last 2 lines):\npanic: MY_AGENT_KEY not set\nexiting';
    setMockInvokeHandler('acp_agent_spawn', () => {
      throw new Error(backendError);
    });

    await expect(
      registerCustomAcpConnection({ label: 'Broken Agent', binaryPath: BINARY_PATH, binaryArgs: ['acp'] }),
    ).rejects.toThrow(/panic: MY_AGENT_KEY not set/);

    expect(useConnectionsStore.getState().connections).toEqual([]);
  });

  it('probe failure at session creation also blocks registration', async () => {
    installSpawnSpy();
    setMockInvokeHandler('acp_session_new', () => {
      throw new Error('session/new not supported');
    });

    await expect(
      registerCustomAcpConnection({ label: 'No Session Agent', binaryPath: BINARY_PATH }),
    ).rejects.toThrow(/session\/new not supported/);

    expect(useConnectionsStore.getState().connections).toEqual([]);
  });

  it('probe success → connection persisted with discovered capabilities', async () => {
    const spawn = installSpawnSpy();
    setMockInvokeHandler('acp_session_new', () => ({
      session_id: 'sess-probe',
      current_model: null,
      available_models: [],
      modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }] },
      config_options: null,
    }));

    const { connectionId, capabilities } = await registerCustomAcpConnection({
      label: 'My Custom Agent',
      binaryPath: BINARY_PATH,
      binaryArgs: BINARY_ARGS,
      envVars: { MY_AGENT_KEY: 'secret' },
    });

    // The probe spawn used the custom binary + args + env.
    const probeSpawn = spawn.calls[0];
    expect(probeSpawn.agentBinary).toBe(BINARY_PATH);
    expect(probeSpawn.agentArgs).toEqual(BINARY_ARGS);
    expect(probeSpawn.envVars).toEqual({ MY_AGENT_KEY: 'secret' });
    // Regression lock (code review #1/#2): `should_sandbox_by_default` in
    // sandbox.rs auto-sandboxes ONLY ~/.notesage/agents/bin paths, so a custom
    // absolute path would default to UNSANDBOXED. The probe must carry an
    // explicit sandboxEnabled=true — never null — for arbitrary binaries.
    expect(probeSpawn.sandboxEnabled).toBe(true);

    const persisted = useConnectionsStore.getState().getConnection(connectionId);
    expect(persisted).toBeDefined();
    expect(persisted!.provider).toBe('custom_acp');
    expect(persisted!.capabilities).toEqual(['interactive', 'agent_tasks']);
    // Regression lock: the persisted connection is maximally confined by
    // default — explicit values that override the backend's source-based
    // sandbox default at every future spawn.
    expect(persisted!.sandboxEnabled).toBe(true);
    expect(persisted!.networkSandboxEnabled).toBe(true);
    expect(persisted!.kernelNetworkDeny).toBe(true);
    expect(persisted!.config).toEqual({ binaryPath: BINARY_PATH, binaryArgs: BINARY_ARGS });
    expect(persisted!.acpCapabilities?.availableModes).toEqual([{ id: 'default', name: 'Default' }]);
    expect(capabilities.availableModes).toEqual([{ id: 'default', name: 'Default' }]);
  });
});

// ---------------------------------------------------------------------------
// (c) Safe degradation — empty domain allowlist, no managed install/update
// ---------------------------------------------------------------------------

describe('custom_acp — managed-provider lookups degrade safely', () => {
  beforeEach(() => {
    installBaselineHandlers();
    resetStores();
    stopAllAcpAgents();
  });

  afterEach(() => {
    stopAllAcpAgents();
  });

  it('network sandbox on → built-in domain allowlist is EMPTY (no provider match)', async () => {
    const spawn = installSpawnSpy();
    seedConversation(['/work/projA']);

    const connection = makeCustomConnection({ networkSandboxEnabled: true, kernelNetworkDeny: true });
    const { result } = renderHook(() =>
      useAcpLifecycle({ effectiveConnection: connection, acpSystemMessage: 'sys' }),
    );

    await act(async () => {
      await result.current.acpSendChatMessage('hello', []);
    });

    const last = spawn.calls[spawn.calls.length - 1];
    expect(last.networkSandboxEnabled).toBe(true);
    // No PROVIDER_OPTIONS entry matches an absolute binary path, and no user
    // domains were granted — the allowlist must be exactly empty.
    expect(last.networkAllowedDomains).toEqual([]);
  });

  it('custom_acp has no PROVIDER_OPTIONS entry — managed install/update surfaces never match it', () => {
    // Install offers and built-in allowlists key off PROVIDER_OPTIONS (by
    // provider or by agentBinary/lspBinary). An absent entry means custom
    // agents are treated as user-managed everywhere.
    expect(PROVIDER_OPTIONS.find((o) => o.provider === 'custom_acp')).toBeUndefined();
    expect(
      PROVIDER_OPTIONS.find((o) => o.agentBinary === BINARY_PATH || o.lspBinary === BINARY_PATH),
    ).toBeUndefined();
  });

  it('managed-update map (keyed by registry agent ids) never matches a custom binary path', () => {
    // `agent_check_updates` returns entries keyed by managed registry ids
    // ('claude-agent-acp', 'codex-acp', ...). ConnectionsSettings derives
    // `updateAvailable` via `agentUpdates[creds.agentBinary]` — an absolute
    // path can never collide with a registry id, so custom connections are
    // never offered a managed update.
    const agentUpdates: Record<string, { currentVersion: string; latestVersion: string }> = {
      'claude-agent-acp': { currentVersion: '1.0.0', latestVersion: '1.1.0' },
      'codex-acp': { currentVersion: '2.0.0', latestVersion: '2.1.0' },
    };
    expect(agentUpdates[BINARY_PATH]).toBeUndefined();
  });

  it('re-authentication is not offered for custom binaries', () => {
    expect(canReauthenticate(BINARY_PATH)).toBe(false);
  });
});

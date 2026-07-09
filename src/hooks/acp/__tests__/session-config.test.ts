// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Connection } from '@/lib/ai/connections';
import type { AcpSessionResult } from '@/lib/ai/acp-utils';
import { useChatStore } from '@/stores/chat-store';

// ---------------------------------------------------------------------------
// Fresh-session config helpers extracted from `useAcpLifecycle`. The composed
// hook tests drive the happy path; these unit tests isolate the branch logic:
// the skip guards in cacheAgentModels / applyConnectionModelOption, the
// restored-vs-fresh precedence in reapplySessionMode, and the exact call
// sequence applyFreshSessionConfig fans out to.
//
// The `@/lib/ai/acp-agent-state` mutators, `setAgentModels`, and the Tauri IPC
// are mocked so we can assert on the calls without a live agent.
// ---------------------------------------------------------------------------

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    acpSessionSetMode: vi.fn().mockResolvedValue(undefined),
    acpSessionSetConfigOption: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/lib/ai/connections', () => ({
  setAgentModels: vi.fn(),
}));

vi.mock('@/lib/ai/acp-agent-state', () => ({
  setSessionModes: vi.fn(),
  setSessionConfigOptions: vi.fn(),
  updateCurrentMode: vi.fn(),
  updateConfigOptionValue: vi.fn(),
  backfillAcpCapabilities: vi.fn(),
  // Real precedence: an explicit per-conversation pick wins, else connection default.
  resolveConfiguredModeId: vi.fn(
    (convMode: string | undefined, connection: Connection | null) =>
      convMode ?? connection?.acpDefaults?.modeId,
  ),
}));

import { tauriApi } from '@/lib/tauri';
import { setAgentModels } from '@/lib/ai/connections';
import {
  setSessionModes,
  setSessionConfigOptions,
  updateCurrentMode,
  updateConfigOptionValue,
  backfillAcpCapabilities,
} from '@/lib/ai/acp-agent-state';
import {
  reapplySessionMode,
  applyConnectionModelOption,
  cacheAgentModels,
  applyFreshSessionConfig,
} from '@/hooks/acp/session-config';

const INSTANCE = 'inst-1';

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    provider: 'anthropic',
    label: 'Claude Code',
    capabilities: ['interactive', 'agent_tasks'],
    credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp' },
    createdAt: Date.now(),
    ...overrides,
  } as Connection;
}

function makeSession(overrides: Partial<AcpSessionResult> = {}): AcpSessionResult {
  return {
    session_id: 'sess-1',
    current_model: null,
    available_models: [],
    modes: null,
    config_options: null,
    ...overrides,
  };
}

/**
 * Set the active conversation's remembered permission mode so reapplySessionMode
 * can read `agentModeId`. Only id + agentModeId are load-bearing here.
 */
function setActiveConvMode(agentModeId: string | undefined): void {
  useChatStore.setState({
    conversations: [{ id: 'active-conv', agentModeId }] as unknown as ReturnType<
      typeof useChatStore.getState
    >['conversations'],
    activeConversationId: 'active-conv',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.setState({ conversations: [], activeConversationId: null });
});

describe('cacheAgentModels', () => {
  it('does nothing when the session reports no models', () => {
    cacheAgentModels(makeConnection(), makeSession({ available_models: [] }));
    expect(setAgentModels).not.toHaveBeenCalled();
  });

  it('does nothing when there is no connection to attach the models to', () => {
    cacheAgentModels(
      null,
      makeSession({
        available_models: [{ model_id: 'm1', name: 'Model One', description: null }],
      }),
    );
    expect(setAgentModels).not.toHaveBeenCalled();
  });

  it('maps the agent model list and current model onto the connection', () => {
    cacheAgentModels(
      makeConnection({ id: 'conn-x' }),
      makeSession({
        current_model: 'm2',
        available_models: [
          { model_id: 'm1', name: 'Model One', description: 'first' },
          { model_id: 'm2', name: 'Model Two', description: null },
        ],
      }),
    );
    expect(setAgentModels).toHaveBeenCalledWith(
      'conn-x',
      [
        { modelId: 'm1', name: 'Model One', description: 'first' },
        { modelId: 'm2', name: 'Model Two', description: null },
      ],
      'm2',
    );
  });
});

describe('applyConnectionModelOption', () => {
  it('skips when no model is configured', async () => {
    await applyConnectionModelOption(INSTANCE, makeSession(), undefined);
    expect(tauriApi.acpSessionSetConfigOption).not.toHaveBeenCalled();
    expect(updateConfigOptionValue).not.toHaveBeenCalled();
  });

  it('skips when the session id is missing', async () => {
    await applyConnectionModelOption(
      INSTANCE,
      makeSession({ session_id: '' }),
      'claude-4-sonnet',
    );
    expect(tauriApi.acpSessionSetConfigOption).not.toHaveBeenCalled();
  });

  it('skips (no throw) when the agent exposes no model-category config option', async () => {
    const session = makeSession({
      config_options: [{ id: 'effort', name: 'Thinking', category: 'mode' }],
    });
    await applyConnectionModelOption(INSTANCE, session, 'claude-4-sonnet');
    expect(tauriApi.acpSessionSetConfigOption).not.toHaveBeenCalled();
    expect(updateConfigOptionValue).not.toHaveBeenCalled();
  });

  it('sets the model on the model-category option and mirrors it into UI state', async () => {
    const session = makeSession({
      config_options: [
        { id: 'mode-opt', name: 'Mode', category: 'mode' },
        { id: 'model-opt', name: 'Model', category: 'model' },
      ],
    });
    await applyConnectionModelOption(INSTANCE, session, 'claude-4-sonnet');
    expect(tauriApi.acpSessionSetConfigOption).toHaveBeenCalledWith(
      INSTANCE,
      'sess-1',
      'model-opt',
      'claude-4-sonnet',
    );
    expect(updateConfigOptionValue).toHaveBeenCalledWith('model-opt', 'claude-4-sonnet');
  });

  it('swallows a rejected set (agent rejected the model id) and skips the UI mirror', async () => {
    vi.mocked(tauriApi.acpSessionSetConfigOption).mockRejectedValueOnce(new Error('unknown model'));
    const session = makeSession({
      config_options: [{ id: 'model-opt', name: 'Model', category: 'model' }],
    });
    await expect(
      applyConnectionModelOption(INSTANCE, session, 'bogus-model'),
    ).resolves.toBeUndefined();
    expect(updateConfigOptionValue).not.toHaveBeenCalled();
  });
});

describe('reapplySessionMode', () => {
  const modes = {
    currentModeId: 'default',
    availableModes: [
      { id: 'default', name: 'Read Only' },
      { id: 'agent', name: 'Agent' },
    ],
  };

  it('no-ops when the session has no modes', () => {
    reapplySessionMode(INSTANCE, makeSession({ modes: null }), makeConnection(), false);
    expect(updateCurrentMode).not.toHaveBeenCalled();
    expect(tauriApi.acpSessionSetMode).not.toHaveBeenCalled();
  });

  it('no-ops when the target mode already equals the session current mode', () => {
    setActiveConvMode('default'); // matches modes.currentModeId
    reapplySessionMode(INSTANCE, makeSession({ modes }), makeConnection(), false);
    expect(updateCurrentMode).not.toHaveBeenCalled();
    expect(tauriApi.acpSessionSetMode).not.toHaveBeenCalled();
  });

  it('fresh session: re-applies the conversation pick that differs from the current mode', () => {
    setActiveConvMode('agent');
    reapplySessionMode(INSTANCE, makeSession({ modes }), makeConnection(), false);
    expect(updateCurrentMode).toHaveBeenCalledWith('agent');
    expect(tauriApi.acpSessionSetMode).toHaveBeenCalledWith(INSTANCE, 'sess-1', 'agent');
  });

  it('fresh session: falls back to the connection default when no conversation pick exists', () => {
    setActiveConvMode(undefined);
    const connection = makeConnection({ acpDefaults: { modeId: 'agent' } } as Partial<Connection>);
    reapplySessionMode(INSTANCE, makeSession({ modes }), connection, false);
    expect(updateCurrentMode).toHaveBeenCalledWith('agent');
    expect(tauriApi.acpSessionSetMode).toHaveBeenCalledWith(INSTANCE, 'sess-1', 'agent');
  });

  it('restored session: does NOT impose the connection default over the agent-restored mode', () => {
    setActiveConvMode(undefined); // no explicit pick
    const connection = makeConnection({ acpDefaults: { modeId: 'agent' } } as Partial<Connection>);
    reapplySessionMode(INSTANCE, makeSession({ modes }), connection, true);
    // restored=true → targetMode is convMode (undefined) → early return, no imposition.
    expect(updateCurrentMode).not.toHaveBeenCalled();
    expect(tauriApi.acpSessionSetMode).not.toHaveBeenCalled();
  });

  it('restored session: an explicit conversation pick still wins', () => {
    setActiveConvMode('agent');
    const connection = makeConnection({ acpDefaults: { modeId: 'default' } } as Partial<Connection>);
    reapplySessionMode(INSTANCE, makeSession({ modes }), connection, true);
    expect(updateCurrentMode).toHaveBeenCalledWith('agent');
    expect(tauriApi.acpSessionSetMode).toHaveBeenCalledWith(INSTANCE, 'sess-1', 'agent');
  });
});

describe('applyFreshSessionConfig', () => {
  it('publishes modes + config options, backfills capabilities, and applies the model', async () => {
    setActiveConvMode(undefined);
    const modes = { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Read Only' }] };
    const configOptions = [{ id: 'model-opt', name: 'Model', category: 'model' }];
    const session = makeSession({ modes, config_options: configOptions });
    const connection = makeConnection({ config: { model: 'claude-4-sonnet' } } as Partial<Connection>);

    await applyFreshSessionConfig(INSTANCE, session, connection);

    expect(setSessionModes).toHaveBeenCalledWith(modes);
    expect(setSessionConfigOptions).toHaveBeenCalledWith(configOptions);
    expect(backfillAcpCapabilities).toHaveBeenCalledWith('conn-1', session);
    // Model applied via the model-category config option.
    expect(tauriApi.acpSessionSetConfigOption).toHaveBeenCalledWith(
      INSTANCE,
      'sess-1',
      'model-opt',
      'claude-4-sonnet',
    );
  });

  it('publishes null modes/options when the session omits them (no crash)', async () => {
    const session = makeSession({ modes: null, config_options: null });
    await applyFreshSessionConfig(INSTANCE, session, null);
    expect(setSessionModes).toHaveBeenCalledWith(null);
    expect(setSessionConfigOptions).toHaveBeenCalledWith(null);
    expect(backfillAcpCapabilities).toHaveBeenCalledWith(undefined, session);
    // No model configured (connection is null) → no config-option write.
    expect(tauriApi.acpSessionSetConfigOption).not.toHaveBeenCalled();
  });
});

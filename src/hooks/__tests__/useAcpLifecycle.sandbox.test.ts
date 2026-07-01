// @vitest-environment jsdom
//
// Integration tests for task #7 of the project-data-isolation PRD.
// Locks the invariant: `acp_agent_spawn` is invoked with sandbox paths
// exactly equal to `selectedProjectPaths ∪ extraWritablePaths` for regular
// chat, and exactly equal to `[cwd]` for comment delegation and inline
// actions. Also asserts respawn-on-scope-change and cross-project mode.
//
// Unlike `useAcpLifecycle.test.ts`, this file uses the REAL `acp-agent-state`
// module so we can observe actual `acp_agent_spawn` IPC calls.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';

import { useChatStore } from '@/stores/chat-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { Connection } from '@/lib/ai/connections';

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

// Session-listener setup is out of scope for this test; stub it so we can
// drive `acpSendChatMessage` to completion without wiring real event streams.
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
import { clearAcpAgent } from '@/lib/ai/acp-agent-state';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgentConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-agent',
    provider: 'anthropic',
    authMethod: 'agent_managed',
    status: 'connected',
    label: 'Claude Code',
    credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp' },
    capabilities: ['interactive', 'agent_tasks'],
    createdAt: Date.now(),
    ...overrides,
  } as Connection;
}

/**
 * Capture args of every `acp_agent_spawn` invocation.
 * Returns the captured-args array and a reset helper.
 */
function installSpawnSpy(): { calls: Record<string, unknown>[]; reset: () => void } {
  const calls: Record<string, unknown>[] = [];
  setMockInvokeHandler('acp_agent_spawn', (args) => {
    calls.push((args ?? {}) as Record<string, unknown>);
    return {
      instance_id: `inst-${calls.length}`,
      agent_name: 'claude-agent-acp',
      agent_version: '1.0.0',
      auth_methods: [],
      sandbox_enabled: false,
      network_sandbox_enabled: false,
      supports_images: true,
      capabilities: null,
    };
  });
  return { calls, reset: () => { calls.length = 0; } };
}

function installBaselineHandlers(): void {
  // ensureAcpAgent's post-spawn checks + auth attempt.
  setMockInvokeHandler('acp_agent_stop', () => undefined);
  setMockInvokeHandler('acp_agent_exists', () => true);
  setMockInvokeHandler('acp_agent_authenticate', () => {
    throw new Error('not implemented');
  });
  setMockInvokeHandler('acp_is_agent_alive', () => true);
  setMockInvokeHandler('acp_permission_respond', () => undefined);
  setMockInvokeHandler('acp_session_cancel', () => undefined);

  // Session lifecycle (`acpSendChatMessage` / `acpGenerateText`).
  setMockInvokeHandler('acp_session_new', () => ({
    session_id: 'sess-1',
    current_model: null,
    available_models: [],
    modes: null,
    config_options: null,
  }));
  setMockInvokeHandler('acp_session_prompt', () => undefined);
}

function seedConversation(projectPaths: string[]): string {
  const id = 'conv-test';
  useChatStore.setState({
    conversations: [{
      id,
      title: '',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      projectPaths,
      segments: [{ projectPaths, sessionId: null, startMessageIndex: 0, historyIncluded: false }],
      activeSegmentIndex: 0,
      activeLeafId: null,
    }],
    activeConversationId: id,
  });
  return id;
}

function resetStores(): void {
  useChatStore.setState({ conversations: [], activeConversationId: null });
  useSettingsStore.setState({ crossProjectMode: false } as Partial<ReturnType<typeof useSettingsStore.getState>>);
  useWorkspaceStore.setState({ projects: [], explorerFolders: [] } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAcpLifecycle — ACP sandbox paths match selected scope (task #7)', () => {
  beforeEach(() => {
    installBaselineHandlers();
    resetStores();
    clearAcpAgent();
  });

  afterEach(() => {
    clearAcpAgent();
  });

  // -------------------------------------------------------------------------
  // Regular chat — union of selected projects + extraWritablePaths
  // -------------------------------------------------------------------------

  it('regular chat: spawn sandboxPaths = selectedProjectPaths ∪ extraWritablePaths', async () => {
    const spawn = installSpawnSpy();
    seedConversation(['/work/projA', '/work/projB']);

    const connection = makeAgentConnection({ extraWritablePaths: ['/tmp/agent-work'] });
    const { result } = renderHook(() =>
      useAcpLifecycle({
        effectiveConnection: connection,
        acpSystemMessage: 'sys',
      }),
    );

    await act(async () => {
      await result.current.acpSendChatMessage('hello', []);
    });

    // There may be extra spawns from the eager-session effect; the *last* spawn
    // matches `send-chat` scope because any eager spawn with different scope
    // triggers a respawn via `sandboxScopeKey` change.
    const last = spawn.calls[spawn.calls.length - 1];
    const paths = (last.sandboxPaths as string[]).slice().sort();
    expect(paths).toEqual(['/tmp/agent-work', '/work/projA', '/work/projB']);
  });

  it('regular chat: no extraWritablePaths → sandboxPaths = selectedProjectPaths only', async () => {
    const spawn = installSpawnSpy();
    seedConversation(['/work/projA', '/work/projB']);

    const connection = makeAgentConnection();
    const { result } = renderHook(() =>
      useAcpLifecycle({
        effectiveConnection: connection,
        acpSystemMessage: 'sys',
      }),
    );

    await act(async () => {
      await result.current.acpSendChatMessage('hello', []);
    });

    const last = spawn.calls[spawn.calls.length - 1];
    const paths = (last.sandboxPaths as string[]).slice().sort();
    expect(paths).toEqual(['/work/projA', '/work/projB']);
  });

  // -------------------------------------------------------------------------
  // Scope change triggers respawn
  // -------------------------------------------------------------------------

  it('changing selectedProjectPaths triggers a new spawn with the updated scope', async () => {
    const spawn = installSpawnSpy();
    seedConversation(['/work/projA']);

    const connection = makeAgentConnection();
    const { result } = renderHook(() =>
      useAcpLifecycle({
        effectiveConnection: connection,
        acpSystemMessage: 'sys',
      }),
    );

    // First send — spawns for projA
    await act(async () => {
      await result.current.acpSendChatMessage('hello', []);
    });
    const firstSpawn = spawn.calls[spawn.calls.length - 1];
    expect((firstSpawn.sandboxPaths as string[]).slice().sort()).toEqual(['/work/projA']);

    // Now switch the conversation's projectPaths to a different set
    const spawnCountBeforeSwitch = spawn.calls.length;
    await act(async () => {
      useChatStore.getState().setSelectedProjectPaths(['/work/projB', '/work/projC']);
    });

    // Second send — should respawn because sandboxScopeKey changed
    await act(async () => {
      await result.current.acpSendChatMessage('again', [{ role: 'user', content: 'hello' }]);
    });

    expect(spawn.calls.length).toBeGreaterThan(spawnCountBeforeSwitch);
    const latestSpawn = spawn.calls[spawn.calls.length - 1];
    expect((latestSpawn.sandboxPaths as string[]).slice().sort()).toEqual([
      '/work/projB',
      '/work/projC',
    ]);
  });

  // -------------------------------------------------------------------------
  // Cross-project mode
  // -------------------------------------------------------------------------

  it('crossProjectMode=true: spawn includes ALL workspace paths (projects + explorer folders)', async () => {
    const spawn = installSpawnSpy();

    useWorkspaceStore.setState({
      projects: [
        { path: '/work/projA', fileTree: [] },
        { path: '/work/projB', fileTree: [] },
        { path: '/work/projC', fileTree: [] },
      ],
      explorerFolders: [{ path: '/elsewhere/explorer', fileTree: [] }],
    } as Partial<ReturnType<typeof useWorkspaceStore.getState>>);

    // Only projA is selected — but cross-project mode should expand scope.
    seedConversation(['/work/projA']);
    useSettingsStore.setState({ crossProjectMode: true } as Partial<ReturnType<typeof useSettingsStore.getState>>);

    const connection = makeAgentConnection();
    const { result } = renderHook(() =>
      useAcpLifecycle({
        effectiveConnection: connection,
        acpSystemMessage: 'sys',
      }),
    );

    await act(async () => {
      await result.current.acpSendChatMessage('hello', []);
    });

    const last = spawn.calls[spawn.calls.length - 1];
    const paths = (last.sandboxPaths as string[]).slice().sort();
    expect(paths).toEqual([
      '/elsewhere/explorer',
      '/work/projA',
      '/work/projB',
      '/work/projC',
    ]);
  });

  // -------------------------------------------------------------------------
  // Comment delegation — single-project scope
  //
  // Invariant: when `opts.sandboxPaths` is supplied (the comment-delegation path),
  // `ensureAcpAgent` is invoked with exactly that array — never widened to the
  // chat's current multi-project scope. We assert this by inspecting the specific
  // spawn triggered by the delegation call, not a trailing spawn from the eager
  // session effect (which respawns against the chat scope on its own timeline).
  // -------------------------------------------------------------------------

  it('comment delegation: sandboxPaths = [cwd] only, even when multiple projects are selected', async () => {
    const spawn = installSpawnSpy();
    // Seed the chat with multiple selected projects so we can prove that
    // comment delegation does NOT widen to the chat's scope.
    seedConversation(['/work/projA', '/work/projB']);

    const connection = makeAgentConnection();
    const { result } = renderHook(() =>
      useAcpLifecycle({
        effectiveConnection: connection,
        acpSystemMessage: 'sys',
      }),
    );

    // Let the eager-session effect resolve first (spawns for the chat scope
    // with sandboxScopeKey = '|/work/projA|/work/projB'). Delegation runs next
    // against a different scope — it must respawn, not reuse.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    spawn.reset();

    // Comment delegation passes `opts.sandboxPaths = [cwd]`, narrowing scope
    // to the source comment's single project.
    const commentCwd = '/work/comment-project';
    await act(async () => {
      await result.current.acpSendChatMessage('review this', [], {
        sandboxPaths: [commentCwd],
      });
    });

    // There MUST be a spawn whose sandboxPaths = [commentCwd] — the scope
    // narrowing for comment delegation.
    const delegationSpawn = spawn.calls.find((c) => {
      const paths = c.sandboxPaths as string[] | null | undefined;
      return Array.isArray(paths) && paths.length === 1 && paths[0] === commentCwd;
    });
    expect(delegationSpawn, 'delegation must trigger a spawn with exactly [commentCwd]').toBeDefined();
    expect(delegationSpawn!.sandboxPaths).toEqual([commentCwd]);

    // And the delegation spawn must NOT include either of the chat's projects.
    expect(delegationSpawn!.sandboxPaths).not.toContain('/work/projA');
    expect(delegationSpawn!.sandboxPaths).not.toContain('/work/projB');
  });

  // -------------------------------------------------------------------------
  // Inline actions — single-project scope
  //
  // `acpGenerateText` derives `cwd` from `selectedProjectPaths[0]` and passes
  // `inlineSandboxPaths = cwd !== '/tmp' ? [cwd] : []`. The invariant we lock
  // here: the inline spawn does not inherit additional selected projects from
  // the chat's multi-select project picker.
  // -------------------------------------------------------------------------

  it('inline action: sandboxPaths = [cwd] only, even when multiple projects are selected', async () => {
    const spawn = installSpawnSpy();
    seedConversation(['/work/projA', '/work/projB']);

    const connection = makeAgentConnection({ extraWritablePaths: ['/tmp/agent-work'] });
    const { result } = renderHook(() =>
      useAcpLifecycle({
        effectiveConnection: connection,
        acpSystemMessage: 'sys',
      }),
    );

    // Let eager-session spawn resolve before firing the inline action, so the
    // scope-key mismatch triggers a respawn that we can observe in isolation.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    spawn.reset();

    await act(async () => {
      await result.current.acpGenerateText('rewrite this paragraph');
    });

    // Locate the inline spawn — its sandboxPaths must be exactly projA + the
    // extra writable path. The chat's second project (projB) must NOT appear.
    const inlineSpawn = spawn.calls.find((c) => {
      const paths = c.sandboxPaths as string[] | null | undefined;
      if (!Array.isArray(paths)) return false;
      const sorted = [...paths].sort();
      return (
        sorted.length === 2 &&
        sorted[0] === '/tmp/agent-work' &&
        sorted[1] === '/work/projA'
      );
    });
    expect(inlineSpawn, 'inline action must spawn with sandboxPaths = [cwd, extraWritable]').toBeDefined();
    expect(inlineSpawn!.sandboxPaths).not.toContain('/work/projB');
  });

  it('inline action: cwd=/tmp (no project) → sandboxPaths = extraWritablePaths only (no /tmp leak)', async () => {
    const spawn = installSpawnSpy();
    seedConversation([]);  // No project selected → cwd falls back to /tmp

    const connection = makeAgentConnection({ extraWritablePaths: ['/tmp/agent-work'] });
    const { result } = renderHook(() =>
      useAcpLifecycle({
        effectiveConnection: connection,
        acpSystemMessage: 'sys',
      }),
    );

    await act(async () => {
      await result.current.acpGenerateText('rewrite this');
    });

    // `inlineSandboxPaths = cwd !== '/tmp' ? [cwd] : []` — `/tmp` is explicitly
    // filtered out to avoid granting writes to the entire temp dir. With no
    // project selected, the only remaining path is extraWritablePaths.
    // Find the spawn matching this specific shape (may not be the last, since
    // the eager effect can also spawn for the same connection).
    const inlineSpawn = spawn.calls.find((c) => {
      const paths = c.sandboxPaths as string[] | null | undefined;
      return Array.isArray(paths) && paths.length === 1 && paths[0] === '/tmp/agent-work';
    });
    expect(inlineSpawn, 'inline action with no project must spawn with extraWritablePaths only').toBeDefined();
  });
});

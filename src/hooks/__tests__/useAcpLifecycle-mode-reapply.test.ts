// @vitest-environment jsdom
//
// Regression test for the "Agent mode silently reverts to Read Only" bug.
//
// A sandbox-scope change respawns the ACP agent and creates a fresh session that
// resets to the agent's own default mode (Claude Code → 'default' = Read Only).
// `reapplySessionMode` must re-assert the conversation's remembered mode after every
// such session creation, so the user's "Agent" pick survives the respawn.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';

// Mock logger + tauriApi BEFORE importing the hook. We keep the REAL
// acp-agent-state so updateCurrentMode/setSessionModes/getSessionInfo actually mutate.
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { acpSessionSetMode } = vi.hoisted(() => ({
  acpSessionSetMode: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    getHomeDir: vi.fn().mockResolvedValue('/Users/test'),
    acpSessionSetMode,
    acpSessionSetConfigOption: vi.fn().mockResolvedValue(undefined),
  },
}));

// Keep the session-listener wiring out of the import graph — not under test here.
vi.mock('@/hooks/useAcpSessionListeners', () => ({
  setupAcpChatListeners: vi.fn(),
  buildAcpChatCleanup: vi.fn(),
}));

import { reapplySessionMode } from '@/hooks/useAcpLifecycle';
import { setSessionModes, getSessionInfo, clearSessionInfo } from '@/lib/ai/acp-agent-state';
import { useChatStore } from '@/stores/chat-store';
import type { Connection } from '@/lib/ai/connections';
import type { AcpSessionResult } from '@/lib/ai/acp-utils';

const CLAUDE_MODES = [
  { id: 'default', name: 'Default' },
  { id: 'acceptEdits', name: 'Accept Edits' },
  { id: 'plan', name: 'Plan' },
  { id: 'bypassPermissions', name: 'Bypass Permissions' },
];

/** A fresh session as returned by a respawn — agent default 'default' (Read Only). */
function freshSession(currentModeId = 'default'): AcpSessionResult {
  return {
    session_id: 'sess-new',
    current_model: null,
    available_models: [],
    modes: { currentModeId, availableModes: CLAUDE_MODES },
    config_options: null,
  } as AcpSessionResult;
}

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-test',
    provider: 'anthropic',
    label: 'Test Agent',
    capabilities: ['interactive'],
    credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp' },
    ...overrides,
  } as Connection;
}

function newActiveConversation(): string {
  const id = useChatStore.getState().createConversation();
  return id;
}

describe('reapplySessionMode', () => {
  beforeEach(() => {
    acpSessionSetMode.mockClear();
    clearSessionInfo();
    // Reset the chat store to a clean slate between tests.
    useChatStore.setState({ conversations: [], activeConversationId: null });
  });

  it('re-applies the conversation-remembered mode after a respawn resets to default', () => {
    newActiveConversation();
    useChatStore.getState().setConversationMode('acceptEdits'); // user picked "Agent"

    // Simulate the respawn: a fresh session whose mode is the agent default.
    const session = freshSession('default');
    setSessionModes(session.modes); // mirrors the setSessionModes() call at the creation site

    reapplySessionMode('inst-1', session, makeConnection(), false);

    // The remembered pick is pushed to the live session AND optimistically reflected.
    expect(acpSessionSetMode).toHaveBeenCalledWith('inst-1', 'sess-new', 'acceptEdits');
    expect(getSessionInfo().modes?.currentModeId).toBe('acceptEdits');
  });

  it('falls back to the connection default for a fresh session with no remembered mode', () => {
    newActiveConversation(); // no setConversationMode → no remembered pick
    const session = freshSession('default');
    setSessionModes(session.modes);

    reapplySessionMode('inst-1', session, makeConnection({ acpDefaults: { modeId: 'plan' } }), false);

    expect(acpSessionSetMode).toHaveBeenCalledWith('inst-1', 'sess-new', 'plan');
    expect(getSessionInfo().modes?.currentModeId).toBe('plan');
  });

  it('does NOT impose the connection default on a restored session', () => {
    newActiveConversation(); // no remembered pick
    const session = freshSession('default');
    setSessionModes(session.modes);

    // restored = true → the loaded session already carries the agent's mode.
    reapplySessionMode('inst-1', session, makeConnection({ acpDefaults: { modeId: 'plan' } }), true);

    expect(acpSessionSetMode).not.toHaveBeenCalled();
    expect(getSessionInfo().modes?.currentModeId).toBe('default');
  });

  it('still re-applies an explicit conversation pick even on a restored session', () => {
    newActiveConversation();
    useChatStore.getState().setConversationMode('acceptEdits');
    const session = freshSession('default');
    setSessionModes(session.modes);

    reapplySessionMode('inst-1', session, makeConnection(), true);

    expect(acpSessionSetMode).toHaveBeenCalledWith('inst-1', 'sess-new', 'acceptEdits');
  });

  it('is a no-op when the session already carries the remembered mode', () => {
    newActiveConversation();
    useChatStore.getState().setConversationMode('acceptEdits');
    const session = freshSession('acceptEdits'); // agent already in Agent mode
    setSessionModes(session.modes);

    reapplySessionMode('inst-1', session, makeConnection(), false);

    expect(acpSessionSetMode).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
//
// Tests for `setupAcpChatListeners` — the chat-side ACP session-update dispatcher.
// Focus: silent `user_message_chunk` handling, inline `resource_link` rendering,
// and `unstable_message_id` (acpMessageId) propagation onto ChatMessages.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emitMockEvent, setMockInvokeHandler } from '@/test/tauri-mock';
import '@/test/tauri-mock';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// `resetUnresponsiveTimer` reaches back into the lifecycle module. Stub it — we're
// testing the dispatcher in isolation.
vi.mock('@/hooks/useAcpLifecycle', () => ({
  resetUnresponsiveTimer: vi.fn(),
}));

// Keep acp-agent-state side-effects no-op — we assert on chat-store, not globals.
vi.mock('@/lib/ai/acp-agent-state', () => ({
  updateCurrentMode: vi.fn(),
  updateConfigOptionValue: vi.fn(),
  updateUsage: vi.fn(),
  setAvailableCommands: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports under test (AFTER mocks are configured)
// ---------------------------------------------------------------------------

import { setupAcpChatListeners } from '@/hooks/useAcpSessionListeners';
import { useChatStore } from '@/stores/chat-store';
import { usePermissionStore } from '@/stores/permission-store';
import type { ChatMessage, Segment } from '@/lib/ai/types';

// ---------------------------------------------------------------------------
// Helpers — minimal chat-store seed matching what `acpSendChatMessage` produces.
// ---------------------------------------------------------------------------

const INSTANCE_ID = 'inst-listener-1';
const USER_TIMESTAMP = 1_700_000_000;
const ASSISTANT_TIMESTAMP = USER_TIMESTAMP + 1;

function seedChatStoreWithUserAndAssistant(): void {
  useChatStore.setState({
    conversations: [
      {
        id: 'conv-l',
        title: 'Listener test',
        messages: [
          { id: 'user-uuid-1', role: 'user', content: 'hi', timestamp: USER_TIMESTAMP, parentId: null },
          { id: 'assistant-uuid-1', role: 'assistant', content: '', timestamp: ASSISTANT_TIMESTAMP, parentId: 'user-uuid-1' },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        projectPaths: [],
        segments: [{ projectPaths: [], sessionId: null, startMessageIndex: 0, historyIncluded: false }],
        activeSegmentIndex: 0,
        activeLeafId: 'assistant-uuid-1',
      },
    ],
    activeConversationId: 'conv-l',
  });
}

/**
 * Build the `ChatListenerDeps` object with thin store-wired action stubs.
 *
 * `pathFilterRoots: []` is the secure default — no project scope means only system /
 * safe-home paths pass the filter. Tests that fire `acp-permission-request` for any
 * other path will see auto-deny; override `pathFilterRoots` per-test to widen scope.
 */
function makeDeps(): Parameters<typeof setupAcpChatListeners>[0] {
  const store = useChatStore.getState();
  const recordedSegments: Segment[] = [];
  return {
    instanceId: INSTANCE_ID,
    assistantMessageId: ASSISTANT_TIMESTAMP,
    conversationId: 'conv-l',
    pathFilterRoots: [],
    homeDir: '/Users/test',
    updateMessage: (id, content) => store.updateMessage(id, content),
    addMessage: (m: ChatMessage) => store.addMessage(m),
    setActiveTool: vi.fn(),
    addActivity: (id, a) => store.addActivity(id, a),
    completeLastActivity: (id) => store.completeLastActivity(id),
    completeAllActivities: (id) => store.completeAllActivities(id),
    appendTextSegment: (id, t) => store.appendTextSegment(id, t),
    appendThinkingSegment: (id, t) => store.appendThinkingSegment(id, t),
    pushSegment: (id, seg) => { recordedSegments.push(seg); store.pushSegment(id, seg); },
    updateSegment: (id, idx, patch) => store.updateSegment(id, idx, patch),
    updateOrPushPlanSegment: (id, entries) => store.updateOrPushPlanSegment(id, entries),
    finalizeSegments: (id) => store.finalizeSegments(id),
  };
}

function getAssistantMessage(): ChatMessage | undefined {
  const st = useChatStore.getState();
  const conv = st.conversations.find((c) => c.id === st.activeConversationId);
  return conv?.messages.find((m) => m.timestamp === ASSISTANT_TIMESTAMP);
}

function getUserMessage(): ChatMessage | undefined {
  const st = useChatStore.getState();
  const conv = st.conversations.find((c) => c.id === st.activeConversationId);
  return conv?.messages.find((m) => m.timestamp === USER_TIMESTAMP);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('setupAcpChatListeners', () => {
  beforeEach(() => {
    useChatStore.setState({ conversations: [], activeConversationId: null });
    vi.clearAllMocks();
    seedChatStoreWithUserAndAssistant();
  });

  describe('user_message_chunk (silent noop)', () => {
    it('does not mutate chat-store state and does not log "Unknown" for user_message_chunk', async () => {
      const { log } = await import('@/lib/logger');
      const logDebug = vi.mocked(log.debug);

      const { unlisten, unlistenPermission, getStreamedContent } = await setupAcpChatListeners(makeDeps());

      emitMockEvent('acp-session-update', {
        instanceId: INSTANCE_ID,
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'user_message_chunk',
          content: { type: 'text', text: 'echoed' },
        },
      });

      // No streamed content — user_message_chunk is a noop.
      expect(getStreamedContent()).toBe('');

      // Assistant content remains empty (no mutation).
      expect(getAssistantMessage()?.content).toBe('');
      expect(getAssistantMessage()?.segments ?? []).toHaveLength(0);

      // Critically: no "Unknown ACP session update type" debug log.
      const unknownCalls = logDebug.mock.calls.filter((call) =>
        typeof call[1] === 'string' && /unknown/i.test(call[1] as string),
      );
      expect(unknownCalls.length).toBe(0);

      unlisten();
      unlistenPermission();
    });
  });

  describe('resource_link rendering', () => {
    it('appends a markdown link to streamedContent and the text segment', async () => {
      const { unlisten, unlistenPermission, getStreamedContent } = await setupAcpChatListeners(makeDeps());

      emitMockEvent('acp-session-update', {
        instanceId: INSTANCE_ID,
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'resource_link',
            uri: 'https://example.com/docs/intro',
            name: 'Introduction',
          },
        },
      });

      const expected = '[Introduction](https://example.com/docs/intro)';
      expect(getStreamedContent()).toBe(expected);
      expect(getAssistantMessage()?.content).toBe(expected);

      const segments = getAssistantMessage()?.segments ?? [];
      const textSegs = segments.filter((s) => s.type === 'text');
      expect(textSegs.length).toBeGreaterThan(0);
      const combined = textSegs.map((s) => (s as { content: string }).content).join('');
      expect(combined).toBe(expected);

      unlisten();
      unlistenPermission();
    });

    it('falls back to URI basename when name is missing', async () => {
      const { unlisten, unlistenPermission, getStreamedContent } = await setupAcpChatListeners(makeDeps());

      emitMockEvent('acp-session-update', {
        instanceId: INSTANCE_ID,
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'resource_link',
            uri: 'file:///project/notes/readme.md',
          },
        },
      });

      expect(getStreamedContent()).toBe('[readme.md](file:///project/notes/readme.md)');

      unlisten();
      unlistenPermission();
    });

    it('appends description on a new line (truncated)', async () => {
      const { unlisten, unlistenPermission, getStreamedContent } = await setupAcpChatListeners(makeDeps());

      const longDesc = 'x'.repeat(120);
      emitMockEvent('acp-session-update', {
        instanceId: INSTANCE_ID,
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'resource_link',
            uri: 'https://example.com/foo',
            name: 'Foo',
            description: longDesc,
          },
        },
      });

      const content = getStreamedContent();
      expect(content.startsWith('[Foo](https://example.com/foo)\n')).toBe(true);
      const descLine = content.split('\n')[1];
      expect(descLine.length).toBeLessThanOrEqual(81);
      expect(descLine.endsWith('\u2026')).toBe(true);

      unlisten();
      unlistenPermission();
    });
  });

  describe('acpMessageId propagation (unstable_message_id)', () => {
    it('stores messageId on the assistant message when agent emits it', async () => {
      const { unlisten, unlistenPermission } = await setupAcpChatListeners(makeDeps());

      emitMockEvent('acp-session-update', {
        instanceId: INSTANCE_ID,
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'agent-abc',
          content: { type: 'text', text: 'hello' },
        },
      });

      expect(getAssistantMessage()?.acpMessageId).toBe('agent-abc');

      unlisten();
      unlistenPermission();
    });

    it('stores echoed user_message_id on the user message', async () => {
      const { unlisten, unlistenPermission } = await setupAcpChatListeners(makeDeps());

      emitMockEvent('acp-session-update', {
        instanceId: INSTANCE_ID,
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'agent-abc',
          userMessageId: 'user-xyz',
          content: { type: 'text', text: 'reply' },
        },
      });

      expect(getUserMessage()?.acpMessageId).toBe('user-xyz');
      expect(getAssistantMessage()?.acpMessageId).toBe('agent-abc');

      unlisten();
      unlistenPermission();
    });

    it('tolerates snake_case user_message_id (custom agents)', async () => {
      const { unlisten, unlistenPermission } = await setupAcpChatListeners(makeDeps());

      emitMockEvent('acp-session-update', {
        instanceId: INSTANCE_ID,
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          user_message_id: 'user-snake',
          content: { type: 'text', text: 'ok' },
        },
      });

      expect(getUserMessage()?.acpMessageId).toBe('user-snake');

      unlisten();
      unlistenPermission();
    });

    it('is a no-op when the agent emits neither field', async () => {
      const { unlisten, unlistenPermission } = await setupAcpChatListeners(makeDeps());

      emitMockEvent('acp-session-update', {
        instanceId: INSTANCE_ID,
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'plain' },
        },
      });

      expect(getAssistantMessage()?.acpMessageId).toBeUndefined();
      expect(getUserMessage()?.acpMessageId).toBeUndefined();

      unlisten();
      unlistenPermission();
    });
  });

  // -------------------------------------------------------------------------
  // Path-filter enforcement on permission requests (task #6)
  //
  // Red-team invariants for project isolation. The path filter must run
  // unconditionally and BEFORE auto-approval — otherwise an auto-allowed
  // tool kind (e.g. `read`) silently leaks files from other projects.
  // -------------------------------------------------------------------------
  describe('path filter on permission requests', () => {
    const PROJECT_A = '/Users/peter/Development/project-a';
    const PROJECT_B = '/Users/peter/Development/project-b';

    beforeEach(() => {
      usePermissionStore.getState().clearAll();
    });

    function makeScopedDeps(roots: string[]): Parameters<typeof setupAcpChatListeners>[0] {
      const base = makeDeps();
      return { ...base, pathFilterRoots: roots, homeDir: '/Users/peter' };
    }

    function emitPermissionRequest(filePath: string, toolKind = 'read'): void {
      emitMockEvent('acp-permission-request', {
        instanceId: INSTANCE_ID,
        sessionId: 'sess-1',
        requestId: 'req-1',
        toolCall: {
          kind: toolKind,
          title: `${toolKind} ${filePath}`,
          rawInput: JSON.stringify({ file_path: filePath }),
        },
        options: [{ optionId: 'allow_once', kind: 'allow_once', name: 'Allow once' }],
      });
    }

    it('denies an auto-allowed read targeting an out-of-scope path', async () => {
      // Seed `read` into the session-allow list so the auto-approve branch is taken
      // unless the path filter blocks first. This is the red-team invariant.
      usePermissionStore.getState().allowSession('read');

      let respondedOptionId: unknown = 'unset';
      setMockInvokeHandler('acp_permission_respond', (args) => {
        respondedOptionId = args?.optionId;
        return undefined;
      });

      const { unlisten, unlistenPermission } = await setupAcpChatListeners(makeScopedDeps([PROJECT_A]));

      emitPermissionRequest(PROJECT_B + '/secrets.env');

      // The path filter must run BEFORE auto-allow — denial wins.
      expect(respondedOptionId).toBeNull();

      // No system message — the agent narrates the denial itself, and the tool_call
      // segment shows the error state. A third "denied" notice would be redundant noise
      // (verified by user feedback on 2026-04-19: "I get double info").
      const conv = useChatStore.getState().conversations.find((c) => c.id === 'conv-l');
      const denyMsg = conv?.messages.find((m) => m.role === 'system' && /denied/i.test(m.content));
      expect(denyMsg).toBeUndefined();

      unlisten();
      unlistenPermission();
    });

    it('allows a read targeting a path inside any of the configured roots', async () => {
      usePermissionStore.getState().allowSession('read');

      let respondedOptionId: unknown = 'unset';
      setMockInvokeHandler('acp_permission_respond', (args) => {
        respondedOptionId = args?.optionId;
        return undefined;
      });

      const { unlisten, unlistenPermission } = await setupAcpChatListeners(
        makeScopedDeps([PROJECT_A, PROJECT_B]),
      );

      emitPermissionRequest(PROJECT_B + '/src/main.ts');

      // `read` is auto-allowed and the path is in scope — should auto-approve.
      expect(respondedOptionId).toBe('allow_once');

      const conv = useChatStore.getState().conversations.find((c) => c.id === 'conv-l');
      const denyMsg = conv?.messages.find((m) => m.role === 'system' && /denied/i.test(m.content));
      expect(denyMsg).toBeUndefined();

      unlisten();
      unlistenPermission();
    });

    it('denies an out-of-scope path even with empty roots (no project selected)', async () => {
      let respondedOptionId: unknown = 'unset';
      setMockInvokeHandler('acp_permission_respond', (args) => {
        respondedOptionId = args?.optionId;
        return undefined;
      });

      const { unlisten, unlistenPermission } = await setupAcpChatListeners(makeScopedDeps([]));

      emitPermissionRequest('/Users/peter/Documents/secret.txt');

      expect(respondedOptionId).toBeNull();

      unlisten();
      unlistenPermission();
    });
  });

  // -------------------------------------------------------------------------
  // Project-scoped auto-allow lookup (task #6b)
  //
  // Invariant: an "always allow read" granted within Project A must NOT
  // auto-approve reads while Project B is selected. The listener must
  // pass the active project root (and connection id) into `isAutoAllowed`
  // — currently it passes `null, null` so a single global always-entry
  // matches everywhere.
  // -------------------------------------------------------------------------
  describe('project-scoped auto-allow lookup (#6b)', () => {
    const PROJECT_A = '/Users/peter/Development/project-a';
    const PROJECT_B = '/Users/peter/Development/project-b';
    const CONN_ID = 'conn-claude';

    beforeEach(() => {
      usePermissionStore.getState().clearAll();
      usePermissionStore.setState({ alwaysAllowed: [] });
    });

    function emitPermissionRequest(filePath: string, toolKind = 'write'): void {
      emitMockEvent('acp-permission-request', {
        instanceId: INSTANCE_ID,
        sessionId: 'sess-1',
        requestId: 'req-1',
        toolCall: {
          kind: toolKind,
          title: `${toolKind} ${filePath}`,
          rawInput: JSON.stringify({ file_path: filePath }),
        },
        options: [{ optionId: 'allow_once', kind: 'allow_once', name: 'Allow once' }],
      });
    }

    it('does not auto-approve when "always" was granted for a different project', async () => {
      // Always-allow `write` granted in Project A only.
      usePermissionStore.getState().allowAlways('write', CONN_ID, PROJECT_A);

      let respondedOptionId: unknown = 'unset';
      setMockInvokeHandler('acp_permission_respond', (args) => {
        respondedOptionId = args?.optionId;
        return undefined;
      });

      // User is now in Project B with the same connection.
      const baseDeps = makeDeps();
      const deps = {
        ...baseDeps,
        pathFilterRoots: [PROJECT_B],
        homeDir: '/Users/peter',
        connectionId: CONN_ID,
        activeProjectRoot: PROJECT_B,
      };
      const { unlisten, unlistenPermission } = await setupAcpChatListeners(deps);

      // Permission request for an in-scope (Project B) write — passes path filter.
      emitPermissionRequest(PROJECT_B + '/output.txt');

      // Auto-approve must NOT fire — the always-entry was for Project A, not B.
      // The permission UI takes over instead (no immediate respond call with allow_once).
      expect(respondedOptionId).toBe('unset');

      // Permission request was added to the store for the UI to handle.
      expect(usePermissionStore.getState().requests.length).toBe(1);

      unlisten();
      unlistenPermission();
    });

    it('does auto-approve when "always" was granted for the active project', async () => {
      usePermissionStore.getState().allowAlways('write', CONN_ID, PROJECT_A);

      let respondedOptionId: unknown = 'unset';
      setMockInvokeHandler('acp_permission_respond', (args) => {
        respondedOptionId = args?.optionId;
        return undefined;
      });

      const baseDeps = makeDeps();
      const deps = {
        ...baseDeps,
        pathFilterRoots: [PROJECT_A],
        homeDir: '/Users/peter',
        connectionId: CONN_ID,
        activeProjectRoot: PROJECT_A,
      };
      const { unlisten, unlistenPermission } = await setupAcpChatListeners(deps);

      emitPermissionRequest(PROJECT_A + '/output.txt');

      expect(respondedOptionId).toBe('allow_once');
      expect(usePermissionStore.getState().requests.length).toBe(0);

      unlisten();
      unlistenPermission();
    });

    // Regression-lock for the documented backward-compat behavior. Legacy
    // `(null, null)` always-entries (created by users on prior versions before
    // scoped approvals existed) wildcard-match every project query. That's the
    // intended migration path — task #2 added a launch toast prompting users
    // to review and re-scope these. This test makes the behavior explicit so
    // any future change that breaks it (e.g., narrowing legacy entries) trips.
    it('legacy (null, null) always-entry still wildcard-matches across projects', async () => {
      usePermissionStore.getState().allowAlways('write', null, null);

      let respondedOptionId: unknown = 'unset';
      setMockInvokeHandler('acp_permission_respond', (args) => {
        respondedOptionId = args?.optionId;
        return undefined;
      });

      const baseDeps = makeDeps();
      const deps = {
        ...baseDeps,
        pathFilterRoots: [PROJECT_B],
        homeDir: '/Users/peter',
        connectionId: CONN_ID,
        activeProjectRoot: PROJECT_B,
      };
      const { unlisten, unlistenPermission } = await setupAcpChatListeners(deps);

      emitPermissionRequest(PROJECT_B + '/output.txt');

      // Legacy wildcard auto-approves regardless of active project — the
      // remediation is the migration toast (task #2), not silent re-scoping.
      expect(respondedOptionId).toBe('allow_once');

      unlisten();
      unlistenPermission();
    });
  });

});

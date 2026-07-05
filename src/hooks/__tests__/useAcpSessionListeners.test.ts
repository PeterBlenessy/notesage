// @vitest-environment jsdom
//
// Tests for `setupAcpChatListeners` — the chat-side ACP session-update dispatcher.
// Focus: silent `user_message_chunk` handling, inline `resource_link` rendering,
// and agent-assigned `messageId` (acpMessageId) propagation onto ChatMessages.

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

// `resetUnresponsiveTimer` reaches into the unresponsive-monitor runtime. Stub
// it — we're testing the dispatcher in isolation. (Import path updated when the
// timer moved from `useAcpLifecycle` to `acp/unresponsive-monitor`.)
vi.mock('@/hooks/acp/unresponsive-monitor', () => ({
  resetUnresponsiveTimer: vi.fn(),
}));

// Keep acp-agent-state side-effects no-op — we assert on chat-store, not globals.
vi.mock('@/lib/ai/acp-agent-state', () => ({
  updateCurrentMode: vi.fn(),
  updateConfigOptionValue: vi.fn(),
  updateUsage: vi.fn(),
  setAvailableCommands: vi.fn(),
  setLastTurnUsage: vi.fn(),
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
    setLastActivityApprovalMode: (id, mode) => store.setLastActivityApprovalMode(id, mode),
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

  // The id is agent-assigned (ContentChunk.message_id, stable since ACP 0.13.6) —
  // chunks of one assistant message share it. There is no client-supplied or
  // echoed user-message id.
  describe('acpMessageId propagation', () => {
    it('stores the agent-assigned messageId on the assistant message', async () => {
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

    it('tolerates snake_case message_id (custom agents)', async () => {
      const { unlisten, unlistenPermission } = await setupAcpChatListeners(makeDeps());

      emitMockEvent('acp-session-update', {
        instanceId: INSTANCE_ID,
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          message_id: 'agent-snake',
          content: { type: 'text', text: 'ok' },
        },
      });

      expect(getAssistantMessage()?.acpMessageId).toBe('agent-snake');

      unlisten();
      unlistenPermission();
    });

    it('is a no-op when the agent emits no messageId', async () => {
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
  // usage_update `_meta` ingestion (provider-usage-display #4)
  //
  // `_meta` is non-contractual — a populated `_claude/rateLimit` must reach
  // `updateUsage` as parsed rateLimit; malformed `_meta` must degrade to
  // exactly today's behavior (usage populated, rateLimit undefined).
  // -------------------------------------------------------------------------
  describe('usage_update _meta ingestion (#4)', () => {
    function emitUsageUpdate(update: Record<string, unknown>): void {
      emitMockEvent('acp-session-update', {
        instanceId: INSTANCE_ID,
        sessionId: 'sess-1',
        update: { sessionUpdate: 'usage_update', ...update },
      });
    }

    it('populates usage.rateLimit from _meta["_claude/rateLimit"]', async () => {
      const { updateUsage } = await import('@/lib/ai/acp-agent-state');
      const mockUpdateUsage = vi.mocked(updateUsage);

      const { unlisten, unlistenPermission } = await setupAcpChatListeners(makeDeps());

      const rateLimitPayload = {
        status: 'allowed_warning',
        rateLimitType: 'five_hour',
        resetsAt: 1_751_700_000,
        utilization: 87,
      };
      emitUsageUpdate({
        used: 4200,
        size: 200_000,
        cost: { amount: 0.42, currency: 'USD' },
        _meta: { '_claude/rateLimit': rateLimitPayload },
      });

      expect(mockUpdateUsage).toHaveBeenCalledTimes(1);
      expect(mockUpdateUsage).toHaveBeenCalledWith({
        contextUsed: 4200,
        contextSize: 200_000,
        cost: { amount: 0.42, currency: 'USD' },
        rateLimit: {
          status: 'allowed_warning',
          rateLimitType: 'five_hour',
          resetsAt: 1_751_700_000,
          utilization: 87,
          raw: rateLimitPayload,
        },
      });

      unlisten();
      unlistenPermission();
    });

    it('captures rate-limit state even when the update carries no token counts', async () => {
      const { updateUsage } = await import('@/lib/ai/acp-agent-state');
      const mockUpdateUsage = vi.mocked(updateUsage);

      const { unlisten, unlistenPermission } = await setupAcpChatListeners(makeDeps());

      emitUsageUpdate({ _meta: { '_claude/rateLimit': { status: 'allowed_warning' } } });

      expect(mockUpdateUsage).toHaveBeenCalledTimes(1);
      const arg = mockUpdateUsage.mock.calls[0][0];
      expect(arg.contextUsed).toBe(0);
      expect(arg.contextSize).toBe(0);
      expect(arg.rateLimit?.status).toBe('allowed_warning');

      unlisten();
      unlistenPermission();
    });

    it('malformed _meta leaves usage populated with rateLimit undefined (never throws)', async () => {
      const { updateUsage } = await import('@/lib/ai/acp-agent-state');
      const mockUpdateUsage = vi.mocked(updateUsage);

      const { unlisten, unlistenPermission } = await setupAcpChatListeners(makeDeps());

      emitUsageUpdate({
        used: 4200,
        size: 200_000,
        _meta: { '_claude/rateLimit': 'total garbage' },
      });

      expect(mockUpdateUsage).toHaveBeenCalledTimes(1);
      expect(mockUpdateUsage).toHaveBeenCalledWith({
        contextUsed: 4200,
        contextSize: 200_000,
        cost: undefined,
        rateLimit: undefined,
      });

      unlisten();
      unlistenPermission();
    });

    it('no _meta behaves exactly as today (regression)', async () => {
      const { updateUsage } = await import('@/lib/ai/acp-agent-state');
      const mockUpdateUsage = vi.mocked(updateUsage);

      const { unlisten, unlistenPermission } = await setupAcpChatListeners(makeDeps());

      emitUsageUpdate({ used: 4200, size: 200_000 });

      expect(mockUpdateUsage).toHaveBeenCalledTimes(1);
      expect(mockUpdateUsage).toHaveBeenCalledWith({
        contextUsed: 4200,
        contextSize: 200_000,
        cost: undefined,
        rateLimit: undefined,
      });

      unlisten();
      unlistenPermission();
    });

    it('writes through to the usage-store snapshot when a connectionId is known (#6)', async () => {
      const { useUsageStore } = await import('@/stores/usage-store');
      useUsageStore.setState({ snapshots: {} });

      const deps = { ...makeDeps(), connectionId: 'conn-usage' };
      const { unlisten, unlistenPermission } = await setupAcpChatListeners(deps);

      emitUsageUpdate({
        used: 4200,
        size: 200_000,
        cost: { amount: 0.42, currency: 'USD' },
        _meta: { '_claude/rateLimit': { status: 'allowed_warning' } },
      });

      const snap = useUsageStore.getState().getSnapshot('conn-usage');
      expect(snap).toBeDefined();
      expect(snap?.contextUsed).toBe(4200);
      expect(snap?.contextSize).toBe(200_000);
      expect(snap?.cost).toEqual({ amount: 0.42, currency: 'USD' });
      expect(snap?.rateLimit?.status).toBe('allowed_warning');
      expect(snap?.source).toBe('acp');
      expect(snap?.confidence).toBe('exact');
      expect(snap?.updatedAt).toBeGreaterThan(0);

      // A rate-limit-only follow-up must not zero out the context reading.
      emitUsageUpdate({ _meta: { '_claude/rateLimit': { status: 'allowed' } } });
      const after = useUsageStore.getState().getSnapshot('conn-usage');
      expect(after?.contextUsed).toBe(4200);
      expect(after?.rateLimit?.status).toBe('allowed');

      unlisten();
      unlistenPermission();
    });

    it('skips the usage-store write-through when no connectionId is known', async () => {
      const { useUsageStore } = await import('@/stores/usage-store');
      useUsageStore.setState({ snapshots: {} });

      const { unlisten, unlistenPermission } = await setupAcpChatListeners(makeDeps());

      emitUsageUpdate({ used: 4200, size: 200_000 });

      expect(Object.keys(useUsageStore.getState().snapshots)).toHaveLength(0);

      unlisten();
      unlistenPermission();
    });

    it('empty usage_update with no _meta stays a no-op (regression)', async () => {
      const { updateUsage } = await import('@/lib/ai/acp-agent-state');
      const mockUpdateUsage = vi.mocked(updateUsage);

      const { unlisten, unlistenPermission } = await setupAcpChatListeners(makeDeps());

      emitUsageUpdate({});
      emitUsageUpdate({ used: 0, size: 0, _meta: { '_unknown/key': { foo: 1 } } });

      expect(mockUpdateUsage).not.toHaveBeenCalled();

      unlisten();
      unlistenPermission();
    });
  });

  // -------------------------------------------------------------------------
  // acp-turn-usage listener (provider-usage-display #5)
  //
  // The Rust prompt path emits `{ instanceId, sessionId, usage }` when the
  // agent reports `PromptResponse.usage` (UNSTABLE upstream) — validate the
  // payload, store on the singleton, write through to the usage-store.
  // -------------------------------------------------------------------------
  describe('acp-turn-usage listener (#5)', () => {
    it('validates the payload, stores lastTurnUsage, and writes through to the usage-store', async () => {
      const { setLastTurnUsage } = await import('@/lib/ai/acp-agent-state');
      const { useUsageStore } = await import('@/stores/usage-store');
      useUsageStore.setState({ snapshots: {} });

      const deps = { ...makeDeps(), connectionId: 'conn-turn' };
      const { unlisten, unlistenPermission } = await setupAcpChatListeners(deps);

      emitMockEvent('acp-turn-usage', {
        instanceId: INSTANCE_ID,
        sessionId: 'sess-1',
        usage: {
          totalTokens: 1500,
          inputTokens: 1000,
          outputTokens: 500,
          thoughtTokens: 120,
          cachedReadTokens: 300,
        },
      });

      expect(vi.mocked(setLastTurnUsage)).toHaveBeenCalledWith({
        totalTokens: 1500,
        inputTokens: 1000,
        outputTokens: 500,
        thoughtTokens: 120,
        cachedReadTokens: 300,
      });
      const snap = useUsageStore.getState().getSnapshot('conn-turn');
      expect(snap?.lastTurnUsage?.totalTokens).toBe(1500);
      expect(snap?.source).toBe('acp');
      expect(snap?.confidence).toBe('exact');

      unlisten();
      unlistenPermission();
    });

    it('ignores malformed payloads without touching state', async () => {
      const { setLastTurnUsage } = await import('@/lib/ai/acp-agent-state');
      const { useUsageStore } = await import('@/stores/usage-store');
      useUsageStore.setState({ snapshots: {} });

      const deps = { ...makeDeps(), connectionId: 'conn-turn' };
      const { unlisten, unlistenPermission } = await setupAcpChatListeners(deps);

      // Missing required totals / wrong types / non-object — all ignored.
      emitMockEvent('acp-turn-usage', { instanceId: INSTANCE_ID, sessionId: 'sess-1', usage: { totalTokens: 'lots' } });
      emitMockEvent('acp-turn-usage', { instanceId: INSTANCE_ID, sessionId: 'sess-1', usage: 'garbage' });
      emitMockEvent('acp-turn-usage', { instanceId: INSTANCE_ID, sessionId: 'sess-1', usage: null });
      emitMockEvent('acp-turn-usage', { instanceId: INSTANCE_ID, sessionId: 'sess-1', usage: { totalTokens: 1, inputTokens: 1 } });

      expect(vi.mocked(setLastTurnUsage)).not.toHaveBeenCalled();
      expect(Object.keys(useUsageStore.getState().snapshots)).toHaveLength(0);

      unlisten();
      unlistenPermission();
    });

    it('ignores events from other agent instances', async () => {
      const { setLastTurnUsage } = await import('@/lib/ai/acp-agent-state');

      const { unlisten, unlistenPermission } = await setupAcpChatListeners(makeDeps());

      emitMockEvent('acp-turn-usage', {
        instanceId: 'someone-else',
        sessionId: 'sess-1',
        usage: { totalTokens: 1, inputTokens: 1, outputTokens: 0 },
      });

      expect(vi.mocked(setLastTurnUsage)).not.toHaveBeenCalled();

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

  // -------------------------------------------------------------------------
  // Session-id gate (deep-review batch1 finding #4a)
  //
  // A single agent instance is reused across sessions within a conversation
  // (chatSessionId is swapped on the agent object, not the instance), so the
  // instanceId gate alone lets a stale listener receive a newer session's
  // chunks. The gate is conservative: it only rejects when BOTH the listener
  // and the payload carry a session id and they differ — a missing id on
  // either side falls back to the instanceId-only gate.
  // -------------------------------------------------------------------------
  describe('session-id gate (#4a)', () => {
    it('ignores a session update whose sessionId does not match the bound session', async () => {
      const { unlisten, unlistenPermission, getStreamedContent } = await setupAcpChatListeners({
        ...makeDeps(),
        sessionId: 'sess-current',
      });

      emitMockEvent('acp-session-update', {
        instanceId: INSTANCE_ID,
        sessionId: 'sess-other',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'bleed' },
        },
      });

      expect(getStreamedContent()).toBe('');
      expect(getAssistantMessage()?.content).toBe('');
      expect(getAssistantMessage()?.segments ?? []).toHaveLength(0);

      unlisten();
      unlistenPermission();
    });

    it('processes a session update whose sessionId matches the bound session', async () => {
      const { unlisten, unlistenPermission, getStreamedContent } = await setupAcpChatListeners({
        ...makeDeps(),
        sessionId: 'sess-current',
      });

      emitMockEvent('acp-session-update', {
        instanceId: INSTANCE_ID,
        sessionId: 'sess-current',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'hello' },
        },
      });

      expect(getStreamedContent()).toBe('hello');

      unlisten();
      unlistenPermission();
    });

    it('falls back to the instanceId gate when the payload carries no sessionId', async () => {
      const { unlisten, unlistenPermission, getStreamedContent } = await setupAcpChatListeners({
        ...makeDeps(),
        sessionId: 'sess-current',
      });

      // No sessionId on the payload (older/custom agents) — must still pass.
      emitMockEvent('acp-session-update', {
        instanceId: INSTANCE_ID,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'legit' },
        },
      });

      expect(getStreamedContent()).toBe('legit');

      unlisten();
      unlistenPermission();
    });

    it('falls back to the instanceId gate when the listener has no bound sessionId', async () => {
      // Legacy caller — no sessionId in deps (pre-session listener setup).
      const { unlisten, unlistenPermission, getStreamedContent } = await setupAcpChatListeners(makeDeps());

      emitMockEvent('acp-session-update', {
        instanceId: INSTANCE_ID,
        sessionId: 'sess-any',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'legacy' },
        },
      });

      expect(getStreamedContent()).toBe('legacy');

      unlisten();
      unlistenPermission();
    });

    it('ignores a permission request whose sessionId does not match the bound session', async () => {
      usePermissionStore.getState().clearAll();

      let responded = false;
      setMockInvokeHandler('acp_permission_respond', () => {
        responded = true;
        return undefined;
      });

      const { unlisten, unlistenPermission } = await setupAcpChatListeners({
        ...makeDeps(),
        sessionId: 'sess-current',
        pathFilterRoots: ['/Users/test/project'],
      });

      emitMockEvent('acp-permission-request', {
        instanceId: INSTANCE_ID,
        sessionId: 'sess-other',
        requestId: 'req-stale',
        toolCall: {
          kind: 'write',
          title: 'write /Users/test/project/out.txt',
          rawInput: JSON.stringify({ file_path: '/Users/test/project/out.txt' }),
        },
        options: [{ optionId: 'allow_once', kind: 'allow_once', name: 'Allow once' }],
      });

      // Neither a respond (deny/approve) nor a UI card — the event belongs to
      // another session's listener.
      expect(responded).toBe(false);
      expect(usePermissionStore.getState().requests).toHaveLength(0);

      unlisten();
      unlistenPermission();
    });
  });

});

// @vitest-environment jsdom

/**
 * ChatMessageList — list-level rendering guarantees (render-perf findings
 * #1, #3, #5, #6):
 *
 *   - Rows are keyed by the stable `message.id` so branch switches / edits /
 *     resends reconcile each row to the SAME message (no cross-message
 *     instance reuse, no remount-driven local-state loss).
 *   - Loading is prop-driven (`isActivelyStreaming`): when the foreground
 *     loading flag flips, ONLY the last message re-renders — every other
 *     row's props are reference-stable and its memo skips.
 *   - Quick replies are parsed once per message object and the stripped
 *     `displayMessage` is reference-stable across renders.
 *   - Branch counts and segment dividers come from precomputed maps.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@/test/component-harness';
import type { ChatMessage as ChatMessageType } from '@/lib/ai/types';

// ---------------------------------------------------------------------------
// Hoisted controllable state
// ---------------------------------------------------------------------------

// Mutable chat-store state the mocked module reads from. Tests reassign the
// arrays and trigger a re-render via `rerender` (the mock has no subscription
// of its own — parent re-renders re-run the selectors).
const chatMock = vi.hoisted(() => {
  type Msg = {
    id?: string;
    role: string;
    content: string;
    timestamp?: number;
    parentId?: string | null;
    isError?: boolean;
  };
  type Seg = {
    projectPaths: string[];
    sessionId: string | null;
    startMessageIndex: number;
    historyIncluded: boolean;
  };
  const state = {
    messages: [] as Msg[],
    allMessages: [] as Msg[],
    segments: [
      { projectPaths: [], sessionId: null, startMessageIndex: 0, historyIncluded: false },
    ] as Seg[],
    activeTool: null as string | null,
    activeConversationId: 'conv-1' as string | null,
    branchFromMessage: () => {},
    conversations: [] as unknown[],
  };
  // Subscription plumbing so store mutations re-render the (memo-wrapped)
  // list the same way a real zustand update would.
  const listeners = new Set<() => void>();
  let version = 0;
  return {
    state,
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    getVersion: () => version,
    notify: () => {
      version++;
      listeners.forEach((l) => l());
    },
  };
});

// Foreground-loading flag backed by a real external store so flipping it
// re-renders subscribed components (the list), mirroring production.
const loadingMock = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const store = {
    value: false,
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    set: (v: boolean) => {
      store.value = v;
      listeners.forEach((l) => l());
    },
  };
  return store;
});

// Per-message-id render counter written by the memo-wrapped ChatMessage stub.
const renderCounts = vi.hoisted(() => new Map<string, number>());

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/stores/chat-store', async () => {
  const { useSyncExternalStore } = await import('react');
  const s = chatMock.state;
  const useChatStore = Object.assign(
    (selector?: (st: typeof s) => unknown) => {
      // Subscribe to mock-store versions so `chatMock.notify()` re-renders
      // the component (the list itself is memo-wrapped — prop-identical
      // rerenders from the test harness would otherwise be skipped).
      useSyncExternalStore(chatMock.subscribe, chatMock.getVersion);
      return selector ? selector(s) : s;
    },
    { getState: () => s },
  );
  return {
    useChatStore,
    selectMessages: () => s.messages,
    selectAllMessages: () => s.allMessages,
    selectPendingProjectSwitch: () => null,
    selectPendingAgentSwitch: () => null,
    selectSegments: () => s.segments,
    getSessionIdForLeaf: () => undefined,
  };
});

vi.mock('@/hooks/useSessionManager', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useForegroundLoading: () =>
      useSyncExternalStore(loadingMock.subscribe, () => loadingMock.value),
  };
});

// Memo-wrapped counting stub. `data-mount-id` records the message id the
// instance FIRST rendered with; `data-current-id` is the live prop. Equal
// values prove identity-keyed reconciliation (no instance reuse across
// different messages). The memo wrapper is load-bearing for the
// "only the last message re-renders" test — it skips when props are
// reference-stable, exactly like the real component.
vi.mock('../ChatMessage', async () => {
  const React = await import('react');
  interface StubProps {
    message: { id?: string; content: string };
    isActivelyStreaming?: boolean;
    branchCount?: number;
  }
  const ChatMessage = React.memo(function ChatMessageStub(props: StubProps) {
    const id = props.message.id ?? 'no-id';
    const mountIdRef = React.useRef(id);
    renderCounts.set(id, (renderCounts.get(id) ?? 0) + 1);
    return (
      <div
        data-testid="chat-message-stub"
        data-current-id={id}
        data-mount-id={mountIdRef.current}
        data-streaming={props.isActivelyStreaming ? 'true' : 'false'}
        data-branch-count={props.branchCount ?? 0}
        data-content={props.message.content}
      />
    );
  });
  return { ChatMessage };
});

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
vi.mock('@/lib/ai/acp-agent-state', () => ({ getAcpAgent: () => undefined }));
vi.mock('@/lib/ai/acp-utils', () => ({ hasSessionCapability: () => false }));
vi.mock('@/lib/tauri', () => ({ tauriApi: {} }));
vi.mock('@/stores/permission-store', () => ({
  usePermissionStore: (sel: (s: { requests: unknown[] }) => unknown) => sel({ requests: [] }),
}));
vi.mock('@/stores/tool-permission-store', () => ({
  useToolPermissionStore: (sel: (s: Record<string, never>) => unknown) => sel({}),
  selectForegroundPending: () => () => null,
}));
vi.mock('@/stores/agent-status-store', () => ({
  useAgentStatusStore: Object.assign(vi.fn(), {
    getState: () => ({ clearStatus: vi.fn() }),
  }),
}));
vi.mock('@/hooks/useAcpLifecycle', () => ({
  getRetryCallback: () => null,
  getKeepWaitingCallback: () => null,
}));
vi.mock('../LocalAgentSetupPrompt', () => ({ LocalAgentSetupPrompt: () => null }));
vi.mock('../LocalAISetupCard', () => ({ LocalAISetupCard: () => null }));
vi.mock('../PermissionCard', () => ({ PermissionCard: () => null }));
vi.mock('../ToolCallPermissionCard', () => ({ ToolCallPermissionCard: () => null }));
vi.mock('../AgentStatusBanner', () => ({ AgentStatusBanner: () => null }));
vi.mock('../ProjectSwitchCard', () => ({ ProjectSwitchCard: () => null }));
vi.mock('../AgentSwitchCard', () => ({ AgentSwitchCard: () => null }));
vi.mock('../ContextDivider', () => ({
  ContextDivider: () => <div data-testid="context-divider" />,
}));

import { ChatMessageList } from '../ChatMessageList';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMsg(
  id: string,
  role: ChatMessageType['role'],
  content: string,
  overrides: Partial<ChatMessageType> = {},
): ChatMessageType {
  return { id, role, content, timestamp: Date.now(), parentId: null, ...overrides };
}

// Stable prop references — a fresh `selectedProjectPaths` array per render
// would invalidate the list's `handleBranch` useCallback and defeat the memo
// (production callers pass store-stable references).
const stableOnSend = vi.fn();
const stablePaths: string[] = [];

function renderList() {
  return render(
    <ChatMessageList onSend={stableOnSend} selectedProjectPaths={stablePaths} />,
  );
}

function stubs(): HTMLElement[] {
  return screen.getAllByTestId('chat-message-stub');
}

describe('ChatMessageList — keys, memoization, derived rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderCounts.clear();
    loadingMock.value = false;
    chatMock.state.messages = [];
    chatMock.state.allMessages = [];
    chatMock.state.segments = [
      { projectPaths: [], sessionId: null, startMessageIndex: 0, historyIncluded: false },
    ];
    chatMock.state.activeTool = null;
  });

  it('keys rows by message id: a branch switch does not reuse an instance for a different message (#1)', () => {
    const m1 = makeMsg('m1', 'user', 'hello');
    const m2 = makeMsg('m2', 'assistant', 'first answer', { parentId: 'm1' });
    const m3 = makeMsg('m3', 'assistant', 'second answer', { parentId: 'm1' });
    chatMock.state.allMessages = [m1, m2, m3];
    chatMock.state.messages = [m1, m2];

    renderList();
    // Sanity: both rows mounted with their own message.
    for (const el of stubs()) {
      expect(el.getAttribute('data-mount-id')).toBe(el.getAttribute('data-current-id'));
    }

    // Branch switch: the visible thread's tail changes m2 → m3.
    chatMock.state.messages = [m1, m3];
    act(() => chatMock.notify());

    const rows = stubs();
    expect(rows.map((el) => el.getAttribute('data-current-id'))).toEqual(['m1', 'm3']);
    // With index keys the second row's instance would be REUSED for m3 and
    // still carry mount-id "m2" (leaking m2's local state into m3). With id
    // keys, m2 unmounts and m3 mounts fresh — mount id equals current id.
    for (const el of rows) {
      expect(el.getAttribute('data-mount-id')).toBe(el.getAttribute('data-current-id'));
    }
  });

  it('re-renders ONLY the last message when foreground loading flips (#3)', () => {
    const m1 = makeMsg('m1', 'user', 'hello');
    const m2 = makeMsg('m2', 'assistant', 'earlier answer', { parentId: 'm1' });
    const m3 = makeMsg('m3', 'user', 'follow-up', { parentId: 'm2' });
    chatMock.state.allMessages = [m1, m2, m3];
    chatMock.state.messages = [m1, m2, m3];

    renderList();
    renderCounts.clear();

    act(() => loadingMock.set(true));

    // The last row's `isActivelyStreaming` prop flipped false → true.
    expect(renderCounts.get('m3')).toBe(1);
    // Every other row's props are reference-stable — memo skips them.
    expect(renderCounts.get('m1') ?? 0).toBe(0);
    expect(renderCounts.get('m2') ?? 0).toBe(0);

    const rows = stubs();
    expect(rows[2].getAttribute('data-streaming')).toBe('true');
    expect(rows[0].getAttribute('data-streaming')).toBe('false');

    // Flipping back re-renders only the tail again.
    renderCounts.clear();
    act(() => loadingMock.set(false));
    expect(renderCounts.get('m3')).toBe(1);
    expect(renderCounts.get('m1') ?? 0).toBe(0);
    expect(renderCounts.get('m2') ?? 0).toBe(0);
  });

  it('strips quick replies into a stable displayMessage and renders the reply chips (#5)', () => {
    const m1 = makeMsg('m1', 'user', 'hello');
    const m2 = makeMsg(
      'm2',
      'assistant',
      'Pick one.\n\n<quick-replies>\nOption A\nOption B\n</quick-replies>',
      { parentId: 'm1' },
    );
    chatMock.state.allMessages = [m1, m2];
    chatMock.state.messages = [m1, m2];

    renderList();

    const row = stubs()[1];
    expect(row.getAttribute('data-content')).toBe('Pick one.');
    expect(screen.getByRole('button', { name: /Option A/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Option B/ })).toBeDefined();

    // The stripped displayMessage is cached per message object — a store
    // flush with the same messages array must NOT re-render the memoized row
    // (i.e. no fresh `{ ...message }` allocation per render).
    renderCounts.clear();
    act(() => chatMock.notify());
    expect(renderCounts.get('m2') ?? 0).toBe(0);
  });

  it('derives branch counts from the full tree and segment dividers by message id (#6)', () => {
    const m1 = makeMsg('m1', 'user', 'hello');
    const m2 = makeMsg('m2', 'assistant', 'answer A', { parentId: 'm1' });
    const m3 = makeMsg('m3', 'assistant', 'answer B', { parentId: 'm1' });
    const m4 = makeMsg('m4', 'user', 'next', { parentId: 'm2' });
    chatMock.state.allMessages = [m1, m2, m4, m3];
    chatMock.state.messages = [m1, m2, m4];
    chatMock.state.segments = [
      { projectPaths: [], sessionId: null, startMessageIndex: 0, historyIncluded: false },
      // Boundary anchored at allMessages[2] === m4 → divider above m4's row.
      { projectPaths: [], sessionId: null, startMessageIndex: 2, historyIncluded: false },
    ];

    renderList();

    const rows = stubs();
    // m1 has two children in the FULL tree (m2 + m3) even though only m2 is
    // on the visible thread.
    expect(rows[0].getAttribute('data-branch-count')).toBe('2');
    expect(rows[1].getAttribute('data-branch-count')).toBe('1');
    // Exactly one segment divider, attached to m4 by identity.
    expect(screen.getAllByTestId('context-divider')).toHaveLength(1);
  });
});

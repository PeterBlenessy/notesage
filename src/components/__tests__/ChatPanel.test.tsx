// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  registerDefaultHandlers,
  act,
} from '@/test/component-harness';
import type { ChatMessage as ChatMessageType } from '@/lib/ai/types';
import type { Connection } from '@/lib/ai/connections';

// ---------------------------------------------------------------------------
// Mock stores
// ---------------------------------------------------------------------------

// Mutable chat-store backing object so individual tests can seed messages and
// observe deleteMessageAndDescendants calls without re-mocking the module.
const chatStoreState = {
  conversations: [] as Array<Record<string, unknown>>,
  activeConversationId: null as string | null,
  createConversation: vi.fn(() => 'conv-1'),
  setActiveConversation: vi.fn(),
  setPendingProjectSwitch: vi.fn(),
  setPendingAgentSwitch: vi.fn(),
  isLoading: false,
  deleteMessageAndDescendants: vi.fn(),
  getActiveSegment: vi.fn(() => null),
  getState: () => chatStoreState,
};
let mockMessages: ChatMessageType[] = [];
let mockSelectedProjectPaths: string[] = [];
vi.mock('@/stores/chat-store', () => {
  const selectMessages = () => mockMessages;
  const selectProjectPaths = () => mockSelectedProjectPaths;
  const selectPendingProjectSwitch = () => null;
  const selectPendingAgentSwitch = () => null;
  return {
    useChatStore: Object.assign(
      vi.fn((selector: (s: typeof chatStoreState) => unknown) => selector(chatStoreState)),
      { getState: () => chatStoreState },
    ),
    selectMessages,
    selectProjectPaths,
    selectPendingProjectSwitch,
    selectPendingAgentSwitch,
  };
});

vi.mock('@/stores/ai-store', () => {
  const store = { provider: null, getState: () => store };
  return {
    useAIStore: Object.assign(
      vi.fn((sel: (s: typeof store) => unknown) => sel(store)),
      { getState: () => store },
    ),
  };
});

const connectionsStoreState = {
  connections: [] as Connection[],
  getState: () => connectionsStoreState,
};
vi.mock('@/stores/connections-store', () => ({
  useConnectionsStore: Object.assign(
    vi.fn((sel: (s: typeof connectionsStoreState) => unknown) => sel(connectionsStoreState)),
    { getState: () => connectionsStoreState },
  ),
}));

const mockSetRouting = vi.fn();
const routingStoreState = {
  getConnectionForUseCase: vi.fn(() => null as Connection | null),
  setRouting: mockSetRouting,
  routing: {} as Record<string, { connectionId: string | null; model?: string }>,
  getState: () => routingStoreState,
};
vi.mock('@/stores/routing-store', () => ({
  useRoutingStore: Object.assign(
    vi.fn((sel: (s: typeof routingStoreState) => unknown) => sel(routingStoreState)),
    { getState: () => routingStoreState },
  ),
}));

const projectMetadataStoreState = {
  metadataMap: {} as Record<string, { aiLock?: { connectionId: string; lockedAt: number }; ai: { provider: string | null } }>,
  getState: () => projectMetadataStoreState,
};
vi.mock('@/stores/project-metadata-store', () => ({
  useProjectMetadataStore: Object.assign(
    vi.fn((sel: (s: typeof projectMetadataStoreState) => unknown) => sel(projectMetadataStoreState)),
    { getState: () => projectMetadataStoreState },
  ),
}));

vi.mock('@/stores/skill-store', () => {
  const store = {
    setActiveAgent: vi.fn(),
    agents: [],
    activeAgent: null,
    getAgentByName: vi.fn(() => null),
    skills: [],
    getState: () => store,
  };
  return {
    useSkillStore: Object.assign(
      vi.fn((sel: (s: typeof store) => unknown) => sel(store)),
      { getState: () => store },
    ),
  };
});

// ---------------------------------------------------------------------------
// Mock hooks
// ---------------------------------------------------------------------------

const mockSendChatMessage = vi.fn(
  async (_content: string, _messages?: unknown, _opts?: unknown) => {},
);
vi.mock('@/hooks/useAIOperations', () => ({
  useAIOperations: vi.fn(() => ({
    sendChatMessage: mockSendChatMessage,
    generateText: vi.fn(),
  })),
}));

vi.mock('@/hooks/useGoalsDiscovery', () => ({
  useGoalsDiscovery: vi.fn(() => ({ goalFiles: [] })),
}));

vi.mock('@/hooks/useChatContext', () => ({
  useChatContext: vi.fn(() => ({ attachedFilePaths: [] })),
}));

// ---------------------------------------------------------------------------
// Mock sub-components
// ---------------------------------------------------------------------------

vi.mock('@/components/chat/ChatHistoryView', () => ({
  ChatHistoryView: () => <div data-testid="chat-history">History</div>,
}));

// Captured props from ChatMessageList so tests can drive onResend/onEdit.
let capturedListProps: {
  onResend?: (msg: ChatMessageType) => void;
  onEdit?: (msg: ChatMessageType) => void;
  onSend?: (content: string) => void;
} = {};
vi.mock('@/components/chat/ChatMessageList', () => ({
  ChatMessageList: (props: typeof capturedListProps) => {
    capturedListProps = props;
    return <div data-testid="chat-messages">Messages</div>;
  },
}));

let capturedFooterProps: {
  onSend?: (content: string) => Promise<void>;
} = {};
vi.mock('@/components/chat/ChatFooter', () => ({
  ChatFooter: (props: typeof capturedFooterProps) => {
    capturedFooterProps = props;
    return <div data-testid="chat-footer">Footer</div>;
  },
}));

// Captured dialog props so tests can invoke the confirm/cancel callbacks.
let capturedDialogProps: {
  open?: boolean;
  original?: { id: string | null; label: string; provider: string | null; disabled: boolean; disabledReason?: string };
  current?: { id: string | null; label: string; provider: string | null; disabled: boolean; disabledReason?: string };
  isEdit?: boolean;
  onConfirm?: (choice: 'original' | 'current') => void;
  onOpenChange?: (next: boolean) => void;
} | null = null;
vi.mock('@/components/chat/ResendProviderDialog', async (importOriginal) => {
  // Keep the real exports so ResendProviderChoice / ResendProviderOption types
  // still resolve at import time; replace only the React component.
  const actual = await importOriginal<typeof import('@/components/chat/ResendProviderDialog')>();
  return {
    ...actual,
    ResendProviderDialog: (props: NonNullable<typeof capturedDialogProps>) => {
      capturedDialogProps = props;
      return props.open ? <div data-testid="resend-dialog" /> : null;
    },
  };
});

// ---------------------------------------------------------------------------
// Mock tauriApi
// ---------------------------------------------------------------------------

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    readSkillContent: vi.fn(async () => ({ body: '' })),
  },
}));

// ---------------------------------------------------------------------------
// Import component after mocks
// ---------------------------------------------------------------------------

import { ChatPanel } from '@/components/chat/ChatPanel';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONN_X: Connection = {
  id: 'conn-X',
  label: 'Claude (X)',
  provider: 'anthropic',
  authMethod: 'api_key',
  capabilities: ['interactive'],
  credentials: { type: 'api_key' },
} as unknown as Connection;

const CONN_Y: Connection = {
  id: 'conn-Y',
  label: 'OpenAI (Y)',
  provider: 'openai',
  authMethod: 'api_key',
  capabilities: ['interactive'],
  credentials: { type: 'api_key' },
} as unknown as Connection;

function seedConnections(conns: Connection[], interactive: Connection | null): void {
  connectionsStoreState.connections = conns;
  routingStoreState.getConnectionForUseCase = vi.fn(() => interactive);
}

function resetMockState(): void {
  mockMessages = [];
  mockSelectedProjectPaths = [];
  mockSendChatMessage.mockReset();
  mockSendChatMessage.mockResolvedValue(undefined);
  mockSetRouting.mockReset();
  chatStoreState.deleteMessageAndDescendants.mockReset();
  chatStoreState.getActiveSegment.mockReturnValue(null);
  connectionsStoreState.connections = [];
  projectMetadataStoreState.metadataMap = {};
  routingStoreState.getConnectionForUseCase = vi.fn(() => null);
  capturedListProps = {};
  capturedFooterProps = {};
  capturedDialogProps = null;
}

function makeUserMessage(overrides: Partial<ChatMessageType> = {}): ChatMessageType {
  return {
    role: 'user',
    content: 'Hello from message',
    timestamp: 1000,
    id: 'msg-user-1',
    parentId: null,
    ...overrides,
  };
}

describe('ChatPanel', () => {
  beforeEach(() => {
    registerDefaultHandlers();
    resetMockState();
  });

  it('mounts without crash', () => {
    const { container } = renderWithProviders(<ChatPanel />);
    expect(container).toBeTruthy();
  });

  it('renders chat tab button', () => {
    renderWithProviders(<ChatPanel />);
    // The chat tab shows the conversation title ("New Chat")
    expect(screen.getByText('New Chat')).toBeTruthy();
  });

  it('renders history tab button', () => {
    renderWithProviders(<ChatPanel />);
    // History button is now icon-only with a tooltip; the tooltip content is in the DOM
    const tooltipContent = document.querySelector('[data-slot="tooltip-content"]');
    const historyButton = screen.getAllByRole('button').find(
      (btn) => btn.querySelector('svg') && btn.className.includes('rounded-md')
    );
    expect(historyButton || tooltipContent).toBeTruthy();
  });

  it('renders new chat button with tooltip', () => {
    renderWithProviders(<ChatPanel />);
    expect(screen.getByText('New Chat')).toBeTruthy();
  });

  it('renders chat message list by default', () => {
    renderWithProviders(<ChatPanel />);
    expect(screen.getByTestId('chat-messages')).toBeTruthy();
  });

  it('renders chat footer by default', () => {
    renderWithProviders(<ChatPanel />);
    expect(screen.getByTestId('chat-footer')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// #10 / #11 — Cross-provider resend & edit confirmation (red-team tests)
// ---------------------------------------------------------------------------

describe('ChatPanel — cross-provider resend/edit confirmation', () => {
  beforeEach(() => {
    registerDefaultHandlers();
    resetMockState();
  });

  it('resend: opens the dialog when message.connectionId differs from the current connection', () => {
    // Red-team seed: message originally went to conn-X; chat is now on conn-Y.
    seedConnections([CONN_X, CONN_Y], CONN_Y);
    mockMessages = [makeUserMessage({ connectionId: 'conn-X' })];

    renderWithProviders(<ChatPanel />);

    // Simulate the user clicking "resend" on the message.
    act(() => {
      capturedListProps.onResend?.(makeUserMessage({ connectionId: 'conn-X' }));
    });

    expect(capturedDialogProps).not.toBeNull();
    expect(capturedDialogProps?.open).toBe(true);
    expect(capturedDialogProps?.original?.id).toBe('conn-X');
    expect(capturedDialogProps?.current?.id).toBe('conn-Y');
    expect(capturedDialogProps?.isEdit).toBe(false);
    // No send should have happened yet — the dialog is gating.
    expect(mockSendChatMessage).not.toHaveBeenCalled();
    // The message must NOT be deleted until the user confirms (otherwise a
    // cancel leaves the thread mutated).
    expect(chatStoreState.deleteMessageAndDescendants).not.toHaveBeenCalled();
  });

  it('resend: "Resend with original" routes via setRouting to the original connection', async () => {
    seedConnections([CONN_X, CONN_Y], CONN_Y);
    mockMessages = [makeUserMessage({ connectionId: 'conn-X' })];
    vi.useFakeTimers();
    renderWithProviders(<ChatPanel />);

    act(() => {
      capturedListProps.onResend?.(makeUserMessage({ connectionId: 'conn-X' }));
    });
    expect(capturedDialogProps?.open).toBe(true);

    // User picks "original".
    act(() => {
      capturedDialogProps?.onConfirm?.('original');
    });
    // Deletion happens immediately on confirm.
    expect(chatStoreState.deleteMessageAndDescendants).toHaveBeenCalledWith('msg-user-1');
    // Reroute happens before the scheduled send.
    expect(mockSetRouting).toHaveBeenCalledWith('interactive', 'conn-X');
    // Send is deferred to the next tick so the closure rebuilds.
    expect(mockSendChatMessage).not.toHaveBeenCalled();
    await act(async () => {
      vi.runAllTimers();
      await Promise.resolve();
    });
    expect(mockSendChatMessage).toHaveBeenCalledTimes(1);
    const [contentArg] = mockSendChatMessage.mock.calls[0];
    expect(contentArg).toBe('Hello from message');
    vi.useRealTimers();
  });

  it('resend: "Resend with current" sends without rerouting', async () => {
    seedConnections([CONN_X, CONN_Y], CONN_Y);
    mockMessages = [makeUserMessage({ connectionId: 'conn-X' })];
    vi.useFakeTimers();
    renderWithProviders(<ChatPanel />);

    act(() => {
      capturedListProps.onResend?.(makeUserMessage({ connectionId: 'conn-X' }));
    });
    act(() => {
      capturedDialogProps?.onConfirm?.('current');
    });

    expect(chatStoreState.deleteMessageAndDescendants).toHaveBeenCalledWith('msg-user-1');
    // Target matches current — no routing change required.
    expect(mockSetRouting).not.toHaveBeenCalled();
    // Send runs synchronously when no reroute is needed.
    expect(mockSendChatMessage).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('resend: matching connections skip the dialog entirely and send immediately', () => {
    // Message was originally sent to conn-Y, chat is still on conn-Y.
    seedConnections([CONN_Y], CONN_Y);
    mockMessages = [makeUserMessage({ connectionId: 'conn-Y' })];

    renderWithProviders(<ChatPanel />);

    act(() => {
      capturedListProps.onResend?.(makeUserMessage({ connectionId: 'conn-Y' }));
    });

    // No dialog prop captured with open=true.
    expect(capturedDialogProps === null || capturedDialogProps.open !== true).toBe(true);
    expect(chatStoreState.deleteMessageAndDescendants).toHaveBeenCalledWith('msg-user-1');
    expect(mockSendChatMessage).toHaveBeenCalledTimes(1);
  });

  it('resend: legacy message without connectionId skips the dialog (back-compat)', () => {
    seedConnections([CONN_X, CONN_Y], CONN_Y);
    mockMessages = [makeUserMessage({ connectionId: undefined })];

    renderWithProviders(<ChatPanel />);

    act(() => {
      capturedListProps.onResend?.(makeUserMessage({ connectionId: undefined }));
    });

    expect(capturedDialogProps === null || capturedDialogProps.open !== true).toBe(true);
    expect(mockSendChatMessage).toHaveBeenCalledTimes(1);
  });

  it('edit: send-time mismatch opens the dialog with isEdit=true', () => {
    seedConnections([CONN_X, CONN_Y], CONN_Y);
    mockMessages = [makeUserMessage({ connectionId: 'conn-X' })];
    renderWithProviders(<ChatPanel />);

    // User clicks edit — establishes edit context carrying originalConnectionId.
    act(() => {
      capturedListProps.onEdit?.(makeUserMessage({ connectionId: 'conn-X', content: 'orig' }));
    });
    // User types & hits send from the footer.
    act(() => {
      capturedFooterProps.onSend?.('edited content');
    });

    expect(capturedDialogProps?.open).toBe(true);
    expect(capturedDialogProps?.isEdit).toBe(true);
    expect(capturedDialogProps?.original?.id).toBe('conn-X');
    expect(capturedDialogProps?.current?.id).toBe('conn-Y');
    expect(mockSendChatMessage).not.toHaveBeenCalled();
  });

  it('edit: "Resend with original" reroutes and sends the edited content', async () => {
    seedConnections([CONN_X, CONN_Y], CONN_Y);
    mockMessages = [makeUserMessage({ connectionId: 'conn-X' })];
    vi.useFakeTimers();
    renderWithProviders(<ChatPanel />);

    act(() => {
      capturedListProps.onEdit?.(makeUserMessage({ connectionId: 'conn-X', content: 'orig' }));
    });
    act(() => {
      capturedFooterProps.onSend?.('edited content');
    });
    act(() => {
      capturedDialogProps?.onConfirm?.('original');
    });

    // Edit path never deletes — it branches.
    expect(chatStoreState.deleteMessageAndDescendants).not.toHaveBeenCalled();
    expect(mockSetRouting).toHaveBeenCalledWith('interactive', 'conn-X');
    await act(async () => {
      vi.runAllTimers();
      await Promise.resolve();
    });
    expect(mockSendChatMessage).toHaveBeenCalledTimes(1);
    const [contentArg] = mockSendChatMessage.mock.calls[0];
    expect(contentArg).toBe('edited content');
    vi.useRealTimers();
  });

  it('lock: current project locked to conn-Y disables the "original" option when it is conn-X', () => {
    seedConnections([CONN_X, CONN_Y], CONN_Y);
    projectMetadataStoreState.metadataMap = {
      '/proj/a': {
        ai: { provider: null },
        aiLock: { connectionId: 'conn-Y', lockedAt: 1 },
      },
    };
    // Single-project selection — resolves `singleLock` in ChatPanel.
    mockSelectedProjectPaths = ['/proj/a'];
    mockMessages = [makeUserMessage({ connectionId: 'conn-X' })];

    renderWithProviders(<ChatPanel />);

    act(() => {
      capturedListProps.onResend?.(makeUserMessage({ connectionId: 'conn-X' }));
    });

    expect(capturedDialogProps?.open).toBe(true);
    // The lock matches the current connection (conn-Y) — so "current" is
    // enabled and "original" (conn-X) is locked out.
    expect(capturedDialogProps?.original?.disabled).toBe(true);
    expect(capturedDialogProps?.original?.disabledReason).toMatch(/locked/i);
    expect(capturedDialogProps?.current?.disabled).toBe(false);
  });

  it('disabled original: when the original connection no longer exists, show a "no longer connected" tooltip', () => {
    // Only conn-Y is in the store; conn-X was deleted.
    seedConnections([CONN_Y], CONN_Y);
    mockMessages = [makeUserMessage({ connectionId: 'conn-X' })];

    renderWithProviders(<ChatPanel />);

    act(() => {
      capturedListProps.onResend?.(makeUserMessage({ connectionId: 'conn-X' }));
    });

    expect(capturedDialogProps?.original?.disabled).toBe(true);
    expect(capturedDialogProps?.original?.disabledReason).toMatch(/no longer connected/i);
    expect(capturedDialogProps?.original?.id).toBe('conn-X');
    expect(capturedDialogProps?.current?.disabled).toBe(false);
  });

  it('onOpenChange(false) cancels the dialog without sending', () => {
    seedConnections([CONN_X, CONN_Y], CONN_Y);
    mockMessages = [makeUserMessage({ connectionId: 'conn-X' })];

    renderWithProviders(<ChatPanel />);

    act(() => {
      capturedListProps.onResend?.(makeUserMessage({ connectionId: 'conn-X' }));
    });
    expect(capturedDialogProps?.open).toBe(true);

    // User clicks outside / presses Escape — dialog fires onOpenChange(false).
    act(() => {
      capturedDialogProps?.onOpenChange?.(false);
    });

    expect(mockSendChatMessage).not.toHaveBeenCalled();
    expect(chatStoreState.deleteMessageAndDescendants).not.toHaveBeenCalled();
    expect(mockSetRouting).not.toHaveBeenCalled();
  });
});

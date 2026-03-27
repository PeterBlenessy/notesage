// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  registerDefaultHandlers,
} from '@/test/component-harness';

// ---------------------------------------------------------------------------
// Mock stores
// ---------------------------------------------------------------------------

vi.mock('@/stores/chat-store', () => {
  const store = {
    conversations: [],
    activeConversationId: null,
    createConversation: vi.fn(() => 'conv-1'),
    setActiveConversation: vi.fn(),
    setPendingProjectSwitch: vi.fn(),
    setPendingAgentSwitch: vi.fn(),
    isLoading: false,
    getState: () => store,
  };
  const selectMessages = () => [];
  const selectProjectPaths = () => [];
  const selectPendingProjectSwitch = () => null;
  const selectPendingAgentSwitch = () => null;
  return {
    useChatStore: Object.assign(
      vi.fn((selector: (s: typeof store) => unknown) => selector(store)),
      { getState: () => store },
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

vi.mock('@/stores/connections-store', () => {
  const store = { connections: [], getState: () => store };
  return {
    useConnectionsStore: Object.assign(
      vi.fn((sel: (s: typeof store) => unknown) => sel(store)),
      { getState: () => store },
    ),
  };
});

vi.mock('@/stores/routing-store', () => {
  const store = { getConnectionForUseCase: () => null, getState: () => store };
  return {
    useRoutingStore: Object.assign(
      vi.fn((sel: (s: typeof store) => unknown) => sel(store)),
      { getState: () => store },
    ),
  };
});

vi.mock('@/stores/project-metadata-store', () => {
  const store = { metadataMap: {}, getState: () => store };
  return {
    useProjectMetadataStore: Object.assign(
      vi.fn((sel: (s: typeof store) => unknown) => sel(store)),
      { getState: () => store },
    ),
  };
});

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

vi.mock('@/hooks/useAIOperations', () => ({
  useAIOperations: vi.fn(() => ({
    sendChatMessage: vi.fn(),
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

vi.mock('@/components/chat/ChatMessageList', () => ({
  ChatMessageList: () => <div data-testid="chat-messages">Messages</div>,
}));

vi.mock('@/components/chat/ChatFooter', () => ({
  ChatFooter: () => <div data-testid="chat-footer">Footer</div>,
}));

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

describe('ChatPanel', () => {
  beforeEach(() => {
    registerDefaultHandlers();
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
    expect(screen.getByText('History')).toBeTruthy();
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

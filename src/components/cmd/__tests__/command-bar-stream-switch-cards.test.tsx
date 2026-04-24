// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders, screen } from '@/test/component-harness';
import type { ChatMessage as ChatMessageType } from '@/lib/ai/types';

// ---------------------------------------------------------------------------
// #117 — CommandBarStream must render both AgentSwitchCard and
// ProjectSwitchCard when the chat-store reports a pending switch. Before #117
// these cards only rendered in the classic ChatMessageList, so Quiet Composer
// users silently lost context on mid-conversation provider / project change.
//
// This spec mocks the chat-store module so the cards' pending state and
// resolver wiring can be driven per test.
// ---------------------------------------------------------------------------

type PendingAgentSwitch = {
  newAgent: string;
  previousAgent: string;
};

type PendingProjectSwitch = {
  newPaths: string[];
  previousPaths: string[];
};

let mockMessages: ChatMessageType[] = [];
let mockPendingAgentSwitch: PendingAgentSwitch | null = null;
let mockPendingProjectSwitch: PendingProjectSwitch | null = null;
const resolveAgentSwitchMock = vi.fn<(historyIncluded: boolean) => void>();
const resolveProjectSwitchMock = vi.fn<(historyIncluded: boolean) => void>();

vi.mock('@/stores/chat-store', () => {
  // The AgentSwitchCard / ProjectSwitchCard call `useChatStore((s) => s.resolveX)`
  // directly to wire their buttons. We feed a shallow state object that carries
  // the resolver functions AND the pending-switch shape — the latter is what
  // the selectors read.
  function useChatStore<T>(
    selector: (state: {
      isLoading: boolean;
      resolveAgentSwitch: typeof resolveAgentSwitchMock;
      resolveProjectSwitch: typeof resolveProjectSwitchMock;
    }) => T,
  ): T {
    return selector({
      isLoading: false,
      resolveAgentSwitch: resolveAgentSwitchMock,
      resolveProjectSwitch: resolveProjectSwitchMock,
    });
  }
  return {
    useChatStore,
    selectMessages: () => mockMessages,
    selectPendingAgentSwitch: () => mockPendingAgentSwitch,
    selectPendingProjectSwitch: () => mockPendingProjectSwitch,
  };
});

// Stub ChatMessage — keep the test focused on the stream's top-level decisions.
vi.mock('@/components/chat/ChatMessage', () => ({
  ChatMessage: ({ message }: { message: ChatMessageType }) => (
    <div data-testid="chat-message-stub">{message.id}</div>
  ),
}));

// Stub useReducedMotion — not relevant to this spec, just needs to be a
// function that returns a boolean.
vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

import CommandBarStream from '@/components/cmd/CommandBarStream';

// Helpers
function makeMessage(id: string, role: ChatMessageType['role'] = 'user'): ChatMessageType {
  return { id, role, content: `msg-${id}`, timestamp: Date.now() };
}

describe('CommandBarStream — provider/project switch cards (#117)', () => {
  beforeEach(() => {
    mockMessages = [];
    mockPendingAgentSwitch = null;
    mockPendingProjectSwitch = null;
    resolveAgentSwitchMock.mockClear();
    resolveProjectSwitchMock.mockClear();
    document.body.innerHTML = '';
  });

  it('renders neither card when no pending switch is set (baseline)', () => {
    mockMessages = [makeMessage('a')];
    renderWithProviders(<CommandBarStream />);
    // Neither the agent-switch nor the project-switch prompt copy should
    // appear — the stream looks identical to its pre-#117 behaviour.
    expect(screen.queryByText(/provider changed to/i)).toBeNull();
    expect(screen.queryByText(/project changed to/i)).toBeNull();
  });

  it('renders AgentSwitchCard when pendingAgentSwitch is set', () => {
    mockMessages = [makeMessage('a'), makeMessage('b', 'assistant')];
    mockPendingAgentSwitch = {
      newAgent: 'Claude',
      previousAgent: 'Ollama',
    };

    renderWithProviders(<CommandBarStream />);

    // The AgentSwitchCard prompt copy is specific enough to uniquely identify it.
    expect(screen.getByText(/provider changed to claude/i)).toBeTruthy();
    expect(screen.getByText(/previous: ollama/i)).toBeTruthy();
    // Stream still shows prior messages.
    expect(screen.getAllByTestId('chat-message-stub')).toHaveLength(2);
  });

  it('renders ProjectSwitchCard when pendingProjectSwitch is set', () => {
    mockMessages = [makeMessage('a')];
    mockPendingProjectSwitch = {
      newPaths: ['/Users/me/Notesage/work'],
      previousPaths: ['/Users/me/Notesage/personal'],
    };

    renderWithProviders(<CommandBarStream />);

    // Basename of newPaths[0] is "work" — the card uses basename for the label.
    expect(screen.getByText(/project changed to work/i)).toBeTruthy();
    expect(screen.getByText(/previous: personal/i)).toBeTruthy();
  });

  it('renders both cards simultaneously when both pending states are set', () => {
    mockMessages = [makeMessage('a')];
    mockPendingAgentSwitch = { newAgent: 'GPT', previousAgent: 'Claude' };
    mockPendingProjectSwitch = {
      newPaths: ['/tmp/new-project'],
      previousPaths: ['/tmp/old-project'],
    };

    renderWithProviders(<CommandBarStream />);

    expect(screen.getByText(/provider changed to gpt/i)).toBeTruthy();
    expect(screen.getByText(/project changed to new-project/i)).toBeTruthy();
  });

  it('clicking "Start fresh" on AgentSwitchCard calls resolveAgentSwitch(false)', () => {
    mockMessages = [makeMessage('a')];
    mockPendingAgentSwitch = {
      newAgent: 'Claude',
      previousAgent: 'Ollama',
    };

    renderWithProviders(<CommandBarStream />);

    // The "Start fresh" button is the card's primary action (resolveAgentSwitch(false)).
    const startFreshButton = screen.getByRole('button', { name: /start fresh/i });
    fireEvent.click(startFreshButton);

    expect(resolveAgentSwitchMock).toHaveBeenCalledTimes(1);
    expect(resolveAgentSwitchMock).toHaveBeenCalledWith(false);
  });

  it('clicking "Start fresh" on ProjectSwitchCard calls resolveProjectSwitch(false)', () => {
    mockMessages = [makeMessage('a')];
    mockPendingProjectSwitch = {
      newPaths: ['/Users/me/Notesage/work'],
      previousPaths: ['/Users/me/Notesage/personal'],
    };

    renderWithProviders(<CommandBarStream />);

    const startFreshButton = screen.getByRole('button', { name: /start fresh/i });
    fireEvent.click(startFreshButton);

    expect(resolveProjectSwitchMock).toHaveBeenCalledTimes(1);
    expect(resolveProjectSwitchMock).toHaveBeenCalledWith(false);
  });

  it('shows the switch card even when there are no prior messages (empty conversation)', () => {
    // If a switch fires before any messages exist, the stream must still show
    // the card instead of the "No messages yet" placeholder.
    mockMessages = [];
    mockPendingAgentSwitch = {
      newAgent: 'Claude',
      previousAgent: 'Ollama',
    };

    renderWithProviders(<CommandBarStream />);

    expect(screen.queryByText(/no messages yet/i)).toBeNull();
    expect(screen.getByText(/provider changed to claude/i)).toBeTruthy();
  });
});

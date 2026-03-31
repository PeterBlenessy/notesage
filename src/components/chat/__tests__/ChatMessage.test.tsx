// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/component-harness';
import { ChatMessage } from '../ChatMessage';
import type { ChatMessage as ChatMessageType } from '@/lib/ai/types';

// Mock stores
const mockDeleteMessage = vi.fn();
const mockChatState = { isLoading: false, deleteMessage: mockDeleteMessage };
vi.mock('@/stores/chat-store', () => ({
  useChatStore: vi.fn((selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(mockChatState) : mockChatState
  ),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(),
}));

// Mock ResizeObserver (not available in jsdom)
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const makeMessage = (overrides: Partial<ChatMessageType> = {}): ChatMessageType => ({
  role: 'user',
  content: 'Hello world',
  timestamp: Date.now(),
  id: 'msg-1',
  parentId: null,
  ...overrides,
});

describe('ChatMessage — resend/edit buttons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows edit and resend buttons for user messages (non-collapsed)', () => {
    render(
      <ChatMessage
        message={makeMessage({ role: 'user' })}
        onEdit={() => {}}
        onResend={() => {}}
      />
    );

    // In jsdom, ResizeObserver is not real so buttons stay inline (non-collapsed)
    expect(screen.getByTitle('Edit message')).toBeDefined();
    expect(screen.getByTitle('Resend message')).toBeDefined();
  });

  it('does not show edit/resend on assistant messages', () => {
    render(
      <ChatMessage
        message={makeMessage({ role: 'assistant' })}
        onEdit={() => {}}
        onResend={() => {}}
      />
    );

    expect(screen.queryByTitle('Edit message')).toBeNull();
    expect(screen.queryByTitle('Resend message')).toBeNull();
  });

  it('does not show edit/resend on system-status messages', () => {
    render(
      <ChatMessage
        message={makeMessage({ role: 'system-status' as 'user', statusType: 'reconnecting', agentName: 'test' })}
      />
    );

    expect(screen.queryByTitle('Edit message')).toBeNull();
    expect(screen.queryByTitle('Resend message')).toBeNull();
  });

  it('calls onEdit when edit button is clicked', () => {
    const onEdit = vi.fn();
    render(
      <ChatMessage
        message={makeMessage({ role: 'user' })}
        onEdit={onEdit}
        onResend={() => {}}
      />
    );

    fireEvent.click(screen.getByTitle('Edit message'));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('calls onResend when resend button is clicked', () => {
    const onResend = vi.fn();
    render(
      <ChatMessage
        message={makeMessage({ role: 'user' })}
        onEdit={() => {}}
        onResend={onResend}
      />
    );

    fireEvent.click(screen.getByTitle('Resend message'));
    expect(onResend).toHaveBeenCalledOnce();
  });

  it('does not show action buttons when no callbacks provided', () => {
    render(
      <ChatMessage
        message={makeMessage({ role: 'user' })}
      />
    );

    expect(screen.queryByTitle('Edit message')).toBeNull();
    expect(screen.queryByTitle('Resend message')).toBeNull();
  });

  it('does not show action buttons while loading', () => {
    mockChatState.isLoading = true;

    render(
      <ChatMessage
        message={makeMessage({ role: 'user' })}
        onEdit={() => {}}
        onResend={() => {}}
      />
    );

    expect(screen.queryByTitle('Edit message')).toBeNull();
    expect(screen.queryByTitle('Resend message')).toBeNull();

    mockChatState.isLoading = false;
  });
});

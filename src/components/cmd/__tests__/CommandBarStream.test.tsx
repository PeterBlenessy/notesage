// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, act } from '@/test/component-harness';
import type { ChatMessage as ChatMessageType } from '@/lib/ai/types';

// ---------------------------------------------------------------------------
// Mock useReducedMotion — flip per test via mockReturnValue
// ---------------------------------------------------------------------------

const useReducedMotionMock = vi.fn<() => boolean>(() => false);
vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: () => useReducedMotionMock(),
}));

// ---------------------------------------------------------------------------
// Mock chat-store — the active conversation drives the renderer.
//
// We model the bare minimum surface CommandBarStream needs: a `selectMessages`
// selector and a `useChatStore` hook that returns the loading flag. The store
// is fully replaceable per test via setMockMessages().
// ---------------------------------------------------------------------------

let mockMessages: ChatMessageType[] = [];

function setMockMessages(msgs: ChatMessageType[]) {
  mockMessages = msgs;
}

vi.mock('@/stores/chat-store', () => {
  // useChatStore is called as `useChatStore(selector)`. We feed it a shallow
  // state object containing the bits CommandBarStream may want to read.
  function useChatStore<T>(selector: (state: { isLoading: boolean }) => T): T {
    return selector({ isLoading: false });
  }
  return {
    useChatStore,
    selectMessages: () => mockMessages,
  };
});

// ---------------------------------------------------------------------------
// Mock ChatMessage so we can count renders without dragging the full segment
// renderer + markdown stack into the test.
// ---------------------------------------------------------------------------

vi.mock('@/components/chat/ChatMessage', () => ({
  ChatMessage: ({ message }: { message: ChatMessageType }) => (
    <div data-testid="chat-message-stub">{message.id}</div>
  ),
}));

import CommandBarStream from '@/components/cmd/CommandBarStream';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(id: string, role: ChatMessageType['role'] = 'user'): ChatMessageType {
  return { id, role, content: `msg-${id}`, timestamp: Date.now() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommandBarStream', () => {
  beforeEach(() => {
    useReducedMotionMock.mockReturnValue(false);
    setMockMessages([]);
    document.body.innerHTML = '';
  });

  it('renders the empty placeholder when there are no messages', () => {
    setMockMessages([]);
    renderWithProviders(<CommandBarStream />);
    expect(screen.getByText(/no messages yet/i)).toBeTruthy();
    expect(screen.queryAllByTestId('chat-message-stub')).toHaveLength(0);
  });

  it('renders a ChatMessage for each message in the active conversation', () => {
    setMockMessages([makeMessage('a', 'user'), makeMessage('b', 'assistant')]);
    renderWithProviders(<CommandBarStream />);
    const stubs = screen.getAllByTestId('chat-message-stub');
    expect(stubs).toHaveLength(2);
    expect(stubs[0].textContent).toBe('a');
    expect(stubs[1].textContent).toBe('b');
    expect(screen.queryByText(/no messages yet/i)).toBeNull();
  });

  it('auto-scrolls the container to the bottom when message count grows', () => {
    setMockMessages([makeMessage('a'), makeMessage('b')]);

    // Make scrollHeight non-zero in jsdom — it returns 0 by default.
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return 1234;
      },
    });

    const { rerender, container } = renderWithProviders(<CommandBarStream />);
    const scrollRegion = container.querySelector('[data-cmd-stream]') as HTMLDivElement;
    expect(scrollRegion).toBeTruthy();

    // Reset scrollTop after the initial mount auto-scroll.
    scrollRegion.scrollTop = 0;

    // Grow from 2 → 3 messages.
    setMockMessages([makeMessage('a'), makeMessage('b'), makeMessage('c')]);
    act(() => {
      rerender(<CommandBarStream />);
    });

    expect(scrollRegion.scrollTop).toBe(scrollRegion.scrollHeight);
  });

  it('uses non-smooth scroll behavior when prefers-reduced-motion is reduce', () => {
    useReducedMotionMock.mockReturnValue(true);

    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return 999;
      },
    });

    // Spy on scrollTo so we can read the behavior arg.
    const scrollToSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      writable: true,
      value: scrollToSpy,
    });

    setMockMessages([makeMessage('a')]);
    const { rerender } = renderWithProviders(<CommandBarStream />);

    // Trigger a length change to fire the scroll effect.
    setMockMessages([makeMessage('a'), makeMessage('b')]);
    act(() => {
      rerender(<CommandBarStream />);
    });

    expect(scrollToSpy).toHaveBeenCalled();
    const lastArgs = scrollToSpy.mock.calls[scrollToSpy.mock.calls.length - 1][0];
    expect(lastArgs.behavior).toBe('auto');
  });

  it('caps the scroll region height at 50vh', () => {
    setMockMessages([makeMessage('a')]);
    const { container } = renderWithProviders(<CommandBarStream />);
    const scrollRegion = container.querySelector('[data-cmd-stream]') as HTMLDivElement;
    expect(scrollRegion).toBeTruthy();
    expect(scrollRegion.className).toMatch(/max-h-\[50vh\]/);
    expect(scrollRegion.className).toMatch(/overflow-y-auto/);
  });

  // -------------------------------------------------------------------------
  // ARIA wiring (#78) — the stream container is a polite live region with
  // an explicit accessible name so screen readers announce new chunks.
  // -------------------------------------------------------------------------

  it('container has role="log", aria-live="polite", aria-label="Chat stream"', () => {
    setMockMessages([makeMessage('a')]);
    const { container } = renderWithProviders(<CommandBarStream />);
    const region = container.querySelector('[data-cmd-stream]') as HTMLElement;
    expect(region).toBeTruthy();
    expect(region.getAttribute('role')).toBe('log');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-label')).toBe('Chat stream');
  });
});

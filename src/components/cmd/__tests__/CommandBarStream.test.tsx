// @vitest-environment jsdom

/**
 * CommandBarStream tests — post-consolidation (2026-04-24).
 *
 * After the consolidation that rewrote CommandBarStream as a thin wrapper
 * around `<ChatMessageList />`, the component's own surface is small:
 *   - Outer wrapper carries `data-cmd-stream`, `role="log"`,
 *     `aria-live="polite"`, `aria-label="Chat stream"`, and the
 *     `max-h-[50vh]` height cap.
 *   - Inner `<ChatMessageList />` receives `selectedProjectPaths` from the
 *     chat-store selector, plus the `onSend` / `onResend` / `onEdit` /
 *     `onPrefill` handlers the parent passed in.
 *
 * Tests that used to assert message-loop or switch-card behaviour are
 * gone — those features now live inside `ChatMessageList` and are covered
 * by that suite (see `src/components/chat/__tests__/`). We test the
 * wrapper shape + prop pass-through here; duplicating the full list suite
 * would just drift.
 */

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '@/test/component-harness';
import CommandBarStream from '@/components/cmd/CommandBarStream';

// ---------------------------------------------------------------------------
// Stub ChatMessageList so we can inspect which props the wrapper forwarded.
// ---------------------------------------------------------------------------

const chatMessageListSpy = vi.fn();

vi.mock('@/components/chat/ChatMessageList', () => ({
  ChatMessageList: (props: Record<string, unknown>) => {
    chatMessageListSpy(props);
    return <div data-testid="chat-message-list-stub" />;
  },
}));

// ---------------------------------------------------------------------------
// Mock chat-store — only need `selectProjectPaths` to return a stable value.
// ---------------------------------------------------------------------------

let mockProjectPaths: string[] = [];

vi.mock('@/stores/chat-store', () => ({
  selectProjectPaths: vi.fn(() => mockProjectPaths),
  useChatStore: vi.fn((selector: (state: unknown) => unknown) =>
    selector(undefined),
  ),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommandBarStream (wrapper around ChatMessageList)', () => {
  beforeEach(() => {
    chatMessageListSpy.mockClear();
    mockProjectPaths = [];
  });

  it('renders an outer container with ARIA log semantics', () => {
    const { container } = renderWithProviders(
      <CommandBarStream onSend={() => undefined} />,
    );

    const outer = container.querySelector('[data-cmd-stream]') as HTMLElement | null;
    expect(outer).toBeTruthy();
    expect(outer?.getAttribute('role')).toBe('log');
    expect(outer?.getAttribute('aria-live')).toBe('polite');
    expect(outer?.getAttribute('aria-label')).toBe('Chat stream');
  });

  it('uses flex-1 + min-h-0 (no hard height cap — parent drives height)', () => {
    // 2026-04-24 regression: an earlier iteration had `max-h-[50vh]` which
    // broke pinned mode (input floated mid-screen). The wrapper now relies
    // on the enclosing bar's `h-[480px]` (floating) or `h-screen` (pinned)
    // to constrain; flex-1 grows to fill whatever's available.
    const { container } = renderWithProviders(
      <CommandBarStream onSend={() => undefined} />,
    );
    const outer = container.querySelector('[data-cmd-stream]') as HTMLElement | null;
    const tokens = outer?.className.split(/\s+/) ?? [];
    expect(tokens).toContain('flex-1');
    expect(tokens).toContain('min-h-0');
    expect(tokens).not.toContain('max-h-[50vh]');
  });

  it('renders <ChatMessageList /> inside the wrapper', () => {
    const { container } = renderWithProviders(
      <CommandBarStream onSend={() => undefined} />,
    );

    expect(container.querySelector('[data-testid="chat-message-list-stub"]')).toBeTruthy();
    expect(chatMessageListSpy).toHaveBeenCalledTimes(1);
  });

  it('forwards onSend / onPrefill / onResend / onEdit to ChatMessageList', () => {
    const onSend = vi.fn();
    const onPrefill = vi.fn();
    const onResend = vi.fn();
    const onEdit = vi.fn();

    renderWithProviders(
      <CommandBarStream
        onSend={onSend}
        onPrefill={onPrefill}
        onResend={onResend}
        onEdit={onEdit}
      />,
    );

    const props = chatMessageListSpy.mock.calls[0]?.[0];
    expect(props?.onSend).toBe(onSend);
    expect(props?.onPrefill).toBe(onPrefill);
    expect(props?.onResend).toBe(onResend);
    expect(props?.onEdit).toBe(onEdit);
  });

  it('forwards selectedProjectPaths from the chat-store selector', () => {
    mockProjectPaths = ['/Users/me/Notesage/alpha', '/Users/me/Notesage/beta'];
    renderWithProviders(<CommandBarStream onSend={() => undefined} />);

    const props = chatMessageListSpy.mock.calls[0]?.[0];
    expect(props?.selectedProjectPaths).toEqual([
      '/Users/me/Notesage/alpha',
      '/Users/me/Notesage/beta',
    ]);
  });

  it('forwards an empty project path list when no active conversation', () => {
    mockProjectPaths = [];
    renderWithProviders(<CommandBarStream onSend={() => undefined} />);

    const props = chatMessageListSpy.mock.calls[0]?.[0];
    expect(props?.selectedProjectPaths).toEqual([]);
  });
});

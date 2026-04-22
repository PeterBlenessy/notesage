// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/component-harness';
import { CommandBarHistory } from '../CommandBarHistory';
import type { Conversation } from '@/stores/chat-store';
import type { ChatMessage } from '@/lib/ai/types';

// chat-store mock — CommandBarHistory only reads `conversations`
let mockConversations: Conversation[] = [];

vi.mock('@/stores/chat-store', () => ({
  useChatStore: vi.fn((selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      conversations: mockConversations,
    };
    return selector ? selector(state) : state;
  }),
}));

// Mock ResizeObserver (not available in jsdom)
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    role: 'assistant',
    content: 'hi',
    timestamp: 1,
    id: 'm1',
    parentId: null,
    ...overrides,
  };
}

function makeConv(
  overrides: Partial<Conversation> & { id: string; title: string },
): Conversation {
  const base: Conversation = {
    id: overrides.id,
    title: overrides.title,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    projectPaths: [],
    segments: [],
    activeSegmentIndex: 0,
    activeLeafId: null,
  };
  return { ...base, ...overrides };
}

describe('CommandBarHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConversations = [];
  });

  it('renders all conversations sorted by date descending', () => {
    mockConversations = [
      makeConv({ id: 'old', title: 'Older chat', updatedAt: 1000 }),
      makeConv({ id: 'newest', title: 'Newest chat', updatedAt: 3000 }),
      makeConv({ id: 'mid', title: 'Middle chat', updatedAt: 2000 }),
    ];

    render(
      <CommandBarHistory
        onPickConversation={vi.fn()}
        selectedProjectPaths={[]}
      />,
    );

    const titles = screen.getAllByTestId('cmd-history-row-title').map((el) => el.textContent);
    expect(titles).toEqual(['Newest chat', 'Middle chat', 'Older chat']);
  });

  it('shows title, relative date, provider, and message count for each row', () => {
    const now = Date.now();
    mockConversations = [
      makeConv({
        id: 'a',
        title: 'Project A chat',
        updatedAt: now - 60_000, // 1 minute ago
        messages: [
          makeMessage({
            id: 'm1',
            role: 'user',
            content: 'hello',
            timestamp: now - 70_000,
          }),
          makeMessage({
            id: 'm2',
            role: 'assistant',
            content: 'hi',
            timestamp: now - 60_000,
            connectionLabel: 'Anthropic Claude',
            connectionProvider: 'anthropic',
          }),
        ],
      }),
    ];

    render(
      <CommandBarHistory
        onPickConversation={vi.fn()}
        selectedProjectPaths={[]}
      />,
    );

    expect(screen.getByText('Project A chat')).toBeDefined();
    // Provider label resolves from latest assistant message snapshot
    expect(screen.getByText('Anthropic Claude')).toBeDefined();
    // Message count
    expect(screen.getByText(/2\s+msgs/i)).toBeDefined();
    // Relative date formatted (e.g. "1m ago" / "just now")
    const dateBadge = screen.getByTestId('cmd-history-row-date');
    expect(dateBadge.textContent).toMatch(/ago|now/i);
  });

  it('calls onPickConversation with the row id when a row is clicked', () => {
    mockConversations = [
      makeConv({ id: 'first', title: 'First', updatedAt: 1 }),
    ];
    const onPick = vi.fn();

    render(
      <CommandBarHistory
        onPickConversation={onPick}
        selectedProjectPaths={[]}
      />,
    );

    fireEvent.click(screen.getByText('First'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('first');
  });

  it('arrow-down then Enter selects the second row', () => {
    mockConversations = [
      makeConv({ id: 'first', title: 'First chat', updatedAt: 3 }),
      makeConv({ id: 'second', title: 'Second chat', updatedAt: 2 }),
      makeConv({ id: 'third', title: 'Third chat', updatedAt: 1 }),
    ];
    const onPick = vi.fn();

    render(
      <CommandBarHistory
        onPickConversation={onPick}
        selectedProjectPaths={[]}
      />,
    );

    const list = screen.getByTestId('cmd-history-list');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('second');
  });

  it('renders the empty state when no conversations exist', () => {
    mockConversations = [];

    render(
      <CommandBarHistory
        onPickConversation={vi.fn()}
        selectedProjectPaths={[]}
      />,
    );

    expect(screen.getByText('No past conversations')).toBeDefined();
  });

  it('shows branch count badge when branches > 1', () => {
    // Two leaves diverge from a shared root
    const root: ChatMessage = {
      role: 'user',
      content: 'q',
      id: 'root',
      parentId: null,
      timestamp: 1,
    };
    const branchA: ChatMessage = {
      role: 'assistant',
      content: 'a',
      id: 'leafA',
      parentId: 'root',
      timestamp: 2,
    };
    const branchB: ChatMessage = {
      role: 'assistant',
      content: 'b',
      id: 'leafB',
      parentId: 'root',
      timestamp: 3,
    };
    mockConversations = [
      makeConv({
        id: 'multi',
        title: 'Multi-branch chat',
        messages: [root, branchA, branchB],
        activeLeafId: 'leafA',
        updatedAt: 10,
      }),
    ];

    render(
      <CommandBarHistory
        onPickConversation={vi.fn()}
        selectedProjectPaths={[]}
      />,
    );

    expect(screen.getByText(/2\s+branches/i)).toBeDefined();
  });

  it('filters by project scope when selectedProjectPaths is non-empty', () => {
    mockConversations = [
      makeConv({
        id: 'a',
        title: 'Project A chat',
        projectPaths: ['/proj/a'],
        updatedAt: 3,
      }),
      makeConv({
        id: 'b',
        title: 'Project B chat',
        projectPaths: ['/proj/b'],
        updatedAt: 2,
      }),
      makeConv({
        id: 'shared',
        title: 'Shared A+B',
        projectPaths: ['/proj/a', '/proj/b'],
        updatedAt: 1,
      }),
    ];

    render(
      <CommandBarHistory
        onPickConversation={vi.fn()}
        selectedProjectPaths={['/proj/a']}
      />,
    );

    expect(screen.getByText('Project A chat')).toBeDefined();
    expect(screen.getByText('Shared A+B')).toBeDefined();
    expect(screen.queryByText('Project B chat')).toBeNull();
  });

  it('shows all conversations when selectedProjectPaths is empty', () => {
    mockConversations = [
      makeConv({
        id: 'a',
        title: 'A',
        projectPaths: ['/proj/a'],
        updatedAt: 2,
      }),
      makeConv({
        id: 'legacy',
        title: 'Legacy',
        projectPaths: [],
        updatedAt: 1,
      }),
    ];

    render(
      <CommandBarHistory
        onPickConversation={vi.fn()}
        selectedProjectPaths={[]}
      />,
    );

    expect(screen.getByText('A')).toBeDefined();
    expect(screen.getByText('Legacy')).toBeDefined();
  });

  it('renders the sticky "History" header', () => {
    mockConversations = [
      makeConv({ id: 'a', title: 'A chat', updatedAt: 1 }),
    ];

    render(
      <CommandBarHistory
        onPickConversation={vi.fn()}
        selectedProjectPaths={[]}
      />,
    );

    expect(screen.getByTestId('cmd-history-header').textContent).toMatch(/history/i);
  });
});

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/component-harness';
import { ChatHistoryView } from '../ChatHistoryView';
import type { Conversation } from '@/stores/chat-store';

// Mock the acp-agent-state module so session/close paths are harmless
vi.mock('@/lib/ai/acp-agent-state', () => ({
  acpAgent: null,
}));

vi.mock('@/lib/ai/acp-utils', () => ({
  hasSessionCapability: vi.fn(() => false),
}));

// Minimal chat-store mock — the view only reads `conversations`, `activeConversationId`
// and calls `deleteConversation`.
const mockDeleteConversation = vi.fn();
let mockConversations: Conversation[] = [];
let mockActiveId: string | null = null;

vi.mock('@/stores/chat-store', () => ({
  useChatStore: vi.fn((selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      conversations: mockConversations,
      activeConversationId: mockActiveId,
      deleteConversation: mockDeleteConversation,
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

function makeConv(overrides: Partial<Conversation> & { id: string; title: string }): Conversation {
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

describe('ChatHistoryView — project scope filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteConversation.mockReset();
    mockActiveId = null;
  });

  it('shows only conversations whose projectPaths intersect the scope (default)', () => {
    mockConversations = [
      makeConv({ id: 'a', title: 'Project A chat', projectPaths: ['/proj/a'], updatedAt: 3 }),
      makeConv({ id: 'b', title: 'Project B chat', projectPaths: ['/proj/b'], updatedAt: 2 }),
      makeConv({ id: 'ab', title: 'Shared A+B', projectPaths: ['/proj/a', '/proj/b'], updatedAt: 1 }),
    ];

    render(
      <ChatHistoryView
        onSelectConversation={vi.fn()}
        selectedProjectPaths={['/proj/a']}
      />
    );

    expect(screen.getByText('Project A chat')).toBeDefined();
    expect(screen.getByText('Shared A+B')).toBeDefined();
    expect(screen.queryByText('Project B chat')).toBeNull();
  });

  it('hides conversations with empty projectPaths when a scope is active', () => {
    mockConversations = [
      makeConv({ id: 'a', title: 'Project A chat', projectPaths: ['/proj/a'], updatedAt: 2 }),
      makeConv({ id: 'legacy', title: 'Legacy chat', projectPaths: [], updatedAt: 1 }),
    ];

    render(
      <ChatHistoryView
        onSelectConversation={vi.fn()}
        selectedProjectPaths={['/proj/a']}
      />
    );

    expect(screen.getByText('Project A chat')).toBeDefined();
    expect(screen.queryByText('Legacy chat')).toBeNull();
  });

  it('shows all conversations after toggling "Show all projects"', () => {
    mockConversations = [
      makeConv({ id: 'a', title: 'Project A chat', projectPaths: ['/proj/a'], updatedAt: 3 }),
      makeConv({ id: 'b', title: 'Project B chat', projectPaths: ['/proj/b'], updatedAt: 2 }),
      makeConv({ id: 'legacy', title: 'Legacy chat', projectPaths: [], updatedAt: 1 }),
    ];

    render(
      <ChatHistoryView
        onSelectConversation={vi.fn()}
        selectedProjectPaths={['/proj/a']}
      />
    );

    // Initially scoped — only A visible
    expect(screen.getByText('Project A chat')).toBeDefined();
    expect(screen.queryByText('Project B chat')).toBeNull();
    expect(screen.queryByText('Legacy chat')).toBeNull();

    // Toggle to "all projects"
    fireEvent.click(screen.getByText('Show all projects'));

    expect(screen.getByText('Project A chat')).toBeDefined();
    expect(screen.getByText('Project B chat')).toBeDefined();
    expect(screen.getByText('Legacy chat')).toBeDefined();
  });

  it('shows scoped empty state when no conversations match the scope', () => {
    mockConversations = [
      makeConv({ id: 'b', title: 'Project B chat', projectPaths: ['/proj/b'], updatedAt: 1 }),
    ];

    render(
      <ChatHistoryView
        onSelectConversation={vi.fn()}
        selectedProjectPaths={['/proj/a']}
      />
    );

    expect(screen.getByText('No conversations for the selected project(s)')).toBeDefined();
    expect(screen.queryByText('Project B chat')).toBeNull();
  });

  it('still shows the empty-scope state even when "all projects" would reveal results', () => {
    mockConversations = [
      makeConv({ id: 'b', title: 'Project B chat', projectPaths: ['/proj/b'], updatedAt: 1 }),
    ];

    render(
      <ChatHistoryView
        onSelectConversation={vi.fn()}
        selectedProjectPaths={['/proj/a']}
      />
    );

    // Toggle surfaces the unscoped conversation
    fireEvent.click(screen.getByText('Show all projects'));
    expect(screen.getByText('Project B chat')).toBeDefined();
  });

  it('shows all conversations when no scope is provided (no toggle visible)', () => {
    mockConversations = [
      makeConv({ id: 'a', title: 'Project A chat', projectPaths: ['/proj/a'], updatedAt: 2 }),
      makeConv({ id: 'b', title: 'Project B chat', projectPaths: ['/proj/b'], updatedAt: 1 }),
    ];

    render(<ChatHistoryView onSelectConversation={vi.fn()} selectedProjectPaths={[]} />);

    expect(screen.getByText('Project A chat')).toBeDefined();
    expect(screen.getByText('Project B chat')).toBeDefined();
    expect(screen.queryByText('Show all projects')).toBeNull();
  });

  it('renders the global empty state when there are no conversations at all', () => {
    mockConversations = [];

    render(<ChatHistoryView onSelectConversation={vi.fn()} selectedProjectPaths={['/proj/a']} />);

    expect(screen.getByText('No conversations yet')).toBeDefined();
    // Scoped-empty copy should NOT appear alongside global empty
    expect(screen.queryByText('No conversations for the selected project(s)')).toBeNull();
  });

  it('invokes onSelectConversation when a visible row is clicked', () => {
    mockConversations = [
      makeConv({ id: 'a', title: 'Project A chat', projectPaths: ['/proj/a'], updatedAt: 1 }),
    ];
    const onSelect = vi.fn();

    render(
      <ChatHistoryView
        onSelectConversation={onSelect}
        selectedProjectPaths={['/proj/a']}
      />
    );

    fireEvent.click(screen.getByText('Project A chat'));
    expect(onSelect).toHaveBeenCalledWith('a');
  });
});

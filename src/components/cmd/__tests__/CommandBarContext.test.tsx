// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/component-harness';
import type { Connection } from '@/lib/ai/connections';
import type { Conversation } from '@/stores/chat-store';
import type { ChatMessage } from '@/lib/ai/types';
import type { ProjectMetadata } from '@/stores/project-metadata-store';

// ---------------------------------------------------------------------------
// Mockable store state — flipped per-test before render
// ---------------------------------------------------------------------------

let mockInteractiveConnection: Connection | null = null;
let mockConnections: Connection[] = [];
let mockActiveConversation: Conversation | null = null;
let mockMetadataMap: Record<string, ProjectMetadata> = {};
let mockCmdBarPinned = false;
const setCmdBarPinnedMock = vi.fn<(pinned: boolean) => void>();
const setRoutingMock = vi.fn<(useCase: string, connectionId: string | null) => void>();

vi.mock('@/stores/connections-store', () => {
  const state = {
    get connections(): Connection[] {
      return mockConnections;
    },
    getConnection: (id: string) =>
      mockConnections.find((c) => c.id === id),
  };
  return {
    useConnectionsStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

vi.mock('@/stores/routing-store', () => {
  const state = {
    routing: {
      get interactive() {
        return { connectionId: mockInteractiveConnection?.id ?? null };
      },
      agent_tasks: { connectionId: null },
      inline_completion: { connectionId: null },
    },
    getConnectionForUseCase: () => mockInteractiveConnection,
    setRouting: (useCase: string, connectionId: string | null) =>
      setRoutingMock(useCase, connectionId),
  };
  return {
    useRoutingStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

vi.mock('@/stores/chat-store', () => {
  const state = {
    get conversations(): Conversation[] {
      return mockActiveConversation ? [mockActiveConversation] : [];
    },
    get activeConversationId(): string | null {
      return mockActiveConversation?.id ?? null;
    },
  };
  return {
    useChatStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

vi.mock('@/stores/project-metadata-store', () => {
  const state = {
    get metadataMap(): Record<string, ProjectMetadata> {
      return mockMetadataMap;
    },
    getMetadata: (path: string) => mockMetadataMap[path],
  };
  return {
    useProjectMetadataStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

vi.mock('@/stores/settings-store', () => {
  const state = {
    get cmdBarPinned() { return mockCmdBarPinned; },
    setCmdBarPinned: (v: boolean) => setCmdBarPinnedMock(v),
  };
  return {
    useSettingsStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

// Mock the shadcn dropdown-menu module so its content is rendered inline
// (no portal / no Radix open-state machine). This keeps the dropdown DOM
// queryable from jsdom without simulating pointer events through Radix's
// internal state machine. We preserve `asChild` on the trigger by rendering
// children directly.
vi.mock('@/components/ui/dropdown-menu', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  const Trigger = ({ children }: { children?: React.ReactNode; asChild?: boolean }) =>
    <>{children}</>;
  const Content = ({ children }: { children?: React.ReactNode }) =>
    <div data-testid="dropdown-menu-content">{children}</div>;
  const Item = ({
    children,
    onSelect,
    onClick,
    ...rest
  }: {
    children?: React.ReactNode;
    onSelect?: () => void;
    onClick?: () => void;
  } & React.HTMLAttributes<HTMLButtonElement>) => (
    <button
      type="button"
      onClick={(e) => {
        onClick?.(e);
        onSelect?.();
      }}
      {...rest}
    >
      {children}
    </button>
  );
  return {
    DropdownMenu: Pass,
    DropdownMenuTrigger: Trigger,
    DropdownMenuContent: Content,
    DropdownMenuItem: Item,
    DropdownMenuLabel: Pass,
    DropdownMenuSeparator: () => <hr />,
  };
});

// Mock ProviderLogo to avoid asset-resolution side-effects.
vi.mock('@/components/ProviderLogo', () => ({
  ProviderLogo: ({ provider }: { provider: string }) => (
    <span data-testid={`provider-logo-${provider}`}>{provider}</span>
  ),
}));

// Now import after mocks are set up
import React from 'react';
import CommandBarContext from '@/components/cmd/CommandBarContext';

// ---------------------------------------------------------------------------
// Test factories
// ---------------------------------------------------------------------------

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-test-1',
    provider: 'anthropic',
    authMethod: 'api_key',
    status: 'connected',
    label: 'Anthropic',
    credentials: { type: 'api_key', credentialStored: true },
    capabilities: ['interactive', 'agent_tasks'],
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    role: 'user',
    content: 'hello',
    timestamp: 1,
    ...overrides,
  };
}

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    title: 'Untitled',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    projectPaths: [],
    segments: [],
    activeSegmentIndex: 0,
    activeLeafId: null,
    ...overrides,
  };
}

function makeMetadata(overrides: Partial<ProjectMetadata> = {}): ProjectMetadata {
  return {
    version: 1,
    name: 'Project',
    description: '',
    ai: {
      provider: null,
      agentName: null,
      projectContext: '',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommandBarContext', () => {
  beforeEach(() => {
    mockInteractiveConnection = null;
    mockConnections = [];
    mockActiveConversation = null;
    mockMetadataMap = {};
    mockCmdBarPinned = false;
    setCmdBarPinnedMock.mockReset();
    setRoutingMock.mockReset();
    document.body.innerHTML = '';
  });

  it('renders the provider pill with the active connection label', () => {
    const conn = makeConnection({ label: 'Claude Sonnet 4.5' });
    mockInteractiveConnection = conn;
    mockConnections = [conn];
    renderWithProviders(<CommandBarContext />);
    // The pill trigger advertises the active label as its accessible name.
    expect(
      screen.getByLabelText(/active provider: claude sonnet 4\.5/i),
    ).toBeTruthy();
  });

  it('renders one project chip per path in the active conversation', () => {
    mockActiveConversation = makeConversation({
      projectPaths: ['/Users/p/Projects/alpha', '/Users/p/Projects/beta'],
    });
    renderWithProviders(<CommandBarContext />);
    expect(screen.getByText('alpha')).toBeTruthy();
    expect(screen.getByText('beta')).toBeTruthy();
  });

  it('shows the lock icon for projects with aiLock metadata', () => {
    mockActiveConversation = makeConversation({
      projectPaths: ['/Users/p/Projects/locked-one'],
    });
    mockMetadataMap = {
      '/Users/p/Projects/locked-one': makeMetadata({
        aiLock: { connectionId: 'conn-x', lockedAt: Date.now() },
      }),
    };
    renderWithProviders(<CommandBarContext />);
    // The lock icon button has an explicit aria-label per project.
    expect(
      screen.getByLabelText(/locked-one is locked to a provider/i),
    ).toBeTruthy();
  });

  it('renders the dashed "+ project" button', () => {
    renderWithProviders(<CommandBarContext />);
    expect(screen.getByLabelText(/add project/i)).toBeTruthy();
  });

  it('renders the mode pill with the default "Agent" label', () => {
    renderWithProviders(<CommandBarContext />);
    expect(screen.getByText(/Agent/i)).toBeTruthy();
  });

  it('renders the clock and pin icon buttons with explicit aria-labels', () => {
    renderWithProviders(<CommandBarContext />);
    expect(screen.getByLabelText(/open history/i)).toBeTruthy();
    expect(screen.getByLabelText(/pin chat/i)).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Pin toggle (#28) — wires settings-store cmdBarPinned
  // -------------------------------------------------------------------------

  describe('pin toggle (#28)', () => {
    it('clicking the pin icon while floating calls setCmdBarPinned(true)', () => {
      mockCmdBarPinned = false;
      renderWithProviders(<CommandBarContext />);

      const pinButton = screen.getByLabelText(/pin chat to side/i);
      fireEvent.click(pinButton);

      expect(setCmdBarPinnedMock).toHaveBeenCalledWith(true);
    });

    it('clicking the pin icon while pinned calls setCmdBarPinned(false)', () => {
      mockCmdBarPinned = true;
      renderWithProviders(<CommandBarContext />);

      const unpinButton = screen.getByLabelText(/unpin chat/i);
      fireEvent.click(unpinButton);

      expect(setCmdBarPinnedMock).toHaveBeenCalledWith(false);
    });

    it('aria-label says "Pin chat to side" when not pinned', () => {
      mockCmdBarPinned = false;
      renderWithProviders(<CommandBarContext />);
      expect(screen.getByLabelText(/pin chat to side/i)).toBeTruthy();
    });

    it('aria-label contains "Unpin" when pinned', () => {
      mockCmdBarPinned = true;
      renderWithProviders(<CommandBarContext />);
      expect(screen.getByLabelText(/unpin/i)).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Provider pill (#24) — wires connections-store + routing-store
  // -------------------------------------------------------------------------

  describe('provider pill (#24)', () => {
    it('the provider pill is a dropdown trigger (no longer a stub)', () => {
      const conn = makeConnection({ label: 'Anthropic' });
      mockInteractiveConnection = conn;
      mockConnections = [conn];
      renderWithProviders(<CommandBarContext />);

      // The trigger button still carries the provider label as its accessible name.
      const trigger = screen.getByLabelText(/active provider: anthropic/i);
      expect(trigger).toBeTruthy();
    });

    it('renders one dropdown item per registered interactive connection', () => {
      const a = makeConnection({ id: 'conn-a', label: 'Anthropic', provider: 'anthropic' });
      const b = makeConnection({ id: 'conn-b', label: 'OpenAI', provider: 'openai' });
      const c = makeConnection({ id: 'conn-c', label: 'Ollama', provider: 'ollama', authMethod: 'local', capabilities: ['interactive'] });
      mockInteractiveConnection = a;
      mockConnections = [a, b, c];

      renderWithProviders(<CommandBarContext />);

      const items = screen.getAllByRole('button', { name: /switch provider to/i });
      expect(items).toHaveLength(3);
      expect(screen.getByRole('button', { name: /switch provider to anthropic/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /switch provider to openai/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /switch provider to ollama/i })).toBeTruthy();
    });

    it('hides connections that lack the "interactive" capability', () => {
      const a = makeConnection({ id: 'conn-a', label: 'Anthropic' });
      // A capability-less connection (e.g. inline-only) should not appear.
      const inlineOnly = makeConnection({
        id: 'conn-inline',
        label: 'Inline Only',
        capabilities: ['inline_completion'],
      });
      mockInteractiveConnection = a;
      mockConnections = [a, inlineOnly];

      renderWithProviders(<CommandBarContext />);

      expect(screen.getByRole('button', { name: /switch provider to anthropic/i })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /switch provider to inline only/i })).toBeNull();
    });

    it('marks the currently active connection with aria-current', () => {
      const a = makeConnection({ id: 'conn-a', label: 'Anthropic' });
      const b = makeConnection({ id: 'conn-b', label: 'OpenAI', provider: 'openai' });
      mockInteractiveConnection = a;
      mockConnections = [a, b];

      renderWithProviders(<CommandBarContext />);

      const activeItem = screen.getByRole('button', { name: /switch provider to anthropic/i });
      const inactiveItem = screen.getByRole('button', { name: /switch provider to openai/i });

      expect(activeItem.getAttribute('aria-current')).toBe('true');
      expect(inactiveItem.getAttribute('aria-current')).not.toBe('true');
    });

    it('selecting a different connection calls setRouting("interactive", id)', () => {
      const a = makeConnection({ id: 'conn-a', label: 'Anthropic' });
      const b = makeConnection({ id: 'conn-b', label: 'OpenAI', provider: 'openai' });
      mockInteractiveConnection = a;
      mockConnections = [a, b];

      renderWithProviders(<CommandBarContext />);

      const openaiItem = screen.getByRole('button', { name: /switch provider to openai/i });
      fireEvent.click(openaiItem);

      expect(setRoutingMock).toHaveBeenCalledWith('interactive', 'conn-b');
    });

    it('selecting the already-active connection is a no-op (does not call setRouting)', () => {
      const a = makeConnection({ id: 'conn-a', label: 'Anthropic' });
      mockInteractiveConnection = a;
      mockConnections = [a];

      renderWithProviders(<CommandBarContext />);

      const activeItem = screen.getByRole('button', { name: /switch provider to anthropic/i });
      fireEvent.click(activeItem);

      expect(setRoutingMock).not.toHaveBeenCalled();
    });

    it('switching with empty chat history calls setRouting (AgentSwitchCard owned by ChatPanel skips no-history convs)', () => {
      const a = makeConnection({ id: 'conn-a', label: 'Anthropic' });
      const b = makeConnection({ id: 'conn-b', label: 'OpenAI', provider: 'openai' });
      mockInteractiveConnection = a;
      mockConnections = [a, b];
      mockActiveConversation = makeConversation({ id: 'conv-empty', messages: [] });

      renderWithProviders(<CommandBarContext />);

      fireEvent.click(screen.getByRole('button', { name: /switch provider to openai/i }));

      // We dispatch the same store action ChatFooter uses. ChatPanel's effect
      // already short-circuits AgentSwitchCard when messages.length === 0, so
      // we deliberately do NOT add a separate prompt here.
      expect(setRoutingMock).toHaveBeenCalledWith('interactive', 'conn-b');
      expect(setRoutingMock).toHaveBeenCalledTimes(1);
    });

    it('switching with non-empty chat history still only calls setRouting (ChatPanel effect raises the prompt)', () => {
      const a = makeConnection({ id: 'conn-a', label: 'Anthropic' });
      const b = makeConnection({ id: 'conn-b', label: 'OpenAI', provider: 'openai' });
      mockInteractiveConnection = a;
      mockConnections = [a, b];
      mockActiveConversation = makeConversation({
        id: 'conv-with-history',
        messages: [
          makeMessage({ role: 'user', content: 'hi', timestamp: 1 }),
          makeMessage({ role: 'assistant', content: 'hello', timestamp: 2 }),
        ],
      });

      renderWithProviders(<CommandBarContext />);

      fireEvent.click(screen.getByRole('button', { name: /switch provider to openai/i }));

      // The AgentSwitchCard prompt is fired by ChatPanel's effect when
      // `effectiveConnection?.id` flips. Reusing the same setRouting action
      // means the existing context-isolation flow keeps working — we don't
      // duplicate the logic here.
      expect(setRoutingMock).toHaveBeenCalledWith('interactive', 'conn-b');
      expect(setRoutingMock).toHaveBeenCalledTimes(1);
    });

    it('renders no dropdown items when there are no interactive connections', () => {
      mockInteractiveConnection = null;
      mockConnections = [];
      renderWithProviders(<CommandBarContext />);

      expect(
        screen.queryAllByRole('button', { name: /switch provider to/i }),
      ).toHaveLength(0);
    });
  });
});

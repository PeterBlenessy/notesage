// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/component-harness';
import type { Connection } from '@/lib/ai/connections';
import type { Conversation } from '@/stores/chat-store';
import type { ProjectMetadata } from '@/stores/project-metadata-store';

// ---------------------------------------------------------------------------
// Mockable store state — flipped per-test before render
// ---------------------------------------------------------------------------

let mockInteractiveConnection: Connection | null = null;
let mockActiveConversation: Conversation | null = null;
let mockMetadataMap: Record<string, ProjectMetadata> = {};
let mockCmdBarPinned = false;
const setCmdBarPinnedMock = vi.fn<(pinned: boolean) => void>();

vi.mock('@/stores/connections-store', () => {
  const state = {
    get connections(): Connection[] {
      return mockInteractiveConnection ? [mockInteractiveConnection] : [];
    },
    getConnection: (id: string) =>
      mockInteractiveConnection?.id === id ? mockInteractiveConnection : undefined,
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

// Now import after mocks are set up
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
    mockActiveConversation = null;
    mockMetadataMap = {};
    mockCmdBarPinned = false;
    setCmdBarPinnedMock.mockReset();
    document.body.innerHTML = '';
  });

  it('renders the provider pill with the active connection label', () => {
    mockInteractiveConnection = makeConnection({ label: 'Claude Sonnet 4.5' });
    renderWithProviders(<CommandBarContext />);
    expect(screen.getByText('Claude Sonnet 4.5')).toBeTruthy();
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
});

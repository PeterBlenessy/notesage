// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  fireEvent,
  setMockInvokeHandler,
  clearMockInvokeHandlers,
} from '@/test/component-harness';
import type { Connection, AcpDiscoveredCapabilities } from '@/lib/ai/connections';
import type { Conversation } from '@/stores/chat-store';
import type { ChatMessage } from '@/lib/ai/types';
import type { ProjectMetadata } from '@/stores/project-metadata-store';
import type { WorkspaceProject } from '@/stores/workspace-store';
import type { AcpSessionInfo } from '@/lib/ai/acp-agent-state';

// ---------------------------------------------------------------------------
// Mockable store state — flipped per-test before render
// ---------------------------------------------------------------------------

let mockInteractiveConnection: Connection | null = null;
let mockConnections: Connection[] = [];
let mockActiveConversation: Conversation | null = null;
let mockMetadataMap: Record<string, ProjectMetadata> = {};
let mockCmdBarPinned = false;
let mockCrossProjectMode = false;
let mockWorkspaceProjects: WorkspaceProject[] = [];
const setCmdBarPinnedMock = vi.fn<(pinned: boolean) => void>();
const setRoutingMock = vi.fn<(useCase: string, connectionId: string | null) => void>();
const toggleProjectPathMock = vi.fn<(path: string) => void>();
const setSelectedProjectPathsMock = vi.fn<(paths: string[]) => void>();
const updateConnectionMock = vi.fn<(id: string, patch: Partial<Connection>) => void>();
const createConversationMock = vi.fn<() => string>(() => 'conv-new');
const setConversationModeMock = vi.fn<(modeId: string) => void>();

// ---------------------------------------------------------------------------
// ACP agent / session mocks (driving `AcpModePicker` via #26)
// ---------------------------------------------------------------------------

interface MockAcpAgentState {
  instanceId: string | null;
  connectionId: string | null;
  chatSessionId: string | null;
}

let mockAcpAgent: MockAcpAgentState = {
  instanceId: null,
  connectionId: null,
  chatSessionId: null,
};
let mockSessionInfo: AcpSessionInfo = {
  modes: null,
  configOptions: null,
  usage: null,
  commands: [],
};
const sessionInfoListeners = new Set<() => void>();
const updateCurrentModeMock = vi.fn<(modeId: string) => void>();

vi.mock('@/stores/connections-store', () => {
  const state = {
    get connections(): Connection[] {
      return mockConnections;
    },
    getConnection: (id: string) =>
      mockConnections.find((c) => c.id === id),
    updateConnection: (id: string, patch: Partial<Connection>) =>
      updateConnectionMock(id, patch),
  };
  return {
    useConnectionsStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

// Mock the acp-agent-state module so the picker can drive a controllable
// in-test session. We expose `acpAgent` as a live binding (accessor) since
// the production code reads `acpAgent` (not a function) and we need each
// access to return the current mock value.
vi.mock('@/lib/ai/acp-agent-state', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/acp-agent-state')>(
    '@/lib/ai/acp-agent-state',
  );
  return {
    // Preserve real exports (CommonModeKey enum, getCommonMode mapping table,
    // getCommonModes filter — these are pure utilities the picker imports).
    ...actual,
    // Live binding via getter: production reads `acpAgent` as a module-level
    // `let`, but ESM imports are read-only references — we proxy through a
    // getter so each access pulls the current mock value.
    get acpAgent() {
      return mockAcpAgent.instanceId
        ? {
            instanceId: mockAcpAgent.instanceId,
            connectionId: mockAcpAgent.connectionId!,
            chatSessionId: mockAcpAgent.chatSessionId,
            sandboxScopeKey: '',
          }
        : null;
    },
    // After the per-conversation registry migration (task #2) the mode picker
    // resolves its agent via `getAcpAgent(activeConversationId)` instead of the
    // `acpAgent` binding. Mirror the same controllable mock value here (the key
    // arg is irrelevant in-test — there is only one mock agent).
    getAcpAgent: () =>
      mockAcpAgent.instanceId
        ? {
            instanceId: mockAcpAgent.instanceId,
            connectionId: mockAcpAgent.connectionId!,
            chatSessionId: mockAcpAgent.chatSessionId,
            sandboxScopeKey: '',
          }
        : null,
    getSessionInfo: () => mockSessionInfo,
    subscribeSessionInfo: (fn: () => void) => {
      sessionInfoListeners.add(fn);
      return () => { sessionInfoListeners.delete(fn); };
    },
    updateCurrentMode: (modeId: string) => updateCurrentModeMock(modeId),
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
    toggleProjectPath: (path: string) => toggleProjectPathMock(path),
    setSelectedProjectPaths: (paths: string[]) => setSelectedProjectPathsMock(paths),
    createConversation: () => createConversationMock(),
    // AcpModePicker persists the picked mode per-conversation so it survives
    // agent respawns (fix/acp-mode-persists-across-respawn).
    setConversationMode: (modeId: string) => setConversationModeMock(modeId),
  };
  return {
    useChatStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
    // `selectProjectPaths` (#125) — used by CommandBarContext to drive the
    // goals pill + single-project discovery. Return the active
    // conversation's project paths so tests can seed a single-project case
    // via `mockActiveConversation.projectPaths`.
    selectProjectPaths: () => mockActiveConversation?.projectPaths ?? [],
  };
});

vi.mock('@/stores/workspace-store', () => {
  const state = {
    get projects(): WorkspaceProject[] {
      return mockWorkspaceProjects;
    },
  };
  return {
    useWorkspaceStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// Stub the explain-lock dialog to a simple visible marker — we don't need
// to drive the real Radix dialog under jsdom; we just want to verify the
// chip wires up to it.
vi.mock('@/components/chat/ExplainLockDialog', () => ({
  ExplainLockDialog: ({ open, lockedProjectPaths }: { open: boolean; lockedProjectPaths: string[] }) =>
    open ? (
      <div data-testid="explain-lock-dialog">
        {lockedProjectPaths.map((p) => (
          <span key={p}>{p}</span>
        ))}
      </div>
    ) : null,
}));

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

// #125 — `showAgentModePicker` gates whether the mode picker renders.
// Flip per-test to cover both paths.
let mockShowAgentModePicker = false;

vi.mock('@/stores/settings-store', () => {
  const state = {
    get cmdBarPinned() { return mockCmdBarPinned; },
    setCmdBarPinned: (v: boolean) => setCmdBarPinnedMock(v),
    get crossProjectMode() { return mockCrossProjectMode; },
    get showAgentModePicker() { return mockShowAgentModePicker; },
  };
  return {
    useSettingsStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

// #125 — Goals discovery drives the "N goals" pill. The real hook reads
// from the SQLite document index via a Tauri IPC call; we stub it to a
// deterministic list so the pill's render branch is testable.
let mockGoalFiles: Array<{ path: string; title: string }> = [];
vi.mock('@/hooks/useGoalsDiscovery', () => ({
  useGoalsDiscovery: () => ({ goalFiles: mockGoalFiles, reload: vi.fn() }),
}));

// #125 — Tooltip mock so the pill's tooltip trigger renders the pill
// markup without the Radix portal machinery.
vi.mock('@/components/ui/tooltip', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    Tooltip: Pass,
    TooltipProvider: Pass,
    TooltipTrigger: ({ children }: { children?: React.ReactNode; asChild?: boolean }) =>
      <>{children}</>,
    TooltipContent: ({ children }: { children?: React.ReactNode }) =>
      <div data-testid="tooltip-content">{children}</div>,
  };
});

// Mock the shadcn dropdown-menu module so its content is rendered inline
// (no portal / no Radix open-state machine). This keeps the dropdown DOM
// queryable from jsdom without simulating pointer events through Radix's
// internal state machine. We preserve `asChild` on the trigger by rendering
// children directly.
// --- Picker mocks ---
//
// AcpModePicker (and friends) compose `<DropdownMenuRadioGroup>` + custom
// `<PickerItem>` rows that internally use Radix `DropdownMenuPrimitive.RadioItem`.
// In jsdom + happy-dom we mock both layers:
//   - DropdownMenu wrappers render content inline (no portal, no open gate)
//     so labels are queryable directly.
//   - DropdownMenuRadioGroup pushes its onValueChange into a React context
//     so PickerItem rows can dispatch the click as a value-change.
//   - PickerItem / PickerCheckboxItem render as plain buttons that call
//     the right callback on click. Production uses Radix; tests skip Radix.
//
// Result: `screen.getByText('Plan')` + `fireEvent.click(planItem)` works
// the same way it did against the old plain-`<button>` rows.
//
// React import is hoisted via vi.hoisted because vi.mock factories themselves
// run before module-scope imports — the context object MUST be created inside
// the hoisted block so both mock factories can reference the same instance.
type PickerRadioGroupContextValue = { value: string; onValueChange?: (v: string) => void } | null;
const { PickerRadioGroupContext } = vi.hoisted((): { PickerRadioGroupContext: React.Context<PickerRadioGroupContextValue> } => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactRuntime = require('react') as typeof import('react');
  return { PickerRadioGroupContext: ReactRuntime.createContext<PickerRadioGroupContextValue>(null) };
});

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
  const RadioGroup = ({
    children,
    value,
    onValueChange,
  }: {
    children?: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
  }) => (
    <PickerRadioGroupContext.Provider value={{ value: value ?? '', onValueChange }}>
      {children}
    </PickerRadioGroupContext.Provider>
  );
  return {
    DropdownMenu: Pass,
    DropdownMenuTrigger: Trigger,
    DropdownMenuContent: Content,
    DropdownMenuItem: Item,
    DropdownMenuLabel: Pass,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuRadioGroup: RadioGroup,
  };
});

vi.mock('@/components/ui/picker-item', () => ({
  PickerItem: ({
    value,
    label,
    description,
    leading,
    trailing,
  }: {
    value: string;
    label: string;
    description?: string;
    leading?: React.ReactNode;
    trailing?: React.ReactNode;
  }) => {
    const ctx = React.useContext(PickerRadioGroupContext);
    const isChecked = ctx?.value === value;
    return (
      <button
        type="button"
        role="menuitemradio"
        aria-checked={isChecked}
        aria-label={label}
        data-slot="picker-item"
        data-checked={isChecked ? 'true' : 'false'}
        onClick={() => ctx?.onValueChange?.(value)}
      >
        <div>
          {leading}
          <span>{label}</span>
          {trailing}
        </div>
        {description && <div>{description}</div>}
      </button>
    );
  },
  PickerCheckboxItem: ({
    label,
    checked,
    onCheckedChange,
    trailing,
  }: {
    label: string;
    checked?: boolean;
    onCheckedChange?: (v: boolean) => void;
    trailing?: React.ReactNode;
  }) => (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={!!checked}
      aria-label={label}
      data-slot="picker-checkbox-item"
      data-checked={checked ? 'true' : 'false'}
      onClick={() => onCheckedChange?.(!checked)}
    >
      <span>{label}</span>
      {trailing}
    </button>
  ),
}));

// Mock ProviderLogo to avoid asset-resolution side-effects.
vi.mock('@/components/ProviderLogo', () => ({
  ProviderLogo: ({ provider }: { provider: string }) => (
    <span data-testid={`provider-logo-${provider}`}>{provider}</span>
  ),
}));

// Mock the shadcn popover module so its content is rendered inline (no
// portal / no Radix open-state machine). Mirrors the dropdown-menu mock
// above. We render the trigger as-is and the content always (no open gate)
// so tests can query the menu directly.
vi.mock('@/components/ui/popover', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  const Trigger = ({ children }: { children?: React.ReactNode; asChild?: boolean }) =>
    <>{children}</>;
  const Content = ({ children }: { children?: React.ReactNode }) =>
    <div data-testid="popover-content">{children}</div>;
  return {
    Popover: Pass,
    PopoverTrigger: Trigger,
    PopoverContent: Content,
    PopoverAnchor: Pass,
    PopoverHeader: Pass,
    PopoverTitle: Pass,
    PopoverDescription: Pass,
  };
});

// Now import after mocks are set up
import React from 'react';
import { toast } from 'sonner';
import CommandBarContext from '@/components/cmd/CommandBarContext';
import { subscribeToCmdBarEvents } from '@/lib/cmd-bar-events';

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
    mockCrossProjectMode = false;
    mockWorkspaceProjects = [];
    mockShowAgentModePicker = false;
    mockGoalFiles = [];
    mockAcpAgent = { instanceId: null, connectionId: null, chatSessionId: null };
    mockSessionInfo = { modes: null, configOptions: null, usage: null, commands: [] };
    sessionInfoListeners.clear();
    setCmdBarPinnedMock.mockReset();
    setRoutingMock.mockReset();
    toggleProjectPathMock.mockReset();
    setSelectedProjectPathsMock.mockReset();
    updateConnectionMock.mockReset();
    createConversationMock.mockReset();
    createConversationMock.mockReturnValue('conv-new');
    updateCurrentModeMock.mockReset();
    vi.mocked(toast.error).mockReset();
    vi.mocked(toast.info).mockReset();
    clearMockInvokeHandlers();
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

  it('renders the projects picker label when one project is selected', () => {
    // Live-test 2026-04-26 — picker shows the project name on its
    // trigger when only one project is selected. (Was: chip per
    // project rendered in-row; now multiselect picker.)
    mockActiveConversation = makeConversation({
      projectPaths: ['/Users/p/Projects/alpha'],
    });
    mockWorkspaceProjects = [{ path: '/Users/p/Projects/alpha', fileTree: [] }];
    renderWithProviders(<CommandBarContext />);
    expect(screen.getByText('alpha')).toBeTruthy();
  });

  it('shows the lock icon on the picker trigger when any selected project has aiLock', () => {
    mockActiveConversation = makeConversation({
      projectPaths: ['/Users/p/Projects/locked-one'],
    });
    mockWorkspaceProjects = [
      { path: '/Users/p/Projects/locked-one', fileTree: [] },
    ];
    mockMetadataMap = {
      '/Users/p/Projects/locked-one': makeMetadata({
        name: 'locked-one',
        aiLock: { connectionId: 'conn-x', lockedAt: Date.now() },
      }),
    };
    renderWithProviders(<CommandBarContext />);
    // Radix Popover renders content in JSDOM regardless of open state,
    // so the per-project lock affordance is reachable directly.
    expect(
      screen.getByLabelText(/locked-one is locked to a provider/i),
    ).toBeTruthy();
  });

  // Mode pill (#26) — see the dedicated `describe('mode pill (#26)', …)`
  // suite below. The pill is now sourced from `AcpModePicker`, which only
  // renders when an interactive ACP-capable connection is active and
  // exposes ≥2 mapped permission levels — the default empty-state of this
  // test file therefore renders nothing. Behavioural coverage lives in #26.

  it('renders the new-chat, clock, and pin icon buttons with explicit aria-labels', () => {
    renderWithProviders(<CommandBarContext />);
    expect(screen.getByLabelText(/start a new chat/i)).toBeTruthy();
    expect(screen.getByLabelText(/open history/i)).toBeTruthy();
    expect(screen.getByLabelText(/pin chat to side panel/i)).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // New-chat button (live-test 2026-04-26) — sits LEFT of the history toggle
  // and dispatches `createConversation()` on the chat store.
  // -------------------------------------------------------------------------

  describe('new-chat button (live-test 2026-04-26)', () => {
    it('clicking the + button calls createConversation when no conversation exists', () => {
      mockActiveConversation = null;
      renderWithProviders(<CommandBarContext />);

      const newChatBtn = screen.getByLabelText(/start a new chat/i);
      fireEvent.click(newChatBtn);

      expect(createConversationMock).toHaveBeenCalledTimes(1);
    });

    it('clicking the + button calls createConversation when active conversation has messages', () => {
      mockActiveConversation = makeConversation({
        messages: [
          makeMessage({ role: 'user', content: 'hi', timestamp: 1 }),
          makeMessage({ role: 'assistant', content: 'hello', timestamp: 2 }),
        ],
      });
      renderWithProviders(<CommandBarContext />);

      fireEvent.click(screen.getByLabelText(/start a new chat/i));

      expect(createConversationMock).toHaveBeenCalledTimes(1);
    });

    it('clicking the + button is a NO-OP when active conversation has zero messages', () => {
      // Already on a blank slate — don't churn through empty conversations.
      mockActiveConversation = makeConversation({ messages: [] });
      renderWithProviders(<CommandBarContext />);

      fireEvent.click(screen.getByLabelText(/start a new chat/i));

      expect(createConversationMock).not.toHaveBeenCalled();
    });

    it('the + button sits BEFORE the history toggle in DOM order (left of clock)', () => {
      const { container } = renderWithProviders(<CommandBarContext />);

      const newChatBtn = screen.getByLabelText(/start a new chat/i);
      const historyBtn = screen.getByLabelText(/open history/i);

      // Both buttons live inside the same context-row root and the new-chat
      // button must precede the history toggle in document order so it
      // visually renders to its left.
      const root = container.querySelector('[data-cmd-context]');
      expect(root).toBeTruthy();
      const buttons = Array.from(
        root!.querySelectorAll('button[aria-label]'),
      ) as HTMLElement[];
      const newChatIdx = buttons.indexOf(newChatBtn);
      const historyIdx = buttons.indexOf(historyBtn);
      expect(newChatIdx).toBeGreaterThanOrEqual(0);
      expect(historyIdx).toBeGreaterThanOrEqual(0);
      expect(newChatIdx).toBeLessThan(historyIdx);
    });

    it('emits toggle-history when clicked while in history view (so user lands in chat)', () => {
      const events: string[] = [];
      const unsub = subscribeToCmdBarEvents((e) => {
        events.push(e.type);
      });

      try {
        mockActiveConversation = makeConversation({
          messages: [makeMessage({ timestamp: 1 })],
        });
        renderWithProviders(<CommandBarContext chatView="history" />);

        fireEvent.click(screen.getByLabelText(/start a new chat/i));

        expect(createConversationMock).toHaveBeenCalledTimes(1);
        expect(events).toContain('toggle-history');
      } finally {
        unsub();
      }
    });

    it('does NOT emit toggle-history when clicked while already in chat view', () => {
      const events: string[] = [];
      const unsub = subscribeToCmdBarEvents((e) => {
        events.push(e.type);
      });

      try {
        mockActiveConversation = makeConversation({
          messages: [makeMessage({ timestamp: 1 })],
        });
        renderWithProviders(<CommandBarContext chatView="chat" />);

        fireEvent.click(screen.getByLabelText(/start a new chat/i));

        expect(createConversationMock).toHaveBeenCalledTimes(1);
        expect(events).not.toContain('toggle-history');
      } finally {
        unsub();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Pin toggle (#28 / #82) — wires settings-store cmdBarPinned and surfaces
  // explicit accessibility labels for both pin / unpin states.
  // -------------------------------------------------------------------------

  describe('pin toggle (#28 / #82)', () => {
    it('clicking the pin icon while floating calls setCmdBarPinned(true)', () => {
      mockCmdBarPinned = false;
      renderWithProviders(<CommandBarContext />);

      const pinButton = screen.getByLabelText(/pin chat to side panel/i);
      fireEvent.click(pinButton);

      expect(setCmdBarPinnedMock).toHaveBeenCalledWith(true);
    });

    it('clicking the pin icon while pinned calls setCmdBarPinned(false)', () => {
      mockCmdBarPinned = true;
      renderWithProviders(<CommandBarContext />);

      const unpinButton = screen.getByLabelText(
        /return chat to floating bar/i,
      );
      fireEvent.click(unpinButton);

      expect(setCmdBarPinnedMock).toHaveBeenCalledWith(false);
    });

    it('aria-label says "Pin chat to side panel" when not pinned', () => {
      mockCmdBarPinned = false;
      renderWithProviders(<CommandBarContext />);
      expect(screen.getByLabelText('Pin chat to side panel')).toBeTruthy();
    });

    it('aria-label says "Return chat to floating bar" when pinned (#82)', () => {
      mockCmdBarPinned = true;
      renderWithProviders(<CommandBarContext />);
      expect(screen.getByLabelText('Return chat to floating bar')).toBeTruthy();
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

      // ProviderQuickConfig also renders a Default model PickerItem when an
      // interactive connection is active; filter by connection-label to count
      // only provider-picker rows.
      const providerItems = screen
        .getAllByRole('menuitemradio')
        .filter((el) => /^(anthropic|openai|ollama)$/i.test(el.getAttribute('aria-label') ?? ''));
      expect(providerItems).toHaveLength(3);
      expect(screen.getByRole('menuitemradio', { name: /^anthropic$/i })).toBeTruthy();
      expect(screen.getByRole('menuitemradio', { name: /^openai$/i })).toBeTruthy();
      expect(screen.getByRole('menuitemradio', { name: /^ollama$/i })).toBeTruthy();
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

      expect(screen.getByRole('menuitemradio', { name: /^anthropic$/i })).toBeTruthy();
      expect(screen.queryByRole('menuitemradio', { name: /^inline only$/i })).toBeNull();
    });

    it('marks the currently active connection with aria-checked', () => {
      const a = makeConnection({ id: 'conn-a', label: 'Anthropic' });
      const b = makeConnection({ id: 'conn-b', label: 'OpenAI', provider: 'openai' });
      mockInteractiveConnection = a;
      mockConnections = [a, b];

      renderWithProviders(<CommandBarContext />);

      const activeItem = screen.getByRole('menuitemradio', { name: /^anthropic$/i });
      const inactiveItem = screen.getByRole('menuitemradio', { name: /^openai$/i });

      expect(activeItem.getAttribute('aria-checked')).toBe('true');
      expect(inactiveItem.getAttribute('aria-checked')).toBe('false');
    });

    it('selecting a different connection calls setRouting("interactive", id)', () => {
      const a = makeConnection({ id: 'conn-a', label: 'Anthropic' });
      const b = makeConnection({ id: 'conn-b', label: 'OpenAI', provider: 'openai' });
      mockInteractiveConnection = a;
      mockConnections = [a, b];

      renderWithProviders(<CommandBarContext />);

      const openaiItem = screen.getByRole('menuitemradio', { name: /^openai$/i });
      fireEvent.click(openaiItem);

      expect(setRoutingMock).toHaveBeenCalledWith('interactive', 'conn-b');
    });

    it('selecting the already-active connection is a no-op (does not call setRouting)', () => {
      const a = makeConnection({ id: 'conn-a', label: 'Anthropic' });
      mockInteractiveConnection = a;
      mockConnections = [a];

      renderWithProviders(<CommandBarContext />);

      const activeItem = screen.getByRole('menuitemradio', { name: /^anthropic$/i });
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

      fireEvent.click(screen.getByRole('menuitemradio', { name: /^openai$/i }));

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

      fireEvent.click(screen.getByRole('menuitemradio', { name: /^openai$/i }));

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

      expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Project chips (#25) — wires chat-store add/remove + workspace + locks
  // -------------------------------------------------------------------------

  describe('projects picker (#25 — multiselect, live-test 2026-04-26)', () => {
    /** Helper: render and open the multiselect popover. Returns the
     *  picker trigger so caller can re-click to close if needed. */
    function openPicker() {
      const picker =
        screen.queryByLabelText(/projects? selected|pick projects/i) ??
        screen.getByLabelText(/projects? selected/i);
      fireEvent.click(picker);
      return picker;
    }

    it("clicking a checked project in the popover calls toggleProjectPath (deselects)", () => {
      mockActiveConversation = makeConversation({
        projectPaths: ['/Users/p/Projects/alpha', '/Users/p/Projects/beta'],
      });
      mockWorkspaceProjects = [
        { path: '/Users/p/Projects/alpha', fileTree: [] },
        { path: '/Users/p/Projects/beta', fileTree: [] },
      ];
      renderWithProviders(<CommandBarContext />);

      openPicker();
      // Clicking a CHECKED project deselects it via toggleProjectPath.
      const item = screen.getByRole('menuitemcheckbox', { name: /^alpha$/i });
      expect(item.getAttribute('aria-checked')).toBe('true');
      fireEvent.click(item);

      expect(toggleProjectPathMock).toHaveBeenCalledWith('/Users/p/Projects/alpha');
      expect(toggleProjectPathMock).toHaveBeenCalledTimes(1);
    });

    it('popover lists ALL workspace projects with checkmarks for selected ones', () => {
      mockActiveConversation = makeConversation({
        projectPaths: ['/Users/p/Projects/alpha'],
      });
      mockWorkspaceProjects = [
        { path: '/Users/p/Projects/alpha', fileTree: [] },
        { path: '/Users/p/Projects/beta', fileTree: [] },
        { path: '/Users/p/Projects/gamma', fileTree: [] },
      ];
      renderWithProviders(<CommandBarContext />);

      // All three projects render; selected one is aria-checked, others not.
      const alpha = screen.getByRole('menuitemcheckbox', { name: /^alpha$/i });
      const beta = screen.getByRole('menuitemcheckbox', { name: /^beta$/i });
      const gamma = screen.getByRole('menuitemcheckbox', { name: /^gamma$/i });
      expect(alpha.getAttribute('aria-checked')).toBe('true');
      expect(beta.getAttribute('aria-checked')).toBe('false');
      expect(gamma.getAttribute('aria-checked')).toBe('false');
    });

    it('clicking an unchecked project in the popover calls toggleProjectPath (selects)', () => {
      mockActiveConversation = makeConversation({ projectPaths: [] });
      mockWorkspaceProjects = [
        { path: '/Users/p/Projects/alpha', fileTree: [] },
      ];
      renderWithProviders(<CommandBarContext />);

      const item = screen.getByRole('menuitemcheckbox', { name: /^alpha$/i });
      expect(item.getAttribute('aria-checked')).toBe('false');
      fireEvent.click(item);

      expect(toggleProjectPathMock).toHaveBeenCalledWith('/Users/p/Projects/alpha');
    });

    it('shows an empty-state message when no workspace projects are open', () => {
      mockActiveConversation = makeConversation({ projectPaths: [] });
      mockWorkspaceProjects = [];
      renderWithProviders(<CommandBarContext />);

      expect(screen.getByText(/no projects open/i)).toBeTruthy();
    });

    it('clicking the lock icon on a locked project in the popover opens the explain-lock dialog', () => {
      mockActiveConversation = makeConversation({
        projectPaths: ['/Users/p/Projects/locked-one'],
      });
      mockWorkspaceProjects = [
        { path: '/Users/p/Projects/locked-one', fileTree: [] },
      ];
      mockMetadataMap = {
        '/Users/p/Projects/locked-one': makeMetadata({
          name: 'locked-one',
          aiLock: { connectionId: 'conn-x', lockedAt: Date.now() },
        }),
      };
      renderWithProviders(<CommandBarContext />);

      const lockBtn = screen.getByLabelText(/locked-one is locked to a provider/i);
      fireEvent.click(lockBtn);

      const dialog = screen.getByTestId('explain-lock-dialog');
      expect(dialog).toBeTruthy();
      expect(dialog.textContent).toContain('/Users/p/Projects/locked-one');
    });

    it('selecting a project with a conflicting aiLock is prevented and shows an error toast', () => {
      mockActiveConversation = makeConversation({
        projectPaths: ['/Users/p/Projects/locked-a'],
      });
      mockWorkspaceProjects = [
        { path: '/Users/p/Projects/locked-a', fileTree: [] },
        { path: '/Users/p/Projects/locked-b', fileTree: [] },
      ];
      mockMetadataMap = {
        '/Users/p/Projects/locked-a': makeMetadata({
          name: 'locked-a',
          aiLock: { connectionId: 'conn-x', lockedAt: Date.now() },
        }),
        '/Users/p/Projects/locked-b': makeMetadata({
          name: 'locked-b',
          aiLock: { connectionId: 'conn-y', lockedAt: Date.now() },
        }),
      };
      renderWithProviders(<CommandBarContext />);

      const item = screen.getByRole('menuitemcheckbox', { name: /^locked-b$/i });
      fireEvent.click(item);

      expect(toggleProjectPathMock).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalled();
      expect(vi.mocked(toast.error).mock.calls[0][0]).toMatch(/locked|provider/i);
    });

    it('selecting an unlocked project on top of a locked-only selection is prevented and shows an error toast', () => {
      mockActiveConversation = makeConversation({
        projectPaths: ['/Users/p/Projects/locked-a'],
      });
      mockWorkspaceProjects = [
        { path: '/Users/p/Projects/locked-a', fileTree: [] },
        { path: '/Users/p/Projects/free', fileTree: [] },
      ];
      mockMetadataMap = {
        '/Users/p/Projects/locked-a': makeMetadata({
          aiLock: { connectionId: 'conn-x', lockedAt: Date.now() },
        }),
      };
      renderWithProviders(<CommandBarContext />);

      const item = screen.getByRole('menuitemcheckbox', { name: /^free$/i });
      fireEvent.click(item);

      expect(toggleProjectPathMock).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalled();
    });

    it('selecting a same-locked project is allowed', () => {
      mockActiveConversation = makeConversation({
        projectPaths: ['/Users/p/Projects/locked-a'],
      });
      mockWorkspaceProjects = [
        { path: '/Users/p/Projects/locked-a', fileTree: [] },
        { path: '/Users/p/Projects/locked-c', fileTree: [] },
      ];
      mockMetadataMap = {
        '/Users/p/Projects/locked-a': makeMetadata({
          name: 'locked-a',
          aiLock: { connectionId: 'conn-x', lockedAt: Date.now() },
        }),
        '/Users/p/Projects/locked-c': makeMetadata({
          name: 'locked-c',
          aiLock: { connectionId: 'conn-x', lockedAt: Date.now() },
        }),
      };
      renderWithProviders(<CommandBarContext />);

      const item = screen.getByRole('menuitemcheckbox', { name: /^locked-c$/i });
      fireEvent.click(item);

      expect(toggleProjectPathMock).toHaveBeenCalledWith('/Users/p/Projects/locked-c');
      expect(toast.error).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Mode pill (#26) — wires the command bar's `AcpModePicker` into the
  // context row. We exercise the picker directly (rather than mocking it
  // out) so the integration — common-mode mapping, store-action dispatch,
  // and the Full Access × sandbox conflict dialog — is end-to-end covered.
  // -------------------------------------------------------------------------

  describe('mode pill (#26)', () => {
    // #125 — The mode pill is now gated on `settings.showAgentModePicker`
    // (parity with ChatFooter). These tests exercise the mode-picker
    // behaviour directly, so flip the toggle on for the whole block.
    beforeEach(() => {
      mockShowAgentModePicker = true;
    });

    /**
     * Build a minimal ACP-capable connection that exposes all four common
     * permission levels via `acpCapabilities.availableModes`. Mode IDs come
     * from the real `MODE_ID_TO_COMMON` table inside `acp-agent-state` (we
     * use Codex's vocabulary for variety).
     */
    function makeAcpConnection(
      overrides: Partial<Connection> = {},
      caps: Partial<AcpDiscoveredCapabilities> = {},
    ): Connection {
      return makeConnection({
        id: 'conn-acp',
        // Codex ACP runs under the OpenAI provider umbrella in the connection
        // taxonomy — there is no standalone 'codex' provider. The mode IDs
        // we use below ('read-only', 'auto', 'full-access', 'plan') match
        // Codex's vocabulary, which is what we want to exercise.
        provider: 'openai',
        authMethod: 'agent_managed',
        label: 'Codex',
        capabilities: ['interactive', 'agent_tasks'],
        acpCapabilities: {
          availableModes: [
            { id: 'read-only', name: 'Read Only' },
            { id: 'auto', name: 'Agent' },
            { id: 'full-access', name: 'Full Access' },
            { id: 'plan', name: 'Plan' },
          ],
          ...caps,
        },
        ...overrides,
      });
    }

    it('hides the mode pill entirely when no interactive provider is active', () => {
      // Empty interactive slot ⇒ no pill at all (no "Direct API" disabled
      // placeholder either — the previous "Agent" stub was a #10 scaffold).
      mockInteractiveConnection = null;
      mockConnections = [];
      renderWithProviders(<CommandBarContext />);

      // No "Read Only" / "Full Access" / "Plan" labels → no picker rendered.
      expect(screen.queryByText('Read Only')).toBeNull();
      expect(screen.queryByText('Full Access')).toBeNull();
      expect(screen.queryByText('Plan')).toBeNull();
    });

    it('hides the mode pill when the active connection is a non-ACP direct-API provider', () => {
      // Anthropic / OpenAI / Ollama don't carry `acpCapabilities`, so
      // `getCommonModes(undefined ?? [])` returns []; the picker hides.
      const directApi = makeConnection({
        id: 'conn-anthropic',
        provider: 'anthropic',
        authMethod: 'api_key',
        label: 'Anthropic',
      });
      mockInteractiveConnection = directApi;
      mockConnections = [directApi];

      renderWithProviders(<CommandBarContext />);

      expect(screen.queryByText('Read Only')).toBeNull();
      expect(screen.queryByText('Full Access')).toBeNull();
      expect(screen.queryByText('Plan')).toBeNull();
    });

    it('renders the dropdown with all four common permission levels for an ACP connection', () => {
      const acp = makeAcpConnection();
      mockInteractiveConnection = acp;
      mockConnections = [acp];

      renderWithProviders(<CommandBarContext />);

      // The popover content is rendered inline by the test mock — every
      // common-mode label should be queryable inside it. The trigger button
      // also echoes one of the labels (the currently-selected mode), so we
      // expect ≥1 occurrence per label and verify all four are present at
      // least once. Items also carry their tooltip blurb as a sibling node.
      expect(screen.getAllByText('Read Only').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Agent').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Full Access').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Plan').length).toBeGreaterThanOrEqual(1);
    });

    it('selecting a level dispatches updateCurrentMode + acp_session_set_mode', async () => {
      const acp = makeAcpConnection();
      mockInteractiveConnection = acp;
      mockConnections = [acp];
      mockAcpAgent = {
        instanceId: 'inst-1',
        connectionId: acp.id,
        chatSessionId: 'sess-1',
      };
      mockSessionInfo = {
        modes: { currentModeId: 'auto', availableModes: [] },
        configOptions: null,
        usage: null,
        commands: [],
      };

      const setModeCalls: Array<Record<string, unknown>> = [];
      setMockInvokeHandler('acp_session_set_mode', (args) => {
        setModeCalls.push(args ?? {});
        return undefined;
      });

      renderWithProviders(<CommandBarContext />);

      // Click "Plan" — distinct from current "auto" → triggers applyMode().
      const planItem = screen.getByText('Plan');
      fireEvent.click(planItem);

      expect(updateCurrentModeMock).toHaveBeenCalledWith('plan');

      // Allow the awaited tauri invoke microtask to resolve before asserting.
      await Promise.resolve();
      await Promise.resolve();

      expect(setModeCalls).toHaveLength(1);
      expect(setModeCalls[0]).toMatchObject({
        instanceId: 'inst-1',
        sessionId: 'sess-1',
        modeId: 'plan',
      });
    });

    it('selecting Full Access with active sandbox restrictions opens the conflict dialog (does not dispatch)', () => {
      // Connection has the sandbox bits flipped ON ⇒ Full Access conflicts.
      const acp = makeAcpConnection({
        sandboxEnabled: true,
        networkSandboxEnabled: true,
        kernelNetworkDeny: true,
      });
      mockInteractiveConnection = acp;
      mockConnections = [acp];
      mockAcpAgent = {
        instanceId: 'inst-1',
        connectionId: acp.id,
        chatSessionId: 'sess-1',
      };
      mockSessionInfo = {
        modes: { currentModeId: 'auto', availableModes: [] },
        configOptions: null,
        usage: null,
        commands: [],
      };

      let setModeCalls = 0;
      setMockInvokeHandler('acp_session_set_mode', () => {
        setModeCalls += 1;
        return undefined;
      });

      renderWithProviders(<CommandBarContext />);

      fireEvent.click(screen.getByText('Full Access'));

      // The conflict dialog short-circuits the dispatch — no mode is set.
      expect(updateCurrentModeMock).not.toHaveBeenCalled();
      expect(setModeCalls).toBe(0);

      // The AlertDialog content surfaces the conflict heading. shadcn/ui's
      // AlertDialog (a thin Radix wrapper) is exercised for real here — its
      // Portal renders into document.body and is queryable from jsdom.
      expect(
        screen.getByText(/mode conflicts with security settings/i),
      ).toBeTruthy();
    });

    it('selecting Full Access with no sandbox restrictions dispatches without prompting', async () => {
      const acp = makeAcpConnection({
        sandboxEnabled: false,
        networkSandboxEnabled: false,
        kernelNetworkDeny: false,
      });
      mockInteractiveConnection = acp;
      mockConnections = [acp];
      mockAcpAgent = {
        instanceId: 'inst-1',
        connectionId: acp.id,
        chatSessionId: 'sess-1',
      };
      mockSessionInfo = {
        modes: { currentModeId: 'auto', availableModes: [] },
        configOptions: null,
        usage: null,
        commands: [],
      };

      const setModeCalls: Array<Record<string, unknown>> = [];
      setMockInvokeHandler('acp_session_set_mode', (args) => {
        setModeCalls.push(args ?? {});
        return undefined;
      });

      renderWithProviders(<CommandBarContext />);

      fireEvent.click(screen.getByText('Full Access'));

      expect(updateCurrentModeMock).toHaveBeenCalledWith('full-access');
      // No conflict heading should appear in the unrestricted path.
      expect(
        screen.queryByText(/mode conflicts with security settings/i),
      ).toBeNull();

      await Promise.resolve();
      await Promise.resolve();

      expect(setModeCalls).toHaveLength(1);
      expect(setModeCalls[0]).toMatchObject({ modeId: 'full-access' });
    });
  });

  // -------------------------------------------------------------------------
  // Cross-project scope pill (#73) — replaces the legacy ChatPanel banner
  // -------------------------------------------------------------------------

  describe('cross-project scope pill (#73)', () => {
    it('is not rendered when crossProjectMode is false', () => {
      mockCrossProjectMode = false;
      renderWithProviders(<CommandBarContext />);

      expect(screen.queryByText(/cross-project scope/i)).toBeNull();
    });

    it('is rendered with the "Cross-project scope" label when crossProjectMode is true', () => {
      mockCrossProjectMode = true;
      renderWithProviders(<CommandBarContext />);

      // The label appears inside the pill's button.
      expect(screen.getByText(/cross-project scope/i)).toBeTruthy();
      // The pill carries an aria-label explaining the warning + next step.
      expect(
        screen.getByLabelText(/cross-project mode exposes all workspace folders/i),
      ).toBeTruthy();
    });

    it('clicking the pill dispatches notesage:open-settings with { tab: "ai" }', () => {
      mockCrossProjectMode = true;
      const received: Array<{ tab?: string }> = [];
      const handler = (e: Event) => {
        const detail = (e as CustomEvent<{ tab?: string }>).detail;
        received.push(detail ?? {});
      };
      window.addEventListener('notesage:open-settings', handler);

      try {
        renderWithProviders(<CommandBarContext />);
        fireEvent.click(
          screen.getByLabelText(/cross-project mode exposes all workspace folders/i),
        );

        expect(received).toHaveLength(1);
        expect(received[0].tab).toBe('ai');
      } finally {
        window.removeEventListener('notesage:open-settings', handler);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Overflow / shrink layout (regression lock for the 5-project bug where
  // the agent mode picker and trailing icons got pushed out of view when
  // the command bar carried more than 2 project chips).
  // -------------------------------------------------------------------------

  describe('overflow (regression lock — live-test 2026-04-26)', () => {
    it('clips overflow at the context-row root so trailing pickers stay in view', () => {
      mockActiveConversation = makeConversation({
        projectPaths: ['/Users/p/Projects/alpha'],
      });
      const { container } = renderWithProviders(<CommandBarContext />);

      const root = container.querySelector('[data-cmd-context]');
      expect(root).toBeTruthy();
      // Root must NOT scroll horizontally — the projects picker now
      // owns the shrink budget so the row can never push the trailing
      // pickers off-screen.
      expect(root!.className).toMatch(/\boverflow-hidden\b/);
      expect(root!.className).not.toMatch(/\boverflow-x-auto\b/);
    });

    it('many selected projects still leave the agent mode picker + trailing icons in view', () => {
      // #125 — mode picker is now gated on showAgentModePicker; flip on so
      // this regression-lock test can still assert the slot exists.
      mockShowAgentModePicker = true;
      // Five-project scenario that triggered the original bug report.
      mockActiveConversation = makeConversation({
        projectPaths: [
          '/Users/p/Projects/alpha',
          '/Users/p/Projects/beta',
          '/Users/p/Projects/gamma',
          '/Users/p/Projects/delta',
          '/Users/p/Projects/epsilon',
        ],
      });
      mockWorkspaceProjects = [
        { path: '/Users/p/Projects/alpha', fileTree: [] },
        { path: '/Users/p/Projects/beta', fileTree: [] },
        { path: '/Users/p/Projects/gamma', fileTree: [] },
        { path: '/Users/p/Projects/delta', fileTree: [] },
        { path: '/Users/p/Projects/epsilon', fileTree: [] },
      ];
      const acp = makeConnection({
        id: 'conn-acp',
        provider: 'openai',
        authMethod: 'agent_managed',
        label: 'Codex',
        acpCapabilities: {
          availableModes: [
            { id: 'read-only', name: 'Read Only' },
            { id: 'auto', name: 'Agent' },
            { id: 'full-access', name: 'Full Access' },
            { id: 'plan', name: 'Plan' },
          ],
        },
      });
      mockInteractiveConnection = acp;
      mockConnections = [acp];

      const { container } = renderWithProviders(<CommandBarContext />);

      // The picker collapses N projects into a single trigger that
      // shows "<first> +N" — 5 projects no longer overflow the row.
      expect(
        screen.getByLabelText(/5 projects selected/i),
      ).toBeTruthy();

      // The mode picker is still in the DOM — its wrapper slot carries
      // shrink-0 so the flex layout can't compress it to zero width.
      const readOnlyNodes = screen.getAllByText('Read Only');
      expect(readOnlyNodes.length).toBeGreaterThanOrEqual(1);

      // Structural check: the context row has shrink-0 children for
      // pickers that must never collapse.
      const root = container.querySelector('[data-cmd-context]');
      expect(root).toBeTruthy();
      const shrinkZeroChildren = root!.querySelectorAll(':scope > .shrink-0');
      expect(shrinkZeroChildren.length).toBeGreaterThanOrEqual(1);

      // Trailing pin icon stays reachable.
      const pinButton = screen.getByLabelText(/pin chat to side panel/i);
      expect(pinButton).toBeTruthy();
      expect(pinButton.className).toMatch(/\bshrink-0\b/);
    });
  });

  // -------------------------------------------------------------------------
  // #125 — Parity with ChatFooter (showAgentModePicker gate + goals pill +
  // AcpSessionControls wiring). Each assertion exercises observable behaviour
  // rather than internal wiring so a refactor that preserves the UX keeps
  // these tests green.
  // -------------------------------------------------------------------------

  describe('ChatFooter parity (#125)', () => {
    function makeAcp(): Connection {
      return makeConnection({
        id: 'conn-acp',
        provider: 'openai',
        authMethod: 'agent_managed',
        label: 'Codex',
        capabilities: ['interactive', 'agent_tasks'],
        acpCapabilities: {
          availableModes: [
            { id: 'read-only', name: 'Read Only' },
            { id: 'auto', name: 'Agent' },
            { id: 'full-access', name: 'Full Access' },
            { id: 'plan', name: 'Plan' },
          ],
        },
      });
    }

    it('hides the mode picker when showAgentModePicker=false, even for an ACP connection', () => {
      mockShowAgentModePicker = false;
      const acp = makeAcp();
      mockInteractiveConnection = acp;
      mockConnections = [acp];

      renderWithProviders(<CommandBarContext />);

      // The picker exposes the "Read Only" label when rendered; if the
      // setting gates it off, none of the mode-level labels should be in
      // the DOM.
      expect(screen.queryByText('Read Only')).toBeNull();
      expect(screen.queryByText('Full Access')).toBeNull();
    });

    it('shows the mode picker when showAgentModePicker=true', () => {
      mockShowAgentModePicker = true;
      const acp = makeAcp();
      mockInteractiveConnection = acp;
      mockConnections = [acp];

      renderWithProviders(<CommandBarContext />);

      // When the gate is on, all four common-mode labels render inside the
      // AcpSessionControls picker (mocked dropdown shows content inline).
      expect(screen.getAllByText('Read Only').length).toBeGreaterThanOrEqual(1);
    });

    it('renders the "N goals" pill when the single-project selection has goals', () => {
      mockGoalFiles = [
        { path: '/p/alpha/goals/q1.md', title: 'Q1 objectives' },
        { path: '/p/alpha/goals/q2.md', title: 'Q2 objectives' },
      ];
      mockActiveConversation = makeConversation({
        projectPaths: ['/p/alpha'],
      });

      renderWithProviders(<CommandBarContext />);

      // The pill shows the count + the "goals" noun (pluralized).
      expect(screen.getByText(/2 goals/i)).toBeTruthy();
    });

    it('renders "1 goal" (singular) when there is exactly one goal file', () => {
      mockGoalFiles = [{ path: '/p/alpha/goals/q1.md', title: 'Q1' }];
      mockActiveConversation = makeConversation({ projectPaths: ['/p/alpha'] });

      renderWithProviders(<CommandBarContext />);

      expect(screen.getByText(/1 goal\b/i)).toBeTruthy();
    });

    it('suppresses the goals pill when no goals are discovered', () => {
      mockGoalFiles = [];
      mockActiveConversation = makeConversation({ projectPaths: ['/p/alpha'] });

      renderWithProviders(<CommandBarContext />);

      // The pill is rendered conditionally on goalFiles.length > 0; when
      // the count is zero, neither "1 goal" nor "N goals" should appear.
      expect(screen.queryByText(/\bgoals?\b/i)).toBeNull();
    });
  });
});

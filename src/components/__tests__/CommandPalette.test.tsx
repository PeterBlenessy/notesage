// @vitest-environment jsdom

// Polyfill ResizeObserver for cmdk (Command palette dependency)
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
}

// Polyfill scrollIntoView for cmdk in jsdom
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function () {};
}

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  registerDefaultHandlers,
} from '@/test/component-harness';
import { CommandPalette } from '@/components/CommandPalette';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: vi.fn(() => ({ openFile: vi.fn() })),
}));

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    indexTags: vi.fn(async () => []),
    indexTagOccurrences: vi.fn(async () => []),
    indexMentions: vi.fn(async () => []),
    indexMentionOccurrences: vi.fn(async () => []),
    indexSearchContent: vi.fn(async () => []),
    indexSearchResearch: vi.fn(async () => []),
  },
  FileEntry: {},
}));

// Symbol search mock — captures the `scope` prop so tests can assert
// scoped vs "all projects" propagation.
const symbolSearchSpy = vi.fn();
vi.mock('@/components/SymbolSearchResults', () => ({
  SymbolSearchResults: (props: { scope?: unknown }) => {
    symbolSearchSpy(props);
    return null;
  },
}));

vi.mock('@/lib/command-palette', () => ({
  deriveMode: vi.fn((input: string, externalMode?: string) => {
    if (externalMode === 'files') return 'files';
    if (input.startsWith('#')) return 'tags';
    if (input.startsWith('@')) return 'mentions';
    if (input.startsWith('>')) return 'commands';
    if (input.startsWith('?')) return 'research';
    return 'default';
  }),
  getQuery: vi.fn((input: string, mode: string) => {
    if (mode === 'default') return input;
    return input.slice(1);
  }),
  getPrefixForMode: vi.fn((mode: string) => {
    const prefixes: Record<string, string> = { tags: '#', mentions: '@', commands: '>', research: '?' };
    return prefixes[mode] || '';
  }),
  getPlaceholder: vi.fn(() => 'Search files and commands...'),
  getSearchPaths: vi.fn(() => []),
  getAllSearchPaths: vi.fn(() => ['/project-a', '/project-b']),
  getDefaultPaletteScope: vi.fn(() => 'all'),
  resolveSearchPaths: vi.fn((scope: unknown) => {
    if (scope === 'all') return ['/project-a', '/project-b'];
    if (Array.isArray(scope)) return scope as string[];
    return ['/project-a', '/project-b'];
  }),
}));

// ---------------------------------------------------------------------------
// Store mocks
// ---------------------------------------------------------------------------

vi.mock('@/stores/editor-store', () => {
  const store = {
    recentFiles: [],
    activeTabId: 'tab-1',
    getState: () => store,
  };
  return {
    useEditorStore: Object.assign(
      vi.fn((selector: (s: typeof store) => unknown) => selector(store)),
      { getState: () => store },
    ),
  };
});

vi.mock('@/stores/workspace-store', () => {
  const store = {
    explorerFolders: [],
    projects: [],
    notesTree: [],
    getState: () => store,
  };
  return {
    useWorkspaceStore: Object.assign(
      vi.fn((selector: (s: typeof store) => unknown) => selector(store)),
      { getState: () => store },
    ),
  };
});

vi.mock('@/stores/settings-store', () => {
  const store = {
    theme: 'light' as string,
    sidebarPinned: true,
    chatPanelOpen: false,
    setTheme: vi.fn(),
    setSidebarPinned: vi.fn(),
    setChatPanelOpen: vi.fn(),
    getState: () => store,
  };
  return {
    useSettingsStore: Object.assign(
      vi.fn((selector: (s: typeof store) => unknown) => selector(store)),
      { getState: () => store },
    ),
  };
});

// Mutable chat-store mock — tests tweak `projectPaths` to drive the palette's
// default scope.
const chatStoreState: {
  conversations: { id: string; projectPaths: string[] }[];
  activeConversationId: string | null;
} = {
  conversations: [],
  activeConversationId: null,
};

vi.mock('@/stores/chat-store', () => {
  const selectProjectPaths = (s: typeof chatStoreState) => {
    if (!s.activeConversationId) return [];
    return s.conversations.find((c) => c.id === s.activeConversationId)?.projectPaths ?? [];
  };
  const useChatStore = Object.assign(
    vi.fn((selector: (s: typeof chatStoreState) => unknown) => selector(chatStoreState)),
    { getState: () => chatStoreState },
  );
  return { useChatStore, selectProjectPaths };
});

// ---------------------------------------------------------------------------
// Default props helper
// ---------------------------------------------------------------------------

function defaultProps(overrides?: Partial<React.ComponentProps<typeof CommandPalette>>) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    onNewNote: vi.fn(),
    onNewProject: vi.fn(),
    onOpenFolder: vi.fn(),
    onOpenSettings: vi.fn(),
    onExportPdf: vi.fn(),
    onToggleFocusMode: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommandPalette', () => {
  beforeEach(() => {
    registerDefaultHandlers();
  });

  it('renders dialog when open is true', () => {
    renderWithProviders(<CommandPalette {...defaultProps()} />);
    // The dialog renders a search input with our mocked placeholder
    const input = screen.getByPlaceholderText('Search files and commands...');
    expect(input).toBeTruthy();
  });

  it('does not render dialog content when open is false', () => {
    renderWithProviders(<CommandPalette {...defaultProps({ open: false })} />);
    const input = screen.queryByPlaceholderText('Search files and commands...');
    expect(input).toBeNull();
  });

  it('shows action commands', () => {
    renderWithProviders(<CommandPalette {...defaultProps()} />);
    expect(screen.getByText('New Note')).toBeTruthy();
    expect(screen.getByText('New Project')).toBeTruthy();
    expect(screen.getByText('Open Folder')).toBeTruthy();
    expect(screen.getByText('Toggle Theme')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('closes on escape key', async () => {
    const onOpenChange = vi.fn();
    renderWithProviders(<CommandPalette {...defaultProps({ onOpenChange })} />);
    const input = screen.getByPlaceholderText('Search files and commands...');
    // Radix Dialog closes on Escape, which calls onOpenChange(false)
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows search input with placeholder', () => {
    renderWithProviders(<CommandPalette {...defaultProps()} />);
    const input = screen.getByPlaceholderText('Search files and commands...');
    expect(input).toBeTruthy();
    expect(input.tagName.toLowerCase()).toBe('input');
  });

  it('shows error state when research index query fails', async () => {
    const { tauriApi } = await import('@/lib/tauri');
    vi.mocked(tauriApi.indexSearchResearch).mockRejectedValue(new Error('index corrupted'));

    renderWithProviders(
      <CommandPalette {...defaultProps({ initialMode: 'research' })} />,
    );

    const { waitFor } = await import('@testing-library/react');
    // The debounced search fires after 300ms; wait for it to resolve
    await waitFor(
      () => {
        expect(screen.getByText(/search failed/i)).toBeTruthy();
      },
      { timeout: 2000 },
    );
  });

  it('shows error state when content search index query fails', async () => {
    const { tauriApi } = await import('@/lib/tauri');
    vi.mocked(tauriApi.indexSearchContent).mockRejectedValue(new Error('db locked'));

    // Override getSearchPaths to return a non-empty array so content search fires
    const { getSearchPaths } = await import('@/lib/command-palette');
    vi.mocked(getSearchPaths).mockReturnValue(['/test/project']);

    renderWithProviders(
      <CommandPalette {...defaultProps({ initialMode: 'files' })} />,
    );

    // Type a query so content search triggers (needs >= 2 chars)
    const { fireEvent } = await import('@testing-library/react');
    const input = screen.getByPlaceholderText('Search files and commands...');
    fireEvent.change(input, { target: { value: 'test query' } });

    const { waitFor } = await import('@testing-library/react');
    await waitFor(
      () => {
        expect(screen.getByText(/search failed/i)).toBeTruthy();
      },
      { timeout: 2000 },
    );
  });
});

// ---------------------------------------------------------------------------
// Scope behaviour (task #25)
// ---------------------------------------------------------------------------

describe('CommandPalette — search scope', () => {
  beforeEach(() => {
    registerDefaultHandlers();
    symbolSearchSpy.mockClear();
    chatStoreState.conversations = [];
    chatStoreState.activeConversationId = null;
  });

  it("hides the scope toggle when no projects are selected (defaults to 'all')", () => {
    renderWithProviders(<CommandPalette {...defaultProps()} />);
    // No selection → no "scoped" or "all projects" chip to toggle.
    expect(screen.queryByRole('switch', { name: /search all projects/i })).toBeNull();
  });

  it('shows the scope toggle in "scoped" state when the active conversation has selected projects', () => {
    chatStoreState.conversations = [
      { id: 'c1', projectPaths: ['/project-a'] },
    ];
    chatStoreState.activeConversationId = 'c1';

    renderWithProviders(<CommandPalette {...defaultProps()} />);
    const toggle = screen.getByRole('switch', { name: /search all projects/i });
    expect(toggle).toBeTruthy();
    // Default: aria-checked false, label reads "scoped" (narrow scope).
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.textContent).toMatch(/scoped/i);
  });

  it('toggle flips label to "all projects" and flags aria-checked=true', async () => {
    chatStoreState.conversations = [
      { id: 'c1', projectPaths: ['/project-a'] },
    ];
    chatStoreState.activeConversationId = 'c1';

    renderWithProviders(<CommandPalette {...defaultProps()} />);
    const toggle = screen.getByRole('switch', { name: /search all projects/i });
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.click(toggle);

    // After clicking the label flips.
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.textContent).toMatch(/all projects/i);
  });

  it('propagates scoped project paths to SymbolSearchResults for tags mode', async () => {
    chatStoreState.conversations = [
      { id: 'c1', projectPaths: ['/project-a'] },
    ];
    chatStoreState.activeConversationId = 'c1';

    renderWithProviders(<CommandPalette {...defaultProps({ initialMode: 'tags' })} />);
    // Last call captures the scope the palette passed in tags mode.
    const calls = symbolSearchSpy.mock.calls;
    const lastCall = calls[calls.length - 1]?.[0];
    expect(lastCall?.scope).toEqual(['/project-a']);
  });

  it("propagates 'all' scope to SymbolSearchResults after toggle is flipped", async () => {
    chatStoreState.conversations = [
      { id: 'c1', projectPaths: ['/project-a'] },
    ];
    chatStoreState.activeConversationId = 'c1';

    renderWithProviders(<CommandPalette {...defaultProps({ initialMode: 'tags' })} />);
    const toggle = screen.getByRole('switch', { name: /search all projects/i });
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.click(toggle);

    // After toggle ON the palette re-renders SymbolSearchResults with scope 'all'.
    const calls = symbolSearchSpy.mock.calls;
    const lastCall = calls[calls.length - 1]?.[0];
    expect(lastCall?.scope).toBe('all');
  });

  it("scope stays 'all' by default across @ and ? prefixes when nothing is selected", async () => {
    // No selection means 'all' for every mode.
    renderWithProviders(<CommandPalette {...defaultProps({ initialMode: 'mentions' })} />);
    const calls = symbolSearchSpy.mock.calls;
    const lastCall = calls[calls.length - 1]?.[0];
    expect(lastCall?.scope).toBe('all');
  });

  it('passes selected project paths to research (?) index queries', async () => {
    chatStoreState.conversations = [
      { id: 'c1', projectPaths: ['/project-a', '/project-b'] },
    ];
    chatStoreState.activeConversationId = 'c1';
    const { tauriApi } = await import('@/lib/tauri');

    renderWithProviders(<CommandPalette {...defaultProps({ initialMode: 'research' })} />);
    const { waitFor } = await import('@testing-library/react');
    // Debounced 300ms — give it time.
    await waitFor(
      () => {
        expect(tauriApi.indexSearchResearch).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );
    const calls = vi.mocked(tauriApi.indexSearchResearch).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall?.[0]).toEqual(['/project-a', '/project-b']);
  });
});

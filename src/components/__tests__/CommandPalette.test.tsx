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

vi.mock('@/components/SymbolSearchResults', () => ({
  SymbolSearchResults: () => null,
}));

vi.mock('@/lib/command-palette', () => ({
  deriveMode: vi.fn((input: string) => {
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
});

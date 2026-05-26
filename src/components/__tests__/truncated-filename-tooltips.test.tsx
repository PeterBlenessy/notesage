// @vitest-environment jsdom

/**
 * Red tests for issue #361 — truncated filename tooltips.
 *
 * Each test verifies that the relevant truncated element is wrapped
 * in a Radix Tooltip trigger (`data-slot="tooltip-trigger"`) so hovering
 * reveals the full filename / path / name.
 */

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import {
  renderWithProviders,
  screen,
  registerDefaultHandlers,
} from '@/test/component-harness';
import { TagsSection } from '@/components/sidebar/quiet/TagsSection';
import { MentionsSection } from '@/components/sidebar/quiet/MentionsSection';
import { TitleBar } from '@/components/TitleBar';
import { PinnedSection } from '@/components/sidebar/quiet/PinnedSection';
import { RecentSection } from '@/components/sidebar/quiet/RecentSection';
import { useEditorStore } from '@/stores/editor-store';
import { useSettingsStore } from '@/stores/settings-store';

// ---------------------------------------------------------------------------
// Mocks shared across multiple tests
// ---------------------------------------------------------------------------

const indexTagsMock = vi.fn();
const indexMentionsMock = vi.fn();

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    indexTags: (...args: unknown[]) => indexTagsMock(...args),
    indexMentions: (...args: unknown[]) => indexMentionsMock(...args),
  },
}));

vi.mock('@/lib/cmd-bar-events', () => ({
  emitCmdBarEvent: vi.fn(),
}));

// Workspace store — provide minimal shape for every component that reads it
const mockWorkspaceState = { projects: [], pinnedFiles: [] as string[], explorerFolders: [], notesTree: [], recentProjects: [] };
vi.mock('@/stores/workspace-store', () => ({
  useWorkspaceStore: <T,>(sel: (s: typeof mockWorkspaceState) => T) => sel(mockWorkspaceState),
}));

// Editor store — module-level mock so all describe blocks can configure it
vi.mock('@/stores/editor-store', () => ({
  useEditorStore: vi.fn(),
}));

// File operations
const mockOpenFile = vi.fn();
const mockRenamePath = vi.fn();
vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: vi.fn(() => ({
    openFile: mockOpenFile,
    openFileAtTag: vi.fn(),
    openFileAtText: vi.fn(),
    saveFile: vi.fn(),
    createFile: vi.fn(),
    createFolder: vi.fn(),
    renamePath: mockRenamePath,
    deletePath: vi.fn(),
    refreshFileTree: vi.fn(),
  })),
}));

vi.mock('@/components/sidebar/quiet/FilePreview', () => ({
  FilePreview: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  isPreviewable: () => false,
}));

vi.mock('@/components/sidebar/quiet/SidebarContextMenu', () => ({
  SidebarContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SIDEBAR_ENTER_RENAME_MODE_EVENT: 'notesage:sidebar-enter-rename-mode',
}));

vi.mock('@/components/sidebar/quiet/SidebarRowIndicators', () => ({
  SidebarRowIndicators: () => null,
}));

// ---------------------------------------------------------------------------
// 1. TagsSection — tag name is wrapped in a tooltip trigger
// ---------------------------------------------------------------------------

describe('TagsSection — truncated tag name tooltip', () => {
  beforeEach(() => {
    indexTagsMock.mockReset();
    useSettingsStore.setState({ sidebarTagsCap: 5 });
    mockWorkspaceState.projects = [];
  });

  it('wraps the tag name span in a Tooltip trigger', async () => {
    indexTagsMock.mockResolvedValue([{ tag: 'averyverylongtagname', file_count: 4 }]);
    renderWithProviders(<TagsSection />);

    // Wait for the async fetch to settle and the tag row to appear
    await waitFor(() => expect(screen.getByText('averyverylongtagname')).toBeTruthy());

    // The tag name text node should be inside a tooltip trigger
    const textEl = screen.getByText('averyverylongtagname');
    const trigger = textEl.closest('[data-slot="tooltip-trigger"]');
    expect(trigger).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. MentionsSection — mention name is wrapped in a tooltip trigger
// ---------------------------------------------------------------------------

describe('MentionsSection — truncated mention name tooltip', () => {
  beforeEach(() => {
    indexMentionsMock.mockReset();
    useSettingsStore.setState({ sidebarMentionsCap: 5 });
    mockWorkspaceState.projects = [];
  });

  it('wraps the mention name span in a Tooltip trigger', async () => {
    indexMentionsMock.mockResolvedValue([{ mention: 'averylongpersonname', file_count: 2 }]);
    renderWithProviders(<MentionsSection />);

    await waitFor(() => expect(screen.getByText('averylongpersonname')).toBeTruthy());

    const textEl = screen.getByText('averylongpersonname');
    const trigger = textEl.closest('[data-slot="tooltip-trigger"]');
    expect(trigger).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. TitleBar — document title is wrapped in a tooltip trigger
// ---------------------------------------------------------------------------

describe('TitleBar — document title tooltip', () => {
  const editorState = {
    openDocuments: [] as Array<{ id: string; fileName: string; isDirty: boolean; filePath: string }>,
    activeTabId: null as string | null,
    closeTab: vi.fn(),
    setPendingCloseTabId: vi.fn(),
  };

  beforeEach(() => {
    registerDefaultHandlers();
    editorState.openDocuments = [];
    editorState.activeTabId = null;
    (useEditorStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (sel: (s: typeof editorState) => unknown) => sel(editorState),
    );
    (useEditorStore as unknown as { getState: () => typeof editorState }).getState = () => editorState;
  });

  it('wraps the document filename span in a Tooltip trigger when a file is open', () => {
    editorState.openDocuments = [
      { id: 'tab1', fileName: 'a-very-long-document-filename.md', isDirty: false, filePath: '/projects/notes/a-very-long-document-filename.md' },
    ];
    editorState.activeTabId = 'tab1';

    renderWithProviders(<TitleBar />);

    const titleEl = screen.getByText('a-very-long-document-filename.md');
    const trigger = titleEl.closest('[data-slot="tooltip-trigger"]');
    expect(trigger).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. PinnedSection — pinned filename is wrapped in a tooltip trigger
// ---------------------------------------------------------------------------

describe('PinnedSection — pinned filename tooltip', () => {
  beforeEach(() => {
    (useEditorStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (sel: (s: { recentFiles: unknown[]; openDocuments: unknown[]; activeTabId: null }) => unknown) =>
        sel({ recentFiles: [], openDocuments: [], activeTabId: null }),
    );
    mockWorkspaceState.pinnedFiles = ['/projects/notes/a-very-long-pinned-filename.md'];
  });

  it('wraps the pinned filename span in a Tooltip trigger', () => {
    renderWithProviders(<PinnedSection />);

    const nameEl = screen.getByText('a-very-long-pinned-filename.md');
    const trigger = nameEl.closest('[data-slot="tooltip-trigger"]');
    expect(trigger).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. RecentSection — recent filename is wrapped in a tooltip trigger
// ---------------------------------------------------------------------------

describe('RecentSection — recent filename tooltip', () => {
  beforeEach(() => {
    useSettingsStore.setState({ sidebarRecentCap: 5 });
    (useEditorStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (sel: (s: {
        recentFiles: Array<{ path: string; name: string; lastAccessedAt?: number }>;
        openDocuments: unknown[];
        activeTabId: null;
      }) => unknown) =>
        sel({
          recentFiles: [{ path: '/projects/notes/a-very-long-recent-name.md', name: 'a-very-long-recent-name.md' }],
          openDocuments: [],
          activeTabId: null,
        }),
    );
  });

  it('wraps the recent filename span in a Tooltip trigger', () => {
    renderWithProviders(<RecentSection />);

    const nameEl = screen.getByText('a-very-long-recent-name.md');
    const trigger = nameEl.closest('[data-slot="tooltip-trigger"]');
    expect(trigger).not.toBeNull();
  });
});

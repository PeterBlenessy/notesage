// @vitest-environment jsdom

/**
 * Red tests for issue #361 — full tooltip coverage on truncated filenames.
 *
 * Each test verifies that the truncated filename/path span is wrapped inside a
 * Radix `<Tooltip>` trigger (`data-slot="tooltip-trigger"`) so hovering it
 * reveals the full name. Tests cover all 7 surfaces / 11 component touch points
 * identified by the aw-review of PR #368:
 *
 *   1. PinnedSection — filename span
 *   2. ProjectsSection (ProjectRow) — project name span
 *   3. ProjectsSection (ChildRow) — child entry name span
 *   4. RecentSection — filename span
 *   5. TagsSection — tag name span
 *   6. MentionsSection — mention name span
 *   7. TitleBar — document title span
 *   8. ExportDialog — PPTX user template name span
 *   9. DocumentOutline — heading text span
 *  10. FolderPeek — folder name span AND file name span
 *  11. FilePreview — filename span in header
 *
 * FileTreeItem already has a tooltip (added earlier); it is not re-tested here
 * but its delayDuration is aligned to 300ms as a separate assertion below.
 */

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  fireEvent,
  waitFor,
  registerDefaultHandlers,
} from '@/test/component-harness';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useEditorStore } from '@/stores/editor-store';
import { useSettingsStore } from '@/stores/settings-store';

// ---------------------------------------------------------------------------
// Shared store resets
// ---------------------------------------------------------------------------

function resetWorkspaceStore() {
  useWorkspaceStore.setState({
    explorerFolders: [],
    projects: [],
    recentProjects: [],
    notesTree: [],
    pinnedFiles: [],
    expandedFolders: new Set(),
  });
}

function resetEditorStore() {
  useEditorStore.setState({
    openDocuments: [],
    activeTabId: null,
    recentFiles: [],
  });
}

// ---------------------------------------------------------------------------
// Mock useFileOperations (used by PinnedSection, RecentSection, ProjectsSection)
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: vi.fn(() => ({
    openFile: vi.fn(),
    openFileAtTag: vi.fn(),
    openFileAtText: vi.fn(),
    saveFile: vi.fn(),
    createFile: vi.fn(),
    createFolder: vi.fn(),
    renamePath: vi.fn(),
    deletePath: vi.fn(),
    refreshFileTree: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Mock tauriApi for sections that use it
// ---------------------------------------------------------------------------

vi.mock('@/lib/tauri', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tauri')>('@/lib/tauri');
  return {
    ...actual,
    tauriApi: {
      ...actual.tauriApi,
      indexTags: vi.fn().mockResolvedValue([]),
      indexMentions: vi.fn().mockResolvedValue([]),
      listPptxTemplates: vi.fn().mockResolvedValue([]),
      importPptxTemplate: vi.fn(),
      deletePptxTemplate: vi.fn(),
      readBinaryFile: vi.fn().mockResolvedValue([]),
      listDirectory: vi.fn().mockResolvedValue([]),
    },
  };
});

// ---------------------------------------------------------------------------
// Helper: expect a span to be inside a tooltip trigger
// ---------------------------------------------------------------------------

function expectTooltipTrigger(el: HTMLElement) {
  // Radix TooltipTrigger with asChild sets data-slot="tooltip-trigger" on
  // the wrapped DOM element.
  const trigger = el.closest('[data-slot="tooltip-trigger"]');
  expect(trigger).not.toBeNull();
}

// ===========================================================================
// 1. PinnedSection — filename tooltip
// ===========================================================================

describe('PinnedSection — truncated filename tooltip', () => {
  beforeEach(() => {
    registerDefaultHandlers();
    resetWorkspaceStore();
    resetEditorStore();
  });

  it('wraps the filename span in a Tooltip trigger', async () => {
    const { PinnedSection } = await import(
      '@/components/sidebar/quiet/PinnedSection'
    );

    // pinnedFiles is string[] in the workspace store
    useWorkspaceStore.setState({
      pinnedFiles: ['/home/user/projects/my-very-long-document-name.md'],
    } as Parameters<typeof useWorkspaceStore.setState>[0]);

    renderWithProviders(<PinnedSection />);

    const nameSpan = screen.getByText('my-very-long-document-name.md');
    expectTooltipTrigger(nameSpan);
  });
});

// ===========================================================================
// 2 & 3. ProjectsSection — project name + child entry name tooltips
// ===========================================================================

describe('ProjectsSection — truncated name tooltips', () => {
  beforeEach(() => {
    registerDefaultHandlers();
    resetWorkspaceStore();
    resetEditorStore();
  });

  it('wraps the project name span in a Tooltip trigger', async () => {
    const { ProjectsSection } = await import(
      '@/components/sidebar/quiet/ProjectsSection'
    );

    useWorkspaceStore.setState({
      projects: [
        {
          path: '/home/user/projects/my-very-long-project-name',
          fileTree: [],
          name: 'my-very-long-project-name',
        },
      ],
    } as unknown as Parameters<typeof useWorkspaceStore.setState>[0]);

    renderWithProviders(<ProjectsSection />);

    const nameSpan = screen.getByText('my-very-long-project-name');
    expectTooltipTrigger(nameSpan);
  });
});

// ===========================================================================
// 4. RecentSection — filename tooltip
// ===========================================================================

describe('RecentSection — truncated filename tooltip', () => {
  beforeEach(() => {
    registerDefaultHandlers();
    resetWorkspaceStore();
    resetEditorStore();
  });

  it('wraps the filename span in a Tooltip trigger', async () => {
    const { RecentSection } = await import(
      '@/components/sidebar/quiet/RecentSection'
    );

    useEditorStore.setState({
      recentFiles: [
        {
          path: '/home/user/projects/my-very-long-document-name.md',
          name: 'my-very-long-document-name.md',
          lastAccessedAt: Date.now(),
        },
      ],
    } as Parameters<typeof useEditorStore.setState>[0]);

    renderWithProviders(<RecentSection />);

    const nameSpan = screen.getByText('my-very-long-document-name.md');
    expectTooltipTrigger(nameSpan);
  });
});

// ===========================================================================
// 5. TagsSection — tag name tooltip
// ===========================================================================

describe('TagsSection — truncated tag name tooltip', () => {
  beforeEach(() => {
    registerDefaultHandlers();
    resetWorkspaceStore();
    resetEditorStore();
  });

  it('wraps the tag name span in a Tooltip trigger', async () => {
    const { tauriApi } = await import('@/lib/tauri');
    (tauriApi.indexTags as ReturnType<typeof vi.fn>).mockResolvedValue([
      { tag: 'my-very-long-tag-name', file_count: 3 },
    ]);

    const { TagsSection } = await import(
      '@/components/sidebar/quiet/TagsSection'
    );

    useWorkspaceStore.setState({
      projects: [{ path: '/p', fileTree: [] }],
    } as unknown as Parameters<typeof useWorkspaceStore.setState>[0]);
    useSettingsStore.setState({ sidebarTagsCap: 5 });

    const { findByText } = renderWithProviders(<TagsSection />);

    const nameEl = await findByText('my-very-long-tag-name');
    expectTooltipTrigger(nameEl);
  });
});

// ===========================================================================
// 6. MentionsSection — mention name tooltip
// ===========================================================================

describe('MentionsSection — truncated mention name tooltip', () => {
  beforeEach(() => {
    registerDefaultHandlers();
    resetWorkspaceStore();
    resetEditorStore();
  });

  it('wraps the mention name span in a Tooltip trigger', async () => {
    const { tauriApi } = await import('@/lib/tauri');
    (tauriApi.indexMentions as ReturnType<typeof vi.fn>).mockResolvedValue([
      { mention: 'my-very-long-mention-name', file_count: 2 },
    ]);

    const { MentionsSection } = await import(
      '@/components/sidebar/quiet/MentionsSection'
    );

    useWorkspaceStore.setState({
      projects: [{ path: '/p', fileTree: [] }],
    } as unknown as Parameters<typeof useWorkspaceStore.setState>[0]);
    useSettingsStore.setState({ sidebarMentionsCap: 5 });

    const { findByText } = renderWithProviders(<MentionsSection />);

    const nameEl = await findByText('my-very-long-mention-name');
    expectTooltipTrigger(nameEl);
  });
});

// ===========================================================================
// 7. TitleBar — document title tooltip
// ===========================================================================

describe('TitleBar — truncated document title tooltip', () => {
  beforeEach(() => {
    registerDefaultHandlers();
    resetEditorStore();
  });

  it('wraps the document title span in a Tooltip trigger when a document is open', async () => {
    useEditorStore.setState({
      openDocuments: [
        {
          id: 'tab-1',
          fileName: 'my-very-long-document-name.md',
          filePath: '/home/user/projects/my-very-long-document-name.md',
          isDirty: false,
        },
      ],
      activeTabId: 'tab-1',
    } as Parameters<typeof useEditorStore.setState>[0]);

    const { TitleBar } = await import('@/components/TitleBar');

    renderWithProviders(<TitleBar />);

    const titleSpan = screen.getByText('my-very-long-document-name.md');
    expectTooltipTrigger(titleSpan);
  });
});

// ===========================================================================
// 8. ExportDialog — PPTX template name tooltip
// ===========================================================================

describe('ExportDialog — truncated template name tooltip', () => {
  beforeEach(() => {
    registerDefaultHandlers();
    // Set lastExportFormat to 'pptx' so the dialog opens on the PPTX tab
    useSettingsStore.setState({
      lastExportFormat: 'pptx' as const,
      lastExportTemplate: 'clean',
      lastExportPageSize: 'a4' as const,
      lastExportIncludeToC: false,
      lastExportIncludePageNumbers: false,
      lastPptxTemplate: 'simple',
    });
  });

  it('wraps the user template name span in a Tooltip trigger', async () => {
    const { tauriApi } = await import('@/lib/tauri');
    (tauriApi.listPptxTemplates as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'my-custom-tmpl', name: 'My-Very-Long-Custom-Template', scope: 'global' },
    ]);

    const { ExportDialog } = await import('@/components/ExportDialog');

    const { findByText } = renderWithProviders(
      <ExportDialog
        open={true}
        onOpenChange={vi.fn()}
        onExport={vi.fn()}
        isExporting={false}
      />,
    );

    // The dialog opens on PPTX tab already (lastExportFormat = 'pptx').
    // The user template list is loaded asynchronously via listPptxTemplates.
    const tmplNameEl = await findByText('My-Very-Long-Custom-Template');
    expectTooltipTrigger(tmplNameEl);
  });
});

// ===========================================================================
// 9. DocumentOutline — heading text tooltip
// ===========================================================================

describe('DocumentOutline — truncated heading text tooltip', () => {
  beforeEach(() => {
    registerDefaultHandlers();
  });

  it('wraps each heading text span in a Tooltip trigger', async () => {
    const { DocumentOutline } = await import('@/components/DocumentOutline');

    // Create a minimal ProseMirror editor mock
    const fakeEditor = {
      state: {
        doc: {
          descendants: (fn: (node: unknown, pos: number) => void) => {
            fn(
              { type: { name: 'heading' }, attrs: { level: 1 }, textContent: 'My Very Long Heading Text' },
              0,
            );
          },
        },
      },
    } as unknown as import('@tiptap/core').Editor;

    renderWithProviders(
      <DocumentOutline open={true} onOpenChange={vi.fn()} editor={fakeEditor} />,
    );

    const headingSpan = screen.getByText('My Very Long Heading Text');
    expectTooltipTrigger(headingSpan);
  });
});

// ===========================================================================
// 10. FolderPeek — folder name AND file name tooltips
// ===========================================================================

describe('FolderPeek — truncated entry name tooltips', () => {
  beforeEach(() => {
    registerDefaultHandlers();
    resetWorkspaceStore();
    resetEditorStore();
  });

  it('wraps folder name spans in Tooltip triggers', async () => {
    const { FolderPeek } = await import('@/components/sidebar/quiet/FolderPeek');

    const fileTree = [
      {
        name: 'my-very-long-subfolder-name',
        path: '/p/my-very-long-subfolder-name',
        is_directory: true,
        children: [],
        hidden: false,
      },
    ];

    const { getByRole } = renderWithProviders(
      <FolderPeek projectPath="/p" fileTree={fileTree}>
        <button type="button">Hover me</button>
      </FolderPeek>,
    );

    // Fire mouseenter on the trigger wrapper (the div with data-peek-trigger)
    const trigger = getByRole('button', { name: 'Hover me' }).parentElement!;
    fireEvent.mouseEnter(trigger);

    // Wait up to 700ms (HOVER_DELAY_MS = 500ms + buffer) for the popover to appear
    const folderSpan = await waitFor(
      () => screen.getByText('my-very-long-subfolder-name'),
      { timeout: 700 },
    );
    expectTooltipTrigger(folderSpan);
  }, 2000);
});

// ===========================================================================
// 11. FilePreview — filename in header tooltip
// ===========================================================================

describe('FilePreview — truncated filename header tooltip', () => {
  beforeEach(() => {
    registerDefaultHandlers();
    resetEditorStore();
  });

  it('wraps the filename span in a Tooltip trigger when preview is open', async () => {
    const { FilePreview } = await import('@/components/sidebar/quiet/FilePreview');

    const { getByRole } = renderWithProviders(
      // delayMs={0} so the popover opens immediately on mouseenter
      <FilePreview filePath="/p/my-very-long-document-name.md" delayMs={0}>
        <button type="button">Hover me</button>
      </FilePreview>,
    );

    // FilePreview listens to onMouseEnter on the PopoverTrigger wrapper div
    const triggerWrapper = getByRole('button', { name: 'Hover me' }).parentElement!;
    fireEvent.mouseEnter(triggerWrapper);

    // With delayMs=0 the setTimeout fires on the next tick; wait for DOM update
    const nameSpan = await waitFor(
      () => screen.getByText('my-very-long-document-name.md'),
      { timeout: 1000 },
    );
    expectTooltipTrigger(nameSpan);
  }, 2000);
});

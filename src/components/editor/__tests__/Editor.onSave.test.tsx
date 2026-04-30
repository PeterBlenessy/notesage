// @vitest-environment jsdom

import '@/test/tauri-mock';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, registerDefaultHandlers, fireEvent } from '@/test/component-harness';
import { createMockEditor } from '@/test/mock-editor';
import { useEditorStore } from '@/stores/editor-store';
import { useSettingsStore } from '@/stores/settings-store';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Mock Toolbar: renders a Save button ONLY when onSave is provided.
// Before the implementation, Editor does not pass onSave → no Save button (RED).
// After the implementation, Editor passes onSave → Save button appears (GREEN).
vi.mock('@/components/editor/Toolbar', () => ({
  Toolbar: ({ onSave, variant }: { onSave?: () => void; variant?: string }) => (
    <div data-testid={`toolbar-${variant ?? 'inline'}`}>
      {onSave && <button title="Save (cmd+S)" onClick={onSave}>Save</button>}
    </div>
  ),
}));

// Return a non-null mock editor so the Editor component doesn't early-return.
vi.mock('@/hooks/useEditor', () => ({
  useEditor: () => createMockEditor(),
}));

// Capture saveFile calls so tests can assert on the arguments.
const mockSaveFile = vi.fn();
vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: () => ({ saveFile: mockSaveFile }),
}));

// Safe defaults for hooks that return values used in rendering.
vi.mock('@/hooks/useScrollPersistence', () => ({
  useScrollPersistence: () => ({
    isProgrammaticScroll: false,
    isResizing: false,
    lastLoadedTabId: null,
    restoreScrollRatio: vi.fn(),
    saveOutgoingTabScroll: vi.fn(),
  }),
}));

vi.mock('@/hooks/useEditorResize', () => ({
  useEditorResize: () => ({ renderedWidth: 720 }),
}));

vi.mock('@/hooks/useDiffReview', () => ({
  useDiffReview: () => ({
    reviewActive: false,
    compareBranch: null,
    endReview: vi.fn(),
    handleAcceptAll: vi.fn(),
    handleRejectAll: vi.fn(),
    handleHunkAccepted: vi.fn(),
    handleHunkRejected: vi.fn(),
  }),
}));

vi.mock('@/hooks/useExportOperations', () => ({
  useExportOperations: () => ({}),
}));

vi.mock('@/hooks/usePageSettings', () => ({
  usePageSettings: () => ({ settings: {}, updateSettings: vi.fn() }),
}));

vi.mock('@/hooks/useActiveProject', () => ({
  useActiveProject: () => ({ projectPath: null }),
}));

vi.mock('@/hooks/useEditorKeyBindings', () => ({
  useEditorKeyBindings: () => ({
    findBarOpen: false,
    findMatchCount: 0,
    findCurrentMatch: 0,
    findInitialQuery: '',
    findReplaceExpanded: false,
    setFindReplaceExpanded: vi.fn(),
    handleFindSearch: vi.fn(),
    handleFindNext: vi.fn(),
    handleFindPrevious: vi.fn(),
    handleFindReplace: vi.fn(),
    handleFindReplaceAll: vi.fn(),
    handleFindClose: vi.fn(),
    handleToggleViewMode: vi.fn(),
  }),
}));

vi.mock('@/hooks/useCommentEditorSync', () => ({
  useCommentEditorSync: () => ({
    commentOps: {
      comments: [],
      commentKey: null,
      setActiveComment: vi.fn(),
      activeCommentId: null,
      createComment: vi.fn(),
      updateComment: vi.fn(),
      deleteComment: vi.fn(),
      resolveComment: vi.fn(),
    },
    delegateComment: vi.fn(),
    delegateReply: vi.fn(),
    cancelDelegation: vi.fn(),
    delegateAll: vi.fn(),
    moveToChat: vi.fn(),
    canDelegate: false,
    sendChatMessage: vi.fn(),
    activeCommentActivities: [],
    commentPopoverOpen: false,
    setCommentPopoverOpen: vi.fn(),
    pendingCommentRange: null,
    setPendingCommentRange: vi.fn(),
    commentAnchorPos: null,
    generatedUUIDRef: { current: null },
    savedSuggestionsRef: { current: [] },
    suggestionActive: false,
  }),
}));

vi.mock('@/hooks/useFileWatcherIntegration', () => ({
  useFileWatcherIntegration: () => ({
    externalChangesAll: [],
    changeListOpen: false,
    setChangeListOpen: vi.fn(),
    handleExternalAcceptAll: vi.fn(),
    handleExternalRejectAll: vi.fn(),
    handleExternalAcceptHunk: vi.fn(),
    handleExternalRejectHunk: vi.fn(),
  }),
}));

vi.mock('@/hooks/useEditorTabSwitch', () => ({
  useEditorTabSwitch: () => ({ pageInfo: null }),
}));

// Void hooks (side-effects only, no return values needed).
vi.mock('@/hooks/useFileWatcher', () => ({ useFileWatcher: vi.fn() }));
vi.mock('@/hooks/useCopilotCompletion', () => ({ useCopilotCompletion: vi.fn() }));
vi.mock('@/hooks/useCopilotCompletionCM', () => ({ useCopilotCompletionCM: vi.fn() }));
vi.mock('@/hooks/useLocalCompletion', () => ({ useLocalCompletion: vi.fn() }));

// Mock heavy sub-components so they don't pull in Tiptap DOM or complex deps.
vi.mock('@tiptap/react', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    EditorContent: () => React.createElement('div', { 'data-testid': 'editor-content' }),
  };
});

vi.mock('@/components/editor/BubbleMenu', () => ({ BubbleMenu: () => null }));
vi.mock('@/components/editor/TableHeaderMenu', () => ({ TableHeaderMenu: () => null }));
vi.mock('@/components/editor/SourceModeEditor', () => ({ SourceModeEditor: () => null }));
vi.mock('@/components/editor/StatusBar', () => ({
  StatusBar: () => React.createElement('div', { 'data-testid': 'status-bar' }),
}));
vi.mock('@/components/editor/FrontmatterBlock', () => ({ FrontmatterBlock: () => null }));
vi.mock('@/components/editor/CommentPopover', () => ({ CommentPopover: () => null }));
vi.mock('@/components/editor/DatePickerPopover', () => ({ DatePickerPopover: () => null }));
vi.mock('@/components/editor/TranscriptionOverlay', () => ({ TranscriptionOverlay: () => null }));
vi.mock('@/components/editor/BranchDiffSelector', () => ({ BranchDiffSelector: () => null }));
vi.mock('@/components/editor/PageHeaderFooterEditor', () => ({
  PageHeaderFooterEditor: () => null,
}));
vi.mock('@/components/editor/ImageInsertDialog', () => ({ ImageInsertDialog: () => null }));
vi.mock('@/components/editor/FindBar', () => ({ FindBar: () => null }));
vi.mock('@/components/editor/ChangeListPopover', () => ({ ChangeListPopover: () => null }));
vi.mock('@/components/DocumentOutline', () => ({ DocumentOutline: () => null }));
vi.mock('@/components/ExportDialog', () => ({ ExportDialog: () => null }));

vi.mock('@/components/editor/extensions', () => ({
  setPendingCommentRange: vi.fn(),
  getInlineDiffHunks: vi.fn(() => []),
  setSuggestion: vi.fn(),
  hasActiveSuggestion: vi.fn(() => false),
  PAGE_HF_CLICK_EVENT: 'page-hf-click',
  PAGE_BREAKS_RECALC_EVENT: 'page-breaks-recalc',
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function openMarkdownTab(filePath = '/test/note.md', content = '# Test') {
  const id = 'tab-' + filePath;
  useEditorStore.setState({
    openDocuments: [
      {
        id,
        filePath,
        fileName: filePath.split('/').pop() ?? 'note.md',
        isDirty: false,
        content,
        contentLoaded: true,
        frontmatter: null,
        fileType: 'markdown',
        viewMode: 'wysiwyg',
      },
    ],
    activeTabId: id,
  });
  return { id, filePath, content };
}

function resetStores() {
  useEditorStore.setState({ openDocuments: [], activeTabId: null });
  useSettingsStore.setState({
    toolbarVisible: true,
    uiPreview: 'legacy',
    showFloatingToolbar: false,
    gitEnabled: false,
    printLayout: false,
    contentWidth: 'auto',
    marginTop: 2,
    marginBottom: 2,
    marginLeft: 2,
    marginRight: 2,
    sourceWordWrap: false,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Editor – onSave wiring', () => {
  beforeEach(() => {
    registerDefaultHandlers();
    resetStores();
    mockSaveFile.mockReset();
    if (typeof globalThis.ResizeObserver === 'undefined') {
      globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof globalThis.ResizeObserver;
    }
    Element.prototype.scrollIntoView = vi.fn();
    // Prevent window.matchMedia crashes in jsdom
    if (!window.matchMedia) {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: false,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
    }
  });

  it('renders classic toolbar with a Save button when a markdown tab is open', async () => {
    // uiPreview !== "quiet-composer" → classic inline toolbar
    openMarkdownTab();
    const { Editor } = await import('@/components/editor/Editor');
    const { container } = renderWithProviders(<Editor />);

    const saveBtn = container.querySelector('button[title="Save (cmd+S)"]');
    expect(saveBtn).not.toBeNull();
  });

  it('renders quiet-composer pill toolbar with a Save button when a markdown tab is open', async () => {
    useSettingsStore.setState({ uiPreview: 'quiet-composer' });
    openMarkdownTab();
    const { Editor } = await import('@/components/editor/Editor');
    const { container } = renderWithProviders(<Editor />);

    const saveBtn = container.querySelector('button[title="Save (cmd+S)"]');
    expect(saveBtn).not.toBeNull();
  });

  it('clicking the Save button invokes saveFile with the active tab path and content', async () => {
    const { filePath, content, id } = openMarkdownTab('/project/my-note.md', '# My Note');
    const { Editor } = await import('@/components/editor/Editor');
    const { container } = renderWithProviders(<Editor />);

    const saveBtn = container.querySelector('button[title="Save (cmd+S)"]') as HTMLElement;
    expect(saveBtn).not.toBeNull();
    fireEvent.click(saveBtn);

    expect(mockSaveFile).toHaveBeenCalledOnce();
    expect(mockSaveFile).toHaveBeenCalledWith(filePath, content, id);
  });
});

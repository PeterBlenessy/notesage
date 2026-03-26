// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  registerDefaultHandlers,
} from '@/test/component-harness';
import { createMockEditor } from '@/test/mock-editor';
import type { Editor } from '@tiptap/core';
import { StatusBar } from '@/components/editor/StatusBar';

// ---------------------------------------------------------------------------
// Store mocks — StatusBar sub-components read from several Zustand stores.
// We mock them to return inert defaults so the component renders cleanly.
// ---------------------------------------------------------------------------

vi.mock('@/stores/action-store', () => {
  const store = {
    getOpenCount: () => 0,
    getState: () => store,
  };
  return {
    useActionStore: Object.assign(
      vi.fn((selector: (s: typeof store) => unknown) => selector(store)),
      { getState: () => store },
    ),
  };
});

vi.mock('@/stores/local-ai-store', () => {
  const store = {
    serverStatus: 'stopped' as const,
    activeModelId: null,
    models: [],
    getState: () => store,
  };
  return {
    useLocalAIStore: Object.assign(
      vi.fn((selector: (s: typeof store) => unknown) => selector(store)),
      { getState: () => store },
    ),
  };
});

vi.mock('@/stores/connections-store', () => {
  const store = {
    connections: [],
    getState: () => store,
  };
  return {
    useConnectionsStore: Object.assign(
      vi.fn((selector: (s: typeof store) => unknown) => selector(store)),
      { getState: () => store },
    ),
  };
});

vi.mock('@/stores/recording-store', () => {
  const store = {
    activeDownloads: {},
    availableModels: [],
    cancelDownload: vi.fn(),
    getState: () => store,
  };
  return {
    useRecordingStore: Object.assign(
      vi.fn((selector: (s: typeof store) => unknown) => selector(store)),
      { getState: () => store },
    ),
  };
});

vi.mock('@/stores/skill-store', () => {
  const store = {
    agentInstructions: [],
    getState: () => store,
  };
  return {
    useSkillStore: Object.assign(
      vi.fn((selector: (s: typeof store) => unknown) => selector(store)),
      { getState: () => store },
    ),
  };
});

vi.mock('@/stores/comment-store', () => {
  const store = {
    comments: {},
    getState: () => store,
  };
  return {
    useCommentStore: Object.assign(
      vi.fn((selector: (s: typeof store) => unknown) => selector(store)),
      { getState: () => store },
    ),
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StatusBar', () => {
  beforeEach(() => {
    registerDefaultHandlers();
  });

  it('renders without crash when editor is null', () => {
    renderWithProviders(<StatusBar editor={null} />);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('shows word count when editor is provided', () => {
    const editor = createMockEditor({ text: 'Hello world test content yay' }) as Editor;
    renderWithProviders(<StatusBar editor={editor} />);
    expect(screen.getByText('5 words')).toBeTruthy();
  });

  it('shows reading time', () => {
    const editor = createMockEditor({ text: 'Hello world test content yay' }) as Editor;
    renderWithProviders(<StatusBar editor={editor} />);
    expect(screen.getByText('1 min read')).toBeTruthy();
  });

  it('shows "Rich text" when viewMode is "wysiwyg"', () => {
    const editor = createMockEditor() as Editor;
    renderWithProviders(<StatusBar editor={editor} viewMode="wysiwyg" />);
    expect(screen.getByText('Rich text')).toBeTruthy();
  });

  it('shows "Raw" when viewMode is "source"', () => {
    const editor = createMockEditor() as Editor;
    renderWithProviders(<StatusBar editor={editor} viewMode="source" />);
    expect(screen.getByText('Raw')).toBeTruthy();
  });

  it('shows git branch name when isGitRepo and branchName provided', () => {
    const editor = createMockEditor() as Editor;
    renderWithProviders(
      <StatusBar editor={editor} isGitRepo branchName="feature/test-branch" />,
    );
    expect(screen.getByText('feature/test-branch')).toBeTruthy();
  });

  it('shows page info when pageInfo provided', () => {
    const editor = createMockEditor() as Editor;
    renderWithProviders(
      <StatusBar editor={editor} pageInfo={{ current: 3, total: 10 }} />,
    );
    expect(screen.getByText('page 3/10')).toBeTruthy();
  });
});

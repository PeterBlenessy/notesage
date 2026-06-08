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

  it('renders the status strip when editor is null', () => {
    const { container } = renderWithProviders(<StatusBar editor={null} />);
    // Quiet Composer is the only shell — the strip root carries
    // data-quiet-status + role="button" (#415 removed the legacy
    // role="status" full variant).
    const root = container.querySelector('[data-quiet-status]');
    expect(root).toBeTruthy();
    expect(root?.getAttribute('aria-label')).toBe('Open status tray');
  });

  it('shows word count when editor is provided', () => {
    const editor = createMockEditor({ text: 'Hello world test content yay' }) as Editor;
    renderWithProviders(<StatusBar editor={editor} />);
    expect(screen.getByText('5 words')).toBeTruthy();
  });

  // Reading time, inline viewMode (Rich text / Raw), git branch name, and page
  // info were full-variant-only affordances removed in #415. ViewMode now lives
  // in the StatusTray (covered by StatusTray.test.tsx); the rest are gone.
});

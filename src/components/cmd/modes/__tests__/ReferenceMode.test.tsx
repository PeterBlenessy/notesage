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
import type { Comment } from '@/stores/comment-store';
import type { FileEntry } from '@/lib/tauri';
import type { AttachmentChip } from '@/components/cmd/AttachmentChips';

// ---------------------------------------------------------------------------
// Per-test mock state — flipped before each render
// ---------------------------------------------------------------------------

let mockExplorerFolders: { path: string; fileTree: FileEntry[] }[] = [];
let mockProjects: { path: string; fileTree: FileEntry[] }[] = [];
let mockNotesTree: FileEntry[] = [];
let mockCommentsByDocument: Record<string, Comment[]> = {};
let mockSelectedProjectPaths: string[] = [];

vi.mock('@/stores/workspace-store', () => {
  const state = {
    get explorerFolders() {
      return mockExplorerFolders;
    },
    get projects() {
      return mockProjects;
    },
    get notesTree() {
      return mockNotesTree;
    },
  };
  return {
    useWorkspaceStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

vi.mock('@/stores/comment-store', () => {
  const state = {
    get commentsByDocument() {
      return mockCommentsByDocument;
    },
  };
  return {
    useCommentStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

vi.mock('@/stores/chat-store', () => {
  const state = {
    get conversations() {
      return [] as never[];
    },
    activeConversationId: null,
  };
  return {
    useChatStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
    selectProjectPaths: () => mockSelectedProjectPaths,
  };
});

// Now import after mocks are in place
import ReferenceMode from '@/components/cmd/modes/ReferenceMode';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name: string, path: string): FileEntry {
  return {
    name,
    path,
    is_directory: false,
    hidden: false,
  };
}

function makeComment(id: string, body: string, documentId = 'doc-1'): Comment {
  return {
    id,
    documentId,
    anchorText: '',
    from: 0,
    to: 0,
    body,
    author: 'tester',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

beforeEach(() => {
  clearMockInvokeHandlers();
  mockExplorerFolders = [];
  mockProjects = [];
  mockNotesTree = [];
  mockCommentsByDocument = {};
  mockSelectedProjectPaths = [];
  // Default: empty mention index. Individual tests override.
  setMockInvokeHandler('index_mentions', () => []);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReferenceMode', () => {
  it('renders results from all three sources', async () => {
    mockProjects = [
      {
        path: '/Users/p/proj',
        fileTree: [makeFile('alice-notes.md', '/Users/p/proj/alice-notes.md')],
      },
    ];
    setMockInvokeHandler('index_mentions', () => [
      { mention: 'alice', file_count: 3 },
    ]);
    mockCommentsByDocument = {
      'doc-1': [makeComment('c1', 'thoughts on alice')],
    };

    renderWithProviders(<ReferenceMode filter="alic" onPick={() => {}} />);

    // Wait for async source loaders to flush.
    await screen.findByText('alice-notes.md');
    expect(screen.getByText('alice')).toBeTruthy();
    expect(screen.getByText('thoughts on alice')).toBeTruthy();
  });

  it('tags each result with the correct kind badge via data-kind', async () => {
    mockProjects = [
      {
        path: '/Users/p/proj',
        fileTree: [makeFile('alice.md', '/Users/p/proj/alice.md')],
      },
    ];
    setMockInvokeHandler('index_mentions', () => [
      { mention: 'alice', file_count: 1 },
    ]);
    mockCommentsByDocument = {
      'doc-1': [makeComment('c1', 'alice comment')],
    };

    const { container } = renderWithProviders(
      <ReferenceMode filter="alice" onPick={() => {}} />,
    );

    await screen.findByText('alice.md');

    const kinds = Array.from(
      container.querySelectorAll<HTMLElement>('[data-result-kind]'),
    ).map((el) => el.dataset.resultKind);

    expect(kinds).toContain('file');
    expect(kinds).toContain('person');
    expect(kinds).toContain('comment');
  });

  it("calls onPick with kind 'file' when a file row is clicked", async () => {
    mockProjects = [
      {
        path: '/Users/p/proj',
        fileTree: [makeFile('readme.md', '/Users/p/proj/readme.md')],
      },
    ];
    const onPick = vi.fn();
    renderWithProviders(<ReferenceMode filter="readme" onPick={onPick} />);

    const row = await screen.findByText('readme.md');
    fireEvent.click(row.closest('[data-result-kind]')!);

    expect(onPick).toHaveBeenCalledTimes(1);
    const chip = onPick.mock.calls[0][0] as AttachmentChip;
    expect(chip.kind).toBe('file');
    expect(chip.name).toBe('readme.md');
    expect(chip.id).toBeTruthy();
  });

  it('drills into person occurrences (not onPick) when a person row is clicked', async () => {
    // Live-test 2026-04-26 (slice 2) — `@person` rows now drill down to
    // an occurrence list at level 2 instead of attaching as a chip.
    // `onPick` only fires for file/comment kinds at level 1; persons go
    // through `onPickOccurrence` at level 2.
    setMockInvokeHandler('index_mentions', () => [
      { mention: 'bob', file_count: 2 },
    ]);
    setMockInvokeHandler('index_mention_occurrences', () => [
      {
        path: '/p/notes.md',
        file_name: 'notes.md',
        context_before: 'asked ',
        context_after: ' yesterday',
      },
    ]);
    const onPick = vi.fn();
    const onPickOccurrence = vi.fn();
    renderWithProviders(
      <ReferenceMode
        filter="bob"
        onPick={onPick}
        onPickOccurrence={onPickOccurrence}
      />,
    );

    const row = await screen.findByText('bob');
    fireEvent.click(row.closest('[data-result-kind]')!);

    // Drilldown opens — onPick must NOT have fired.
    expect(onPick).not.toHaveBeenCalled();
    await screen.findByText('notes.md');

    // Click the occurrence — onPickOccurrence fires with the navigate payload.
    fireEvent.click(screen.getByText('notes.md').closest('li')!);
    expect(onPickOccurrence).toHaveBeenCalledTimes(1);
    expect(onPickOccurrence).toHaveBeenCalledWith({
      filePath: '/p/notes.md',
      fileName: 'notes.md',
      symbol: '@bob',
      occurrenceInFile: 0,
    });
  });

  it("calls onPick with kind 'comment' when a comment row is clicked", async () => {
    mockCommentsByDocument = {
      'doc-1': [makeComment('comment-xyz', 'an interesting thread')],
    };
    const onPick = vi.fn();
    renderWithProviders(<ReferenceMode filter="interesting" onPick={onPick} />);

    const row = await screen.findByText('an interesting thread');
    fireEvent.click(row.closest('[data-result-kind]')!);

    expect(onPick).toHaveBeenCalledTimes(1);
    const chip = onPick.mock.calls[0][0] as AttachmentChip;
    expect(chip.kind).toBe('comment');
    expect(chip.id).toBe('comment-xyz');
  });

  it('shows top results from each source when filter is empty', async () => {
    mockProjects = [
      {
        path: '/Users/p/proj',
        fileTree: [
          makeFile('a.md', '/Users/p/proj/a.md'),
          makeFile('b.md', '/Users/p/proj/b.md'),
          makeFile('c.md', '/Users/p/proj/c.md'),
          makeFile('d.md', '/Users/p/proj/d.md'),
        ],
      },
    ];
    setMockInvokeHandler('index_mentions', () => [
      { mention: 'alice', file_count: 5 },
      { mention: 'bob', file_count: 4 },
    ]);
    mockCommentsByDocument = {
      'doc-1': [
        makeComment('c1', 'first comment'),
        makeComment('c2', 'second comment'),
      ],
    };

    renderWithProviders(<ReferenceMode filter="" onPick={() => {}} />);

    // Should show some of each kind without filtering them out.
    await screen.findByText('a.md');
    expect(screen.getByText('alice')).toBeTruthy();
    expect(screen.getByText('first comment')).toBeTruthy();
  });

  it('selects the second result when ↓ then Enter is pressed', async () => {
    // Two file results so we have something to step through.
    mockProjects = [
      {
        path: '/Users/p/proj',
        fileTree: [
          makeFile('alpha.md', '/Users/p/proj/alpha.md'),
          makeFile('beta.md', '/Users/p/proj/beta.md'),
        ],
      },
    ];
    const onPick = vi.fn();
    const { container } = renderWithProviders(
      <ReferenceMode filter="" onPick={onPick} />,
    );

    await screen.findByText('alpha.md');

    const list = container.querySelector<HTMLElement>('[data-reference-list]');
    expect(list).toBeTruthy();

    // ↓ moves selection from index 0 to index 1, Enter picks it.
    fireEvent.keyDown(list!, { key: 'ArrowDown' });
    fireEvent.keyDown(list!, { key: 'Enter' });

    expect(onPick).toHaveBeenCalledTimes(1);
    const chip = onPick.mock.calls[0][0] as AttachmentChip;
    expect(chip.kind).toBe('file');
    expect(chip.name).toBe('beta.md');
  });

  it('shows "No matches" when every source returns nothing', async () => {
    renderWithProviders(<ReferenceMode filter="zzz-nothing-here" onPick={() => {}} />);

    expect(await screen.findByText(/no matches/i)).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Issue #38 — discrete checkmark selection indicator
  // -------------------------------------------------------------------------

  it('active reference row shows a data-picker-check element instead of an accent background fill', async () => {
    mockProjects = [
      {
        path: '/Users/p/proj',
        fileTree: [
          makeFile('alpha.md', '/Users/p/proj/alpha.md'),
          makeFile('beta.md', '/Users/p/proj/beta.md'),
        ],
      },
    ];

    const { container } = renderWithProviders(
      <ReferenceMode filter="" onPick={() => {}} />,
    );

    await screen.findByText('alpha.md');

    const activeRow = container.querySelector('[aria-selected="true"]') as HTMLElement;
    expect(activeRow).toBeTruthy();
    expect(activeRow.className).not.toContain('bg-[var(--color-accent-primary)]');
    expect(activeRow.querySelector('[data-picker-check]')).toBeTruthy();
  });

  it('inactive reference rows do not show a checkmark', async () => {
    mockProjects = [
      {
        path: '/Users/p/proj',
        fileTree: [
          makeFile('alpha.md', '/Users/p/proj/alpha.md'),
          makeFile('beta.md', '/Users/p/proj/beta.md'),
        ],
      },
    ];

    const { container } = renderWithProviders(
      <ReferenceMode filter="" onPick={() => {}} />,
    );

    await screen.findByText('alpha.md');

    const inactiveRows = container.querySelectorAll<HTMLElement>('[aria-selected="false"]');
    expect(inactiveRows.length).toBeGreaterThan(0);
    inactiveRows.forEach((row) => {
      expect(row.querySelector('[data-picker-check]')).toBeNull();
    });
  });
});

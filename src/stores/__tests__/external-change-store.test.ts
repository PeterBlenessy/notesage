/**
 * Unit tests for external-change-store.
 *
 * Covers: addChange, acceptAll, rejectAll, resolveChange, setStatus, setHunks,
 * getChange, pendingCount, allChanges, capacity limit, TTL expiry.
 *
 * Non-persisted store — no localStorage mocking needed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }));

const mockComputeExternalDiff = vi.fn();
vi.mock('@/lib/external-diff', () => ({
  computeExternalDiff: (...args: unknown[]) => mockComputeExternalDiff(...args),
}));

import { useExternalChangeStore } from '../external-change-store';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultHunks = [
  {
    id: 'ext-hunk-0',
    charFrom: 0,
    charTo: 5,
    deleteText: 'hello',
    insertText: 'world',
  },
];

function addTestChange(filePath: string, fileName?: string) {
  useExternalChangeStore
    .getState()
    .addChange(filePath, fileName ?? filePath.split('/').pop()!, 'old', 'new');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('external-change-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    useExternalChangeStore.setState({ changes: {} });
    mockComputeExternalDiff.mockReturnValue(defaultHunks);
  });

  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------

  it('has empty changes on init', () => {
    const { changes } = useExternalChangeStore.getState();
    expect(changes).toEqual({});
  });

  // -----------------------------------------------------------------------
  // addChange
  // -----------------------------------------------------------------------

  describe('addChange', () => {
    it('stores entry with hunks and metadata', () => {
      addTestChange('/path/to/file.md', 'file.md');

      const entry = useExternalChangeStore.getState().getChange('/path/to/file.md');
      expect(entry).toBeDefined();
      expect(entry!.filePath).toBe('/path/to/file.md');
      expect(entry!.fileName).toBe('file.md');
      expect(entry!.oldContent).toBe('old');
      expect(entry!.newContent).toBe('new');
      expect(entry!.hunks).toEqual(defaultHunks);
      expect(entry!.status).toBe('pending');
      expect(entry!.timestamp).toBeGreaterThan(0);
    });

    it('calls computeExternalDiff with old and new content', () => {
      addTestChange('/path/to/file.md');

      expect(mockComputeExternalDiff).toHaveBeenCalledWith('old', 'new');
    });

    it('skips when computeExternalDiff returns empty array', () => {
      mockComputeExternalDiff.mockReturnValue([]);
      addTestChange('/path/to/file.md');

      expect(useExternalChangeStore.getState().pendingCount()).toBe(0);
    });

    it('overwrites existing entry for the same file path', () => {
      addTestChange('/path/to/file.md', 'file.md');

      const newHunks = [{ ...defaultHunks[0], insertText: 'updated' }];
      mockComputeExternalDiff.mockReturnValue(newHunks);
      useExternalChangeStore.getState().addChange('/path/to/file.md', 'file.md', 'old2', 'new2');

      const entry = useExternalChangeStore.getState().getChange('/path/to/file.md');
      expect(entry!.oldContent).toBe('old2');
      expect(entry!.hunks).toEqual(newHunks);
      expect(useExternalChangeStore.getState().pendingCount()).toBe(1);
    });

    it('stores multiple changes for different files', () => {
      addTestChange('/a.md', 'a.md');
      addTestChange('/b.md', 'b.md');
      addTestChange('/c.md', 'c.md');

      expect(useExternalChangeStore.getState().pendingCount()).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // acceptAll
  // -----------------------------------------------------------------------

  describe('acceptAll', () => {
    it('removes the entry for the given file path', () => {
      addTestChange('/a.md');
      addTestChange('/b.md');

      useExternalChangeStore.getState().acceptAll('/a.md');

      expect(useExternalChangeStore.getState().getChange('/a.md')).toBeUndefined();
      expect(useExternalChangeStore.getState().getChange('/b.md')).toBeDefined();
    });

    it('is a no-op for non-existent file path', () => {
      addTestChange('/a.md');
      useExternalChangeStore.getState().acceptAll('/nonexistent.md');

      expect(useExternalChangeStore.getState().pendingCount()).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // rejectAll
  // -----------------------------------------------------------------------

  describe('rejectAll', () => {
    it('removes the entry for the given file path', () => {
      addTestChange('/a.md');
      useExternalChangeStore.getState().rejectAll('/a.md');

      expect(useExternalChangeStore.getState().getChange('/a.md')).toBeUndefined();
      expect(useExternalChangeStore.getState().pendingCount()).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // resolveChange
  // -----------------------------------------------------------------------

  describe('resolveChange', () => {
    it('removes the entry for the given file path', () => {
      addTestChange('/a.md');
      addTestChange('/b.md');

      useExternalChangeStore.getState().resolveChange('/a.md');

      expect(useExternalChangeStore.getState().getChange('/a.md')).toBeUndefined();
      expect(useExternalChangeStore.getState().pendingCount()).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // setStatus
  // -----------------------------------------------------------------------

  describe('setStatus', () => {
    it('updates the status of an existing entry', () => {
      addTestChange('/a.md');

      useExternalChangeStore.getState().setStatus('/a.md', 'reviewing');
      expect(useExternalChangeStore.getState().getChange('/a.md')!.status).toBe('reviewing');

      useExternalChangeStore.getState().setStatus('/a.md', 'deferred');
      expect(useExternalChangeStore.getState().getChange('/a.md')!.status).toBe('deferred');
    });

    it('is a no-op for non-existent file path', () => {
      const before = useExternalChangeStore.getState().changes;
      useExternalChangeStore.getState().setStatus('/nonexistent.md', 'reviewing');
      const after = useExternalChangeStore.getState().changes;

      expect(after).toBe(before);
    });
  });

  // -----------------------------------------------------------------------
  // setHunks
  // -----------------------------------------------------------------------

  describe('setHunks', () => {
    it('replaces the hunks array for an existing entry', () => {
      addTestChange('/a.md');

      const newHunks = [
        { id: 'ext-hunk-1', charFrom: 10, charTo: 20, deleteText: 'x', insertText: 'y' },
      ];
      useExternalChangeStore.getState().setHunks('/a.md', newHunks);

      expect(useExternalChangeStore.getState().getChange('/a.md')!.hunks).toEqual(newHunks);
    });

    it('is a no-op for non-existent file path', () => {
      const before = useExternalChangeStore.getState().changes;
      useExternalChangeStore.getState().setHunks('/nonexistent.md', []);
      const after = useExternalChangeStore.getState().changes;

      expect(after).toBe(before);
    });
  });

  // -----------------------------------------------------------------------
  // getChange
  // -----------------------------------------------------------------------

  describe('getChange', () => {
    it('returns the entry for an existing file path', () => {
      addTestChange('/a.md', 'a.md');
      const entry = useExternalChangeStore.getState().getChange('/a.md');

      expect(entry).toBeDefined();
      expect(entry!.fileName).toBe('a.md');
    });

    it('returns undefined for a non-existent file path', () => {
      expect(useExternalChangeStore.getState().getChange('/nope.md')).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // pendingCount
  // -----------------------------------------------------------------------

  describe('pendingCount', () => {
    it('returns 0 when empty', () => {
      expect(useExternalChangeStore.getState().pendingCount()).toBe(0);
    });

    it('returns the number of entries', () => {
      addTestChange('/a.md');
      addTestChange('/b.md');
      expect(useExternalChangeStore.getState().pendingCount()).toBe(2);
    });

    it('decrements after removal', () => {
      addTestChange('/a.md');
      addTestChange('/b.md');
      useExternalChangeStore.getState().resolveChange('/a.md');

      expect(useExternalChangeStore.getState().pendingCount()).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // allChanges
  // -----------------------------------------------------------------------

  describe('allChanges', () => {
    it('returns empty array when no changes', () => {
      expect(useExternalChangeStore.getState().allChanges()).toEqual([]);
    });

    it('returns all entries as an array', () => {
      addTestChange('/a.md', 'a.md');
      addTestChange('/b.md', 'b.md');

      const all = useExternalChangeStore.getState().allChanges();
      expect(all).toHaveLength(2);

      const paths = all.map((e) => e.filePath).sort();
      expect(paths).toEqual(['/a.md', '/b.md']);
    });
  });

  // -----------------------------------------------------------------------
  // Capacity limit (MAX_PENDING_CHANGES = 20)
  // -----------------------------------------------------------------------

  describe('capacity limit', () => {
    it('rejects new entries when at MAX_PENDING_CHANGES (20)', () => {
      // Seed 20 entries directly into state
      const changes: Record<string, unknown> = {};
      for (let i = 0; i < 20; i++) {
        changes[`/file-${i}.md`] = {
          filePath: `/file-${i}.md`,
          fileName: `file-${i}.md`,
          oldContent: '',
          newContent: '',
          hunks: defaultHunks,
          timestamp: Date.now(),
          status: 'pending',
        };
      }
      useExternalChangeStore.setState({ changes: changes as Record<string, never> });

      // Try to add a 21st entry
      addTestChange('/overflow.md');

      expect(useExternalChangeStore.getState().getChange('/overflow.md')).toBeUndefined();
      expect(toast.warning).toHaveBeenCalledWith(
        'Too many pending changes — please review existing changes first'
      );
    });

    it('allows update to existing file even when at capacity', () => {
      const changes: Record<string, unknown> = {};
      for (let i = 0; i < 20; i++) {
        changes[`/file-${i}.md`] = {
          filePath: `/file-${i}.md`,
          fileName: `file-${i}.md`,
          oldContent: '',
          newContent: '',
          hunks: defaultHunks,
          timestamp: Date.now(),
          status: 'pending',
        };
      }
      useExternalChangeStore.setState({ changes: changes as Record<string, never> });

      // Updating an existing file should succeed (remaining count excludes it)
      useExternalChangeStore.getState().addChange('/file-0.md', 'file-0.md', 'old', 'new');

      expect(useExternalChangeStore.getState().getChange('/file-0.md')!.oldContent).toBe('old');
    });
  });

  // -----------------------------------------------------------------------
  // TTL expiry (CHANGE_TTL_MS = 1 hour)
  // -----------------------------------------------------------------------

  describe('TTL expiry', () => {
    it('cleans expired entries when addChange is called', () => {
      vi.useFakeTimers();
      const now = Date.now();

      // Add an entry in the past (2 hours ago)
      const oldTimestamp = now - 2 * 60 * 60 * 1000;
      useExternalChangeStore.setState({
        changes: {
          '/stale.md': {
            filePath: '/stale.md',
            fileName: 'stale.md',
            oldContent: 'old',
            newContent: 'new',
            hunks: defaultHunks,
            timestamp: oldTimestamp,
            status: 'pending',
          },
        },
      });

      // Adding a new change should clean the stale one
      vi.setSystemTime(now);
      addTestChange('/fresh.md', 'fresh.md');

      expect(useExternalChangeStore.getState().getChange('/stale.md')).toBeUndefined();
      expect(useExternalChangeStore.getState().getChange('/fresh.md')).toBeDefined();
      expect(useExternalChangeStore.getState().pendingCount()).toBe(1);
    });

    it('does not clean entries within the TTL window', () => {
      vi.useFakeTimers();
      const now = Date.now();

      // Add an entry 30 minutes ago (within 1h TTL)
      const recentTimestamp = now - 30 * 60 * 1000;
      useExternalChangeStore.setState({
        changes: {
          '/recent.md': {
            filePath: '/recent.md',
            fileName: 'recent.md',
            oldContent: 'old',
            newContent: 'new',
            hunks: defaultHunks,
            timestamp: recentTimestamp,
            status: 'pending',
          },
        },
      });

      vi.setSystemTime(now);
      addTestChange('/fresh.md', 'fresh.md');

      expect(useExternalChangeStore.getState().getChange('/recent.md')).toBeDefined();
      expect(useExternalChangeStore.getState().getChange('/fresh.md')).toBeDefined();
      expect(useExternalChangeStore.getState().pendingCount()).toBe(2);
    });

    it('frees capacity by cleaning expired entries', () => {
      vi.useFakeTimers();
      const now = Date.now();

      // Fill to capacity with stale entries
      const changes: Record<string, unknown> = {};
      const oldTimestamp = now - 2 * 60 * 60 * 1000;
      for (let i = 0; i < 20; i++) {
        changes[`/stale-${i}.md`] = {
          filePath: `/stale-${i}.md`,
          fileName: `stale-${i}.md`,
          oldContent: '',
          newContent: '',
          hunks: defaultHunks,
          timestamp: oldTimestamp,
          status: 'pending',
        };
      }
      useExternalChangeStore.setState({ changes: changes as Record<string, never> });

      // Should succeed because stale entries are cleaned first
      vi.setSystemTime(now);
      addTestChange('/fresh.md', 'fresh.md');

      expect(useExternalChangeStore.getState().getChange('/fresh.md')).toBeDefined();
      expect(toast.warning).not.toHaveBeenCalled();
    });
  });
});

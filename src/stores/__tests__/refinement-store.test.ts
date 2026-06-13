/**
 * Unit tests for refinement-store (non-persisted).
 *
 * Covers: upsert add + replace-by-id, setStatus, dismiss removal,
 * markSeen/hasSeen, rebuildForDoc (target-doc scoped), clearDoc,
 * selectHasPending (ignores `keep` + non-pending), selectPendingForDoc,
 * and the new-reference invariant for every mutating action.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useRefinementStore,
  selectHasPending,
  selectPendingForDoc,
} from '../refinement-store';
import type {
  RefinementEntry,
  RefinementResult,
  RefinementVerdict,
} from '@/lib/ai/refinement';

function makeResult(verdict: RefinementVerdict = 'sharpen'): RefinementResult {
  return {
    verdict,
    outcome: verdict === 'keep' ? '' : 'Do the thing by Friday',
    steps: [],
    rationale: 'because',
  };
}

function makeEntry(overrides: Partial<RefinementEntry> = {}): RefinementEntry {
  return {
    id: 'entry-1',
    docPath: '/doc/a.md',
    anchor: { from: 0, to: 10 },
    srcHash: 'hash-1',
    originalText: 'do thing',
    result: makeResult(),
    status: 'pending',
    createdAt: 1000,
    ...overrides,
  };
}

describe('refinement-store', () => {
  beforeEach(() => {
    useRefinementStore.setState({ entries: [], seen: new Set<string>() });
  });

  describe('upsertEntry', () => {
    it('appends a new entry', () => {
      useRefinementStore.getState().upsertEntry(makeEntry());
      expect(useRefinementStore.getState().entries).toHaveLength(1);
      expect(useRefinementStore.getState().entries[0].id).toBe('entry-1');
    });

    it('replaces an existing entry by id', () => {
      useRefinementStore.getState().upsertEntry(makeEntry());
      useRefinementStore
        .getState()
        .upsertEntry(makeEntry({ originalText: 'updated text' }));
      const { entries } = useRefinementStore.getState();
      expect(entries).toHaveLength(1);
      expect(entries[0].originalText).toBe('updated text');
    });

    it('returns a new entries reference', () => {
      const before = useRefinementStore.getState().entries;
      useRefinementStore.getState().upsertEntry(makeEntry());
      const after = useRefinementStore.getState().entries;
      expect(before).not.toBe(after);
    });
  });

  describe('setStatus', () => {
    it('updates the status of an entry', () => {
      useRefinementStore.getState().upsertEntry(makeEntry());
      useRefinementStore.getState().setStatus('entry-1', 'applied');
      expect(useRefinementStore.getState().entries[0].status).toBe('applied');
    });

    it('returns a new entries reference', () => {
      useRefinementStore.getState().upsertEntry(makeEntry());
      const before = useRefinementStore.getState().entries;
      useRefinementStore.getState().setStatus('entry-1', 'dismissed');
      const after = useRefinementStore.getState().entries;
      expect(before).not.toBe(after);
    });

    it('is a no-op for an unknown id', () => {
      useRefinementStore.getState().upsertEntry(makeEntry());
      const before = useRefinementStore.getState().entries;
      useRefinementStore.getState().setStatus('nope', 'applied');
      expect(useRefinementStore.getState().entries).toBe(before);
    });
  });

  describe('dismiss', () => {
    it('removes the entry', () => {
      useRefinementStore.getState().upsertEntry(makeEntry());
      useRefinementStore.getState().dismiss('entry-1');
      expect(useRefinementStore.getState().entries).toHaveLength(0);
    });

    it('returns a new entries reference when it removes', () => {
      useRefinementStore.getState().upsertEntry(makeEntry());
      const before = useRefinementStore.getState().entries;
      useRefinementStore.getState().dismiss('entry-1');
      const after = useRefinementStore.getState().entries;
      expect(before).not.toBe(after);
    });
  });

  describe('markSeen / hasSeen', () => {
    it('records and reports seen hashes', () => {
      expect(useRefinementStore.getState().hasSeen('h1')).toBe(false);
      useRefinementStore.getState().markSeen('h1');
      expect(useRefinementStore.getState().hasSeen('h1')).toBe(true);
    });

    it('returns a new seen Set reference', () => {
      const before = useRefinementStore.getState().seen;
      useRefinementStore.getState().markSeen('h1');
      const after = useRefinementStore.getState().seen;
      expect(before).not.toBe(after);
    });
  });

  describe('rebuildForDoc', () => {
    it('replaces only the target doc entries, leaving others intact', () => {
      const store = useRefinementStore.getState();
      store.upsertEntry(makeEntry({ id: 'a1', docPath: '/doc/a.md' }));
      store.upsertEntry(makeEntry({ id: 'a2', docPath: '/doc/a.md' }));
      store.upsertEntry(makeEntry({ id: 'b1', docPath: '/doc/b.md' }));

      useRefinementStore
        .getState()
        .rebuildForDoc('/doc/a.md', [
          makeEntry({ id: 'a3', docPath: '/doc/a.md' }),
        ]);

      const { entries } = useRefinementStore.getState();
      const ids = entries.map((e) => e.id).sort();
      expect(ids).toEqual(['a3', 'b1']);
    });

    it('returns a new entries reference', () => {
      const before = useRefinementStore.getState().entries;
      useRefinementStore.getState().rebuildForDoc('/doc/a.md', [makeEntry()]);
      const after = useRefinementStore.getState().entries;
      expect(before).not.toBe(after);
    });
  });

  describe('clearDoc', () => {
    it('removes all entries for a doc', () => {
      const store = useRefinementStore.getState();
      store.upsertEntry(makeEntry({ id: 'a1', docPath: '/doc/a.md' }));
      store.upsertEntry(makeEntry({ id: 'b1', docPath: '/doc/b.md' }));

      useRefinementStore.getState().clearDoc('/doc/a.md');

      const { entries } = useRefinementStore.getState();
      expect(entries.map((e) => e.id)).toEqual(['b1']);
    });

    it('returns a new entries reference when it removes', () => {
      useRefinementStore.getState().upsertEntry(makeEntry());
      const before = useRefinementStore.getState().entries;
      useRefinementStore.getState().clearDoc('/doc/a.md');
      const after = useRefinementStore.getState().entries;
      expect(before).not.toBe(after);
    });
  });

  describe('selectHasPending', () => {
    it('is true for a pending non-keep entry', () => {
      useRefinementStore.getState().upsertEntry(makeEntry());
      expect(selectHasPending(useRefinementStore.getState())).toBe(true);
    });

    it('ignores entries with verdict keep', () => {
      useRefinementStore
        .getState()
        .upsertEntry(makeEntry({ result: makeResult('keep') }));
      expect(selectHasPending(useRefinementStore.getState())).toBe(false);
    });

    it('ignores non-pending entries', () => {
      useRefinementStore
        .getState()
        .upsertEntry(makeEntry({ status: 'applied' }));
      expect(selectHasPending(useRefinementStore.getState())).toBe(false);
    });
  });

  describe('selectPendingForDoc', () => {
    it('returns only pending entries for the given doc', () => {
      const store = useRefinementStore.getState();
      store.upsertEntry(makeEntry({ id: 'a1', docPath: '/doc/a.md', status: 'pending' }));
      store.upsertEntry(makeEntry({ id: 'a2', docPath: '/doc/a.md', status: 'applied' }));
      store.upsertEntry(makeEntry({ id: 'b1', docPath: '/doc/b.md', status: 'pending' }));

      const result = selectPendingForDoc(useRefinementStore.getState(), '/doc/a.md');
      expect(result.map((e) => e.id)).toEqual(['a1']);
    });
  });
});

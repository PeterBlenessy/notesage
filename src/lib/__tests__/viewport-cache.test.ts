/**
 * Tests for the IndexedDB viewport cache (src/lib/viewport-cache.ts).
 *
 * These tests use the injectable storage backend (`_injectStorageForTesting`)
 * to avoid the jsdom 29 limitation: jsdom does not implement `indexedDB`, so
 * the real IDB-backed store can only be exercised in a browser context or
 * with `fake-indexeddb` (which is not a project dependency). The injectable
 * pattern lets us verify all cache semantics with a lightweight in-memory
 * Map without touching IDB code.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getCachedViewport,
  setCachedViewport,
  deleteCachedViewport,
  clearAllViewports,
  getViewportCacheStats,
  contentFingerprint,
  CACHE_SCHEMA_VERSION,
  _injectStorageForTesting,
  type ViewportEntry,
  type StorageBackend,
} from '../viewport-cache';

// ---------------------------------------------------------------------------
// Minimal in-memory storage backend for tests
// ---------------------------------------------------------------------------

interface StoredEntry extends ViewportEntry {
  fingerprint: string;
  schemaVersion: string;
}

class InMemoryStorage implements StorageBackend {
  store = new Map<string, StoredEntry>();

  async get(key: string): Promise<StoredEntry | undefined> {
    return this.store.get(key);
  }

  async put(key: string, entry: StoredEntry): Promise<void> {
    this.store.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async getAllEntries(): Promise<Array<{ key: string; entry: StoredEntry }>> {
    return Array.from(this.store.entries()).map(([key, entry]) => ({ key, entry }));
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides?: Partial<ViewportEntry>): ViewportEntry {
  return {
    html: '<p>Hello world</p>',
    scrollY: 0,
    capturedAt: Date.now(),
    byteSize: 20,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('viewport-cache', () => {
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = new InMemoryStorage();
    _injectStorageForTesting(storage);
  });

  afterEach(() => {
    _injectStorageForTesting(null);
  });

  // -------------------------------------------------------------------------
  // contentFingerprint
  // -------------------------------------------------------------------------

  describe('contentFingerprint', () => {
    it('returns a non-empty string', () => {
      expect(contentFingerprint('hello')).toBeTruthy();
      expect(typeof contentFingerprint('hello')).toBe('string');
    });

    it('returns different values for different content', () => {
      const a = contentFingerprint('hello world');
      const b = contentFingerprint('goodbye world');
      expect(a).not.toBe(b);
    });

    it('returns the same value for the same content', () => {
      const content = 'some markdown content';
      expect(contentFingerprint(content)).toBe(contentFingerprint(content));
    });

    it('distinguishes content that differs only in length', () => {
      expect(contentFingerprint('a')).not.toBe(contentFingerprint('aa'));
    });

    it('handles empty string without throwing', () => {
      expect(() => contentFingerprint('')).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // CACHE_SCHEMA_VERSION
  // -------------------------------------------------------------------------

  it('exports CACHE_SCHEMA_VERSION as a non-empty string', () => {
    expect(typeof CACHE_SCHEMA_VERSION).toBe('string');
    expect(CACHE_SCHEMA_VERSION.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // getCachedViewport — misses
  // -------------------------------------------------------------------------

  describe('getCachedViewport — misses', () => {
    it('returns null for a file not in cache', async () => {
      const result = await getCachedViewport('/some/file.md', 'fp1');
      expect(result).toBeNull();
    });

    it('returns null when fingerprint mismatches', async () => {
      const fp = contentFingerprint('original content');
      await setCachedViewport('/file.md', fp, makeEntry());

      const result = await getCachedViewport('/file.md', 'different-fingerprint');
      expect(result).toBeNull();
    });

    it('returns null when stored schema version differs from CACHE_SCHEMA_VERSION', async () => {
      // Directly inject a stale-schema entry into the storage backend
      const staleFp = 'fp-stale';
      await storage.put('/file.md', {
        html: '<p>old</p>',
        scrollY: 0,
        capturedAt: Date.now(),
        byteSize: 10,
        fingerprint: staleFp,
        schemaVersion: 'v0',  // intentionally stale
      });

      const result = await getCachedViewport('/file.md', staleFp);
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // setCachedViewport + getCachedViewport — hits
  // -------------------------------------------------------------------------

  describe('setCachedViewport + getCachedViewport — hits', () => {
    it('stores and retrieves an entry by filePath + fingerprint', async () => {
      const fp = contentFingerprint('some content');
      const entry = makeEntry({ html: '<h1>Title</h1>', scrollY: 120 });

      await setCachedViewport('/notes/hello.md', fp, entry);

      const result = await getCachedViewport('/notes/hello.md', fp);
      expect(result).not.toBeNull();
      expect(result!.html).toBe('<h1>Title</h1>');
      expect(result!.scrollY).toBe(120);
    });

    it('overwrites an existing entry for the same filePath', async () => {
      const fp = contentFingerprint('content');
      await setCachedViewport('/file.md', fp, makeEntry({ html: '<p>v1</p>' }));
      await setCachedViewport('/file.md', fp, makeEntry({ html: '<p>v2</p>' }));

      const result = await getCachedViewport('/file.md', fp);
      expect(result!.html).toBe('<p>v2</p>');
    });

    it('returns null for a different filePath than what was stored', async () => {
      const fp = contentFingerprint('content');
      await setCachedViewport('/a.md', fp, makeEntry());

      expect(await getCachedViewport('/b.md', fp)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // deleteCachedViewport
  // -------------------------------------------------------------------------

  describe('deleteCachedViewport', () => {
    it('removes an existing entry for a filePath', async () => {
      const fp = contentFingerprint('x');
      await setCachedViewport('/x.md', fp, makeEntry());
      expect(await getCachedViewport('/x.md', fp)).not.toBeNull();

      await deleteCachedViewport('/x.md');

      expect(await getCachedViewport('/x.md', fp)).toBeNull();
    });

    it('is a no-op for a file not in cache (does not throw)', async () => {
      await expect(deleteCachedViewport('/nonexistent.md')).resolves.toBeUndefined();
    });

    it('does not affect entries for other files', async () => {
      const fp = contentFingerprint('y');
      await setCachedViewport('/a.md', fp, makeEntry());
      await setCachedViewport('/b.md', fp, makeEntry());

      await deleteCachedViewport('/a.md');

      expect(await getCachedViewport('/a.md', fp)).toBeNull();
      expect(await getCachedViewport('/b.md', fp)).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // clearAllViewports
  // -------------------------------------------------------------------------

  describe('clearAllViewports', () => {
    it('removes all entries', async () => {
      const fp = contentFingerprint('content');
      await setCachedViewport('/a.md', fp, makeEntry());
      await setCachedViewport('/b.md', fp, makeEntry());
      await setCachedViewport('/c.md', fp, makeEntry());

      await clearAllViewports();

      expect(await getCachedViewport('/a.md', fp)).toBeNull();
      expect(await getCachedViewport('/b.md', fp)).toBeNull();
      expect(await getCachedViewport('/c.md', fp)).toBeNull();
    });

    it('is safe to call on an empty cache', async () => {
      await expect(clearAllViewports()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getViewportCacheStats
  // -------------------------------------------------------------------------

  describe('getViewportCacheStats', () => {
    it('returns zero counts for empty cache', async () => {
      const stats = await getViewportCacheStats();
      expect(stats.entryCount).toBe(0);
      expect(stats.totalBytes).toBe(0);
    });

    it('reflects entry count and byteSize sum after insertions', async () => {
      const fp = contentFingerprint('x');
      await setCachedViewport('/a.md', fp, makeEntry({ byteSize: 100 }));
      await setCachedViewport('/b.md', fp, makeEntry({ byteSize: 200 }));

      const stats = await getViewportCacheStats();
      expect(stats.entryCount).toBe(2);
      expect(stats.totalBytes).toBe(300);
    });

    it('reflects deletion in stats', async () => {
      const fp = contentFingerprint('x');
      await setCachedViewport('/a.md', fp, makeEntry({ byteSize: 50 }));
      await deleteCachedViewport('/a.md');

      const stats = await getViewportCacheStats();
      expect(stats.entryCount).toBe(0);
      expect(stats.totalBytes).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // LRU eviction (50 MB cap)
  // -------------------------------------------------------------------------

  describe('LRU eviction', () => {
    it('evicts oldest entry when total bytes exceed 50 MB cap', async () => {
      const MB = 1024 * 1024;
      const fp = contentFingerprint('x');

      // Insert 6 entries × 10 MB = 60 MB (cap = 50 MB)
      for (let i = 0; i < 6; i++) {
        await setCachedViewport(`/file-${i}.md`, fp, makeEntry({ byteSize: 10 * MB, capturedAt: i }));
      }

      // Oldest entry (capturedAt=0, /file-0.md) should have been evicted
      expect(await getCachedViewport('/file-0.md', fp)).toBeNull();
      // Most recent entries should still be present
      expect(await getCachedViewport('/file-5.md', fp)).not.toBeNull();
    });

    it('does NOT evict when total bytes are within cap', async () => {
      const KB = 1024;
      const fp = contentFingerprint('x');

      await setCachedViewport('/a.md', fp, makeEntry({ byteSize: 100 * KB }));
      await setCachedViewport('/b.md', fp, makeEntry({ byteSize: 100 * KB }));

      // Both should survive — 200 KB << 50 MB
      expect(await getCachedViewport('/a.md', fp)).not.toBeNull();
      expect(await getCachedViewport('/b.md', fp)).not.toBeNull();
    });

    it('preserves the single last entry even if it alone exceeds the cap', async () => {
      const MB = 1024 * 1024;
      const fp = contentFingerprint('x');
      // Single entry > 50 MB: must not evict itself into an infinite loop
      await setCachedViewport('/huge.md', fp, makeEntry({ byteSize: 60 * MB }));
      const stats = await getViewportCacheStats();
      expect(stats.entryCount).toBe(1);
    });
  });
});

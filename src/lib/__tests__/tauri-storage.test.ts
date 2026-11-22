/**
 * @vitest-environment jsdom
 *
 * Tests for the batched read path in tauri-storage:
 *   - Concurrent `getItem` reads registered in the same microtask are
 *     coalesced into ONE `store_read_batch` IPC call.
 *   - Keys missing from the batch result resolve to null.
 *   - When the batch command fails, each key falls back to the legacy
 *     per-key `store_read` path individually.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import { createTauriStorage } from '../tauri-storage';

/** Wrap a plain state object in the JSON envelope zustand persist writes. */
function envelope(state: Record<string, unknown>): string {
  return JSON.stringify({ state, version: 0 });
}

/** createJSONStorage's return type is `| undefined` — unwrap for tests. */
function makeStorage<T>() {
  const storage = createTauriStorage<T>();
  if (!storage) throw new Error('storage adapter not created');
  return storage;
}

describe('tauri-storage batched reads', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('coalesces concurrent getItem reads into a single store_read_batch call', async () => {
    const batchCalls: string[][] = [];
    const singleReads: string[] = [];

    setMockInvokeHandler('store_read_batch', (args) => {
      const keys = (args?.keys as string[]) ?? [];
      batchCalls.push(keys);
      return {
        'batch-a': envelope({ a: 1 }),
        'batch-b': envelope({ b: 2 }),
      };
    });
    setMockInvokeHandler('store_read', (args) => {
      singleReads.push(String(args?.key));
      return null;
    });

    const storage = makeStorage<{ a?: number; b?: number }>();

    // Fire both reads synchronously — they land in the same microtask batch.
    const [a, b] = await Promise.all([
      storage.getItem('batch-a'),
      storage.getItem('batch-b'),
    ]);

    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0]).toEqual(expect.arrayContaining(['batch-a', 'batch-b']));
    expect(batchCalls[0]).toHaveLength(2);
    // No per-key fallback reads when the batch succeeds.
    expect(singleReads).toHaveLength(0);

    expect(a?.state).toEqual({ a: 1 });
    expect(b?.state).toEqual({ b: 2 });
  });

  it('resolves keys missing from the batch result to null', async () => {
    setMockInvokeHandler('store_read_batch', () => ({}));
    setMockInvokeHandler('store_read', () => {
      throw new Error('should not be called');
    });

    const storage = makeStorage<Record<string, unknown>>();
    const value = await storage.getItem('batch-missing');
    expect(value).toBeNull();
  });

  it('falls back to per-key store_read when the batch call fails', async () => {
    const singleReads: string[] = [];

    setMockInvokeHandler('store_read_batch', () => {
      throw new Error('batch unavailable');
    });
    setMockInvokeHandler('store_read', (args) => {
      const key = String(args?.key);
      singleReads.push(key);
      return key === 'fallback-a' ? envelope({ ok: true }) : null;
    });

    const storage = makeStorage<{ ok?: boolean }>();
    const [a, b] = await Promise.all([
      storage.getItem('fallback-a'),
      storage.getItem('fallback-b'),
    ]);

    expect(singleReads).toEqual(expect.arrayContaining(['fallback-a', 'fallback-b']));
    expect(a?.state).toEqual({ ok: true });
    expect(b).toBeNull();
  });

  it('survives a per-key fallback read that also fails (resolves null)', async () => {
    setMockInvokeHandler('store_read_batch', () => {
      throw new Error('batch unavailable');
    });
    setMockInvokeHandler('store_read', () => {
      throw new Error('disk on fire');
    });

    const storage = makeStorage<Record<string, unknown>>();
    const value = await storage.getItem('fallback-broken');
    expect(value).toBeNull();
  });

  it('issues separate batches for reads registered in different microtasks', async () => {
    const batchCalls: string[][] = [];
    setMockInvokeHandler('store_read_batch', (args) => {
      batchCalls.push((args?.keys as string[]) ?? []);
      return {};
    });

    const storage = makeStorage<Record<string, unknown>>();
    await storage.getItem('late-a');
    await storage.getItem('late-b');

    expect(batchCalls).toHaveLength(2);
    expect(batchCalls[0]).toEqual(['late-a']);
    expect(batchCalls[1]).toEqual(['late-b']);
  });
});

/**
 * A read that FAILS must not be treated as "no file yet": zustand hydrates
 * defaults either way, and the store's next change would overwrite the real
 * file with them. The adapter keeps such a key write-blocked.
 */
describe('tauri-storage failed reads', () => {
  const THROTTLE_MS = 2000;
  let writes: Array<{ key: string; value: string }>;
  let deletes: string[];
  /** `toast.error` of the module instance under test (sonner is mocked by tauri-mock). */
  let toastError: ReturnType<typeof vi.fn>;

  /** A fresh module instance, so the once-per-session toast flag starts clear. */
  async function freshStorage<T>() {
    vi.resetModules();
    const mod = await import('../tauri-storage');
    // Same module registry as the adapter just imported, so the same mock.
    toastError = vi.mocked((await import('sonner')).toast.error);
    toastError.mockClear();
    const storage = mod.createTauriStorage<T>();
    if (!storage) throw new Error('storage adapter not created');
    return storage;
  }

  /** Simulate Rust: the batch fails as a whole when any file is unreadable. */
  function failReadsFor(...brokenKeys: string[]) {
    setMockInvokeHandler('store_read_batch', (args) => {
      const keys = (args?.keys as string[]) ?? [];
      if (keys.some((k) => brokenKeys.includes(k))) {
        throw new Error(`Failed to read state file '${brokenKeys[0]}': Permission denied`);
      }
      return Object.fromEntries(
        keys.filter((k) => k.startsWith('present')).map((k) => [k, envelope({ saved: k })]),
      );
    });
    setMockInvokeHandler('store_read', (args) => {
      const key = String(args?.key);
      if (brokenKeys.includes(key)) {
        throw new Error(`Failed to read state file '${key}': Permission denied`);
      }
      return key.startsWith('present') ? envelope({ saved: key }) : null;
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    writes = [];
    deletes = [];
    setMockInvokeHandler('store_write', (args) => {
      writes.push({ key: String(args?.key), value: String(args?.value) });
      return null;
    });
    setMockInvokeHandler('store_delete', (args) => {
      deletes.push(String(args?.key));
      return null;
    });
  });

  afterEach(() => {
    // Drop this test's delayed toast / throttled writes so they cannot fire
    // into the next test.
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('does not write defaults over a file whose read failed', async () => {
    failReadsFor('broken-chat');
    const storage = await freshStorage<Record<string, unknown>>();

    // Hydration still completes (with nothing), so the app can start…
    expect(await storage.getItem('broken-chat')).toBeNull();

    // …but the store's next state change must not reach the file.
    storage.setItem('broken-chat', { state: { conversations: [] }, version: 0 });
    await vi.advanceTimersByTimeAsync(THROTTLE_MS * 2);
    expect(writes).toEqual([]);

    // Nor may a pending value be flushed when the window closes.
    window.dispatchEvent(new Event('beforeunload'));
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toEqual([]);
  });

  it('drops a write that was queued while the failing read was still in flight', async () => {
    failReadsFor('racy-chat');
    const storage = await freshStorage<Record<string, unknown>>();

    // Hydration starts its read…
    const hydration = storage.getItem('racy-chat');
    // …and a component changes the store before that read has resolved, so
    // the defaults are queued for a throttled write.
    storage.setItem('racy-chat', { state: { conversations: [] }, version: 0 });
    expect(await hydration).toBeNull();

    await vi.advanceTimersByTimeAsync(THROTTLE_MS * 2);
    expect(writes).toEqual([]);
  });

  it('does not delete a file whose read failed', async () => {
    failReadsFor('broken-activity');
    const storage = await freshStorage<Record<string, unknown>>();
    await storage.getItem('broken-activity');

    storage.removeItem('broken-activity');
    await vi.advanceTimersByTimeAsync(0);
    expect(deletes).toEqual([]);
  });

  it('still persists a store whose file is simply missing', async () => {
    failReadsFor(); // nothing is broken
    const storage = await freshStorage<Record<string, unknown>>();
    expect(await storage.getItem('absent-store')).toBeNull();

    storage.setItem('absent-store', { state: { fresh: true }, version: 0 });
    await vi.advanceTimersByTimeAsync(THROTTLE_MS * 2);
    expect(writes.map((w) => w.key)).toEqual(['absent-store']);
  });

  it('blocks only the unreadable key when other stores load in the same batch', async () => {
    failReadsFor('broken-one');
    const storage = await freshStorage<Record<string, unknown>>();
    const [broken, present, absent] = await Promise.all([
      storage.getItem('broken-one'),
      storage.getItem('present-two'),
      storage.getItem('absent-three'),
    ]);
    expect(broken).toBeNull();
    expect(present?.state).toEqual({ saved: 'present-two' });
    expect(absent).toBeNull();

    storage.setItem('broken-one', { state: { x: 1 }, version: 0 });
    storage.setItem('present-two', { state: { x: 2 }, version: 0 });
    storage.setItem('absent-three', { state: { x: 3 }, version: 0 });
    await vi.advanceTimersByTimeAsync(THROTTLE_MS * 2);
    expect(writes.map((w) => w.key).sort()).toEqual(['absent-three', 'present-two']);
  });

  it('allows writes again once the key has been read successfully', async () => {
    failReadsFor('flaky-store');
    const storage = await freshStorage<Record<string, unknown>>();
    await storage.getItem('flaky-store');

    // The file becomes readable; the store rehydrates from it.
    setMockInvokeHandler('store_read_batch', () => ({
      'flaky-store': envelope({ restored: true }),
    }));
    const reread = await storage.getItem('flaky-store');
    expect(reread?.state).toEqual({ restored: true });

    storage.setItem('flaky-store', { state: { restored: true, edited: true }, version: 0 });
    await vi.advanceTimersByTimeAsync(THROTTLE_MS * 2);
    expect(writes.map((w) => w.key)).toEqual(['flaky-store']);
  });

  it('tells the user once, however many stores failed', async () => {
    failReadsFor('broken-a', 'broken-b');
    const storage = await freshStorage<Record<string, unknown>>();
    await Promise.all([storage.getItem('broken-a'), storage.getItem('broken-b')]);
    await vi.advanceTimersByTimeAsync(5000);

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0][0])).toMatch(/could not be loaded/i);
  });

  it('shows no toast when every read succeeds or the file is just missing', async () => {
    failReadsFor();
    const storage = await freshStorage<Record<string, unknown>>();
    await Promise.all([storage.getItem('present-x'), storage.getItem('absent-y')]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('keeps the localStorage copy when the migration check cannot read the file', async () => {
    failReadsFor('broken-legacy');
    localStorage.setItem('broken-legacy', envelope({ legacy: true }));
    const storage = await freshStorage<Record<string, unknown>>();
    await storage.getItem('broken-legacy');
    expect(localStorage.getItem('broken-legacy')).toBe(envelope({ legacy: true }));
  });
});

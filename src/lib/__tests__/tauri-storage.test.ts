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

import { describe, it, expect, beforeEach } from 'vitest';
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

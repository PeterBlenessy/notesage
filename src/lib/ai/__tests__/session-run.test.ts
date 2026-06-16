/**
 * Unit tests for SessionRunQueue — FIFO concurrent-session cap.
 *
 * KEY INVARIANT: the drain path NEVER calls setActiveConversation.
 * Context is derived from the targetConversationId captured at submit time,
 * not from the store's active-conversation pointer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks needed for the chat-store import in the navigation test
// ---------------------------------------------------------------------------

const { storageBacking } = vi.hoisted(() => {
  const storageBacking = new Map<string, string>();
  const localStorageMock: Storage = {
    getItem: (key: string) => storageBacking.get(key) ?? null,
    setItem: (key: string, value: string) => { storageBacking.set(key, value); },
    removeItem: (key: string) => { storageBacking.delete(key); },
    clear: () => { storageBacking.clear(); },
    get length() { return storageBacking.size; },
    key: (index: number) => [...storageBacking.keys()][index] ?? null,
  };
  if (typeof globalThis.window === 'undefined') {
    (globalThis as Record<string, unknown>).window = globalThis;
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock, writable: true, configurable: true,
  });
  return { storageBacking };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/tauri-storage', () => {
  const { createJSONStorage } = require('zustand/middleware');
  return { createTauriStorage: () => createJSONStorage(() => (globalThis as Record<string, unknown>).localStorage) };
});

// ---------------------------------------------------------------------------
// Subject under test — will fail (module not found) until session-run.ts exists
// ---------------------------------------------------------------------------

import { SessionRunQueue, DEFAULT_MAX_CONCURRENT_SESSIONS } from '@/lib/ai/session-run';

// ---------------------------------------------------------------------------

beforeEach(() => {
  storageBacking.clear();
  vi.clearAllMocks();
});

describe('SessionRunQueue', () => {
  it('exports DEFAULT_MAX_CONCURRENT_SESSIONS of 4', () => {
    expect(DEFAULT_MAX_CONCURRENT_SESSIONS).toBe(4);
  });

  it('runs execute immediately when under the concurrent cap', async () => {
    const queue = new SessionRunQueue(2);
    const fn = vi.fn().mockResolvedValue(undefined);
    const queued = queue.run('conv-a', fn);
    await vi.waitFor(() => fn.mock.calls.length > 0);
    expect(queued).toBe(false);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('returns true (queued) when at the concurrent cap', () => {
    const queue = new SessionRunQueue(1);
    let release!: () => void;
    // Fill the one slot
    queue.run('conv-a', () => new Promise<void>((res) => { release = res; }));

    const second = vi.fn().mockResolvedValue(undefined);
    const queued = queue.run('conv-b', second);

    expect(queued).toBe(true);
    expect(second).not.toHaveBeenCalled();
    release!();
  });

  it('drains queued entries in FIFO order', async () => {
    const order: string[] = [];
    const queue = new SessionRunQueue(1);

    let releaseFirst!: () => void;
    queue.run('conv-first', () => new Promise<void>((res) => { releaseFirst = res; }));

    queue.run('conv-a', vi.fn(async () => { order.push('a'); }));
    queue.run('conv-b', vi.fn(async () => { order.push('b'); }));
    queue.run('conv-c', vi.fn(async () => { order.push('c'); }));

    releaseFirst!();
    // vi.waitFor retries until the callback does not throw; using expect here
    // so a falsy result keeps retrying (returning false without throwing would
    // make waitFor exit immediately on the first poll).
    await vi.waitFor(() => expect(order).toHaveLength(3));
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('drain does NOT call setActiveConversation from the chat store', async () => {
    const { useChatStore } = await import('@/stores/chat-store');
    storageBacking.clear();
    useChatStore.setState({ conversations: [], activeConversationId: null });

    const spy = vi.spyOn(useChatStore.getState(), 'setActiveConversation');

    const queue = new SessionRunQueue(1);
    let releaseFirst!: () => void;
    queue.run('conv-a', () => new Promise<void>((res) => { releaseFirst = res; }));

    const second = vi.fn().mockResolvedValue(undefined);
    queue.run('conv-b', second);

    releaseFirst!();
    await vi.waitFor(() => expect(second).toHaveBeenCalled());

    // The queue itself must never navigate the view.
    expect(spy).not.toHaveBeenCalled();
  });

  it('activeCount and queueLength reflect the run state', () => {
    const queue = new SessionRunQueue(1);
    expect(queue.activeCount).toBe(0);
    expect(queue.queueLength).toBe(0);

    let release!: () => void;
    queue.run('conv-a', () => new Promise<void>((res) => { release = res; }));
    expect(queue.activeCount).toBe(1);
    expect(queue.queueLength).toBe(0);

    queue.run('conv-b', vi.fn().mockResolvedValue(undefined));
    expect(queue.queueLength).toBe(1);

    release!();
  });
});

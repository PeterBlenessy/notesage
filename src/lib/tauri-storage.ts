import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { createJSONStorage } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';
import { log, PERF } from '@/lib/logger';
import { tauriApi } from '@/lib/tauri';

/**
 * Zustand StateStorage adapter backed by Tauri file storage (~/.notesage/state/).
 *
 * Used only for stores that grow over time (chat-store, activity-store).
 * Small bounded config stores use plain localStorage (Zustand default).
 *
 * Read path: async file read via Tauri IPC (store_read).
 * Write path: throttled file writes (max 1 per 2s per key) with serialized
 *             IPC queue to prevent overload.
 *
 * On first access, migrates any existing localStorage data to file storage
 * (one-time, from before the localStorage/file split).
 *
 * A read that FAILS is not the same as "no file yet". Zustand hydrates
 * defaults either way, but after a failed read the real file is still on
 * disk, and the store's next state change would replace it with those
 * defaults. So a key whose read failed is write-blocked (see
 * `readFailedKeys`) until a later read of it succeeds.
 */

const THROTTLE_MS = 2000;

/** Latest value queued for each key (may not yet be written to file). */
const pendingValues = new Map<string, string>();
/** Timer handles for throttled file writes. */
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Last successfully written value per key (for dedup). */
const lastFileWritten = new Map<string, string>();

/** Serialized write queue — prevents IPC overload. */
let writeQueue: Array<{ key: string; value: string }> = [];
let writing = false;

async function drainWriteQueue(): Promise<void> {
  if (writing) return;
  writing = true;
  while (writeQueue.length > 0) {
    const { key, value } = writeQueue.shift()!;
    try {
      await invoke('store_write', { key, value });
      lastFileWritten.set(key, value);
    } catch (err) {
      log.error('store', `Failed to write store file '${key}'`, err);
    }
  }
  writing = false;
}

function enqueueFileWrite(key: string, value: string): void {
  if (lastFileWritten.get(key) === value) return;
  writeQueue = writeQueue.filter((w) => w.key !== key);
  writeQueue.push({ key, value });
  drainWriteQueue();
}

function flushKey(key: string): void {
  const timer = pendingTimers.get(key);
  if (timer) clearTimeout(timer);
  pendingTimers.delete(key);

  const value = pendingValues.get(key);
  pendingValues.delete(key);
  if (value !== undefined) {
    enqueueFileWrite(key, value);
  }
}

function flushAll(): void {
  for (const key of [...pendingValues.keys()]) {
    flushKey(key);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushAll);
}

/** Keys already checked for localStorage→file migration. */
const migrated = new Set<string>();

// ---------------------------------------------------------------------------
// Failed reads
// ---------------------------------------------------------------------------

/**
 * Keys whose most recent file read failed (as opposed to finding no file).
 * `setItem` / `removeItem` are refused for these: the store is running on
 * defaults it did not load from disk, and persisting them would destroy the
 * data the read could not get at. A later successful read (e.g. the store's
 * `persist.rehydrate()`) lifts the block, because the store then holds what
 * is actually on disk.
 */
const readFailedKeys = new Set<string>();
/** Keys already warned about a refused write — one log line each, not one per keystroke. */
const blockedWriteWarned = new Set<string>();
let readFailureToastShown = false;

/**
 * Stores hydrate while the app is still booting, and sonner drops toasts
 * raised before its `<Toaster>` has mounted — so the toast waits a moment.
 */
const READ_FAILURE_TOAST_DELAY_MS = 1500;

function markReadFailed(key: string, err: unknown): void {
  readFailedKeys.add(key);
  // A state change made while the read was still in flight is already queued
  // (throttled, or waiting in the write queue) and would land on the file a
  // moment from now. Drop it — it is defaults, not the user's data.
  const timer = pendingTimers.get(key);
  if (timer) clearTimeout(timer);
  pendingTimers.delete(key);
  pendingValues.delete(key);
  writeQueue = writeQueue.filter((w) => w.key !== key);
  log.error(
    'store',
    `Failed to read store file '${key}' — keeping it untouched: writes to this store are disabled until it can be read`,
    err,
  );
  if (readFailureToastShown) return;
  readFailureToastShown = true;
  setTimeout(() => {
    toast.error('Some saved data could not be loaded', {
      description:
        'Notesage left the files on disk untouched, so changes to that data will not be saved in this session. Restart Notesage to try again.',
      duration: Infinity,
    });
  }, READ_FAILURE_TOAST_DELAY_MS);
}

function markReadOk(key: string): void {
  readFailedKeys.delete(key);
  blockedWriteWarned.delete(key);
}

/** True (and logs once per key) when writes to `key` must be refused. */
function isWriteBlocked(key: string, action: string): boolean {
  if (!readFailedKeys.has(key)) return false;
  if (!blockedWriteWarned.has(key)) {
    blockedWriteWarned.add(key);
    log.warn(
      'store',
      `Refusing to ${action} store file '${key}': it could not be read at startup and would be overwritten`,
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// Batched reads (store_read_batch)
//
// All file-backed stores (chat, activity, action, automation) rehydrate during
// the same synchronous module-evaluation pass at startup, each issuing a
// `store_read` IPC call. Coalescing the reads that land in the same microtask
// into ONE `store_read_batch` call collapses 4 round-trips (each ~100ms of
// tokio scheduling overhead per the Rust-side comment) into one.
//
// Fallback: if the batch call fails, each key falls back to the legacy
// per-key `store_read` path individually. The batch fails as a whole when any
// one file exists but cannot be read, so the per-key pass is also what tells
// the unreadable keys (which throw) from the healthy and the missing ones.
// ---------------------------------------------------------------------------

/** Keys awaiting the next batch flush → their pending resolvers. */
const pendingReads = new Map<string, Array<(value: string | null) => void>>();
let readFlushScheduled = false;

async function flushPendingReads(): Promise<void> {
  readFlushScheduled = false;
  if (pendingReads.size === 0) return;

  const batch = new Map(pendingReads);
  pendingReads.clear();
  const keys = [...batch.keys()];
  const t0 = performance.now();

  let results: Record<string, string> | null = null;
  try {
    results = await tauriApi.storeReadBatch(keys);
    log.info(PERF.startup, 'store batch read', {
      keys: keys.length,
      ms: Math.round(performance.now() - t0),
    });
  } catch (err) {
    log.warn('store', 'store_read_batch failed — falling back to per-key reads', err);
  }

  for (const [key, resolvers] of batch) {
    let value: string | null;
    if (results) {
      // Missing keys are omitted from the batch result → null.
      value = results[key] ?? null;
      markReadOk(key);
    } else {
      // Per-key fallback to the legacy single-read path.
      try {
        value = (await invoke<string | null>('store_read', { key })) ?? null;
        markReadOk(key);
      } catch (err) {
        // The file may well exist. Hydrate defaults so the app still starts,
        // but never let them be written over it.
        markReadFailed(key, err);
        value = null;
      }
    }
    for (const resolve of resolvers) resolve(value);
  }
}

/**
 * Read one store key, coalescing with every other read registered in the same
 * microtask into a single `store_read_batch` IPC call.
 */
function batchedStoreRead(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    const resolvers = pendingReads.get(key);
    if (resolvers) {
      resolvers.push(resolve);
    } else {
      pendingReads.set(key, [resolve]);
    }
    if (!readFlushScheduled) {
      readFlushScheduled = true;
      queueMicrotask(() => void flushPendingReads());
    }
  });
}

/**
 * Create the raw StateStorage adapter (file-backed).
 */
function createRawTauriStorage(): StateStorage {
  return {
    getItem: async (key: string): Promise<string | null> => {
      // One-time migration: if data exists in localStorage but not in files,
      // write it to file and remove from localStorage.
      if (!migrated.has(key)) {
        migrated.add(key);
        const localValue = localStorage.getItem(key);
        if (localValue) {
          try {
            const fileValue = await invoke<string | null>('store_read', { key });
            if (!fileValue) {
              log.info('store', `Migrating '${key}' from localStorage to file (${(localValue.length / 1024).toFixed(1)} KB)`);
              enqueueFileWrite(key, localValue);
            }
            // Clean up localStorage — file is the source of truth for these stores
            localStorage.removeItem(key);
          } catch (err) {
            // A missing file is `null`, not a throw: this is a real read
            // failure. Keep the localStorage copy (it may be the only one)
            // and retry the migration on the next launch.
            log.warn('store', `Could not check store file '${key}' — leaving its localStorage copy in place`, err);
          }
        }
      }

      // Check pending writes first (may have data not yet flushed to disk)
      const pending = pendingValues.get(key);
      if (pending !== undefined) return pending;

      // Check write queue
      const queued = writeQueue.find((w) => w.key === key);
      if (queued) return queued.value;

      // Read from file — coalesced with concurrent reads into one
      // store_read_batch IPC call (per-key store_read fallback inside).
      return batchedStoreRead(key);
    },

    setItem: (key: string, value: string): void => {
      // Never persist over a file we failed to read (see `readFailedKeys`).
      if (isWriteBlocked(key, 'write')) return;

      const serialized = typeof value === 'string' ? value : JSON.stringify(value);

      // Skip file write if identical to last written
      if (lastFileWritten.get(key) === serialized) return;

      // Schedule throttled file write
      pendingValues.set(key, serialized);
      const existing = pendingTimers.get(key);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        pendingTimers.delete(key);
        const val = pendingValues.get(key);
        pendingValues.delete(key);
        if (val !== undefined) {
          enqueueFileWrite(key, val);
        }
      }, THROTTLE_MS);

      pendingTimers.set(key, timer);
    },

    removeItem: (key: string): void => {
      if (isWriteBlocked(key, 'delete')) return;

      // Cancel pending file write
      const timer = pendingTimers.get(key);
      if (timer) clearTimeout(timer);
      pendingTimers.delete(key);
      pendingValues.delete(key);
      lastFileWritten.delete(key);

      // Remove file (async, fire-and-forget)
      invoke('store_delete', { key }).catch((err) => {
        log.error('store', `Failed to delete store file '${key}'`, err);
      });
    },
  };
}

/**
 * Create a Zustand PersistStorage backed by Tauri file storage.
 * Used for stores with unbounded data (chat history, activity tasks).
 */
export function createTauriStorage<T>() {
  return createJSONStorage<T>(() => createRawTauriStorage());
}

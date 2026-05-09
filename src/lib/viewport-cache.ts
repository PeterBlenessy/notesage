/**
 * IndexedDB viewport cache for cross-session cold-start instant first paint.
 *
 * On a cold start (app quit + restart), the in-memory `parsedDocCache` is
 * empty. For large files (500 KB+) the full pipeline costs ~5 s
 * (comrak preview + worker parse + streaming hydrate). This module persists
 * the editor viewport as static HTML to IndexedDB so the next cold open can
 * show content in <50 ms while background hydration catches up.
 *
 * ## Cache key design
 * Key: `filePath` (string) — one slot per file.
 * Discriminators embedded in the stored value:
 *   - `fingerprint`: fast content fingerprint (length + djb2 hash prefix).
 *     If the stored fingerprint mismatches the current content, the entry is
 *     treated as a miss and background hydration runs normally.
 *   - `schemaVersion`: equals `CACHE_SCHEMA_VERSION`. Bumping this constant
 *     auto-invalidates ALL existing entries on the next lookup because the
 *     stored version won't match the new constant.
 *
 * ## LRU eviction
 * Hard cap: 50 MB. After every `setCachedViewport`, if the total stored
 * `byteSize` exceeds the cap, the oldest entry (lowest `capturedAt`) is
 * evicted. Repeats until under cap OR only one entry remains (to avoid an
 * infinite loop when a single oversized entry is inserted).
 *
 * ## Testing
 * jsdom 29 does not implement `indexedDB`. The module exposes
 * `_injectStorageForTesting(backend)` so tests can inject an in-memory
 * Map-backed store without any extra npm dependencies. Set to `null` to
 * restore the real IDB backend.
 */

/** Bump this to auto-invalidate all existing cached entries. */
export const CACHE_SCHEMA_VERSION = "v1";

const MAX_CACHE_BYTES = 50 * 1024 * 1024; // 50 MB

export interface ViewportEntry {
  html: string;
  scrollY: number;
  capturedAt: number;
  byteSize: number;
}

/** Full stored shape — includes discriminators not exposed to callers. */
export interface StoredEntry extends ViewportEntry {
  fingerprint: string;
  schemaVersion: string;
}

/** Minimal async storage contract used by both IDB backend and test mocks. */
export interface StorageBackend {
  get(key: string): Promise<StoredEntry | undefined>;
  put(key: string, entry: StoredEntry): Promise<void>;
  delete(key: string): Promise<void>;
  getAllEntries(): Promise<Array<{ key: string; entry: StoredEntry }>>;
  clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// IDB backend
// ---------------------------------------------------------------------------

const DB_NAME = "notesage-viewport-cache";
const STORE_NAME = "viewport-cache";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(db: IDBDatabase, key: string): Promise<StoredEntry | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as StoredEntry | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: StoredEntry): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbGetAllEntries(db: IDBDatabase): Promise<Array<{ key: string; entry: StoredEntry }>> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const results: Array<{ key: string; entry: StoredEntry }> = [];
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    let keysReady = false;
    let valsReady = false;
    let keys: IDBValidKey[] = [];
    let vals: unknown[] = [];
    const maybeResolve = () => {
      if (!keysReady || !valsReady) return;
      for (let i = 0; i < keys.length; i++) {
        results.push({ key: String(keys[i]), entry: vals[i] as StoredEntry });
      }
      resolve(results);
    };
    keysReq.onsuccess = () => { keys = keysReq.result; keysReady = true; maybeResolve(); };
    valsReq.onsuccess = () => { vals = valsReq.result; valsReady = true; maybeResolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

function idbClear(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

let _dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (!_dbPromise) {
    _dbPromise = openDb();
  }
  return _dbPromise;
}

const idbStorage: StorageBackend = {
  async get(key) {
    const db = await getDb();
    return idbGet(db, key);
  },
  async put(key, entry) {
    const db = await getDb();
    await idbPut(db, key, entry);
  },
  async delete(key) {
    const db = await getDb();
    await idbDelete(db, key);
  },
  async getAllEntries() {
    const db = await getDb();
    return idbGetAllEntries(db);
  },
  async clear() {
    const db = await getDb();
    await idbClear(db);
  },
};

// ---------------------------------------------------------------------------
// Injectable backend (for testing)
// ---------------------------------------------------------------------------

let _injectedStorage: StorageBackend | null = null;

/** Call with a StorageBackend to override IDB in tests; call with null to restore. */
export function _injectStorageForTesting(backend: StorageBackend | null): void {
  _injectedStorage = backend;
}

function getStorage(): StorageBackend {
  return _injectedStorage ?? idbStorage;
}

// ---------------------------------------------------------------------------
// Content fingerprint
// ---------------------------------------------------------------------------

/**
 * Fast, deterministic content discriminator — substitutes for file mtime
 * since no Tauri command exposes filesystem stat.
 *
 * Uses a djb2-style hash over the first 512 characters, combined with the
 * total content length. Sufficient to detect edits; not cryptographic.
 */
export function contentFingerprint(content: string): string {
  const sample = content.slice(0, 512);
  let hash = 5381;
  for (let i = 0; i < sample.length; i++) {
    // djb2: hash = hash * 33 ^ char
    hash = ((hash << 5) + hash) ^ sample.charCodeAt(i);
    hash |= 0; // keep 32-bit integer
  }
  return `${content.length}:${hash >>> 0}`;
}

// ---------------------------------------------------------------------------
// LRU eviction
// ---------------------------------------------------------------------------

async function evictIfOverCap(): Promise<void> {
  const storage = getStorage();
  const all = await storage.getAllEntries();
  const totalBytes = all.reduce((sum, { entry }) => sum + entry.byteSize, 0);
  if (totalBytes <= MAX_CACHE_BYTES) return;

  // Sort ascending by capturedAt — oldest first
  all.sort((a, b) => a.entry.capturedAt - b.entry.capturedAt);

  let remaining = totalBytes;
  for (const { key, entry } of all) {
    if (remaining <= MAX_CACHE_BYTES) break;
    if (all.length === 1) break; // never evict the only entry
    remaining -= entry.byteSize;
    await storage.delete(key);
    all.splice(all.indexOf({ key, entry }), 1);
    // Recalculate to handle concurrent modifications gracefully
    if (all.length <= 1) break;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns a cached ViewportEntry for `filePath` if one exists and its
 * fingerprint + schemaVersion match. Returns `null` on any miss.
 */
export async function getCachedViewport(
  filePath: string,
  fingerprint: string,
): Promise<ViewportEntry | null> {
  try {
    const stored = await getStorage().get(filePath);
    if (!stored) return null;
    if (stored.fingerprint !== fingerprint) return null;
    if (stored.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
    const { fingerprint: _fp, schemaVersion: _sv, ...entry } = stored;
    return entry;
  } catch {
    return null;
  }
}

/**
 * Stores a ViewportEntry for `filePath`, tagged with `fingerprint` and the
 * current `CACHE_SCHEMA_VERSION`. Runs LRU eviction after storing.
 */
export async function setCachedViewport(
  filePath: string,
  fingerprint: string,
  entry: ViewportEntry,
): Promise<void> {
  try {
    const stored: StoredEntry = {
      ...entry,
      fingerprint,
      schemaVersion: CACHE_SCHEMA_VERSION,
    };
    await getStorage().put(filePath, stored);
    await evictIfOverCap();
  } catch {
    // Non-fatal — cache is best-effort
  }
}

/**
 * Removes the cached entry for `filePath`. Called by the external-change
 * watcher when a file is modified externally, ensuring the next cold open
 * re-captures fresh content rather than serving a stale viewport.
 */
export async function deleteCachedViewport(filePath: string): Promise<void> {
  try {
    await getStorage().delete(filePath);
  } catch {
    // Non-fatal
  }
}

/**
 * Removes ALL cached viewport entries. Called from System Settings →
 * Performance → "Clear viewport cache" button.
 */
export async function clearAllViewports(): Promise<void> {
  try {
    await getStorage().clear();
  } catch {
    // Non-fatal
  }
}

/**
 * Returns aggregate stats for the settings UI (entry count + total bytes).
 */
export async function getViewportCacheStats(): Promise<{
  totalBytes: number;
  entryCount: number;
}> {
  try {
    const all = await getStorage().getAllEntries();
    const totalBytes = all.reduce((sum, { entry }) => sum + entry.byteSize, 0);
    return { totalBytes, entryCount: all.length };
  } catch {
    return { totalBytes: 0, entryCount: 0 };
  }
}

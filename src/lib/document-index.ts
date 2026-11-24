import { tauriApi, type FileEntry } from '@/lib/tauri';
import { parseFrontmatter } from '@/lib/frontmatter';
import { log, PERF } from '@/lib/logger';

export interface DocumentIndex {
  /** UUID → absolute file path */
  entries: Record<string, string>;
}

/**
 * Runtime guard for `doc-index.json` read from disk. The file lives inside
 * the user's project and can be hand-edited or corrupted — a wrong shape
 * must degrade to an empty index, not crash consumers indexing `entries`.
 */
export function isDocumentIndex(v: unknown): v is DocumentIndex {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const entries = (v as Record<string, unknown>).entries;
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) return false;
  return Object.values(entries).every((path) => typeof path === 'string');
}

/**
 * Recursively collect all .md file paths from a file tree.
 */
function collectMarkdownFiles(entries: FileEntry[]): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    // A tree taken from the workspace store may include hidden entries (the
    // "show hidden files" setting); the index never covered those.
    if (entry.hidden) continue;
    if (entry.is_directory && entry.children) {
      // Skip .notesage directory
      if (entry.name === '.notesage') continue;
      paths.push(...collectMarkdownFiles(entry.children));
    } else if (entry.name.endsWith('.md')) {
      paths.push(entry.path);
    }
  }
  return paths;
}

/**
 * What this machine learned the last time it read a project's documents:
 * for each markdown file (path relative to the project root) the frontmatter
 * `id` it carried, or `null` for "read, and it has none".
 *
 * Kept in `localStorage`, not in `doc-index.json`: that file lives in an
 * iCloud-synced folder, and a list that changes with every new note would be
 * re-uploaded on every launch.
 */
interface DocumentIdMemo {
  ids: Record<string, string | null>;
  /** Comment sidecar ids a full pass could not match to any document. */
  unresolved: string[];
}

const MEMO_KEY_PREFIX = 'notesage.docIndexMemo:';

function loadMemo(projectRoot: string): DocumentIdMemo {
  try {
    const raw = localStorage.getItem(MEMO_KEY_PREFIX + projectRoot);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        const { ids, unresolved } = parsed as Record<string, unknown>;
        if (typeof ids === 'object' && ids !== null && !Array.isArray(ids)) {
          const clean: Record<string, string | null> = {};
          for (const [rel, id] of Object.entries(ids)) {
            if (typeof id === 'string' || id === null) clean[rel] = id;
          }
          return {
            ids: clean,
            unresolved: Array.isArray(unresolved)
              ? unresolved.filter((u): u is string => typeof u === 'string')
              : [],
          };
        }
      }
    }
  } catch {
    // Expected: storage unavailable or the entry is corrupt — start over.
  }
  return { ids: {}, unresolved: [] };
}

function saveMemo(projectRoot: string, memo: DocumentIdMemo): void {
  try {
    const next = JSON.stringify(memo);
    const key = MEMO_KEY_PREFIX + projectRoot;
    if (localStorage.getItem(key) !== next) localStorage.setItem(key, next);
  } catch {
    // Expected: storage full or unavailable. The cost is re-reading next launch.
  }
}

/** Drop what was remembered about a project that is no longer in the workspace. */
export function forgetDocumentIndexMemo(projectRoot: string): void {
  try {
    localStorage.removeItem(MEMO_KEY_PREFIX + projectRoot);
  } catch {
    // Expected: storage unavailable.
  }
}

function relativeTo(projectRoot: string, filePath: string): string {
  return filePath.startsWith(projectRoot + '/') ? filePath.slice(projectRoot.length + 1) : filePath;
}

/** Path → id, or `null` for "has none". A path that could not be read is left out. */
async function readDocumentIds(paths: string[]): Promise<Map<string, string | null>> {
  const ids = new Map<string, string | null>();
  // Small batches: this runs behind a live UI, and every read of an evicted
  // iCloud file is a download.
  const BATCH_SIZE = 8;
  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    const batch = paths.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (filePath) => {
        try {
          const raw = await tauriApi.readFile(filePath);
          const { frontmatter } = parseFrontmatter(raw);
          const id = frontmatter?.id;
          ids.set(filePath, typeof id === 'string' && id ? id : null);
        } catch {
          // Expected: file may be unreadable (permissions, binary, encoding).
          // Not remembered, so the next build tries again.
        }
      })
    );
  }
  return ids;
}

/** The ids the comment sidecars in `.notesage/comments/` are keyed by. */
async function listCommentSidecarIds(projectRoot: string): Promise<string[]> {
  try {
    const files = await tauriApi.listFilesShallow(`${projectRoot}/.notesage/comments`, true);
    return files
      .filter((f) => f.name.endsWith('.json'))
      .map((f) => f.name.slice(0, -'.json'.length));
  } catch {
    // Expected: a project nobody has commented in has no comments folder.
    return [];
  }
}

function sameEntries(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => a[k] === b[k]);
}

/**
 * Build the UUID → file path mapping for a project's markdown files and keep
 * `.notesage/doc-index.json` in step with it. The Rust action scan reads that
 * file to find the document a comment sidecar belongs to.
 *
 * This used to read EVERY markdown file in full on every launch, and rewrite
 * the index file (in an iCloud-synced folder) whether or not it had changed.
 * Now:
 *  - a file is read only if this machine has not read it before. The
 *    recursive listing carries no modification times, so "unchanged" is
 *    decided by path: what a path held last time is remembered locally
 *    (`DocumentIdMemo`);
 *  - an id the index file already holds for a path is kept, so ids assigned
 *    since (the comment flow, another Mac using the same paths) are not lost;
 *  - the one case a path-based gate cannot see — a document that gained an id
 *    outside this app — is caught by need: a comment sidecar that resolves to
 *    no document triggers one re-read of the documents with no known id;
 *  - the file is written only when its entries differ from what is on disk.
 *
 * @param tree the project's file tree when the caller already has it; listed
 *   here otherwise.
 */
export async function buildDocumentIndex(
  projectRoot: string,
  tree?: FileEntry[],
): Promise<DocumentIndex> {
  const t0 = performance.now();
  const listing = tree && tree.length > 0 ? tree : await tauriApi.listDirectory(projectRoot);
  const mdFiles = collectMarkdownFiles(listing);
  const mdFileSet = new Set(mdFiles);

  const memo = loadMemo(projectRoot);
  const previous = await readIndexFile(projectRoot);
  const previousIdByPath = new Map<string, string>();
  for (const [id, path] of Object.entries(previous.index.entries)) {
    if (mdFileSet.has(path)) previousIdByPath.set(path, id);
  }

  // path → id (or null); a path missing from this map is unread or unreadable.
  const idByPath = new Map<string, string | null>();
  const toRead: string[] = [];
  for (const path of mdFiles) {
    const rel = relativeTo(projectRoot, path);
    if (Object.prototype.hasOwnProperty.call(memo.ids, rel)) {
      idByPath.set(path, memo.ids[rel] ?? previousIdByPath.get(path) ?? null);
    } else {
      toRead.push(path);
    }
  }

  let filesRead = toRead.length;
  for (const [path, id] of await readDocumentIds(toRead)) idByPath.set(path, id);

  // Need-driven second look: every comment sidecar has to resolve.
  const sidecarIds = await listCommentSidecarIds(projectRoot);
  const knownIds = () => new Set([...idByPath.values()].filter((id): id is string => id !== null));
  let unresolved = sidecarIds.filter((id) => !knownIds().has(id));
  if (unresolved.some((id) => !memo.unresolved.includes(id))) {
    const justRead = new Set(toRead);
    const recheck = mdFiles.filter((path) => idByPath.get(path) === null && !justRead.has(path));
    filesRead += recheck.length;
    for (const [path, id] of await readDocumentIds(recheck)) idByPath.set(path, id);
    unresolved = sidecarIds.filter((id) => !knownIds().has(id));
  }

  const entries: Record<string, string> = {};
  const nextMemo: DocumentIdMemo = { ids: {}, unresolved };
  for (const path of mdFiles) {
    const id = idByPath.get(path);
    if (id === undefined) {
      // Unreadable this time: keep what the index file said about it.
      const kept = previousIdByPath.get(path);
      if (kept) entries[kept] = path;
      continue;
    }
    nextMemo.ids[relativeTo(projectRoot, path)] = id;
    if (id) entries[id] = path;
  }
  saveMemo(projectRoot, nextMemo);

  const index: DocumentIndex = { entries };

  // Write the index only when it says something the file on disk does not.
  // No file and nothing to say is the same answer to its reader as an empty
  // file, so that case creates nothing.
  let wrote = false;
  const unchanged = previous.exists
    ? sameEntries(previous.index.entries, entries)
    : Object.keys(entries).length === 0;
  if (!unchanged) {
    try {
      const notesageDir = `${projectRoot}/.notesage`;
      const notesageDirExists = await tauriApi.pathExists(notesageDir);
      if (!notesageDirExists) {
        await tauriApi.createDirectory(notesageDir);
      }
      await tauriApi.writeFile(
        `${notesageDir}/doc-index.json`,
        JSON.stringify(index, null, 2)
      );
      wrote = true;
    } catch (error) {
      console.error('Failed to write document index:', error);
    }
  }

  log.perf(PERF.index, 'doc-index build', {
    project: projectRoot,
    files: mdFiles.length,
    filesRead,
    wrote,
    ms: Math.round(performance.now() - t0),
  });

  return index;
}

// ---------------------------------------------------------------------------
// Background queue: one project at a time, in idle gaps, after startup.
// ---------------------------------------------------------------------------

type DocumentIndexJob = () => Promise<void>;

const pendingJobs = new Map<string, DocumentIndexJob>();
let queueRunning = false;
let queueStarted = false;
let idleWaiters: Array<() => void> = [];

/** How long a job may wait for an idle gap before it runs anyway. */
const IDLE_TIMEOUT_MS = 2000;

function whenIdle(run: () => void): void {
  // `requestIdleCallback` is absent in WKWebView and in the test
  // environment, where the timeout is the whole implementation.
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => run(), { timeout: IDLE_TIMEOUT_MS });
  } else {
    setTimeout(run, 0);
  }
}

function drainDocumentIndexQueue(): void {
  if (!queueStarted || queueRunning) return;
  const next = pendingJobs.entries().next();
  if (next.done) {
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
    return;
  }
  const [key, job] = next.value;
  pendingJobs.delete(key);
  queueRunning = true;
  whenIdle(() => {
    job()
      .catch(() => {
        // Jobs report their own failures; one must not stop the queue.
      })
      .finally(() => {
        queueRunning = false;
        drainDocumentIndexQueue();
      });
  });
}

/**
 * Queue a document-index build. Nothing runs until
 * `startDocumentIndexQueue()`; after that, jobs run one at a time, each in an
 * idle gap. Queuing a key that is already waiting replaces its job.
 */
export function enqueueDocumentIndexJob(key: string, job: DocumentIndexJob): void {
  pendingJobs.set(key, job);
  drainDocumentIndexQueue();
}

/** Withdraw a job that has not started (its project left the workspace). */
export function cancelDocumentIndexJob(key: string): void {
  pendingJobs.delete(key);
  drainDocumentIndexQueue();
}

/** Let queued builds run. Called once startup is over. */
export function startDocumentIndexQueue(): void {
  queueStarted = true;
  drainDocumentIndexQueue();
}

/**
 * Resolves once no document-index build is queued or running, or after
 * `timeoutMs`, whichever is first.
 *
 * The action scan waits on this: it reads `doc-index.json`, and an entry that
 * still points at a path the document has since left makes the Rust scan
 * treat the comment sidecar as orphaned.
 */
export function whenDocumentIndexIdle(timeoutMs: number): Promise<void> {
  if (pendingJobs.size === 0 && !queueRunning) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      log.warn('doc-index', `Document index still building after ${timeoutMs}ms; not waiting further`);
      done();
    }, timeoutMs);
    idleWaiters.push(done);
  });
}

/** Test seam: forget queued jobs and the started flag. */
export function resetDocumentIndexQueueForTests(): void {
  pendingJobs.clear();
  queueRunning = false;
  queueStarted = false;
  idleWaiters = [];
}

/**
 * Update a single entry in the document index.
 */
export async function updateDocumentIndex(
  projectRoot: string,
  uuid: string,
  filePath: string
): Promise<void> {
  const index = await loadDocumentIndex(projectRoot);
  index.entries[uuid] = filePath;

  // Keep the local memo in step, so the next build does not have to re-read
  // the document to learn the id it was just given.
  const memo = loadMemo(projectRoot);
  memo.ids[relativeTo(projectRoot, filePath)] = uuid;
  memo.unresolved = memo.unresolved.filter((id) => id !== uuid);
  saveMemo(projectRoot, memo);

  try {
    await tauriApi.writeFile(
      `${projectRoot}/.notesage/doc-index.json`,
      JSON.stringify(index, null, 2)
    );
  } catch (error) {
    console.error('Failed to update document index:', error);
  }
}

/**
 * Load the existing document index from disk.
 * Returns an empty index if the file doesn't exist.
 */
export async function loadDocumentIndex(projectRoot: string): Promise<DocumentIndex> {
  return (await readIndexFile(projectRoot)).index;
}

/** The index on disk, and whether there is a file there at all. */
async function readIndexFile(
  projectRoot: string,
): Promise<{ index: DocumentIndex; exists: boolean }> {
  const filePath = `${projectRoot}/.notesage/doc-index.json`;
  let exists = false;
  try {
    exists = await tauriApi.pathExists(filePath);
    if (!exists) {
      return { index: { entries: {} }, exists };
    }
    const raw = await tauriApi.readFile(filePath);
    const parsed: unknown = JSON.parse(raw);
    return { index: isDocumentIndex(parsed) ? parsed : { entries: {} }, exists };
  } catch {
    // Expected: index file may not exist yet or contain invalid JSON
    return { index: { entries: {} }, exists };
  }
}

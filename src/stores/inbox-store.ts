import { create } from "zustand";
import { toast } from "sonner";
import { t } from "@/lib/i18n";
import { log } from "@/lib/logger";
import { tauriApi, type FileEntry, type InboxCardMeta } from "@/lib/tauri";
import { classifyFile } from "@/components/mobile/FileRow";
import { createLimiter } from "@/lib/mobile-thumbnails";
import { inboxDir, inboxMetaDir, resolveNotesRoot } from "@/lib/notes-root";
import {
  emptyReadingProgress,
  isFinished,
  isUnread,
  liveEntry,
  mergeEntry,
  mergeReadingProgress,
  reuseReadingProgress,
  parseReadingProgress,
  pruneReadingProgress,
  serializeReadingProgress,
  tombstone,
  READING_PROGRESS_FILE,
  READING_PROGRESS_VERSION,
  type ReadingProgressEntry,
  type ReadingProgressFile,
} from "@/lib/reading-progress-file";
import { evictDesktopThumbnail } from "@/lib/desktop-thumbnails";
import { trackSelfRename } from "@/lib/self-rename-filter";
import { useSettingsStore } from "@/stores/settings-store";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

/**
 * inbox-store — the desktop Inbox: the phone's read-later list at desk
 * width, plus the one thing the phone can't do well, filing.
 *
 * The Inbox is a MODE of the document column, not a document: Quiet Composer
 * is a single-document shell, so opening an item evicts the previous
 * document, and coming back to the list is a mode switch, not a tab switch.
 * `open` is that flag. Everything else here is the listing (`items`), the
 * shared read-later state (`progress`, backed by
 * `Inbox/.notesage/reading-progress.json`), the header cache for article rows,
 * and a selection.
 *
 * Nothing is persisted: the folder and the sidecar are the truth, and the
 * three view preferences live in settings-store with the other UI settings.
 */

export type InboxKind = ReturnType<typeof classifyFile>;

export interface InboxItem {
  path: string;
  name: string;
  modified?: number;
  kind: InboxKind;
}

/** How the Inbox reaches the filesystem-mutating hooks it cannot import. */
export interface InboxOps {
  /** `useFileOperations().renamePath` — the move primitive, with a tree
   *  refresh for the old and the new path on EVERY call. Used only when
   *  `refreshFileTree` is not given. */
  renamePath: (oldPath: string, newPath: string) => Promise<boolean>;
  /**
   * `useFileOperations().refreshFileTree`. When given, a filing moves every
   * file itself (the same steps `renamePath` takes, minus the refresh) and
   * refreshes each affected tree ONCE at the end — filing twenty items used
   * to list the destination project recursively forty times.
   */
  refreshFileTree?: (targetPath?: string) => Promise<void>;
  /** `refreshGitForPath` — debounced per repository. */
  refreshGit?: (path: string) => void;
}

/** The perf category. Not in `PERF` (logger.ts) only because that file is
 *  shared; `log.info` with a `perf:` category is what `log.perf` does. */
const PERF_INBOX = "perf:inbox";

interface InboxStore {
  open: boolean;
  /** Absolute path of `<library root>/Inbox`, once the root is known. */
  dir: string | null;
  /**
   * A library root that wins over settings. Set only by tests (the real
   * E2E suite points the Inbox at a throw-away library so it can file and
   * trash without touching the user's own); `null` in production.
   */
  rootOverride: string | null;
  items: InboxItem[];
  loading: boolean;
  error: string | null;
  progress: ReadingProgressFile;
  /** Header per article path; `null` = read and not a capture; absent = not read yet. */
  meta: Record<string, InboxCardMeta | null>;
  filter: string;
  /** Selected paths, in selection order. */
  selection: string[];
  /** The keyboard cursor — the row that ↩ / e / p act on when nothing is selected. */
  cursor: string | null;
  /** Shift-click anchor. */
  anchor: string | null;
  /** The project the last "File to" went to — the default for the next one. */
  lastDestination: string | null;
  /** The Inbox item currently open in the document column, if any. */
  activeItem: string | null;

  openInbox: () => void;
  closeInbox: () => void;
  toggleInbox: () => void;
  /** (Re)read the folder and the sidecar. Safe to call repeatedly. */
  load: () => Promise<void>;
  setFilter: (filter: string) => void;
  setCursor: (path: string | null) => void;
  select: (path: string, modifiers?: { shift?: boolean; meta?: boolean }) => void;
  clearSelection: () => void;
  /** Paths an action applies to: the selection, else the cursor. */
  targets: () => string[];
  /**
   * Header for an article row; resolves from cache after the first read.
   * Called by the rows that are actually on screen (and for every item while
   * a filter is set, since the filter matches titles) — never by `load()`:
   * a header costs a whole-file read of the capture on a cache miss.
   */
  ensureMeta: (item: InboxItem) => void;
  entryFor: (path: string) => ReadingProgressEntry | undefined;
  unreadCount: () => number;
  /** First open on any device clears the unread dot; never un-clears. */
  markOpened: (path: string) => void;
  recordProgress: (path: string, fraction: number) => void;
  markRead: (paths: string[]) => void;
  markUnread: (paths: string[]) => void;
  markAllRead: () => void;
  setActiveItem: (path: string | null) => void;
  /** Neighbours in listing order, for ⌘↑ / ⌘↓ from the reader. */
  neighbour: (path: string, direction: 1 | -1) => InboxItem | null;
  /** Move items into a project's root, carrying their read-later state.
   *  Serialised per destination — see `fileToNow` for the work. */
  fileTo: (paths: string[], projectPath: string, ops: InboxOps) => Promise<string[]>;
  /** The move itself; only ever called through `fileTo`'s per-destination chain. */
  fileToNow: (paths: string[], dest: string, ops: InboxOps) => Promise<string[]>;
  trash: (paths: string[]) => Promise<void>;
  /** The visible items, filtered. */
  visible: () => InboxItem[];
  /**
   * Where the cursor lands after `removed` leave the list: the same
   * position (the item that slides up), else the previous, else nothing.
   * A triage loop — e, e, e — keeps its place instead of losing focus.
   */
  cursorAfterRemoving: (removed: Set<string>) => string | null;
}

const metaLimiter = createLimiter(4);
const metaCache = new Map<string, Promise<InboxCardMeta | null>>();
/** Versions (`path@modified`) with a header request in flight, so a row that
 *  re-renders does not queue a second continuation for the same answer. */
const metaInFlight = new Set<string>();
/** The file version (`path@modified`) each stored header was read from. */
const metaVersion = new Map<string, string>();
/** Headers that have arrived and not yet been put in the store. They land
 *  together, once per frame: one store update per header was 350 updates,
 *  each copying `meta` and notifying every subscriber. */
const metaArrived = new Map<string, InboxCardMeta | null>();
let metaFlushTimer: number | null = null;
const META_FLUSH_MS = 16;
/** Renames a batched filing runs at once. */
const MOVE_CONCURRENCY = 4;
let writeTimer: number | null = null;
let metaDirEnsured: string | null = null;
/** Sequence of `load()` calls; a listing that finishes after a newer one
 *  started is stale and must not land (the root may have changed underneath). */
let loadSeq = 0;

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function matchesFilter(item: InboxItem, meta: InboxCardMeta | null | undefined, filter: string): boolean {
  const q = filter.trim().toLowerCase();
  if (!q) return true;
  const hay = [item.name, meta?.title, meta?.site, meta?.excerpt].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q);
}

/** Write the sidecar soon. Coalesced: a scroll session writes once, not per frame. */
function scheduleWrite(get: () => InboxStore) {
  if (writeTimer !== null) window.clearTimeout(writeTimer);
  const dir = get().dir;
  writeTimer = window.setTimeout(() => {
    writeTimer = null;
    // The root may have moved under us (startup resolving iCloud, a test
    // pointing elsewhere); a write scheduled for the old folder is dropped.
    if (get().dir !== dir) return;
    void writeSidecar(dir, get);
  }, 400);
}

let writeChain: Promise<void> = Promise.resolve();
/** One chain per destination project: two filings to the same project must
 *  not race on its sidecar (read-merge-write) or on the dedupe check. */
const fileChains = new Map<string, Promise<unknown>>();

function serialised<T>(key: string, run: () => Promise<T>): Promise<T> {
  const prev = fileChains.get(key) ?? Promise.resolve();
  const next = prev.then(run, run);
  fileChains.set(key, next);
  void next.finally(() => {
    if (fileChains.get(key) === next) fileChains.delete(key);
  });
  return next;
}

/**
 * Read → merge → write, never a blind overwrite. The phone writes the same
 * file, so the on-disk copy can be newer than this device's memory: an item
 * finished on the phone while the Mac was reading another. Merging keeps
 * both (progress is monotonic, `openedAt` keeps the earliest), and the merged
 * result is put back in the store so memory does not drift from disk.
 * Serialised through `writeChain` so two bursts cannot interleave their reads.
 */
function writeSidecar(dir: string | null, get: () => InboxStore): Promise<void> {
  if (!dir) return Promise.resolve();
  const run = async () => {
    const metaDir = `${dir}/.notesage`;
    try {
      if (metaDirEnsured !== metaDir) {
        await tauriApi.createDirectory(metaDir);
        metaDirEnsured = metaDir;
      }
      const onDisk = await readSidecar(metaDir);
      if (get().dir !== dir) return;
      // Deletions survive the merge as tombstones and "mark as unread" as a
      // reset stamp (see reading-progress-file.ts), so the union cannot
      // resurrect what this device just removed. Orphans and old stones are
      // pruned here, at the one place the file is rewritten.
      const present = new Set(get().items.map((i) => i.name));
      const merged = pruneReadingProgress(mergeReadingProgress(onDisk, get().progress), present);
      // Entries the merge did not change keep their identity (rows are
      // memoised on them), and a merge that changed nothing sets nothing.
      const kept = reuseReadingProgress(get().progress, merged);
      if (kept !== get().progress) useInboxStore.setState({ progress: kept });
      const path = `${metaDir}/${READING_PROGRESS_FILE}`;
      await tauriApi.markSelfWrite(path);
      await tauriApi.writeFile(path, serializeReadingProgress(merged));
    } catch (err) {
      // Includes a sidecar that could not be READ: nothing is written then,
      // and this device's progress stays in memory for the next attempt.
      log.warn("inbox", "Reading progress not written", err);
    }
  };
  writeChain = writeChain.then(run, run);
  return writeChain;
}

/**
 * Read a reading-progress sidecar. Empty ONLY when the file is confirmed
 * absent; a read that fails any other way THROWS.
 *
 * It used to answer "empty" for every failure, and every caller merges the
 * answer with its own state and writes the result back — so one failed read
 * (an iCloud placeholder not downloaded yet, a permission hiccup) replaced
 * the shared file with this device's view of it, dropping the entries and
 * tombstones only the other device had.
 */
async function readSidecar(metaDir: string): Promise<ReadingProgressFile> {
  const file = `${metaDir}/${READING_PROGRESS_FILE}`;
  let text: string;
  try {
    text = await tauriApi.readFile(file);
  } catch (err) {
    // `pathExists` is false for a missing file AND for one iCloud has
    // evicted to a `.name.icloud` placeholder; only the first is "empty".
    const exists = await tauriApi.pathExists(file);
    const evicted = !exists && (await tauriApi.pathExists(`${metaDir}/.${READING_PROGRESS_FILE}.icloud`));
    if (!exists && !evicted) return emptyReadingProgress();
    if (evicted) {
      void tauriApi.icloudEnsureDownloaded(file).catch((downloadError: unknown) => {
        log.warn("inbox", `Could not request download of ${file}`, downloadError);
      });
    }
    throw new Error(`reading progress unreadable (${evicted ? "not downloaded from iCloud" : String(err)})`);
  }
  return parseReadingProgress(text);
}

export const useInboxStore = create<InboxStore>((set, get) => ({
  open: false,
  dir: null,
  rootOverride: null,
  items: [],
  loading: false,
  error: null,
  progress: emptyReadingProgress(),
  meta: {},
  filter: "",
  selection: [],
  cursor: null,
  anchor: null,
  lastDestination: null,
  activeItem: null,

  openInbox: () => {
    // A selection made before reading is not a selection the user still
    // has in mind when they come back.
    set({ open: true, selection: [], anchor: null });
    void get().load();
  },
  closeInbox: () => set({ open: false }),
  toggleInbox: () => (get().open ? get().closeInbox() : get().openInbox()),

  load: async () => {
    const seq = ++loadSeq;
    const stale = () => seq !== loadSeq;
    const settings = useSettingsStore.getState();
    // The library the phone shares is the iCloud one when sync is on — the
    // same root the pins file uses. `~/Notesage` is the local fallback.
    const root = get().rootOverride ?? settings.icloudNotesagePath ?? resolveNotesRoot(settings.notesRootPath, settings.homeDir);
    if (!root) {
      set({ error: "library-root-unknown", loading: false });
      return;
    }
    const dir = inboxDir(root);
    set({ dir, loading: true, error: null });
    const started = performance.now();
    try {
      // The asset protocol serves image thumbnails straight from disk; the
      // grant is idempotent and must land BEFORE the first row renders, or an
      // <img> that loads first is refused and cached as broken. Awaited for
      // that reason. The library root is usually granted at startup already,
      // but the iCloud root is not, and the Inbox lives there when sync is on.
      try {
        await tauriApi.allowAssetDir(dir);
      } catch (err) {
        // The validator rejects only unsafe roots, never a missing folder;
        // a refusal here means the Inbox is somewhere thumbnails may not be
        // served from, which the icon fallback covers.
        console.warn("[inbox] asset scope not granted:", err);
      }
      let entries: FileEntry[] = [];
      try {
        entries = await tauriApi.listFilesShallow(dir, false);
      } catch (err) {
        // A folder that is there but cannot be listed is not "nothing
        // shared": keep the rows already shown and report it. (An
        // unanswerable `pathExists` counts as "there".)
        if (await tauriApi.pathExists(dir).catch(() => true)) {
          log.warn("inbox", `Could not list ${dir}`, err);
          toast.error(t("toast.inboxUnreadable", { error: String(err) }), { id: "inbox-unreadable" });
          if (!stale()) set({ loading: false, error: String(err) });
          return;
        }
        // No Inbox yet — nothing has been shared. An empty list, not an error.
        entries = [];
      }
      if (stale()) return;
      const listMs = Math.round(performance.now() - started);
      // An item whose path and mtime did not change IS the previous object,
      // and a listing that changed nothing is the previous array: rows,
      // grouping and the filter are all memoised on these identities, and a
      // reload runs on every open and every watcher batch under the folder.
      const previous = get().items;
      const known = new Map(previous.map((i) => [i.path, i]));
      let items: InboxItem[] = entries
        .filter((e) => !e.is_directory)
        .map((e) => {
          const before = known.get(e.path);
          if (before && before.name === e.name && before.modified === e.modified) return before;
          return { path: e.path, name: e.name, modified: e.modified, kind: classifyFile(e.name) };
        });
      if (items.length === previous.length && items.every((item, i) => item === previous[i])) items = previous;
      const sidecarStarted = performance.now();
      // An unreadable sidecar leaves this device's progress as it is; the
      // write path refuses to write over a file it could not read.
      const fromDisk = await readSidecar(inboxMetaDir(root)).catch((err: unknown) => {
        log.warn("inbox", "Reading progress not loaded", err);
        return emptyReadingProgress();
      });
      // A newer load started while this one was reading — startup resolving
      // the iCloud root mid-listing, or a test pointing at another library.
      // Its result would clobber the newer one; drop it.
      if (stale()) return;
      // Disk wins nothing on its own: merge, so an unsaved local advance
      // survives a reload that happened mid-write. Entries for names not in
      // the listing stay (tombstones, the other device's knowledge) — they
      // are pruned at write time, where the file is actually rewritten.
      const progress = reuseReadingProgress(get().progress, mergeReadingProgress(fromDisk, get().progress));
      const sidecarMs = Math.round(performance.now() - sidecarStarted);
      const paths = new Set(items.map((i) => i.path));
      set((s) => ({
        items,
        progress,
        loading: false,
        selection: s.selection.every((p) => paths.has(p)) ? s.selection : s.selection.filter((p) => paths.has(p)),
        cursor: s.cursor && paths.has(s.cursor) ? s.cursor : (items[0]?.path ?? null),
      }));
      // No headers from here: the badge needs only the sidecar, and a header
      // is a whole-file read of the capture. Rows ask for their own when they
      // are on screen. The one exception is a filter in force, which matches
      // titles and so needs every header.
      let metaRequested = 0;
      if (get().filter.trim()) {
        for (const item of items) {
          if (item.kind === "html") metaRequested += 1;
          get().ensureMeta(item);
        }
      }
      log.info(PERF_INBOX, "load", {
        items: items.length,
        reused: items === previous ? items.length : items.filter((i) => known.get(i.path) === i).length,
        listMs,
        sidecarMs,
        metaRequested,
        ms: Math.round(performance.now() - started),
      });
    } catch (err) {
      if (!stale()) set({ loading: false, error: String(err) });
    }
  },

  setFilter: (filter) => {
    set({ filter });
    // The filter matches title, site and excerpt, and headers are otherwise
    // read only for the rows on screen — so the first keystroke asks for all
    // of them (cached after that; they land in batches).
    if (filter.trim()) for (const item of get().items) get().ensureMeta(item);
  },
  setCursor: (path) => set({ cursor: path }),

  select: (path, modifiers = {}) => {
    const { selection, anchor } = get();
    if (modifiers.shift && anchor) {
      const order = get().visible().map((i) => i.path);
      const a = order.indexOf(anchor);
      const b = order.indexOf(path);
      if (a >= 0 && b >= 0) {
        const [from, to] = a < b ? [a, b] : [b, a];
        set({ selection: order.slice(from, to + 1), cursor: path });
        return;
      }
    }
    if (modifiers.meta) {
      const next = selection.includes(path) ? selection.filter((p) => p !== path) : [...selection, path];
      set({ selection: next, anchor: path, cursor: path });
      return;
    }
    set({ selection: [path], anchor: path, cursor: path });
  },
  clearSelection: () => set({ selection: [], anchor: null }),
  targets: () => {
    const { selection, cursor } = get();
    if (selection.length > 0) return selection;
    return cursor ? [cursor] : [];
  },

  ensureMeta: (item) => {
    if (item.kind !== "html") return;
    const key = `${item.path}@${item.modified ?? 0}`;
    // Known for THIS version of the file (a capture rewritten in place — the
    // image sweep, an update from source — is read again). A header put in
    // the store by anything else has no recorded version and counts as known.
    if (item.path in get().meta && (metaVersion.get(item.path) ?? key) === key) return;
    if (metaInFlight.has(key)) return;
    metaInFlight.add(key);
    let pending = metaCache.get(key);
    if (!pending) {
      pending = metaLimiter(() => tauriApi.inboxCardMeta(item.path)).catch(() => null);
      metaCache.set(key, pending);
    }
    void pending.then((meta) => {
      metaInFlight.delete(key);
      metaArrived.set(item.path, meta);
      metaVersion.set(item.path, key);
      if (metaFlushTimer !== null) return;
      metaFlushTimer = window.setTimeout(() => {
        metaFlushTimer = null;
        const arrived = [...metaArrived];
        metaArrived.clear();
        // The listing may have moved on; only record for items still present.
        const present = new Set(get().items.map((i) => i.path));
        const landed: Record<string, InboxCardMeta | null> = {};
        let count = 0;
        for (const [path, value] of arrived) {
          if (!present.has(path)) {
            metaVersion.delete(path);
            continue;
          }
          landed[path] = value;
          count += 1;
        }
        if (count === 0) return;
        set((s) => ({ meta: { ...s.meta, ...landed } }));
        log.info(PERF_INBOX, "meta", { landed: count, known: Object.keys(get().meta).length });
      }, META_FLUSH_MS);
    });
  },

  entryFor: (path) => liveEntry(get().progress.items[nameOf(path)]),
  unreadCount: () => get().items.filter((i) => isUnread(get().progress.items[i.name])).length,

  // The writers below read the LIVE entry (a tombstone counts as none) and
  // stamp `now`: a first open after a deletion is by construction newer than
  // the stone, which is what turns the name into a new life on merge.
  markOpened: (path) => {
    const name = nameOf(path);
    const current = liveEntry(get().progress.items[name]);
    if (current && current.openedAt) return;
    const now = new Date().toISOString();
    set((s) => ({
      progress: {
        ...s.progress,
        items: { ...s.progress.items, [name]: mergeEntry(current, { fraction: 0, openedAt: now, updatedAt: now }) },
      },
    }));
    scheduleWrite(get);
  },

  recordProgress: (path, fraction) => {
    const name = nameOf(path);
    const current = liveEntry(get().progress.items[name]);
    const clamped = Math.min(1, Math.max(0, fraction));
    // Forward only, and a true no-op when nothing advances: the scroll
    // handler calls this per frame.
    if (current && clamped <= current.fraction) return;
    const now = new Date().toISOString();
    set((s) => ({
      progress: {
        ...s.progress,
        items: {
          ...s.progress.items,
          [name]: mergeEntry(current, { fraction: clamped, openedAt: current?.openedAt ?? now, updatedAt: now }),
        },
      },
    }));
    scheduleWrite(get);
  },

  markRead: (paths) => {
    if (paths.length === 0) return;
    const now = new Date().toISOString();
    set((s) => {
      const items = { ...s.progress.items };
      for (const p of paths) {
        const name = nameOf(p);
        items[name] = mergeEntry(liveEntry(items[name]), { fraction: 1, openedAt: now, updatedAt: now });
      }
      return { progress: { ...s.progress, items } };
    });
    scheduleWrite(get);
  },

  markUnread: (paths) => {
    if (paths.length === 0) return;
    // A reset, not a deletion: the stamp voids everything either device
    // recorded before it, so the other device's copy cannot bring the
    // progress back — while anything read after it counts again.
    const now = new Date().toISOString();
    set((s) => {
      const items = { ...s.progress.items };
      for (const p of paths) {
        const name = nameOf(p);
        items[name] = { fraction: 0, openedAt: null, updatedAt: now, resetAt: now };
      }
      return { progress: { ...s.progress, items } };
    });
    scheduleWrite(get);
  },

  markAllRead: () => get().markRead(get().items.map((i) => i.path)),

  setActiveItem: (path) => set({ activeItem: path }),

  neighbour: (path, direction) => {
    const order = get().visible();
    const i = order.findIndex((item) => item.path === path);
    if (i < 0) return null;
    return order[i + direction] ?? null;
  },

  fileTo: (paths, projectPath, ops) => {
    const dest = projectPath.replace(/\/+$/, "");
    return serialised(dest, () => get().fileToNow(paths, dest, ops));
  },

  fileToNow: async (paths, dest, ops) => {
    const started = performance.now();
    const batched = typeof ops.refreshFileTree === "function";
    // Captured first: the rows leave the list before the files move, and a
    // sidecar write in between prunes by what is listed.
    const entries = new Map<string, ReadingProgressEntry>();
    for (const path of paths) {
      const entry = liveEntry(get().progress.items[nameOf(path)]);
      if (entry) entries.set(path, entry);
    }
    // Where each file goes. Existence is asked for all of them at once;
    // dedupe like the phone does (`name-1.ext`, `name-2.ext`), in order, and
    // against the names this same batch has already claimed.
    const exists = await Promise.all(paths.map((path) => tauriApi.pathExists(`${dest}/${nameOf(path)}`)));
    const targets = new Map<string, string>();
    const claimed = new Set<string>();
    for (let i = 0; i < paths.length; i += 1) {
      const name = nameOf(paths[i]);
      let target = `${dest}/${name}`;
      if (exists[i] || claimed.has(target)) {
        const dot = name.lastIndexOf(".");
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : "";
        let n = 1;
        while (claimed.has(`${dest}/${stem}-${n}${ext}`) || (await tauriApi.pathExists(`${dest}/${stem}-${n}${ext}`))) n += 1;
        target = `${dest}/${stem}-${n}${ext}`;
      }
      claimed.add(target);
      targets.set(paths[i], target);
    }

    // The rows leave now, not after the last file has moved: `e` on a
    // selection used to sit there until the whole loop was through. A move
    // that fails puts its row back below.
    const leaving = new Set(paths);
    const before = get().items;
    const cursorAfter = get().cursorAfterRemoving(leaving);
    set((s) => ({
      items: s.items.filter((i) => !leaving.has(i.path)),
      selection: s.selection.filter((p) => !leaving.has(p)),
      cursor: cursorAfter,
    }));

    const moveOne = async (path: string, target: string) => {
      if (!batched) {
        await ops.renamePath(path, target);
        return;
      }
      // `useFileOperations.renamePath` without its two tree refreshes.
      trackSelfRename(path, target);
      await Promise.all([tauriApi.markSelfWrite(path), tauriApi.markSelfWrite(target)]);
      await tauriApi.renamePath(path, target);
      useEditorStore.getState().renameOpenDocument(path, target);
      useWorkspaceStore.getState().renamePinnedPath(path, target);
    };
    const limit = createLimiter(batched ? MOVE_CONCURRENCY : 1);
    const outcome = await Promise.all(
      paths.map((path) =>
        limit(() => moveOne(path, targets.get(path) as string)).then(
          () => true,
          (err: unknown) => {
            console.error("[inbox] move failed:", err);
            return false;
          },
        ),
      ),
    );
    const moved: string[] = [];
    const carried: Record<string, ReadingProgressEntry> = {};
    paths.forEach((path, i) => {
      if (!outcome[i]) return;
      moved.push(path);
      const entry = entries.get(path);
      if (entry) carried[nameOf(targets.get(path) as string)] = entry;
      evictDesktopThumbnail(path);
    });

    if (moved.length < paths.length) {
      // Put back what did not move, where it was.
      const failed = new Set(paths.filter((_, i) => !outcome[i]));
      const rank = new Map(before.map((item, i) => [item.path, i]));
      set((s) => {
        const have = new Set(s.items.map((i) => i.path));
        const back = before.filter((i) => failed.has(i.path) && !have.has(i.path));
        if (back.length === 0) return {};
        const items = [...s.items, ...back].sort(
          (a, b) => (rank.get(a.path) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.path) ?? Number.MAX_SAFE_INTEGER),
        );
        return { items, cursor: s.cursor ?? back[0].path };
      });
    }

    if (batched && moved.length > 0) {
      // One refresh per affected tree. The destination covers the library
      // tree too when the project lives in the library the Inbox is in;
      // otherwise the Inbox's side is refreshed as well.
      const inbox = get().dir;
      const library = inbox ? inbox.slice(0, inbox.lastIndexOf("/")) : null;
      try {
        await ops.refreshFileTree?.(dest);
        if (inbox && library && !dest.startsWith(`${library}/`)) await ops.refreshFileTree?.(inbox);
        ops.refreshGit?.(dest);
        if (inbox) ops.refreshGit?.(inbox);
      } catch (err) {
        log.warn("inbox", "Tree not refreshed after filing", err);
      }
    }
    log.info(PERF_INBOX, "file", {
      count: paths.length,
      moved: moved.length,
      batched,
      ms: Math.round(performance.now() - started),
    });
    if (moved.length === 0) return moved;

    // The state travels with the item: into the project's own sidecar.
    if (Object.keys(carried).length > 0) {
      const metaDir = `${dest}/.notesage`;
      try {
        await tauriApi.createDirectory(metaDir);
        const existing = await readSidecar(metaDir);
        const merged = mergeReadingProgress(existing, { version: READING_PROGRESS_VERSION, items: carried });
        const path = `${metaDir}/${READING_PROGRESS_FILE}`;
        await tauriApi.markSelfWrite(path);
        await tauriApi.writeFile(path, serializeReadingProgress(merged));
      } catch (err) {
        console.warn("[inbox] could not carry reading progress:", err);
      }
    }
    const movedSet = new Set(moved);
    // The rows are gone already; this pass matters only when a reload listed
    // a file again in the moment before it moved.
    const nextCursor = get().cursorAfterRemoving(movedSet);
    const stone = tombstone();
    set((s) => {
      const items = { ...s.progress.items };
      for (const p of moved) items[nameOf(p)] = stone;
      return {
        items: s.items.some((i) => movedSet.has(i.path)) ? s.items.filter((i) => !movedSet.has(i.path)) : s.items,
        progress: { ...s.progress, items },
        selection: s.selection.filter((p) => !movedSet.has(p)),
        cursor: nextCursor,
        lastDestination: dest,
        activeItem: s.activeItem && movedSet.has(s.activeItem) ? null : s.activeItem,
      };
    });
    scheduleWrite(get);
    return moved;
  },

  trash: async (paths) => {
    if (paths.length === 0) return;
    const started = performance.now();
    // One call for the whole selection: one hop to Finder, not one per file
    // in sequence. It answers with the paths it could NOT move.
    let failed: string[];
    try {
      failed = await tauriApi.trashPaths(paths);
    } catch (err) {
      console.error("[inbox] trash failed:", err);
      failed = paths;
    }
    if (failed.length > 0) console.error("[inbox] not moved to the Trash:", failed);
    const failedSet = new Set(failed);
    const gone = paths.filter((p) => !failedSet.has(p));
    log.info(PERF_INBOX, "trash", { count: paths.length, gone: gone.length, ms: Math.round(performance.now() - started) });
    if (gone.length === 0) return;
    const editor = useEditorStore.getState();
    const ws = useWorkspaceStore.getState();
    const pinned = new Set(ws.pinnedFiles);
    for (const p of gone) {
      editor.markTabDeleted(p);
      editor.removeRecent(p);
      if (pinned.has(p)) ws.unpinFile(p);
      evictDesktopThumbnail(p);
    }
    const goneSet = new Set(gone);
    const nextCursor = get().cursorAfterRemoving(goneSet);
    const stone = tombstone();
    set((s) => {
      const items = { ...s.progress.items };
      for (const p of gone) items[nameOf(p)] = stone;
      return {
        items: s.items.filter((i) => !goneSet.has(i.path)),
        progress: { ...s.progress, items },
        selection: s.selection.filter((p) => !goneSet.has(p)),
        cursor: nextCursor,
        activeItem: s.activeItem && goneSet.has(s.activeItem) ? null : s.activeItem,
      };
    });
    scheduleWrite(get);
  },

  visible: () => {
    const { items, meta, filter } = get();
    return items.filter((i) => matchesFilter(i, meta[i.path], filter));
  },

  cursorAfterRemoving: (removed) => {
    const { cursor } = get();
    if (!cursor || !removed.has(cursor)) return cursor;
    const order = get().visible().map((i) => i.path);
    const at = order.indexOf(cursor);
    const after = order.slice(at + 1).find((p) => !removed.has(p));
    if (after) return after;
    const before = order.slice(0, at).reverse().find((p) => !removed.has(p));
    return before ?? null;
  },
}));

/** Selector helpers kept outside the store so components don't recompute. */
export function inboxItemIsFinished(entry: ReadingProgressEntry | undefined): boolean {
  return isFinished(entry);
}

/** Test-only reset of module caches. */
export function resetInboxCaches(): void {
  metaCache.clear();
  metaInFlight.clear();
  metaVersion.clear();
  metaArrived.clear();
  if (metaFlushTimer !== null) {
    window.clearTimeout(metaFlushTimer);
    metaFlushTimer = null;
  }
  metaDirEnsured = null;
  writeChain = Promise.resolve();
  fileChains.clear();
  if (writeTimer !== null) {
    window.clearTimeout(writeTimer);
    writeTimer = null;
  }
}

// Any document becoming active takes the column: the recent-document cycle,
// the command bar, a wikilink — not only the sidebar (which also goes through
// `useFileOperations.openFile`, the path that covers re-opening the file
// already active behind the list). Opening an Inbox item passes here too;
// the Inbox was closing anyway.
//
// Guarded because this runs at import: a suite that mocks the editor store
// with a bare `getState` (agent-orb-toggle-composition) would otherwise fail
// to load every module that reaches this one.
if (typeof useEditorStore.subscribe === "function") {
  useEditorStore.subscribe((state, previous) => {
    if (state.activeTabId === previous.activeTabId) return;
    const inbox = useInboxStore.getState();
    if (inbox.open) inbox.closeInbox();
  });
}

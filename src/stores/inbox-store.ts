import { create } from "zustand";
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
  /** `useFileOperations().renamePath` — the move primitive, with tree refresh. */
  renamePath: (oldPath: string, newPath: string) => Promise<boolean>;
}

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
  /** Header for an article row; resolves from cache after the first read. */
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
      useInboxStore.setState({ progress: merged });
      const path = `${metaDir}/${READING_PROGRESS_FILE}`;
      await tauriApi.markSelfWrite(path);
      await tauriApi.writeFile(path, serializeReadingProgress(merged));
    } catch (err) {
      console.warn("[inbox] could not write reading progress:", err);
    }
  };
  writeChain = writeChain.then(run, run);
  return writeChain;
}

async function readSidecar(metaDir: string): Promise<ReadingProgressFile> {
  try {
    const text = await tauriApi.readFile(`${metaDir}/${READING_PROGRESS_FILE}`);
    return parseReadingProgress(text);
  } catch {
    return emptyReadingProgress();
  }
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
      } catch {
        // No Inbox yet — nothing has been shared. An empty list, not an error.
        entries = [];
      }
      if (stale()) return;
      const items: InboxItem[] = entries
        .filter((e) => !e.is_directory)
        .map((e) => ({ path: e.path, name: e.name, modified: e.modified, kind: classifyFile(e.name) }));
      const fromDisk = await readSidecar(inboxMetaDir(root));
      // A newer load started while this one was reading — startup resolving
      // the iCloud root mid-listing, or a test pointing at another library.
      // Its result would clobber the newer one; drop it.
      if (stale()) return;
      // Disk wins nothing on its own: merge, so an unsaved local advance
      // survives a reload that happened mid-write. Entries for names not in
      // the listing stay (tombstones, the other device's knowledge) — they
      // are pruned at write time, where the file is actually rewritten.
      const progress = mergeReadingProgress(fromDisk, get().progress);
      const paths = new Set(items.map((i) => i.path));
      set((s) => ({
        items,
        progress,
        loading: false,
        selection: s.selection.filter((p) => paths.has(p)),
        cursor: s.cursor && paths.has(s.cursor) ? s.cursor : (items[0]?.path ?? null),
      }));
      for (const item of items) get().ensureMeta(item);
    } catch (err) {
      if (!stale()) set({ loading: false, error: String(err) });
    }
  },

  setFilter: (filter) => set({ filter }),
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
    if (item.path in get().meta) return;
    const key = `${item.path}@${item.modified ?? 0}`;
    let pending = metaCache.get(key);
    if (!pending) {
      pending = metaLimiter(() => tauriApi.inboxCardMeta(item.path)).catch(() => null);
      metaCache.set(key, pending);
    }
    void pending.then((meta) => {
      // The listing may have moved on; only record for an item still present.
      if (!get().items.some((i) => i.path === item.path)) return;
      set((s) => ({ meta: { ...s.meta, [item.path]: meta } }));
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
    const moved: string[] = [];
    const carried: Record<string, ReadingProgressEntry> = {};
    for (const path of paths) {
      const name = nameOf(path);
      let target = `${dest}/${name}`;
      // Dedupe like the phone does: `name-1.ext`, `name-2.ext`.
      if (await tauriApi.pathExists(target)) {
        const dot = name.lastIndexOf(".");
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : "";
        let n = 1;
        while (await tauriApi.pathExists(`${dest}/${stem}-${n}${ext}`)) n += 1;
        target = `${dest}/${stem}-${n}${ext}`;
      }
      try {
        await ops.renamePath(path, target);
      } catch (err) {
        console.error("[inbox] move failed:", err);
        continue;
      }
      moved.push(path);
      const entry = liveEntry(get().progress.items[name]);
      if (entry) carried[nameOf(target)] = entry;
      evictDesktopThumbnail(path);
    }
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
    const nextCursor = get().cursorAfterRemoving(movedSet);
    const stone = tombstone();
    set((s) => {
      const items = { ...s.progress.items };
      for (const p of moved) items[nameOf(p)] = stone;
      return {
        items: s.items.filter((i) => !movedSet.has(i.path)),
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
    const gone: string[] = [];
    for (const path of paths) {
      try {
        await tauriApi.trashPath(path);
        gone.push(path);
      } catch (err) {
        console.error("[inbox] trash failed:", err);
      }
    }
    if (gone.length === 0) return;
    const editor = useEditorStore.getState();
    const ws = useWorkspaceStore.getState();
    for (const p of gone) {
      editor.markTabDeleted(p);
      editor.removeRecent(p);
      if (ws.pinnedFiles.includes(p)) ws.unpinFile(p);
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

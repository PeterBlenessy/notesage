import { iosEnsureDirectory, iosReadFile, iosWriteFile } from "@/lib/ios-api";
import { useMobileStore } from "@/stores/mobile-store";
import { INBOX_FOLDER_NAME } from "@/lib/inbox";
import {
  emptyReadingProgress,
  liveEntry,
  mergeReadingProgress,
  parseReadingProgress,
  serializeReadingProgress,
  time,
  READING_PROGRESS_FILE,
  type ReadingProgressFile,
} from "@/lib/reading-progress-file";

/**
 * The phone's side of `Inbox/.notesage/reading-progress.json`.
 *
 * The phone keeps reading progress and listen positions in its local store
 * (fast, offline). This module makes that store a write-through cache of the
 * shared sidecar for Inbox items only:
 *
 *   pull — when the Inbox is listed, the file's live entries are merged into
 *          the local store, forward-only, so what the Mac read shows here;
 *   push — a change to an Inbox item's progress, listen position, or its
 *          first open marks that item DIRTY; one coalesced write later
 *          read-merge-writes the dirty items, stamped with their change time.
 *
 * Only dirty items are ever written: the phone's local store has no
 * timestamps and may hold entries for items the Mac has since trashed or
 * reset, and pushing those wholesale would undo the Mac's work. A tombstone
 * or reset on disk therefore wins over the phone's silence, and the phone's
 * own changes win because they are newer.
 *
 * A "mark as unread" on the Mac arrives as a `resetAt` stamp (#876). The
 * pull applies each stamp ONCE — the store's ledger remembers which — by
 * dropping the item's local fraction and listen position, the one write
 * allowed backwards past the forward-only guard. A change made here after
 * the reset (read on the phone before the next pull) is newer than the
 * stamp and stays; the stamp is recorded so it is not applied later.
 */
export const INBOX_SIDECAR_REL = `${INBOX_FOLDER_NAME}/.notesage/${READING_PROGRESS_FILE}`;
const INBOX_PREFIX = `${INBOX_FOLDER_NAME}/`;
const PUSH_DELAY_MS = 1500;

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;
/** Names whose first open this device observed, so `openedAt` is written once. */
const openedHere = new Map<string, string>();
/** Names changed on this device since the last successful push → change time. */
const dirty = new Map<string, string>();
/** True while a pull is writing the store: those changes came FROM disk. */
let pulling = false;

function nameOf(relPath: string): string | null {
  if (!relPath.startsWith(INBOX_PREFIX)) return null;
  const rest = relPath.slice(INBOX_PREFIX.length);
  // Only direct children: a nested folder inside the Inbox is not an item.
  return rest.includes("/") ? null : rest;
}

async function readSidecar(): Promise<ReadingProgressFile> {
  try {
    return parseReadingProgress(await iosReadFile(INBOX_SIDECAR_REL));
  } catch {
    return emptyReadingProgress();
  }
}

/** This device's DIRTY Inbox items, as a sidecar file. */
export function localInboxProgress(): ReadingProgressFile {
  const s = useMobileStore.getState();
  const file = emptyReadingProgress();
  for (const [name, updatedAt] of dirty) {
    const relPath = `${INBOX_PREFIX}${name}`;
    const fraction = Math.min(1, Math.max(0, s.readingProgress[relPath] ?? 0));
    const paragraph = s.speechPositions[relPath];
    file.items[name] = {
      fraction,
      openedAt: openedHere.get(name) ?? null,
      updatedAt,
      ...(paragraph !== undefined ? { speech: { paragraph } } : {}),
    };
  }
  return file;
}

/** Merge the sidecar's live entries into the local store: forward-only. */
export async function pullInboxProgress(): Promise<void> {
  const file = await readSidecar();
  const s = useMobileStore.getState();
  pulling = true;
  try {
    for (const [name, raw] of Object.entries(file.items)) {
      const relPath = `${INBOX_PREFIX}${name}`;
      if (raw.resetAt && s.readingResets[relPath] !== raw.resetAt) {
        const changedHere = dirty.get(name);
        // Parsed, not compared as strings: a hand-edited stamp without
        // milliseconds sorts after one with them (review finding).
        if (changedHere && time(changedHere) > time(raw.resetAt)) {
          // Read here after the Mac reset it: this device's progress is the
          // newer fact. Record the stamp so it is never applied on top.
          s.recordReadingReset(relPath, raw.resetAt);
        } else {
          s.applyReadingReset(relPath, raw.resetAt);
          openedHere.delete(name);
          dirty.delete(name);
        }
      }
      const entry = liveEntry(raw);
      if (!entry) continue;
      if (entry.fraction > 0) s.rememberReadingProgress(relPath, entry.fraction);
      if (entry.speech && s.speechPositions[relPath] === undefined) s.rememberSpeechPosition(relPath, entry.speech.paragraph);
      if (entry.openedAt && !openedHere.has(name)) openedHere.set(name, entry.openedAt);
    }
  } finally {
    pulling = false;
  }
}

/** Read-merge-write the sidecar with this device's dirty items. */
export async function pushInboxProgress(): Promise<void> {
  if (dirty.size === 0) return;
  const local = localInboxProgress();
  try {
    const onDisk = await readSidecar();
    const merged = mergeReadingProgress(onDisk, local);
    const text = serializeReadingProgress(merged);
    if (text !== serializeReadingProgress(onDisk)) {
      await iosEnsureDirectory(`${INBOX_FOLDER_NAME}/.notesage`);
      await iosWriteFile(INBOX_SIDECAR_REL, text);
      // The sidecar just changed what "unread" means: recount the badge.
      void useMobileStore.getState().refreshUnread();
    }
    for (const name of Object.keys(local.items)) dirty.delete(name);
  } catch (err) {
    console.warn("[inbox-sync] could not write reading progress:", err);
  }
}

export function scheduleInboxProgressPush(): void {
  if (pushTimer !== null) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushInboxProgress();
  }, PUSH_DELAY_MS);
}

/**
 * Watch the local store for Inbox-relevant changes and push them. Mounted
 * once at the app root — the listing unmounts the moment a document opens,
 * and reading is exactly when progress changes.
 */
export function startInboxProgressSync(): () => void {
  if (unsubscribe) return unsubscribe;
  let prev = useMobileStore.getState();
  unsubscribe = useMobileStore.subscribe((next) => {
    const now = new Date().toISOString();
    let changed = false;
    if (pulling) {
      // Adopted from disk, not changed here: never dirty.
      prev = next;
      return;
    }
    if (next.readingProgress !== prev.readingProgress) {
      for (const [relPath, fraction] of Object.entries(next.readingProgress)) {
        const name = nameOf(relPath);
        if (name && prev.readingProgress[relPath] !== fraction) {
          dirty.set(name, now);
          changed = true;
        }
      }
    }
    if (next.speechPositions !== prev.speechPositions) {
      for (const [relPath, paragraph] of Object.entries(next.speechPositions)) {
        const name = nameOf(relPath);
        if (name && prev.speechPositions[relPath] !== paragraph) {
          dirty.set(name, now);
          changed = true;
        }
      }
    }
    if (next.openDoc !== prev.openDoc && next.openDoc) {
      const name = nameOf(next.openDoc.relPath);
      if (name && !openedHere.has(name)) {
        openedHere.set(name, now);
        dirty.set(name, now);
        changed = true;
      }
    }
    prev = next;
    if (changed) scheduleInboxProgressPush();
  });
  return () => {
    unsubscribe?.();
    unsubscribe = null;
  };
}

/** Test-only. */
export function resetInboxProgressSync(): void {
  if (pushTimer !== null) clearTimeout(pushTimer);
  pushTimer = null;
  unsubscribe?.();
  unsubscribe = null;
  openedHere.clear();
  dirty.clear();
}

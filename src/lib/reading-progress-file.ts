/**
 * `Inbox/.notesage/reading-progress.json` — the read-later state both apps
 * share, kept with the folder the way a project keeps its metadata in its own
 * `.notesage/`.
 *
 * iCloud syncs dot-folders (Finder and Files hide them), so the phone and the
 * Mac read one file. Entries are keyed by the item's name relative to the
 * Inbox, and carry the only three things that make a list a read-later list:
 * how far the reader got, when it was first opened, and where listening left
 * off. Moving an item into a project moves its entry into that project's
 * sidecar; deleting drops it.
 *
 * Two devices write the file without coordination, so every write is a
 * read → merge → write and the merge has to be safe in any order:
 *
 *   - progress is monotonic: the larger fraction wins, `openedAt` keeps the
 *     earliest — a stale write can only lose ground it had already lost;
 *   - a deliberate step backwards is a RESET (`resetAt`, "mark as unread"):
 *     anything a side last touched before the newest reset is treated as
 *     empty, anything touched after it counts again;
 *   - a deletion is a TOMBSTONE (`deleted`) that beats any live entry with an
 *     older `updatedAt`, so trashing or filing an item is not undone by the
 *     other device's copy of the old entry — and a later capture with the
 *     same name starts unread, because its first open is newer than the stone.
 *
 * `updatedAt` is the change time on the writing device. Entries the phone
 * carries without one (its local store is timestamp-free) count as oldest.
 */

export const READING_PROGRESS_FILE = "reading-progress.json";
export const READING_PROGRESS_VERSION = 2;
/** Tombstones and orphans older than this are dropped at write time. */
export const TOMBSTONE_TTL_MS = 30 * 86_400_000;

export interface ReadingSpeechPosition {
  /** Paragraph index the speech player last reached. */
  paragraph: number;
  /** The voice in use, so a resume on another device can prefer it. */
  voice?: string;
}

export interface ReadingProgressEntry {
  /** 0…1, the furthest scroll fraction reached. */
  fraction: number;
  /** ISO-8601 of the first open on any device; `null` while unread. */
  openedAt: string | null;
  /** ISO-8601 of the last change on the writing device. */
  updatedAt?: string;
  /** ISO-8601 of the last "mark as unread"; state older than it is void. */
  resetAt?: string;
  /** A deletion (trashed, filed away) that must survive the other device. */
  deleted?: true;
  /**
   * ISO-8601 of the deletion a live entry succeeded (a capture re-shared
   * under a trashed name). Carried forward like `resetAt`, so a third device's
   * copy from before the deletion is still void after the new life began.
   */
  deletedAt?: string;
  /** Device label of the last writer — diagnostics only. */
  device?: string;
  speech?: ReadingSpeechPosition;
}

export interface ReadingProgressFile {
  version: number;
  items: Record<string, ReadingProgressEntry>;
}

export function emptyReadingProgress(): ReadingProgressFile {
  return { version: READING_PROGRESS_VERSION, items: {} };
}

function clampFraction(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.min(1, Math.max(0, n));
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

export function time(iso: string | null | undefined): number {
  return iso ? Date.parse(iso) : 0;
}

/**
 * Parse the file's text. Tolerant by design: a hand-edited or half-synced
 * file must never take the Inbox down with it. Unknown fields are dropped,
 * malformed entries are skipped, and anything unparseable is an empty file.
 */
export function parseReadingProgress(text: string): ReadingProgressFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptyReadingProgress();
  }
  if (!raw || typeof raw !== "object") return emptyReadingProgress();
  const items = (raw as { items?: unknown }).items;
  const out = emptyReadingProgress();
  if (!items || typeof items !== "object") return out;
  for (const [name, value] of Object.entries(items as Record<string, unknown>)) {
    if (!name || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const entry: ReadingProgressEntry = {
      fraction: clampFraction(v.fraction),
      openedAt: isoOrNull(v.openedAt),
    };
    // The merge's invariants, enforced on the way in rather than assumed: a
    // stamp (`resetAt`, `deletedAt`) is never later than the entry's own
    // `updatedAt`, and a tombstone carries no `deletedAt` of its own. A
    // hand-edited or corrupted file must not poison every later merge.
    const resetAt = isoOrNull(v.resetAt);
    const deletedAt = v.deleted === true ? null : isoOrNull(v.deletedAt);
    let updatedAt = isoOrNull(v.updatedAt);
    for (const stamp of [resetAt, deletedAt]) {
      if (stamp && (!updatedAt || Date.parse(stamp) > Date.parse(updatedAt))) updatedAt = stamp;
    }
    if (updatedAt) entry.updatedAt = updatedAt;
    // `openedAt` decides new life vs. old life against a tombstone, so a
    // claimed open later than the entry's own last change is capped at it.
    if (entry.openedAt && updatedAt && Date.parse(entry.openedAt) > Date.parse(updatedAt)) entry.openedAt = updatedAt;
    if (resetAt) entry.resetAt = resetAt;
    if (v.deleted === true) entry.deleted = true;
    if (deletedAt) entry.deletedAt = deletedAt;
    if (typeof v.device === "string" && v.device) entry.device = v.device;
    const speech = v.speech as Record<string, unknown> | undefined;
    if (speech && typeof speech === "object" && typeof speech.paragraph === "number" && speech.paragraph >= 0) {
      entry.speech = { paragraph: Math.floor(speech.paragraph) };
      if (typeof speech.voice === "string" && speech.voice) entry.speech.voice = speech.voice;
    }
    out.items[name] = entry;
  }
  return out;
}

/** Stable, human-readable output — the file lives in a synced folder and a
 *  person may well open it. Keys sorted so two devices writing the same
 *  state produce the same bytes. */
export function serializeReadingProgress(file: ReadingProgressFile): string {
  const names = Object.keys(file.items).sort((a, b) => a.localeCompare(b));
  const items: Record<string, ReadingProgressEntry> = {};
  for (const name of names) items[name] = file.items[name];
  return JSON.stringify({ version: READING_PROGRESS_VERSION, items }, null, 2) + "\n";
}

/** The earlier of two ISO times; `null` only when both are null. */
function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function latest(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/*
 * Known limit: precedence is a wall-clock comparison; on an exact tie the
 * incoming side wins, so the merge is order-dependent only for two devices
 * writing the same millisecond.
 */

/** An entry as it counts after the newest reset: void if it was last
 *  touched before the reset (an entry with no `updatedAt` is oldest). A
 *  change at the reset's own instant counts as after it — the reset entry
 *  itself is empty, so nothing is lost either way. */
function afterReset(e: ReadingProgressEntry, resetAt: string | undefined): ReadingProgressEntry {
  if (!resetAt || time(e.updatedAt) >= time(resetAt)) return e;
  return { fraction: 0, openedAt: null, updatedAt: e.updatedAt, device: e.device };
}

/**
 * Merge one entry into another under the rules above. Pure.
 */
export function mergeEntry(
  current: ReadingProgressEntry | undefined,
  incoming: ReadingProgressEntry,
): ReadingProgressEntry {
  if (!current) return { ...incoming, fraction: clampFraction(incoming.fraction) };
  // A tombstone beats any live state that is older than it; a live entry
  // newer than the stone is a new life (a re-shared capture) — and it keeps
  // the stone's time as `deletedAt`, so a copy from before the deletion that
  // turns up later is still void. Without that the stone's protection would
  // end the moment anyone reopened the name, and the old 90 % would return
  // through a third device (round-three review finding).
  if (current.deleted || incoming.deleted) {
    const [winner, loser] =
      time(incoming.updatedAt) >= time(current.updatedAt) ? [incoming, current] : [current, incoming];
    if (winner.deleted) return { ...winner };
    // A live entry written after the stone is a new life only if its OPEN
    // is after the stone too. A device still scrolling an item the other
    // device deleted writes a fresh `updatedAt` with the old `openedAt`;
    // that is the old life continuing, and the stone keeps it dead (round
    // four review finding).
    if (winner.openedAt && time(winner.openedAt) < time(loser.updatedAt)) return { ...loser };
    const epoch = latest(loser.updatedAt, latest(winner.deletedAt, loser.deletedAt));
    return epoch ? { ...winner, deletedAt: epoch } : { ...winner };
  }
  // Everything either side recorded before the newest reset OR deletion is void.
  const resetAt = latest(current.resetAt, incoming.resetAt);
  const deletedAt = latest(current.deletedAt, incoming.deletedAt);
  const voidBefore = latest(resetAt, deletedAt);
  const a = afterReset(current, voidBefore);
  const b = afterReset(incoming, voidBefore);
  const merged: ReadingProgressEntry = {
    fraction: Math.max(clampFraction(a.fraction), clampFraction(b.fraction)),
    openedAt: earliest(a.openedAt, b.openedAt),
  };
  const updatedAt = latest(current.updatedAt, incoming.updatedAt);
  if (updatedAt) merged.updatedAt = updatedAt;
  if (resetAt) merged.resetAt = resetAt;
  if (deletedAt) merged.deletedAt = deletedAt;
  // Diagnostics follow the newer side (ties: incoming), so order matters
  // only for a field nothing decides on.
  const newer = time(incoming.updatedAt) >= time(current.updatedAt) ? incoming : current;
  const device = newer.device ?? (newer === incoming ? current.device : incoming.device);
  if (device) merged.device = device;
  // The speech position follows the most recent session, unless the reset
  // voided that session.
  const speech = time(b.updatedAt) >= time(a.updatedAt) ? (b.speech ?? a.speech) : (a.speech ?? b.speech);
  if (speech && (a.fraction > 0 || b.fraction > 0 || merged.openedAt)) merged.speech = speech;
  return merged;
}

/** Merge a whole file into another, entry by entry. Pure; returns a new file. */
export function mergeReadingProgress(
  current: ReadingProgressFile,
  incoming: ReadingProgressFile,
): ReadingProgressFile {
  const out: ReadingProgressFile = { version: READING_PROGRESS_VERSION, items: { ...current.items } };
  for (const [name, entry] of Object.entries(incoming.items)) {
    out.items[name] = mergeEntry(out.items[name], entry);
  }
  return out;
}

/** A tombstone for `name`, stamped now. */
export function tombstone(now: Date = new Date()): ReadingProgressEntry {
  return { fraction: 0, openedAt: null, updatedAt: now.toISOString(), deleted: true };
}

/**
 * Drop what no longer carries information: tombstones past their TTL, and
 * live entries for names not in `present` that are older than the TTL (an
 * item trashed from Finder, never tombstoned). An entry with no `updatedAt`
 * (written by a phone before stamps existed) is stamped `now` instead of
 * dropped, so it gets the same 30-day grace as everything else. Pure.
 */
export function pruneReadingProgress(
  file: ReadingProgressFile,
  present: ReadonlySet<string>,
  now: Date = new Date(),
): ReadingProgressFile {
  const cutoff = now.getTime() - TOMBSTONE_TTL_MS;
  const items: Record<string, ReadingProgressEntry> = {};
  for (const [name, entry] of Object.entries(file.items)) {
    if (!entry.updatedAt) {
      items[name] = { ...entry, updatedAt: now.toISOString() };
      continue;
    }
    const stale = time(entry.updatedAt) < cutoff;
    if (entry.deleted && stale) continue;
    if (!entry.deleted && !present.has(name) && stale) continue;
    items[name] = entry;
  }
  return { version: READING_PROGRESS_VERSION, items };
}

/** Progress at or past this reads as finished — the phone's rule (#836). */
export const FINISHED_THRESHOLD = 0.97;

/** Unread = never opened anywhere (a tombstone counts as no entry). */
export function isUnread(entry: ReadingProgressEntry | undefined): boolean {
  return !entry || entry.deleted === true || entry.openedAt === null;
}

export function isFinished(entry: ReadingProgressEntry | undefined): boolean {
  return !!entry && !entry.deleted && entry.fraction >= FINISHED_THRESHOLD;
}

/** The live entry for display, or undefined for none / a tombstone. */
export function liveEntry(entry: ReadingProgressEntry | undefined): ReadingProgressEntry | undefined {
  return entry && !entry.deleted ? entry : undefined;
}

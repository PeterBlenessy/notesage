import { iosReadFile } from "@/lib/ios-api";
import type { FolderAppearance } from "@/lib/folder-icon";

/**
 * The icon and colour a folder was given on the Mac (#140), read from its
 * `.notesage/project.json` — the same file the desktop sidebar reads — so a
 * project looks the same in the phone's list and gallery.
 *
 * One read per folder per listing, cached for the session and keyed by the
 * folder's modification time so a change made on the Mac shows on the next
 * listing. A folder without the file, or with a file that does not parse,
 * is simply a folder: `null`, cached too, so the miss is not re-read.
 *
 * Reads go through a small limiter: a root with fifty projects mounts fifty
 * rows at once, and fifty concurrent native reads is the burst every other
 * per-row reader here avoids (thumbnails are visibility-gated and capped;
 * the article header cache is capped). The cache itself is bounded like the
 * article header cache, oldest first.
 */
const MAX_ENTRIES = 500;
const MAX_CONCURRENT = 4;

const cache = new Map<string, Promise<FolderAppearance | null>>();
let inFlight = 0;
const waiting: Array<() => void> = [];

function acquire(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiting.push(() => {
      inFlight += 1;
      resolve();
    });
  });
}

function release(): void {
  inFlight = Math.max(0, inFlight - 1);
  const next = waiting.shift();
  if (next) next();
}

function parseAppearance(raw: string): FolderAppearance | null {
  try {
    const json = JSON.parse(raw) as { appearance?: { iconName?: unknown; colorIndex?: unknown } };
    const a = json?.appearance;
    if (!a || typeof a !== "object") return null;
    const iconName = typeof a.iconName === "string" ? a.iconName : null;
    const colorIndex =
      typeof a.colorIndex === "number" && Number.isInteger(a.colorIndex) && a.colorIndex >= 0 && a.colorIndex <= 7
        ? a.colorIndex
        : null;
    if (iconName === null && colorIndex === null) return null;
    return { iconName, colorIndex };
  } catch {
    return null;
  }
}

async function readAppearance(file: string): Promise<FolderAppearance | null> {
  await acquire();
  try {
    return parseAppearance(await iosReadFile(file));
  } catch {
    return null;
  } finally {
    release();
  }
}

export function folderAppearanceFor(relPath: string, modified: number | undefined): Promise<FolderAppearance | null> {
  const key = `${relPath}@${modified ?? 0}`;
  let pending = cache.get(key);
  if (!pending) {
    const file = relPath ? `${relPath}/.notesage/project.json` : ".notesage/project.json";
    pending = readAppearance(file);
    if (cache.size >= MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, pending);
  }
  return pending;
}

/** How many reads are running right now — for the limiter's test. */
export function folderAppearanceReadsInFlight(): number {
  return inFlight;
}

/** Forget every cached appearance and the limiter's bookkeeping (tests). */
export function clearFolderAppearanceCache(): void {
  cache.clear();
  inFlight = 0;
  waiting.length = 0;
}

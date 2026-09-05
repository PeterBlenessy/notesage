/**
 * The phone's Home: which root folders the library shows on its first
 * screen, kept in `.notesage/home.json` beside `pins.json` — a property of
 * the library, so an iPhone and an iPad open to the same Home. Written by
 * iOS; the Mac does not read it (its sidebar is its own curation). Framework
 * agnostic on purpose, in the image of `pins-file.ts`: no Tauri imports.
 *
 * Missing file = the defaults (the Inbox alone). Present file = the whole
 * truth, including "the Inbox is not listed, so it is hidden".
 */
import { INBOX_FOLDER_NAME } from "@/lib/inbox";
import type { FileEntry } from "@/lib/tauri";

export const HOME_FILE_REL_PATH = ".notesage/home.json";

/**
 * Screen key for Home in per-screen maps (scroll offsets, remembered views):
 * Home and "All Folders" both list the root (`""`), and must not share a
 * memory. A relative path can never begin with `/` (the native layer
 * rejects absolute paths), so this cannot collide with a real folder.
 */
export const HOME_KEY = "/home";

interface HomeFileShape {
  version: 1;
  folders: string[];
}

/** `null` when the file is missing its shape, of another version, or not
 *  JSON — the caller applies the defaults. Non-strings dropped, duplicates
 *  folded. */
export function parseHomeFileContent(raw: string): string[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const shape = parsed as Partial<HomeFileShape>;
    if (shape.version !== 1 || !Array.isArray(shape.folders)) return null;
    const seen = new Set<string>();
    for (const f of shape.folders) if (typeof f === "string" && f) seen.add(f);
    return [...seen];
  } catch {
    return null;
  }
}

export function serializeHomeFileContent(folders: string[]): string {
  const content: HomeFileShape = { version: 1, folders };
  return `${JSON.stringify(content, null, 2)}\n`;
}

/** What Home shows before anyone chose: the Inbox, when there is one. */
export function defaultHomeFolders(rootEntries: FileEntry[]): string[] {
  return rootEntries.some((e) => e.is_directory && e.name === INBOX_FOLDER_NAME) ? [INBOX_FOLDER_NAME] : [];
}

/** A folder that may be offered "Show on Home": a root-level directory. */
export function isHomeCandidate(entry: Pick<FileEntry, "is_directory" | "path">): boolean {
  return entry.is_directory && !entry.path.includes("/");
}

/**
 * The set after one change, compacted: entries that no longer name a
 * directory in the root listing are dropped, so a folder renamed on the Mac
 * leaves no dead entry behind. Compaction happens only here — on a write
 * the user asked for — never on a read, where a folder may be mid-sync.
 */
export function applyHomeChange(
  current: string[],
  relPath: string,
  shown: boolean,
  rootEntries: FileEntry[],
): string[] {
  const present = new Set(rootEntries.filter((e) => e.is_directory).map((e) => e.path));
  const next = new Set(current.filter((p) => present.has(p)));
  if (shown) next.add(relPath);
  else next.delete(relPath);
  return [...next];
}

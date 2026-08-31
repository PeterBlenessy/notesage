import { iosListDirectory } from "@/lib/ios-api";

export interface FolderChoice {
  /** Rel path, `""` for the library root. */
  path: string;
  /** What the picker shows — the root reads as "/" rather than blank. */
  label: string;
}

/**
 * Bounds on the walk. A library is a user's own folder tree, but it lives in
 * iCloud and can contain anything they put there — a picker that enumerates an
 * unbounded tree would stall the sheet with no way out, which is the same
 * failure `claimName` was bounded for (#783).
 */
const MAX_DEPTH = 4;
const MAX_FOLDERS = 200;

/**
 * Every folder a document can be filed into, breadth-first so the shallow,
 * likely destinations come first and any truncation drops the deepest ones.
 *
 * Hidden folders are skipped: `.notesage` is metadata, not a destination.
 */
export async function collectFolders(): Promise<FolderChoice[]> {
  const out: FolderChoice[] = [{ path: "", label: "/" }];
  let frontier: string[] = [""];

  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const dir of frontier) {
      if (out.length >= MAX_FOLDERS) return out;
      let entries;
      try {
        entries = await iosListDirectory(dir);
      } catch {
        continue; // An unreadable subtree is skipped, never fatal.
      }
      for (const e of entries) {
        if (!e.is_directory || e.hidden || e.name.startsWith(".")) continue;
        if (out.length >= MAX_FOLDERS) return out;
        out.push({ path: e.path, label: e.path });
        next.push(e.path);
      }
    }
    frontier = next;
  }
  return out;
}

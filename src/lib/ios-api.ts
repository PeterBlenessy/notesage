/**
 * Typed wrappers for the iOS-only Tauri commands backing the mobile reader +
 * share capture (PRD `docs/prds/2026-06-28-ios-mobile-app.md`).
 *
 * These mirror `src-tauri/src/commands/ios_library.rs`. All `relPath` values are
 * relative to the granted library root; the Rust layer rejects absolute paths
 * and `..` traversal. On non-iOS targets these commands reject — the mobile
 * shell is only mounted on iOS.
 */
import { invoke } from "@tauri-apps/api/core";
import type { FileEntry } from "./tauri";

export interface IosLibraryGrant {
  /** User-facing folder name (e.g. "Notesage"); empty when not granted. */
  displayName: string;
  /** Whether a usable (non-stale) grant is currently resolved. */
  granted: boolean;
}

export type IosDownloadState = "ready" | "downloading" | "failed";

/** Present the folder picker (pre-pointed at iCloud Drive/Notesage) and persist the grant. */
export function iosPickLibraryFolder(): Promise<IosLibraryGrant> {
  return invoke<IosLibraryGrant>("ios_pick_library_folder");
}

/** Resolve the persisted grant; `granted: false` when none / stale. */
export function iosGetLibraryGrant(): Promise<IosLibraryGrant> {
  return invoke<IosLibraryGrant>("ios_get_library_grant");
}

/** Forget the persisted grant (used on re-grant / sign-out). */
export function iosClearLibraryGrant(): Promise<void> {
  return invoke<void>("ios_clear_library_grant");
}

/** List a directory relative to the granted library root (`""` = root). */
export function iosListDirectory(relPath: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("ios_list_directory", { relPath });
}

/** Read a UTF-8 file relative to the granted library root. */
export function iosReadFile(relPath: string): Promise<string> {
  return invoke<string>("ios_read_file", { relPath });
}

/**
 * Read a binary file (PDF/EPUB/DOCX/image) relative to the granted library
 * root. The command answers with a RAW IPC response — an ArrayBuffer, no
 * JSON. Anything JSON-shaped here (a number array, or even base64-in-JSON)
 * makes the WebView's main thread parse a payload-sized JSON string, which
 * froze the loading spinner for seconds on large PDFs. The Swift-side base64
 * is decoded on a Rust worker thread before the bytes reach the WebView.
 */
export async function iosReadBinary(relPath: string): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer>("ios_read_binary", { relPath });
  return new Uint8Array(buf);
}

/** Ensure an iCloud item is downloaded; returns its current download state. */
/** Native chrome item: an SF-Symbol button at a screen corner. */
export interface IosChromeItem {
  id: string;
  icon: string;
  /** Native UIMenu entries. Long-press by default (tap fires `id`); with
   *  `menuOnTap` the tap opens the menu. `selected` renders a checkmark row
   *  (pick-one controls like the sort menu). */
  menu?: Array<{
    id: string;
    title: string;
    icon?: string;
    selected?: boolean;
    /** Start a new menu section (divider) before this entry. */
    sectionBreak?: boolean;
  }>;
  /** When true, tapping opens `menu` directly and `id` never fires. */
  menuOnTap?: boolean;
  /** True while the action behind this button is in flight — the native
   *  button spins its SF Symbol for the duration, mirroring the web
   *  fallback's `animate-spin` treatment. */
  busy?: boolean;
}

/**
 * Declare the native Liquid Glass chrome overlay. Rejects off-iOS and on
 * pre-native builds — callers treat rejection as "render web chrome".
 */
export interface IosChromeSearch {
  placeholder: string;
  /** Passive status shown collapsed (item count, page indicator). */
  status?: string;
  /** 1-based current match + total for find-in-document searches. */
  current?: number;
  total?: number;
  /** "filter" (folder search) or "find" (in-document, Notes find anatomy). */
  kind?: "filter" | "find";
}

/** Top-center breadcrumb island (#615): current folder name; tapping opens a
 *  native UIMenu of ancestors (root first). Empty/absent menu = passive label. */
export interface IosChromeBreadcrumb {
  title: string;
  /** Compact ancestor path shown as a second line ("Notesage › Projects"). */
  subtitle?: string;
  menu?: Array<{ id: string; title: string; icon?: string; selected?: boolean }>;
}

export function iosSetChrome(spec: {
  topLeft?: IosChromeItem;
  topRight?: IosChromeItem;
  topCenter?: IosChromeBreadcrumb;
  /** Bottom-trailing action button (the folder view's "+"). */
  bottomRight?: IosChromeItem;
  search?: IosChromeSearch;
}): Promise<void> {
  return invoke("ios_set_chrome", { spec });
}

/**
 * System-generated thumbnail PNG (QLThumbnailGenerator) — PDFs, images,
 * videos and office docs rendered by the OS off the webview thread. Raw
 * bytes (no JSON), same transport as `iosReadBinary`.
 */
export async function iosThumbnail(relPath: string, maxPixel: number): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer>("ios_thumbnail", { relPath, maxPixel });
  return new Uint8Array(buf);
}

/**
 * Present the system QuickLook preview for a library file — native
 * video/audio playback and document rendering. Rejects off-iOS.
 */
export function iosQuickLook(relPath: string): Promise<void> {
  return invoke("ios_quick_look", { relPath });
}

/**
 * Delete a FILE (never a directory) under the granted library root. iCloud's
 * "Recently Deleted" (30-day recovery) backs the no-confirm swipe gesture.
 */
export function iosDeleteFile(relPath: string): Promise<void> {
  return invoke("ios_delete_file", { relPath });
}

/**
 * Rename a file within its directory (the title-becomes-filename primitive).
 * `newName` is a single path segment; the native side dedupes on collision.
 * Resolves the relative path actually produced.
 */
export function iosRenameFile(relPath: string, newName: string): Promise<string> {
  return invoke<string>("ios_rename_file", { relPath, newName });
}

/**
 * Tell the native layer the webview has painted, so it drops the launch
 * cover held over it (#675). Fire-and-forget: rejects off-iOS, and the
 * native side removes the cover on a timeout anyway.
 */
export function iosContentReady(): Promise<void> {
  return invoke("ios_content_ready");
}

/**
 * Native single-line text prompt (UIAlertController with a text field).
 * Resolves the entered text, or `null` when the user cancels. Rejects
 * off-iOS — callers fall back to a web prompt.
 */
export async function iosTextPrompt(
  title: string,
  placeholder: string,
  confirmLabel: string,
): Promise<string | null> {
  const text = await invoke<string | null>("ios_text_prompt", {
    title,
    placeholder,
    confirmLabel,
  });
  return text ?? null;
}

/** Present the iOS share sheet for a library file. */
export function iosShareFile(relPath: string): Promise<void> {
  return invoke("ios_share_file", { relPath });
}

export function iosEnsureDownloaded(relPath: string): Promise<IosDownloadState> {
  return invoke<IosDownloadState>("ios_ensure_downloaded", { relPath });
}

/**
 * Overwrite (or create) a UTF-8 file — the mobile editor's save path (#586).
 * Atomic coordinated write on the native side.
 */
export function iosWriteFile(relPath: string, content: string): Promise<void> {
  return invoke("ios_write_file", { relPath, content });
}

/**
 * Create a new UTF-8 file. The name is deduped natively (`note.md` →
 * `note-1.md`) rather than overwritten; resolves to the relative path
 * actually created.
 */
export function iosCreateFile(relPath: string, content: string): Promise<string> {
  return invoke<string>("ios_create_file", { relPath, content });
}

/**
 * Create a new folder. The name is deduped natively; resolves to the
 * relative path actually created.
 */
export function iosCreateDirectory(relPath: string): Promise<string> {
  return invoke<string>("ios_create_directory", { relPath });
}

export interface IosFileStat {
  /** File size in bytes. */
  sizeBytes: number;
}

/**
 * Cheap metadata probe — the file's size, without reading its content. The
 * mobile reader calls this before `iosReadFile` for text/markdown/html so it
 * can decline an oversized file instead of attempting a read that would
 * freeze the WebView (issue #616).
 */
export function iosStatFile(relPath: string): Promise<IosFileStat> {
  return invoke<IosFileStat>("ios_stat_file", { relPath });
}


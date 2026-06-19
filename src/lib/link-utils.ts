/** Shared link utilities for detecting and resolving internal document links. */

import type { FileEntry } from '@/lib/tauri';
import { tauriApi } from '@/lib/tauri';
import { getFileType, isBinaryFileType } from '@/lib/file-utils';
import { parseFrontmatter } from '@/lib/frontmatter';
import { setBinaryData } from '@/lib/binary-cache';
import { openUrl } from '@tauri-apps/plugin-opener';
import { toast } from 'sonner';
import type { Frontmatter } from '@/lib/frontmatter';
import type { FileType } from '@/lib/file-utils';

/** Function signature for opening a file as an editor tab (matches editor-store.openTab). */
export type OpenTabFn = (filePath: string, fileName: string, content: string, frontmatter?: Frontmatter | null, fileType?: FileType) => void;

/** File extensions that can be opened as editor tabs. */
export const OPENABLE_EXTENSIONS = /\.(md|txt|json|yaml|yml|toml|csv|html|htm|css|js|ts|jsx|tsx|rs|py|rb|go|java|c|cpp|h|sh|sql|xml|svg|epub|pdf|docx)$/i;

/** Returns true if the href looks like an external URL (http, mailto, tel, #anchor). */
export function isExternalUrl(href: string): boolean {
  return /^https?:\/\/|^mailto:|^tel:|^#/.test(href);
}

/** Returns true if the href looks like a local file path (starts with ./, ../, /, ~, or has a known file extension). */
export function isLocalFilePath(href: string): boolean {
  if (/^\.\/|^\.\.\/|^\/|^~/.test(href)) return true;
  return OPENABLE_EXTENSIONS.test(href);
}

export interface FileSearchResult {
  name: string;
  relativePath: string;
  absolutePath: string;
  /** The project or folder name this file belongs to. */
  project: string;
}

/** Collect all files from a FileEntry tree (flat list). */
function collectFiles(entries: FileEntry[], results: FileEntry[]): void {
  for (const entry of entries) {
    if (entry.is_directory) {
      if (entry.children) collectFiles(entry.children, results);
    } else if (OPENABLE_EXTENSIONS.test(entry.name)) {
      results.push(entry);
    }
  }
}

/**
 * Slugify a wikilink title into a filename-safe `.md` slug used for dangling
 * link creation (ADR 0007). Lowercases, replaces runs of non-alphanumerics with
 * a single hyphen, trims leading/trailing hyphens, and appends `.md`.
 *
 * `[[Quarterly Plan]]` → `quarterly-plan.md`
 * `[[Q4 / 2026 Review!]]` → `q4-2026-review.md`
 */
export function slugifyTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'untitled'}.md`;
}

/**
 * Build the relative href to store for a dangling wikilink — a slugified
 * filename in the CURRENT document's directory (ADR 0007). Always a `./`-prefixed
 * relative link so the on-disk form stays canonical.
 *
 * `[[Quarterly Plan]]` → `./quarterly-plan.md`
 */
export function danglingWikiLinkHref(title: string): string {
  return `./${slugifyTitle(title)}`;
}

/** Compute relative path from `fromDir` to `toPath`. */
export function computeRelativePath(fromDir: string, toPath: string): string {
  const fromParts = fromDir.split('/').filter(Boolean);
  const toParts = toPath.split('/').filter(Boolean);

  // Find common prefix length
  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
    common++;
  }

  const ups = fromParts.length - common;
  const rest = toParts.slice(common);

  if (ups === 0) return './' + rest.join('/');
  return '../'.repeat(ups) + rest.join('/');
}

/**
 * Build the relative href for a RESOLVED wikilink target (ADR 0001/0002). The
 * target's absolute `path` (from the link index) is expressed relative to the
 * active document's directory so the stored on-disk form is a standard relative
 * link. With no active directory (untitled / unsaved doc) it falls back to a
 * `./`-prefixed basename.
 */
export function resolvedWikiLinkHref(targetAbsPath: string, activeFileDir?: string): string {
  if (activeFileDir) {
    return computeRelativePath(activeFileDir, targetAbsPath);
  }
  const base = targetAbsPath.split('/').pop() || targetAbsPath;
  return `./${base}`;
}

/** Search all workspace file trees for files matching a query. */
export function searchWorkspaceFiles(
  query: string,
  trees: Array<{ rootPath: string; name: string; fileTree: FileEntry[] }>,
  activeFileDir?: string,
): FileSearchResult[] {
  const lowerQuery = query.toLowerCase();
  const results: FileSearchResult[] = [];

  for (const { rootPath, name, fileTree } of trees) {
    const files: FileEntry[] = [];
    collectFiles(fileTree, files);

    for (const file of files) {
      if (file.name.toLowerCase().includes(lowerQuery)) {
        let relativePath: string;
        if (activeFileDir) {
          relativePath = computeRelativePath(activeFileDir, file.path);
        } else {
          const stripped = file.path.startsWith(rootPath + '/') ? file.path.slice(rootPath.length + 1) : file.path;
          relativePath = './' + stripped;
        }

        results.push({
          name: file.name,
          relativePath,
          absolutePath: file.path,
          project: name,
        });
      }
    }

    if (results.length >= 20) break;
  }

  return results.slice(0, 20);
}

/** Try to open a file path as an editor tab. Returns true on success. */
export async function tryOpenFile(
  filePath: string,
  openTab: OpenTabFn,
): Promise<boolean> {
  const fileName = filePath.split('/').pop() || filePath;
  const fileType = getFileType(fileName);
  try {
    if (isBinaryFileType(fileType)) {
      const bytes = await tauriApi.readBinaryFile(filePath);
      setBinaryData(filePath, new Uint8Array(bytes));
      openTab(filePath, fileName, '', null, fileType);
    } else {
      const raw = await tauriApi.readFile(filePath);
      if (fileType === 'markdown') {
        const { frontmatter, content: body } = parseFrontmatter(raw);
        openTab(filePath, fileName, body, frontmatter, fileType);
      } else {
        openTab(filePath, fileName, raw, null, fileType);
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Resolve a relative path against workspace roots and open it as a tab. */
export async function resolveRelativeAndOpen(
  relativePath: string,
  roots: string[],
  openTab: OpenTabFn,
): Promise<boolean> {
  for (const root of roots) {
    const candidate = `${root}/${relativePath}`;
    if (await tryOpenFile(candidate, openTab)) return true;
  }
  return false;
}

/**
 * Resolve a relative href to the absolute path it would be CREATED at — the
 * active file's directory join for relative paths, or the literal path for
 * absolute ones. Used by the dangling create-on-click flow (ADR 0007), which
 * always creates in the current document's directory.
 */
export function resolveCreateTarget(href: string, activeFileDir?: string): string | null {
  if (href.startsWith('/') || href.startsWith('~')) return href;
  if (!activeFileDir) return null;
  return normalizePath(`${activeFileDir}/${href}`);
}

/**
 * Handle clicking a link: open external URLs in browser, internal file links as tabs.
 * `activeFileDir` is the directory of the currently active file (for resolving relative paths).
 *
 * When an internal link cannot be resolved to an existing file and an
 * `onUnresolved` callback is supplied, it is invoked with the would-be absolute
 * create-target path instead of showing an error toast — this drives the
 * dangling-wikilink create-on-click affordance (ADR 0007). Without the callback
 * the legacy "could not resolve" error toast is shown.
 */
export async function handleLinkNavigation(
  href: string,
  openTab: OpenTabFn,
  workspaceRoots: string[],
  activeFileDir?: string,
  onUnresolved?: (createTargetAbsPath: string, href: string) => void,
): Promise<void> {
  // External URLs — open in system browser
  if (isExternalUrl(href)) {
    openUrl(href).catch(() => window.open(href, '_blank'));
    return;
  }

  // Only try to open as file if it has a recognized extension
  if (!OPENABLE_EXTENSIONS.test(href)) {
    openUrl(href).catch(() => {
      toast.error(`Could not open link: ${href}`);
    });
    return;
  }

  // Absolute path
  if (href.startsWith('/') || href.startsWith('~')) {
    if (await tryOpenFile(href, openTab)) return;
    if (onUnresolved) {
      onUnresolved(href, href);
      return;
    }
    toast.error(`File not found: ${href}`);
    return;
  }

  // Relative path — try resolving from active file's directory first
  if (activeFileDir) {
    // Normalize ../ traversals
    const resolved = normalizePath(`${activeFileDir}/${href}`);
    if (await tryOpenFile(resolved, openTab)) return;
  }

  // Fall back to workspace roots
  if (await resolveRelativeAndOpen(href, workspaceRoots, openTab)) return;

  // Unresolved internal link — offer create-on-click when wired (ADR 0007),
  // otherwise fall back to the legacy error toast.
  const createTarget = resolveCreateTarget(href, activeFileDir);
  if (onUnresolved && createTarget) {
    onUnresolved(createTarget, href);
    return;
  }

  toast.error(`Could not resolve link: ${href}`);
}

/** Normalize a path by resolving . and .. segments. */
function normalizePath(path: string): string {
  const parts = path.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return (path.startsWith('/') ? '/' : '') + resolved.join('/');
}

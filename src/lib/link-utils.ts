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
 * Handle clicking a link: open external URLs in browser, internal file links as tabs.
 * `activeFileDir` is the directory of the currently active file (for resolving relative paths).
 */
export async function handleLinkNavigation(
  href: string,
  openTab: OpenTabFn,
  workspaceRoots: string[],
  activeFileDir?: string,
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

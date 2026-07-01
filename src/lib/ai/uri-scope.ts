/**
 * URI-level scope filter for Copilot LSP document sync and context requests
 * (Track 1 isolation — task #16).
 *
 * Narrower and more restrictive than the ACP tool-call path filter in
 * `path-filter.ts`: an LSP does NOT need system paths, agent config dirs,
 * or temp dirs. Only real user content (selected projects + notes root) may
 * be synced to the LSP. Anything else is out-of-scope and must NOT produce
 * LSP traffic.
 *
 * Scope semantics match task #8 (direct-API tool-executor):
 *   - Empty `selectedProjectPaths` does NOT silently allow everything.
 *     Only reads under the notes root remain allowed.
 *   - A path that equals a scoped root OR sits under it (via `/`) is allowed.
 *   - No system / home-dir carve-outs — LSPs have no legitimate need for them.
 */

export interface UriScope {
  /** Projects the command bar is currently scoped to. */
  projectRoots: string[];
  /**
   * Absolute path to the user's notes library (`~/Notesage` resolved). When
   * `null`, we treat the notes root as unavailable — it contributes nothing
   * to scope.
   */
  notesRootPath: string | null;
}

function normalize(p: string): string {
  if (!p) return p;
  return p.endsWith('/') ? p.slice(0, -1) : p;
}

function containedIn(pathAbs: string, rootAbs: string): boolean {
  const p = normalize(pathAbs);
  const r = normalize(rootAbs);
  if (!r) return false;
  return p === r || p.startsWith(r + '/');
}

/**
 * Accepts either a bare absolute path (e.g. `/project/foo.md`) or a
 * `file://` URI, returning just the filesystem path portion.
 *
 * Any other scheme (http, https, untitled, etc.) returns `null` — such
 * URIs are categorically out-of-scope because they can't be mapped to a
 * local filesystem path, and the LSP should not be told about them.
 */
export function fileUriToPath(uri: string): string | null {
  if (!uri) return null;
  if (uri.startsWith('file://')) {
    // Strip the scheme; keep the leading slash of the absolute path.
    return uri.slice('file://'.length);
  }
  if (uri.startsWith('/')) return uri;
  return null;
}

/**
 * True iff the given URI/path is within the declared scope. Out-of-scope
 * URIs must be suppressed at the caller (no LSP IPC, no context payload).
 */
export function isUriInScope(uri: string, scope: UriScope): boolean {
  const filePath = fileUriToPath(uri);
  if (!filePath) return false;

  for (const root of scope.projectRoots) {
    if (root && containedIn(filePath, root)) return true;
  }

  if (scope.notesRootPath && containedIn(filePath, scope.notesRootPath)) {
    return true;
  }

  return false;
}

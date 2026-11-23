/**
 * Tool call path filtering for delegation sandbox enforcement.
 *
 * Prevents agents from accessing files outside their assigned project root
 * by parsing tool call inputs and checking extracted paths against an allowlist.
 *
 * Threat model: prevent accidental leakage from a well-behaved agent.
 * Not defending against prompt injection or deliberate circumvention.
 *
 * That said, for the direct-API and Copilot tools (`tool-executor.ts`) this
 * check is the ONLY boundary — those run in the unsandboxed main process — so
 * it must at least not be defeated by spelling: every path is resolved
 * lexically (`.`/`..` collapsed) before it is compared, and anything that is
 * not an absolute path is refused by `isPathAllowed`. It is still a string
 * check: it does not follow symlinks, and nothing on the Rust side enforces
 * the same roots.
 */

// Fields that commonly contain file paths in structured ACP tool inputs
const PATH_FIELDS = ['file_path', 'path', 'directory', 'cwd', 'paths', 'destination', 'source'];

// Regex for absolute paths in shell commands — matches /foo/bar style paths,
// and ~/foo/bar, which the shell turns into one.
// Handles both quoted and unquoted paths
const ABSOLUTE_PATH_RE = /(?:^|[\s='"(])(~?\/([\w.@~-]+\/)+[\w.@~-]*)/g;

// System paths that agents always need access to
const SYSTEM_PREFIXES = [
  '/tmp',
  '/private/tmp',
  '/private/var',
  '/dev',
  '/usr',
  '/bin',
  '/sbin',
  '/opt',
  '/etc',
  '/private/etc',
  '/System',
  '/Library',
  '/Applications',
  '/var',
];

// Home-relative dirs that agents need for their own config/tooling
const SAFE_HOME_DIRS = [
  '.claude',
  '.codex',
  '.copilot',
  '.gemini',
  '.notesage',
  // NOT all of `.config`: it holds other tools' credentials
  // (`.config/gh/hosts.yml`, `.config/github-copilot`, `.config/gcloud`).
  // Only the one agent that keeps its own state there, mirroring the
  // per-agent grant in `src-tauri/src/commands/sandbox.rs`.
  '.config/goose',
  '.npm',
  '.nvm',
  '.volta',
  '.fnm',
  '.local',
  '.cargo',
  '.rustup',
  '.bun',
  '.deno',
  '.pnpm',
];

/**
 * Resolve an absolute path lexically: collapse `.`, `..` and repeated
 * slashes, drop a trailing slash. Returns `null` for anything that is not an
 * absolute path (relative, `~`-prefixed, empty, containing NUL) and for a
 * path whose `..` climbs above `/`.
 *
 * Every comparison in this module goes through here, so that
 * `/tmp/../Users/x/.ssh/id_rsa` is judged as the `/Users/x/.ssh/id_rsa` the
 * filesystem will open, not as something under `/tmp`.
 */
export function normalizeAbsolutePath(path: string): string | null {
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0')) return null;
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return '/' + out.join('/');
}

/** `path` is `dir` or lies beneath it. Both already normalised. */
function isInside(path: string, dir: string): boolean {
  if (dir === '/') return true;
  return path === dir || path.startsWith(dir + '/');
}

/** A relative path whose `..` segments climb out of wherever it starts. */
function relativePathEscapes(path: string): boolean {
  let depth = 0;
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      depth -= 1;
      if (depth < 0) return true;
    } else {
      depth += 1;
    }
  }
  return false;
}

/**
 * Parse structured tool input (JSON) and extract file path values.
 *
 * Returns every non-empty string in a path field, relative ones included:
 * skipping them here meant a relative path was never checked at all.
 */
export function extractPathsFromStructuredInput(rawInput: string): string[] {
  if (!rawInput) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawInput);
  } catch {
    // Expected: rawInput may not be JSON (e.g., plain command string)
    return [];
  }

  if (typeof parsed !== 'object' || parsed === null) return [];

  const paths: string[] = [];
  const obj = parsed as Record<string, unknown>;

  for (const field of PATH_FIELDS) {
    const val = obj[field];
    if (typeof val === 'string' && val.length > 0) {
      paths.push(val);
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string' && item.length > 0) {
          paths.push(item);
        }
      }
    }
  }

  return paths;
}

/**
 * Scan a shell command string for absolute paths.
 *
 * This is best-effort — catches direct path references like `ls "/other-project"`
 * and `cat ~/.ssh/id_rsa`, but misses dynamic construction (`$(echo /path)`)
 * and relative traversal (`cd ..`).
 * Acceptable for the "well-behaved agent" threat model.
 */
export function extractAbsolutePathsFromCommand(command: string): string[] {
  // Defensive: this gates filesystem access, and callers parse `command` out
  // of untrusted tool-call JSON. A non-string slipping through would throw on
  // `.matchAll` below (audit types A2) — treat it as "no paths found".
  if (!command || typeof command !== 'string') return [];

  const paths: string[] = [];
  const seen = new Set<string>();

  for (const match of command.matchAll(ABSOLUTE_PATH_RE)) {
    const p = match[1];
    if (!seen.has(p)) {
      seen.add(p);
      paths.push(p);
    }
  }

  return paths;
}

/**
 * Check whether a single path is allowed given one or more project roots.
 *
 * Allowed iff the path lies inside ANY configured root, OR matches a
 * system prefix, OR matches a safe ~/ subdir. Empty `projectRoots`
 * means no project scope — only system + safe-home paths are allowed.
 *
 * `filePath` must be absolute. A relative or `~` path is refused outright:
 * the backend resolves a relative path against the process working
 * directory (`/` for a Finder-launched app), so it has no project to be
 * inside. The path is normalised first, and compared at a path boundary.
 */
export function isPathAllowed(
  filePath: string,
  projectRoots: string | string[],
  homeDir: string,
): boolean {
  const normalized = normalizeAbsolutePath(filePath);
  if (normalized === null) return false;
  const roots = typeof projectRoots === 'string' ? [projectRoots] : projectRoots;

  for (const root of roots) {
    const normalizedRoot = normalizeAbsolutePath(root);
    if (normalizedRoot !== null && isInside(normalized, normalizedRoot)) {
      return true;
    }
  }

  if (SYSTEM_PREFIXES.some((prefix) => isInside(normalized, prefix))) {
    return true;
  }

  const normalizedHome = normalizeAbsolutePath(homeDir);
  // A home of `/` (or none) would turn the safe dirs into `/.claude` etc.
  if (normalizedHome !== null && normalizedHome !== '/') {
    if (SAFE_HOME_DIRS.some((dir) => isInside(normalized, normalizedHome + '/' + dir))) {
      return true;
    }
  }

  return false;
}

/**
 * Judge one path as it appeared in an AGENT's tool call, where — unlike in
 * `isPathAllowed` — a path need not be absolute: the agent has a shell and a
 * working directory of its own.
 *
 *  - absolute: `isPathAllowed`.
 *  - `~` / `~/x`: expanded against `homeDir`, then `isPathAllowed`.
 *    `~user/x` is refused.
 *  - relative: resolves inside the agent's working directory, which is a
 *    project root, unless its `..` segments climb out — then it is refused.
 */
function isToolPathAllowed(
  path: string,
  projectRoots: string | string[],
  homeDir: string,
): boolean {
  if (path.startsWith('/')) return isPathAllowed(path, projectRoots, homeDir);
  if (path === '~' || path.startsWith('~/')) {
    const home = normalizeAbsolutePath(homeDir);
    if (home === null) return false;
    return isPathAllowed(home + path.slice(1), projectRoots, homeDir);
  }
  if (path.startsWith('~')) return false;
  return !relativePathEscapes(path);
}

// Tool kinds that only read (no extraction needed for terminal commands)
const STRUCTURED_TOOLS = [
  'read', 'read_file', 'write', 'write_file', 'edit', 'edit_file',
  'glob', 'list', 'grep', 'search', 'fetch', 'web_search',
  'create', 'delete', 'move', 'rename', 'copy',
];

// Tools that run shell commands — need command string scanning
const TERMINAL_TOOLS = ['bash', 'terminal', 'shell', 'command', 'execute'];

export interface ToolCallFilterResult {
  allowed: boolean;
  deniedPath?: string;
}

/**
 * Check whether a tool call should be allowed based on path analysis.
 *
 * `projectRoots` may be a single string (legacy single-project chats and
 * delegation/inline paths) or an array (multi-select chats). A path is
 * allowed iff it lies inside ANY configured root.
 *
 * Returns { allowed: true } if the call is safe, or
 * { allowed: false, deniedPath } if a path outside the project was found.
 */
export function isToolCallAllowed(
  toolKind: string,
  rawInput: string,
  projectRoots: string | string[],
  homeDir: string,
): ToolCallFilterResult {
  const kind = toolKind.toLowerCase();

  // Extract paths based on tool type
  let paths: string[] = [];

  if (TERMINAL_TOOLS.includes(kind)) {
    // For terminal tools, try structured first (some send JSON with a command field),
    // then scan the raw string for absolute paths
    let command = rawInput;
    try {
      const parsed = JSON.parse(rawInput);
      if (typeof parsed === 'object' && parsed !== null) {
        // Only trust a STRING `command` field. `as string ?? rawInput` would
        // assert a non-string (number, object, array) as a string and hand it
        // to extractAbsolutePathsFromCommand, which then crashes on
        // `.matchAll` — an unchecked shape assertion feeding a security gate
        // (audit types A2). A non-string command falls back to the raw input.
        const cmd = (parsed as Record<string, unknown>).command;
        command = typeof cmd === 'string' ? cmd : rawInput;
      }
    } catch {
      // Expected: rawInput is the command string itself, not JSON
    }
    paths = extractAbsolutePathsFromCommand(command);
  } else if (STRUCTURED_TOOLS.includes(kind)) {
    paths = extractPathsFromStructuredInput(rawInput);
  } else {
    // Unknown tool kind — try structured extraction as best effort
    paths = extractPathsFromStructuredInput(rawInput);
  }

  // If no paths extracted, allow (e.g., `git status` with no absolute paths)
  if (paths.length === 0) {
    return { allowed: true };
  }

  // Check each extracted path
  for (const p of paths) {
    if (!isToolPathAllowed(p, projectRoots, homeDir)) {
      return { allowed: false, deniedPath: p };
    }
  }

  return { allowed: true };
}

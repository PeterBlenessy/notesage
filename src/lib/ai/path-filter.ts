/**
 * Tool call path filtering for delegation sandbox enforcement.
 *
 * Prevents agents from accessing files outside their assigned project root
 * by parsing tool call inputs and checking extracted paths against an allowlist.
 *
 * Threat model: prevent accidental leakage from a well-behaved agent.
 * Not defending against prompt injection or deliberate circumvention.
 */

// Fields that commonly contain file paths in structured ACP tool inputs
const PATH_FIELDS = ['file_path', 'path', 'directory', 'cwd', 'paths', 'destination', 'source'];

// Regex for absolute paths in shell commands — matches /foo/bar style paths
// Handles both quoted and unquoted paths
const ABSOLUTE_PATH_RE = /(?:^|[\s='"(])(\/([\w.@~-]+\/)+[\w.@~-]*)/g;

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
  '.config',
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
 * Parse structured tool input (JSON) and extract file path values.
 */
export function extractPathsFromStructuredInput(rawInput: string): string[] {
  if (!rawInput) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawInput);
  } catch {
    return [];
  }

  if (typeof parsed !== 'object' || parsed === null) return [];

  const paths: string[] = [];
  const obj = parsed as Record<string, unknown>;

  for (const field of PATH_FIELDS) {
    const val = obj[field];
    if (typeof val === 'string' && val.startsWith('/')) {
      paths.push(val);
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string' && item.startsWith('/')) {
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
 * but misses dynamic construction (`$(echo /path)`) and relative traversal (`cd ..`).
 * Acceptable for the "well-behaved agent" threat model.
 */
export function extractAbsolutePathsFromCommand(command: string): string[] {
  if (!command) return [];

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
 * Check whether a single path is allowed given a project root.
 */
export function isPathAllowed(
  filePath: string,
  projectRoot: string,
  homeDir: string,
): boolean {
  // Normalize trailing slashes for consistent comparison
  const normalized = filePath.endsWith('/') ? filePath.slice(0, -1) : filePath;
  const normalizedRoot = projectRoot.endsWith('/') ? projectRoot.slice(0, -1) : projectRoot;

  // Within project root — always allowed
  if (normalized === normalizedRoot || normalized.startsWith(normalizedRoot + '/')) {
    return true;
  }

  // System paths — always allowed
  if (SYSTEM_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(prefix + '/'))) {
    return true;
  }

  // Agent config/tooling dirs in home — always allowed
  const normalizedHome = homeDir.endsWith('/') ? homeDir.slice(0, -1) : homeDir;
  if (SAFE_HOME_DIRS.some((dir) => {
    const full = normalizedHome + '/' + dir;
    return normalized === full || normalized.startsWith(full + '/');
  })) {
    return true;
  }

  // Everything else — denied
  return false;
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
 * Returns { allowed: true } if the call is safe, or
 * { allowed: false, deniedPath } if a path outside the project was found.
 */
export function isToolCallAllowed(
  toolKind: string,
  rawInput: string,
  projectRoot: string,
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
        command = (parsed as Record<string, unknown>).command as string ?? rawInput;
      }
    } catch {
      // rawInput is the command string itself
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
    if (!isPathAllowed(p, projectRoot, homeDir)) {
      return { allowed: false, deniedPath: p };
    }
  }

  return { allowed: true };
}

import type { ProjectMetadata } from '@/stores/project-metadata-store';
import type { FileEntry } from '@/lib/tauri';
import { isUriInScope, type UriScope } from '@/lib/ai/uri-scope';

/**
 * Build a context string from discovered goal files.
 */
export function buildGoalsContext(goalFiles: { name: string; content: string }[]): string {
  if (goalFiles.length === 0) return '';

  const sections = goalFiles
    .map((g) => `### ${g.name}\n${g.content}`)
    .join('\n\n');

  return `## Project Goals\n\nThe following goal files exist in this project:\n\n${sections}`;
}

/**
 * Build a context block for a single project (name, description, custom context).
 */
export function buildProjectHeader(metadata: ProjectMetadata, rootPath?: string): string {
  const lines: string[] = [];
  if (metadata.name) lines.push(`Project: ${metadata.name}`);
  if (rootPath) lines.push(`Project root: ${rootPath}`);
  if (metadata.description) lines.push(`Description: ${metadata.description}`);
  if (metadata.ai.projectContext) lines.push(`Project context: ${metadata.ai.projectContext}`);
  return lines.join('\n');
}

/** Directories to skip when building file tree context for AI. */
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.svelte-kit',
  'dist', 'build', 'out', '.output', 'target',
  '.cache', '.turbo', '.parcel-cache',
  '__pycache__', '.venv', 'venv',
  '.notesage',
]);

/**
 * Caps for file-tree injection into AI system prompts (task #27).
 *
 * Bumped from the previous 100/3 defaults — we want the model to have a
 * reasonable view of the project, but we must NEVER allow a 5k-file workspace
 * to blow up the system message (token cost, attention budget, leak surface).
 *
 * `FILE_TREE_MAX_FILES` caps the total number of entries (files + dirs)
 * emitted. `FILE_TREE_MAX_LEVELS` is the number of directory levels the walk
 * descends into (top-level entries = level 1). Internally the walker uses a
 * 0-indexed `depth` that stops when `depth >= FILE_TREE_MAX_LEVELS`.
 *
 * Hard-coded for now; can be surfaced in settings-store later if users want
 * to tune them.
 */
export const FILE_TREE_MAX_FILES = 200;
export const FILE_TREE_MAX_LEVELS = 4;

export interface BuildFileTreeOptions {
  /** Max entries (files + directories) to include before truncating. */
  maxFiles?: number;
  /**
   * Max number of directory levels to descend into. Top-level entries count
   * as level 1.
   */
  maxLevels?: number;
  /**
   * Optional scope filter. When provided, entries whose `path` is not in
   * scope are dropped from the output — defense-in-depth for task #27 so
   * that a tree accidentally containing out-of-scope entries (e.g. via a
   * symlink or misuse) cannot leak filenames into the system prompt.
   */
  scope?: UriScope;
}

/**
 * Build a compact text representation of a file tree for AI context.
 * Limits depth and total file count to avoid bloating the system message.
 *
 * When `scope` is provided, each entry's path is checked against
 * `isUriInScope`; out-of-scope entries are dropped. This is intentionally
 * redundant with the call-site filter (single-project lookup in the
 * workspace store) — the redundancy is the point: a future refactor that
 * accidentally wires in a broader tree will still be caught here.
 */
export function buildFileTreeContext(
  tree: FileEntry[],
  rootPath: string,
  options: BuildFileTreeOptions = {},
): string {
  const maxLevels = options.maxLevels ?? FILE_TREE_MAX_LEVELS;
  const maxFiles = options.maxFiles ?? FILE_TREE_MAX_FILES;
  const scope = options.scope;

  const lines: string[] = [];
  let fileCount = 0;

  function walk(entries: FileEntry[], depth: number, prefix: string) {
    if (depth >= maxLevels || fileCount >= maxFiles) return;
    for (const entry of entries) {
      if (fileCount >= maxFiles) {
        lines.push(`${prefix}... (truncated)`);
        return;
      }
      if (entry.is_directory && IGNORED_DIRS.has(entry.name)) continue;
      if (scope && entry.path && !isUriInScope(entry.path, scope)) continue;

      const icon = entry.is_directory ? '/' : '';
      lines.push(`${prefix}${entry.name}${icon}`);
      fileCount++;
      if (entry.is_directory && entry.children) {
        walk(entry.children, depth + 1, prefix + '  ');
      }
    }
  }

  walk(tree, 0, '  ');

  if (lines.length === 0) return '';

  const rootName = rootPath.split('/').pop() || rootPath;
  return `## Project Files\n\n${rootName}/\n${lines.join('\n')}`;
}

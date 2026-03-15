import type { ProjectMetadata } from '@/stores/project-metadata-store';
import type { FileEntry } from '@/lib/tauri';

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
 * Build a compact text representation of a file tree for AI context.
 * Limits depth and total file count to avoid bloating the system message.
 */
export function buildFileTreeContext(tree: FileEntry[], rootPath: string, maxDepth = 3, maxFiles = 100): string {
  const lines: string[] = [];
  let fileCount = 0;

  function walk(entries: FileEntry[], depth: number, prefix: string) {
    if (depth > maxDepth || fileCount >= maxFiles) return;
    for (const entry of entries) {
      if (fileCount >= maxFiles) {
        lines.push(`${prefix}... (truncated)`);
        return;
      }
      if (entry.is_directory && IGNORED_DIRS.has(entry.name)) continue;
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

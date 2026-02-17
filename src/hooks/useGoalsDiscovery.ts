import { useState, useEffect, useCallback, useRef } from 'react';
import { tauriApi, FileEntry } from '@/lib/tauri';
import { parseFrontmatter } from '@/lib/frontmatter';

export interface GoalFile {
  path: string;
  name: string;
  content: string;
}

/**
 * Collect all .md file paths from root level and first-level subdirectories only.
 * Does not recurse deeper than one level for performance.
 */
function collectMdPaths(entries: FileEntry[]): string[] {
  const paths: string[] = [];

  for (const entry of entries) {
    if (!entry.is_directory && entry.name.endsWith('.md')) {
      paths.push(entry.path);
    } else if (entry.is_directory && entry.children) {
      // Only go one level deep — collect .md files from immediate children
      for (const child of entry.children) {
        if (!child.is_directory && child.name.endsWith('.md')) {
          paths.push(child.path);
        }
      }
    }
  }

  return paths;
}

/**
 * Discover goal files within a project by scanning .md files for
 * frontmatter with `type: 'goal'`.
 *
 * Scans root-level and first-level subdirectory .md files only (no deep recursion).
 * Results are cached and only refreshed on explicit `refresh()` calls or
 * when `projectPath` changes.
 */
export function useGoalsDiscovery(projectPath: string | null): {
  goalFiles: GoalFile[];
  isLoading: boolean;
  refresh: () => void;
} {
  const [goalFiles, setGoalFiles] = useState<GoalFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Cache: store the last scanned project path and its results
  const cacheRef = useRef<{ path: string; goals: GoalFile[] } | null>(null);

  // Debounce timer ref
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track whether the component is still mounted
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const scan = useCallback(async (path: string) => {
    setIsLoading(true);

    try {
      const entries = await tauriApi.listDirectory(path);
      const mdPaths = collectMdPaths(entries);

      const goals: GoalFile[] = [];

      for (const filePath of mdPaths) {
        try {
          const content = await tauriApi.readFile(filePath);
          const { frontmatter } = parseFrontmatter(content);

          if (frontmatter && frontmatter.type === 'goal') {
            const name = filePath.split('/').pop() || filePath;
            goals.push({ path: filePath, name, content });
          }
        } catch (error) {
          // Skip files that can't be read (permissions, encoding, etc.)
          console.warn(`Failed to read file ${filePath}:`, error);
        }
      }

      if (!mountedRef.current) return;

      cacheRef.current = { path, goals };
      setGoalFiles(goals);
    } catch (error) {
      console.error(`Failed to scan for goal files in ${path}:`, error);
      if (!mountedRef.current) return;
      setGoalFiles([]);
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // Scan when projectPath changes
  useEffect(() => {
    if (!projectPath) {
      setGoalFiles([]);
      setIsLoading(false);
      cacheRef.current = null;
      return;
    }

    // If we have cached results for this path, use them
    if (cacheRef.current && cacheRef.current.path === projectPath) {
      setGoalFiles(cacheRef.current.goals);
      return;
    }

    scan(projectPath);
  }, [projectPath, scan]);

  const refresh = useCallback(() => {
    if (!projectPath) return;

    // Debounce rapid refresh calls (300ms)
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      scan(projectPath);
    }, 300);
  }, [projectPath, scan]);

  return { goalFiles, isLoading, refresh };
}

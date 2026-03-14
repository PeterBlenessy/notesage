import { useState, useEffect, useCallback, useRef } from 'react';
import { tauriApi } from '@/lib/tauri';

export interface GoalFile {
  path: string;
  name: string;
  content: string;
}

/**
 * Discover goal files within a project using the SQLite document index.
 *
 * Uses `index_goals` to instantly find which files have `type: goal` frontmatter
 * (AST-parsed, no false positives), then reads only those files for their full
 * content (needed for AI context injection).
 */
export function useGoalsDiscovery(projectPath: string | null): {
  goalFiles: GoalFile[];
  isLoading: boolean;
  refresh: () => void;
} {
  const [goalFiles, setGoalFiles] = useState<GoalFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const cacheRef = useRef<{ path: string; goals: GoalFile[] } | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  const scan = useCallback(async (path: string) => {
    setIsLoading(true);
    try {
      // Use index to find goal files instantly (no filesystem scan)
      const indexed = await tauriApi.indexGoals([path]);

      // Read full content only for the goal files (needed for AI context)
      const goals: GoalFile[] = [];
      for (const goal of indexed) {
        try {
          const content = await tauriApi.readFile(goal.path);
          const name = goal.path.split('/').pop() || goal.path;
          goals.push({ path: goal.path, name, content });
        } catch {
          // Skip files that can't be read
        }
      }

      if (!mountedRef.current) return;
      cacheRef.current = { path, goals };
      setGoalFiles(goals);
    } catch (error) {
      console.error(`Failed to discover goals in ${path}:`, error);
      if (!mountedRef.current) return;
      setGoalFiles([]);
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!projectPath) {
      setGoalFiles([]);
      setIsLoading(false);
      cacheRef.current = null;
      return;
    }
    if (cacheRef.current && cacheRef.current.path === projectPath) {
      setGoalFiles(cacheRef.current.goals);
      return;
    }
    scan(projectPath);
  }, [projectPath, scan]);

  const refresh = useCallback(() => {
    if (!projectPath) return;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      scan(projectPath);
    }, 300);
  }, [projectPath, scan]);

  return { goalFiles, isLoading, refresh };
}

/**
 * Pre-warm the in-memory parsed-doc cache during app startup.
 *
 * Reads the top-5 recent .md files plus all pinned .md files, parses each
 * in the markdown Web Worker, and stores the result in `parsedDocCache`.
 * Runs in the background after startup — never blocks `startupReady`.
 *
 * Concurrency is bounded to MAX_CONCURRENT_WORKERS so we don't flood the
 * parser thread with a burst of messages at startup.
 */

import { parsedDocCache } from "@/lib/parsed-doc-cache";
import { parseInWorker } from "@/lib/markdown-worker";
import { tauriApi } from "@/lib/tauri";
import { parseFrontmatter } from "@/lib/frontmatter";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { log, PERF } from "@/lib/logger";

const MAX_CONCURRENT_WORKERS = 2;
const MAX_RECENT_FILES = 5;

/**
 * Returns the set of files that should be pre-warmed: up to
 * `MAX_RECENT_FILES` recent `.md` files followed by all pinned `.md` files,
 * deduplicated while preserving the recents-first order.
 */
export function getPrewarmCandidates(): string[] {
  const { recentFiles = [] } = useEditorStore.getState();
  const { pinnedFiles = [] } = useWorkspaceStore.getState();

  const recent = recentFiles
    .filter((f) => f.path.endsWith(".md"))
    .slice(0, MAX_RECENT_FILES)
    .map((f) => f.path);

  const pinned = pinnedFiles.filter((p) => p.endsWith(".md"));

  const seen = new Set<string>(recent);
  const candidates = [...recent];
  for (const p of pinned) {
    if (!seen.has(p)) {
      seen.add(p);
      candidates.push(p);
    }
  }
  return candidates;
}

/**
 * Derive the project root for a given file path by checking which open
 * project path is an ancestor of the file, mirroring the pattern used in
 * `useActiveProject.ts`.
 */
function getProjectRoot(filePath: string): string | undefined {
  const { projects } = useWorkspaceStore.getState();
  return projects.find((p) => filePath.startsWith(p.path + "/"))?.path;
}

/**
 * Pre-warm `parsedDocCache` for the given list of file paths.
 *
 * - Skips files already in the cache.
 * - Per-file errors (missing file, worker crash) are swallowed so a single
 *   bad file doesn't abort the whole batch.
 * - Max `MAX_CONCURRENT_WORKERS` parses run in parallel at any time.
 */
export async function prewarmParseCache(filePaths: string[]): Promise<void> {
  if (filePaths.length === 0) return;

  const startMs = Date.now();
  log.debug(PERF.prewarm, "started", { count: filePaths.length });

  const pending = filePaths.filter((p) => !parsedDocCache.has(p));
  let successCount = 0;

  // Bounded concurrency via a semaphore-style pool
  const queue = [...pending];
  const workers: Array<Promise<void>> = [];

  async function processNext(): Promise<void> {
    while (queue.length > 0) {
      const filePath = queue.shift()!;
      try {
        const raw = await tauriApi.readFile(filePath);
        const { content: markdown } = parseFrontmatter(raw);
        const projectRoot = getProjectRoot(filePath);
        const result = await parseInWorker(markdown, projectRoot);
        parsedDocCache.set(filePath, result);
        successCount++;
        log.debug(PERF.prewarm, "file cached", { filePath });
      } catch {
        log.debug(PERF.prewarm, "file skipped", { filePath });
      }
    }
  }

  for (let i = 0; i < Math.min(MAX_CONCURRENT_WORKERS, pending.length); i++) {
    workers.push(processNext());
  }

  await Promise.all(workers);

  log.debug(PERF.prewarm, "complete", {
    count: successCount,
    elapsedMs: Date.now() - startMs,
  });
}

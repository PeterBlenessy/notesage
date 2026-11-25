import { toast } from "sonner";
import { tauriApi } from "@/lib/tauri";
import { log } from "@/lib/logger";
import { t } from "@/lib/i18n";
import { useIndexProgressStore } from "@/stores/index-progress-store";

/**
 * Who has initialised which project's index this launch.
 *
 * Two callers initialise project indexes: the startup pass
 * (`runStartupIndexPass`) for the projects known at launch, and
 * `useProjectIndexSync` for a project that joins the workspace later. Both go
 * through {@link ensureProjectIndex}, so a project is never indexed by two
 * passes at once, whichever of them gets to it first.
 */

/** Project path → the `index_init` that is running for it. */
const inFlight = new Map<string, Promise<void>>();
/** Projects whose `index_init` has succeeded this launch. */
const settled = new Set<string>();

/**
 * Initialize the index for a scope, with auto-recovery on failure.
 * If init fails (corrupted DB), deletes the DB files and retries once.
 * Shows a toast during recovery so the user knows tags/mentions may be
 * temporarily unavailable.
 *
 * Never rejects. Resolves to whether the scope ended up indexed.
 */
export async function initIndexWithRecovery(projectPath?: string): Promise<boolean> {
  // Bracket the whole attempt, recovery included, for the indexing indicator:
  // a pass that fails emits no `index-ready`, but this function always returns.
  const progress = useIndexProgressStore.getState();
  progress.begin(projectPath ?? null);
  try {
    return await initIndexOrRecover(projectPath);
  } finally {
    progress.settle(projectPath ?? null);
  }
}

async function initIndexOrRecover(projectPath?: string): Promise<boolean> {
  try {
    await tauriApi.indexInit(projectPath);
    return true;
  } catch (firstError) {
    const scope = projectPath ?? "global";
    log.warn("lifecycle", `Index init failed for ${scope}, attempting recovery`, firstError);

    // Delete corrupted DB and retry
    toast.info(t("toast.rebuildingIndex"), {
      id: `index-recovery-${scope}`,
    });
    try {
      await tauriApi.indexReset(projectPath);
      await tauriApi.indexInit(projectPath);
      toast.dismiss(`index-recovery-${scope}`);
      return true;
    } catch (retryError) {
      log.error("lifecycle", `Index recovery failed for ${scope}`, retryError);
      toast.error(
        "An unexpected error occurred while rebuilding the search index. " +
        "Tag and mention suggestions will be unavailable until the app is restarted. " +
        "If this persists, please share the app logs and report the issue on GitHub.",
        { id: `index-recovery-${scope}`, duration: 15000 },
      );
      return false;
    }
  }
}

/**
 * Initialise a project's index unless that already happened this launch or is
 * happening right now (the returned promise is then the running one).
 *
 * Never rejects. A project whose init failed, recovery included, is not
 * remembered, so asking again (the project is removed and added back) retries.
 */
export function ensureProjectIndex(projectPath: string): Promise<void> {
  if (settled.has(projectPath)) return Promise.resolve();
  const running = inFlight.get(projectPath);
  if (running) return running;

  const run = initIndexWithRecovery(projectPath)
    .then((ok) => {
      if (ok) settled.add(projectPath);
    })
    .finally(() => {
      inFlight.delete(projectPath);
    });
  inFlight.set(projectPath, run);
  return run;
}

/**
 * A project left the workspace: index it afresh if it comes back. (Files may
 * have changed while nothing was watching it.) An init that is still running
 * is left to finish.
 */
export function forgetProjectIndex(projectPath: string): void {
  settled.delete(projectPath);
}

/**
 * A new startup pass begins: nothing counts as indexed yet. Inits that are
 * still running are kept, so they cannot be doubled.
 */
export function beginStartupIndexPass(): void {
  settled.clear();
}

/** Test-only: drop all bookkeeping, running inits included. */
export function resetProjectIndexSyncForTests(): void {
  settled.clear();
  inFlight.clear();
}

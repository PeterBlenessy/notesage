import { tauriApi, type ICloudDownloadState } from "@/lib/tauri";

/**
 * Bringing the library down before moving it.
 *
 * The migration's one path to real data loss is an eviction that happens
 * between the guard and the rename: iCloud takes the bytes back, leaves a
 * `.name.icloud` stub, the stub moves into a container that does not own its
 * content, and the owner is then free to purge it. The per-entry guard in
 * `sync.rs` narrows that window; it cannot close it, because there is always
 * some window between checking and moving.
 *
 * So the window is removed instead: nothing is evicted when the run starts.
 * Both roots are walked for placeholders, each one is asked for, and the
 * migration REFUSES to begin while any remain. The guard stays as the backstop
 * for anything evicted mid-run.
 *
 * Design: `docs/design/migration-safety.md`.
 */

/** One file that has not come down, and what is known about why. */
export interface PendingDownload {
  path: string;
  /** The last state iCloud reported, or the error it reported instead. */
  reason: string;
}

export interface MaterialiseReport {
  /** How many placeholders the walk found. Zero is the ordinary case. */
  requested: number;
  /** How many are now on disk. */
  arrived: number;
  /** What is still missing. A migration may start only when this is empty. */
  pending: PendingDownload[];
  /** True when the caller stopped it, so a report of pending files is not a
   *  verdict about iCloud. */
  cancelled: boolean;
}

export interface MaterialiseDeps {
  listPlaceholders: (root: string) => Promise<string[]>;
  ensureDownloaded: (path: string) => Promise<ICloudDownloadState>;
  exists: (path: string) => Promise<boolean>;
  wait: (ms: number) => Promise<void>;
  /** Called after every sweep, so a modal can show something moving. */
  onProgress?: (arrived: number, total: number) => void;
  /** Checked between sweeps. A download already asked for keeps going in
   *  iCloud's own time; what stops is the waiting. */
  isCancelled?: () => boolean;
  /** How long between sweeps. */
  pollMs?: number;
  /**
   * How many sweeps to make before giving up. Absent means wait indefinitely
   * and rely on the caller's cancel — which is the right default for a person
   * watching a progress bar, and the wrong one for a test.
   */
  maxSweeps?: number;
}

/**
 * Ask for everything undownloaded in both roots, and wait for it.
 *
 * The downloads are ALL requested first and then waited on together. iCloud
 * fetches in parallel; asking for one file, waiting for it, then asking for
 * the next would serialise a whole library over the network for no reason —
 * on the kind of link where this matters most.
 *
 * Polling, rather than the watcher the recordings scanner uses. That scanner
 * runs in the background with nothing to report to; this runs behind a modal
 * that has to show progress and stay cancellable, and a sweep of `exists`
 * gives both. The cost is one `path_exists` per outstanding file per sweep,
 * over a set that only shrinks.
 */
export async function materialiseLibrary(
  roots: string[],
  deps: MaterialiseDeps,
): Promise<MaterialiseReport> {
  const pollMs = deps.pollMs ?? 1000;
  const cancelled = () => deps.isCancelled?.() === true;

  // The walk itself is allowed to throw. A root that cannot be read is not
  // "nothing to download" — it is the exact fault this pre-flight exists to
  // survive, and treating it as clean would hand a migration the clean bill of
  // health it must not have.
  const placeholders: string[] = [];
  for (const root of roots) {
    for (const path of await deps.listPlaceholders(root)) {
      if (!placeholders.includes(path)) placeholders.push(path);
    }
  }

  const total = placeholders.length;
  if (total === 0) return { requested: 0, arrived: 0, pending: [], cancelled: false };

  // What iCloud said when asked. Kept so a file that never arrives can say
  // whether it was refused outright or simply still on its way.
  const reasons = new Map<string, string>();
  for (const path of placeholders) {
    if (cancelled()) {
      return { requested: total, arrived: 0, pending: pendingFrom(placeholders, reasons), cancelled: true };
    }
    try {
      reasons.set(path, await deps.ensureDownloaded(path));
    } catch (err) {
      // Recorded, and then still waited for: a refused request is not proof
      // the file will not arrive — another device or a retry may bring it —
      // and the only thing that settles it is whether the file is there.
      reasons.set(path, String(err));
    }
  }

  let outstanding = [...placeholders];
  let sweeps = 0;
  for (;;) {
    const stillMissing: string[] = [];
    for (const path of outstanding) {
      if (!(await deps.exists(path).catch(() => false))) stillMissing.push(path);
    }
    outstanding = stillMissing;
    deps.onProgress?.(total - outstanding.length, total);

    if (outstanding.length === 0) {
      return { requested: total, arrived: total, pending: [], cancelled: false };
    }
    if (cancelled()) break;
    sweeps += 1;
    if (deps.maxSweeps !== undefined && sweeps >= deps.maxSweeps) break;
    await deps.wait(pollMs);
    if (cancelled()) break;
  }

  return {
    requested: total,
    arrived: total - outstanding.length,
    pending: pendingFrom(outstanding, reasons),
    cancelled: cancelled(),
  };
}

function pendingFrom(paths: string[], reasons: Map<string, string>): PendingDownload[] {
  return paths.map((path) => ({ path, reason: reasons.get(path) ?? "downloading" }));
}

/** The real wiring. Ordinary read commands — nothing here moves a byte. */
export function materialiseDeps(): Pick<
  MaterialiseDeps,
  "listPlaceholders" | "ensureDownloaded" | "exists" | "wait"
> {
  return {
    listPlaceholders: (root) => tauriApi.listEvictedPlaceholders(root),
    ensureDownloaded: (path) => tauriApi.icloudEnsureDownloaded(path),
    exists: (path) => tauriApi.pathExists(path),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

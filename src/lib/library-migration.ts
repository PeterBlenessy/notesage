import type { FileEntry } from "@/lib/tauri";

/**
 * Moving the library from `iCloud Drive/Notesage` into Notesage's own iCloud
 * container.
 *
 * Planning is separated from running for two reasons. The plan is where every
 * collision is decided, so the decisions can be read — and tested — without
 * moving a byte; and a plan re-derived over what is still there is the same
 * plan minus the completed steps, which is what makes an interrupted
 * migration resumable rather than a repair job.
 *
 * The one invariant the runner depends on: no step deletes anything before
 * its destination exists. Every step below either moves (which is atomic on
 * one volume, and copy-verify-delete across two) or writes a merged file
 * before removing the source.
 */

/** Finder leaves one in any folder somebody opened. It is never content. */
const IGNORED = new Set([".DS_Store"]);

/** Carried across devices, so it must not follow the library to a new root. */
const DROPPED_RELATIVE = new Set([".notesage/sync-settings.json"]);

export type MigrationStepKind =
  | "move"
  | "merge-inbox-item"
  | "merge-pins"
  | "merge-reading-progress"
  | "rename-conflicting-project"
  | "merge-folder"
  | "drop";

export interface MigrationStep {
  kind: MigrationStepKind;
  /** What this step moves, so the report can count it correctly. Decided at
   *  planning time, where a project is already distinguished from a folder. */
  unit?: "project" | "file" | "inboxItem";
  /** Relative to the source root. */
  from: string;
  /** Relative to the destination root; absent for `drop`. */
  to?: string;
  /** Why this step is not a plain move, for the confirmation dialog. */
  note?: string;
}

export interface MigrationPlan {
  steps: MigrationStep[];
  /** Entries that stay where they are, with the reason. For the report. */
  leftBehind: { name: string; reason: string }[];
  counts: { projects: number; inboxItems: number; looseFiles: number };
}

export interface MigrationListing {
  /** Top-level entries of the root. */
  entries: FileEntry[];
  /** Top-level entries of `Inbox/`, empty when there is none. */
  inbox: FileEntry[];
  /** Relative paths under the root that are projects (they have `.notesage/`). */
  projectDirs: Set<string>;
}

/** Append `-1`, `-2`, … before the extension — the phone's own dedupe rule,
 *  so a name colliding across devices reads the same on both. */
export function dedupeName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let n = 1; ; n += 1) {
    const candidate = `${stem}-${n}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Decide every move before making one.
 *
 * `source` is today's library, `dest` the container — which for a phone-first
 * user is NOT empty: they may have captured to the Inbox for weeks before the
 * Mac joined.
 */
export function planLibraryMigration(
  source: MigrationListing,
  dest: MigrationListing,
): MigrationPlan {
  const steps: MigrationStep[] = [];
  const leftBehind: { name: string; reason: string }[] = [];
  const counts = { projects: 0, inboxItems: 0, looseFiles: 0 };

  const destTop = new Set(dest.entries.map((e) => e.name));
  const destInbox = new Set(dest.inbox.map((e) => e.name));

  // --- Inbox, merged item by item ------------------------------------------
  for (const item of source.inbox) {
    if (IGNORED.has(item.name)) continue;
    if (item.name === ".notesage") continue; // handled below, as a unit
    const to = dedupeName(item.name, destInbox);
    destInbox.add(to);
    steps.push({
      kind: "merge-inbox-item",
      unit: "inboxItem",
      from: `Inbox/${item.name}`,
      to: `Inbox/${to}`,
      note: to === item.name ? undefined : `renamed to ${to} — the name was taken`,
    });
    counts.inboxItems += 1;
  }
  if (source.inbox.some((e) => e.name === ".notesage")) {
    // The shared reading-progress sidecar. Merged by the existing rules
    // (progress only moves forward, a tombstone wins by time) rather than
    // overwritten, because both devices have been writing to it.
    steps.push({
      kind: "merge-reading-progress",
      from: "Inbox/.notesage/reading-progress.json",
      to: "Inbox/.notesage/reading-progress.json",
      note: "read state merged, not replaced",
    });
  }

  // --- Everything at the top level -----------------------------------------
  for (const entry of source.entries) {
    if (IGNORED.has(entry.name)) continue;
    if (entry.name === "Inbox") continue; // done above

    // An evicted file: on disk only as `.name.icloud`, with the bytes in the
    // cloud. Copying the placeholder and deleting the source would delete
    // the real item from iCloud, so it stays where it is and is REPORTED —
    // the outcome that used to happen silently, because the default listing
    // hid it entirely.
    // Debris from an interrupted copy of THIS feature. Never a user's data,
    // and listing hidden entries is what made it visible in the first place.
    if (entry.name.endsWith(".notesage-migrating")) continue;

    const evicted = /^\.(.+)\.icloud$/.exec(entry.name);
    if (evicted) {
      leftBehind.push({
        name: evicted[1],
        reason: `${evicted[1]} has not been downloaded from iCloud yet — open it once, then migrate again`,
      });
      continue;
    }

    if (entry.name === ".notesage") {
      steps.push({
        kind: "merge-pins",
        from: ".notesage/pins.json",
        to: ".notesage/pins.json",
        note: "pinned files combined from both",
      });
      steps.push({
        kind: "drop",
        from: ".notesage/sync-settings.json",
        note: "per-device, not carried across",
      });
      continue;
    }

    // Any other dot entry is left where it is, and said so. Listing hidden
    // entries was to SEE evicted placeholders, not to start migrating
    // `.git`, `.editorconfig` and friends that no previous run ever touched
    // — a silent scope change is not a fix.
    if (entry.name.startsWith(".")) {
      leftBehind.push({ name: entry.name, reason: `${entry.name} is not part of the library` });
      continue;
    }

    if (!entry.is_directory) {
      const to = dedupeName(entry.name, destTop);
      destTop.add(to);
      steps.push({
        kind: "move",
        unit: "file",
        from: entry.name,
        to,
        note: to === entry.name ? undefined : `renamed to ${to} — the name was taken`,
      });
      counts.looseFiles += 1;
      continue;
    }

    const isProject = source.projectDirs.has(entry.name);
    if (!destTop.has(entry.name)) {
      steps.push({ kind: "move", unit: isProject ? "project" : "file", from: entry.name, to: entry.name });
      if (isProject) counts.projects += 1;
      else counts.looseFiles += 1;
      continue;
    }

    // Same name on both sides.
    const destIsProject = dest.projectDirs.has(entry.name);
    if (isProject && destIsProject) {
      // Two projects, two sets of metadata. Merging them would silently
      // combine settings, comments and AI locks that were never meant to
      // meet; the safe move is to keep both and say so.
      const to = dedupeName(`${entry.name} (from iCloud Drive)`, destTop);
      destTop.add(to);
      steps.push({
        kind: "rename-conflicting-project",
        unit: "project",
        from: entry.name,
        to,
        note: "a project of this name is already there — both kept",
      });
      counts.projects += 1;
      leftBehind.push({
        name: entry.name,
        reason: `kept as "${to}" — a project of the same name already existed`,
      });
      continue;
    }

    // A plain folder on one side: merge into the destination, file by file.
    //
    // NOT a `move` — the move primitive refuses a destination that exists,
    // which for this step is true by definition, so it failed every single
    // time and the merge it promised never happened. `merge-folder` is
    // executed by moving the source's CHILDREN one at a time, which is what
    // "merge" meant all along; the folder's own `.notesage/` travels with
    // them.
    steps.push({
      kind: "merge-folder",
      unit: isProject ? "project" : "file",
      from: entry.name,
      to: entry.name,
      note: "merged into the folder already there",
    });
    if (isProject) counts.projects += 1;
    else counts.looseFiles += 1;
  }

  return { steps, leftBehind, counts };
}

/** Everything a run needs, injected so the orchestrator is testable without
 *  touching a filesystem or a store. */
export interface MigrationDeps {
  moveEntry: (src: string, dst: string) => Promise<string>;
  /** Names directly inside a directory, for merging one into another. */
  listNames: (dir: string) => Promise<string[]>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  deletePath: (path: string) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  /** Merge two `reading-progress.json` bodies; the existing sidecar rules. */
  mergeReadingProgress: (mine: string | null, theirs: string | null) => string;
  /** Merge two `pins.json` bodies into the union of their paths. */
  mergePins: (mine: string | null, theirs: string | null) => string;
  onStep?: (done: number, total: number, step: MigrationStep) => void;
}

export interface MigrationReport {
  moved: { projects: number; inboxItems: number; looseFiles: number };
  merged: number;
  renamed: number;
  leftBehind: { name: string; reason: string }[];
  failed: { step: MigrationStep; error: string }[];
}

/**
 * Run a plan. Resumable by construction: a step whose source is already gone
 * is treated as done, so re-planning over what remains and running again
 * reaches the same end state without touching what already moved.
 *
 * A failing step does not abort the run. The library would otherwise be left
 * half in each place with no record of which half — far worse than finishing
 * the rest and reporting exactly what did not make it.
 */
export async function runLibraryMigration(
  plan: MigrationPlan,
  sourceRoot: string,
  destRoot: string,
  deps: MigrationDeps,
): Promise<MigrationReport> {
  const report: MigrationReport = {
    moved: { projects: 0, inboxItems: 0, looseFiles: 0 },
    merged: 0,
    renamed: 0,
    leftBehind: [...plan.leftBehind],
    failed: [],
  };

  let done = 0;
  for (const step of plan.steps) {
    const from = `${sourceRoot}/${step.from}`;
    const to = step.to ? `${destRoot}/${step.to}` : null;
    try {
      if (!(await deps.exists(from))) {
        // Already moved by an earlier run, or never there. Either way there
        // is nothing to do and nothing to report as a failure.
        done += 1;
        deps.onStep?.(done, plan.steps.length, step);
        continue;
      }
      switch (step.kind) {
        case "drop":
          await deps.deletePath(from);
          break;
        case "merge-reading-progress":
        case "merge-pins": {
          const mine = to && (await deps.exists(to)) ? await deps.readFile(to) : null;
          const theirs = await deps.readFile(from);
          const merged =
            step.kind === "merge-pins"
              ? deps.mergePins(mine, theirs)
              : deps.mergeReadingProgress(mine, theirs);
          if (to) await deps.writeFile(to, merged);
          await deps.deletePath(from);
          report.merged += 1;
          break;
        }
        case "merge-folder": {
          if (!to) break;
          // Child by child, deduping against what is already there. The
          // destination folder stays; only its contents grow.
          const [mine, theirs] = await Promise.all([
            deps.listNames(to).catch(() => []),
            deps.listNames(from),
          ]);
          const taken = new Set(mine);
          for (const name of theirs) {
            if (IGNORED.has(name)) continue; // `.DS_Store`, never data
            const target = dedupeName(name, taken);
            taken.add(target);
            await deps.moveEntry(`${from}/${name}`, `${to}/${target}`);
          }
          if (step.unit === "project") report.moved.projects += 1;
          else report.moved.looseFiles += 1;
          break;
        }
        default: {
          if (!to) break;
          await deps.moveEntry(from, to);
          if (step.kind === "rename-conflicting-project") report.renamed += 1;
          // Counted from what the step SAYS it moves. The previous version
          // had both arms of an if/else do the same thing, so every project
          // was reported as a loose file, and projects were then back-filled
          // by subtracting the total failure count — which blamed a failed
          // inbox merge on a project that had moved perfectly well.
          if (step.unit === "project") report.moved.projects += 1;
          else if (step.unit === "inboxItem") report.moved.inboxItems += 1;
          else report.moved.looseFiles += 1;
        }
      }
    } catch (err) {
      report.failed.push({ step, error: String(err) });
    }
    done += 1;
    deps.onStep?.(done, plan.steps.length, step);
  }

  return report;
}

/** Is the old root safe to remove? Only when nothing but ignorable debris
 *  remains — never a blind delete of whatever did not move. */
export function oldRootIsEmpty(entries: FileEntry[]): boolean {
  return entries.every((e) => IGNORED.has(e.name));
}

export const MIGRATION_INTERNAL = { IGNORED, DROPPED_RELATIVE };

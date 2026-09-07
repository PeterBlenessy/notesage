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

/** An iCloud file whose bytes are still in the cloud: on disk it is only
 *  `.name.icloud` beside the missing `name`. */
const EVICTED = /^\.(.+)\.icloud$/;

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
 * The names already spoken for at a destination — including the ones that are
 * only there as placeholders.
 *
 * An iCloud file the local machine has not downloaded is on disk ONLY as
 * `.name.icloud`. Reading the listing literally therefore misses it: the set
 * gets `.name.icloud`, `has("name")` is false, and a genuine collision is
 * planned as an uncontested move. `migrate_library_entry`'s own
 * `dest.exists()` check misses it for the same reason — the real name does
 * not exist yet — so the move succeeds and the container ends up holding the
 * incoming file under a name a DIFFERENT file is still waiting to
 * materialise into.
 *
 * That breaks the guarantee the whole collision design rests on: two things
 * of the same name are kept side by side, never one on top of the other. And
 * it breaks it in exactly the case this feature is FOR — a Mac joining a
 * library the phone made, whose contents have not all come down yet.
 *
 * Both forms are added: the placeholder's own name (so nothing plans a move
 * onto the stub itself) and the name it stands for.
 */
export function takenNames(names: string[]): Set<string> {
  const taken = new Set<string>();
  for (const name of names) {
    taken.add(name);
    const evicted = EVICTED.exec(name);
    if (evicted) taken.add(evicted[1]);
  }
  return taken;
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

  const destTop = takenNames(dest.entries.map((e) => e.name));
  const destInbox = takenNames(dest.inbox.map((e) => e.name));

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

    const evicted = EVICTED.exec(entry.name);
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
  /**
   * Every entry that landed under a DIFFERENT relative path than it had, as
   * `from` → `to` relative to the two roots.
   *
   * The path rewriter needs this and cannot derive it. It rebases stored
   * absolute paths from the old root to the new one, which is correct only
   * while the name is unchanged — and this migration renames on every
   * collision. Without the list, a project kept as
   * `X (from iCloud Drive)` has its workspace entry, recents and pins
   * rewritten to `<new root>/X`, which is a DIFFERENT project: the one
   * already in the container.
   *
   * Recorded by the runner rather than read off the plan because
   * `merge-folder` decides its children's names while it runs.
   */
  renames: { from: string; to: string }[];
  /**
   * EVERY relocation this run performed, as `from` → `to` relative to the two
   * roots — not only the renamed ones.
   *
   * `renames` answers "where did the path rewriter need to look?"; this
   * answers "what would it take to put everything back?". They differ exactly
   * where it matters: a `merge-folder` moves its children one at a time into
   * a folder the destination already had, and a child that did NOT collide is
   * absent from `renames`. An undo built on `renames` alone could not tell
   * which files in the merged folder came from the old root, so it would take
   * back too few — or, guessing, too many.
   */
  moves: { from: string; to: string }[];
  /**
   * Content the run destroyed at the DESTINATION, so an undo can restore it.
   *
   * The merges read the destination, write a merged result and delete the
   * source: the destination's own prior copy is gone. `drop` deletes outright.
   * These are pins, read state and per-device settings — kilobytes, whatever
   * the library's size — so they are kept rather than declared unrecoverable.
   * `content: null` means there was nothing there before.
   */
  destroyed: { path: string; content: string | null }[];
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
    renames: [],
    moves: [],
    destroyed: [],
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
          // Kept so an undo can put it back: `sync-settings.json` is
          // per-device and deliberately not carried across, but "deliberately"
          // is not the same as "unrecoverable".
          report.destroyed.push({ path: step.from, content: await deps.readFile(from).catch(() => null) });
          await deps.deletePath(from);
          break;
        case "merge-reading-progress":
        case "merge-pins": {
          const mine = to && (await deps.exists(to)) ? await deps.readFile(to) : null;
          const theirs = await deps.readFile(from);
          // The destination's own copy is about to be overwritten by the
          // merged result. Recorded before that happens, or an undo can
          // restore where the source went but not what was already there.
          if (step.to) report.destroyed.push({ path: step.to, content: mine });
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
          // NOT `.catch(() => [])`. This folder exists — the step was only
          // planned because the name is taken on both sides — so a listing
          // that fails is a fault, and an empty `mine` would mean deduping
          // against nothing and planning every child straight onto whatever
          // is already there. Letting it throw records the step as failed and
          // leaves the folder for the next run.
          const [mine, theirs] = await Promise.all([deps.listNames(to), deps.listNames(from)]);
          // Placeholders count as taken, for the reason `takenNames` gives.
          const taken = takenNames(mine);
          let stranded = false;
          for (const name of theirs) {
            if (IGNORED.has(name)) continue; // `.DS_Store`, never data
            // An evicted child, refused for the same reason the top level
            // refuses one: on disk it is a stub, so moving it and deleting
            // the source deletes the real item out of iCloud. Planning
            // catches these at the top level; nothing caught them HERE,
            // where they are reached by name from a hidden-inclusive
            // listing and moved as ordinary small files.
            const evicted = EVICTED.exec(name);
            if (evicted) {
              stranded = true;
              report.leftBehind.push({
                name: `${step.from}/${evicted[1]}`,
                reason: `${evicted[1]} has not been downloaded from iCloud yet — open it once, then migrate again`,
              });
              continue;
            }
            const target = dedupeName(name, taken);
            taken.add(target);
            await deps.moveEntry(`${from}/${name}`, `${to}/${target}`);
            // Every child, not only the renamed ones — see `moves`.
            report.moves.push({ from: `${step.from}/${name}`, to: `${step.to}/${target}` });
            if (target !== name) {
              report.renames.push({ from: `${step.from}/${name}`, to: `${step.to}/${target}` });
            }
          }
          // The emptied folder itself. Leaving it made the old root never
          // read as empty, which is both debris and a wrong answer: the
          // startup rule asks "does the old folder still have content?" and
          // an empty husk says yes. Only removed when nothing but ignorable
          // debris is left — never a blind delete of what did not move.
          if (!stranded) {
            const rest = await deps.listNames(from).catch(() => ["?"]);
            if (rest.every((n) => IGNORED.has(n))) await deps.deletePath(from);
          }
          if (step.unit === "project") report.moved.projects += 1;
          else report.moved.looseFiles += 1;
          break;
        }
        default: {
          if (!to) break;
          await deps.moveEntry(from, to);
          if (step.to) report.moves.push({ from: step.from, to: step.to });
          if (step.to && step.to !== step.from) {
            report.renames.push({ from: step.from, to: step.to });
          }
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

/**
 * What is still sitting in the old root that nothing accounts for.
 *
 * The report is what the RUNNER believes happened; until now nothing checked
 * that belief against the disk. For a feature whose whole promise is "your
 * files are all over there now", a belief is not enough — a step can report
 * success and leave something behind, and the plan itself is built before the
 * user confirms, so anything that arrives in the window between planning and
 * running is in no step at all and would be stranded in silence.
 *
 * Everything explained is subtracted: ignorable debris, the entries the plan
 * deliberately left, the sources of steps that failed and are named already,
 * and `.notesage` — whose files are merged or dropped by design, leaving a
 * husk. Whatever remains is surfaced, because the one thing worse than a
 * partial migration is a partial migration reported as complete.
 */
export function unaccountedInOldRoot(
  remaining: FileEntry[],
  report: Pick<MigrationReport, "leftBehind" | "failed">,
  /** What is still directly inside the old `Inbox/`. Checked separately
   *  because the folder ITSELF always survives — items are moved out of it,
   *  it is never removed — so explaining the folder away would hide every
   *  article left inside it. */
  remainingInbox: FileEntry[] = [],
): { name: string; reason: string }[] {
  const explained = new Set<string>([".notesage", "Inbox"]);
  for (const left of report.leftBehind) {
    explained.add(left.name);
    explained.add(left.name.split("/")[0]);
  }
  for (const failure of report.failed) {
    explained.add(failure.step.from);
    explained.add(failure.step.from.split("/")[0]);
  }

  const out: { name: string; reason: string }[] = [];
  const check = (entry: FileEntry, prefix: string) => {
    if (IGNORED.has(entry.name)) return;
    if (prefix && entry.name === ".notesage") return; // the Inbox's own sidecar husk
    // An evicted file is reported under the name it stands for, so compare
    // that form too or every stranded placeholder reads as unaccounted.
    const evicted = EVICTED.exec(entry.name);
    const bare = evicted ? evicted[1] : entry.name;
    const reported = `${prefix}${bare}`;
    if (
      explained.has(entry.name) ||
      explained.has(bare) ||
      explained.has(reported) ||
      explained.has(`${prefix}${entry.name}`)
    ) {
      return;
    }
    out.push({
      name: reported,
      reason: `still in the old folder — it was not moved, and nothing explains why`,
    });
  };
  for (const entry of remaining) check(entry, "");
  for (const entry of remainingInbox) check(entry, "Inbox/");
  return out;
}

/*
 * There is deliberately no "remove the old root" here.
 *
 * An `oldRootIsEmpty` helper used to sit at this spot, exported and tested
 * and called by nothing — which read as implemented behaviour to anyone
 * skimming, and invited wiring it up. The old CloudDocs folder is KEPT: a
 * migration can leave things behind (an undownloaded file, a step that
 * failed), `resolveSyncedLibraryRoot` follows the marker rather than the
 * directories so a leftover folder costs nothing, and deleting a root this
 * feature has just finished writing to is the one action with no undo.
 * Cleaning it up is the user's call, in Finder, once they can see both.
 */

export const MIGRATION_INTERNAL = { IGNORED, DROPPED_RELATIVE };

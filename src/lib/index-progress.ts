/**
 * Adding up the document index's progress, as a pure unit.
 *
 * The backend indexes one SCOPE per pass: the global `~/Notesage` library, or
 * one project. Startup runs the global pass and then every project's pass at
 * once, and each counts its own `current/total` from zero. Shown as they
 * arrive, the numbers restart per project. Kept per scope and added up, they
 * are one honest total: files done across every scope that has reported, out
 * of the files those scopes hold.
 *
 * Nothing here listens, schedules or translates; `index-progress-store.ts`
 * feeds it and `indexing-label.ts` words it.
 */

/** Key of the global pass. A project path is never empty. */
export const GLOBAL_SCOPE = "";

/** The key a backend `project_path` (null for the global pass) is kept under. */
export function scopeKey(projectPath: string | null | undefined): string {
  return projectPath ?? GLOBAL_SCOPE;
}

export interface ScopeProgress {
  /** Files handled so far in the running (or last) pass. */
  current: number;
  /** Files in the pass; `null` until its first progress event. */
  total: number | null;
  /** The pass has ended (it reported ready, or its command returned). */
  done: boolean;
}

/** Every scope of the current burst of passes, by {@link scopeKey}. */
export type IndexScopes = Readonly<Record<string, ScopeProgress>>;

export const NO_SCOPES: IndexScopes = Object.freeze({});

export interface IndexingSummary {
  /** A pass is running, or the startup pass has begun and not settled. */
  active: boolean;
  /** Files done, over every scope that has reported a total. */
  filesDone: number;
  /** Files in every scope that has reported a total. */
  filesTotal: number;
  /**
   * `filesDone / filesTotal`, or `null` while the total is not the whole
   * story yet: nothing has reported, a pass has begun without a total, or
   * projects are still to start. A bar drawn from a partial total would run
   * backwards when the next scope joins.
   */
  fraction: number | null;
  /** Projects the startup pass has not begun yet. 0 once startup settled. */
  pendingScopes: number;
  /** Scopes mid-pass, in the order they began. May hold {@link GLOBAL_SCOPE}. */
  currentScopes: string[];
}

export const IDLE_SUMMARY: IndexingSummary = Object.freeze({
  active: false,
  filesDone: 0,
  filesTotal: 0,
  fraction: null,
  pendingScopes: 0,
  currentScopes: [],
}) as IndexingSummary;

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * A pass is about to run for `key` (its command was invoked). An unfinished
 * scope keeps its numbers; a finished one starts over.
 */
export function beginScope(scopes: IndexScopes, key: string): IndexScopes {
  const existing = scopes[key];
  if (existing && !existing.done) return scopes;
  return { ...scopes, [key]: { current: 0, total: null, done: false } };
}

/**
 * An `index-progress` event. Starts the scope if nothing announced it, and
 * restarts it if it had finished (a recovery retry, a project added back).
 *
 * The one event that does NOT reopen a finished scope is its own last one
 * arriving late: `current == total` with the total it finished on.
 */
export function applyProgress(
  scopes: IndexScopes,
  key: string,
  current: unknown,
  total: unknown,
): IndexScopes {
  const nextTotal = asCount(total);
  const nextCurrent = Math.min(asCount(current), nextTotal);
  const existing = scopes[key];
  if (existing?.done && nextCurrent >= nextTotal && existing.total === nextTotal) return scopes;
  if (
    existing &&
    !existing.done &&
    existing.total === nextTotal &&
    existing.current === nextCurrent
  ) {
    return scopes;
  }
  return { ...scopes, [key]: { current: nextCurrent, total: nextTotal, done: false } };
}

/**
 * The scope's pass ended. A scope nobody has heard of stays unheard of: an
 * `index-ready` on its own says nothing is running, which is the idle state.
 */
export function finishScope(scopes: IndexScopes, key: string): IndexScopes {
  const existing = scopes[key];
  if (!existing || existing.done) return scopes;
  return {
    ...scopes,
    [key]: { current: existing.total ?? existing.current, total: existing.total, done: true },
  };
}

/** Forget a scope (its project left the workspace). */
export function removeScope(scopes: IndexScopes, key: string): IndexScopes {
  if (!(key in scopes)) return scopes;
  const { [key]: _removed, ...rest } = scopes;
  return rest;
}

/** Finish every unfinished scope except the ones in `keep`. */
export function finishAllExcept(scopes: IndexScopes, keep: ReadonlySet<string>): IndexScopes {
  let next = scopes;
  for (const key of Object.keys(scopes)) {
    if (!keep.has(key)) next = finishScope(next, key);
  }
  return next;
}

export interface SummaryContext {
  /** `settings.indexReady`: the startup pass has settled. */
  startupSettled: boolean;
  /** The workspace's project paths, for "how many are still to start". */
  projects: readonly string[];
}

/** Add the scopes up into what the UI shows. */
export function summarize(scopes: IndexScopes, context: SummaryContext): IndexingSummary {
  const keys = Object.keys(scopes);
  if (keys.length === 0) return IDLE_SUMMARY;

  let filesDone = 0;
  let filesTotal = 0;
  let unfinished = 0;
  let unsized = 0;
  const currentScopes: string[] = [];
  for (const key of keys) {
    const scope = scopes[key];
    if (scope.total !== null) {
      filesTotal += scope.total;
      filesDone += scope.done ? scope.total : Math.min(scope.current, scope.total);
    }
    if (!scope.done) {
      unfinished += 1;
      if (scope.total === null) unsized += 1;
      else currentScopes.push(key);
    }
  }

  // Between the global pass and the projects' passes nothing is running for
  // a moment, but startup has not settled: still indexing.
  const active = unfinished > 0 || !context.startupSettled;
  const pendingScopes = context.startupSettled
    ? 0
    : context.projects.filter((path) => !(path in scopes)).length;

  let fraction: number | null = null;
  if (unfinished === 0 && context.startupSettled) fraction = 1;
  else if (filesTotal > 0 && unsized === 0 && pendingScopes === 0) fraction = filesDone / filesTotal;

  return { active, filesDone, filesTotal, fraction, pendingScopes, currentScopes };
}

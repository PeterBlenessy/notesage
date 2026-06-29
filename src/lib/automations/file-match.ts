// File-event condition matching — the pure predicate that decides whether a
// changed `file` satisfies a file-event automation's `condition`. Glob is
// matched **scope-relative** (against the path under the automation's watched
// root) via picomatch; `frontmatter` keys are read **lazily** through an
// injected reader, gated behind the cheap glob match so a file is only read
// from disk when frontmatter is actually constrained.
//
// Pure + side-effect-free (the reader is injected), so it is unit-testable
// outside React/Tauri and reused by the runner's event matcher (Task #3).
//
// PRD: docs/prds/2026-06-28-automations.md (Task #4)

import picomatch from 'picomatch';
import type { Automation, FileEventName } from './types';

/** Map a watcher `file-changed-batch` kind to a file-trigger event name. */
export const WATCHER_KIND_TO_EVENT: Record<'create' | 'modify' | 'delete', FileEventName> = {
  create: 'file-created',
  modify: 'file-modified',
  delete: 'file-deleted',
};

/**
 * Pure pre-filter: does this automation's FILE trigger match `event` for `file`
 * — right trigger type, right event, and `file` under the watched base? The
 * `condition` (glob/frontmatter) is checked separately via `matchesCondition`
 * (async, because frontmatter may need a file read).
 */
export function fileTriggerMatches(
  automation: Automation,
  event: FileEventName,
  file: string,
): boolean {
  if (automation.trigger.type !== 'file') return false;
  if (automation.trigger.event !== event) return false;
  const base = automationBase(automation);
  if (base && relativeToBase(base, file) === null) return false; // out of scope
  return true;
}

/** Lazily reads a file's parsed frontmatter (`null` when absent/unreadable). */
export type FrontmatterReader = (path: string) => Promise<Record<string, unknown> | null>;

/**
 * The watched root a file-event automation's glob is resolved against:
 * explicit `trigger.path`, else the automation's project scope. `undefined`
 * for a global automation with no `trigger.path` (glob then matches the path
 * as-is, e.g. `**\/*.md`).
 */
export function automationBase(automation: Automation): string | undefined {
  const explicit = automation.trigger.path?.trim();
  if (explicit) return explicit;
  if (automation.scope && automation.scope !== 'global') return automation.scope;
  return undefined;
}

/**
 * Path of `file` relative to `base`. `''` when `file` IS `base`, `null` when
 * `file` is outside `base` (out of scope). With no `base`, the leading
 * separator is stripped so an absolute path still globs against `**`-style
 * patterns.
 */
export function relativeToBase(base: string | undefined, file: string): string | null {
  if (!base) return file.replace(/^\/+/, '');
  const root = base.replace(/\/+$/, '');
  if (file === root) return '';
  if (file.startsWith(`${root}/`)) return file.slice(root.length + 1);
  return null;
}

function frontmatterValueMatches(actual: unknown, expected: string): boolean {
  if (actual === undefined || actual === null) return false;
  if (Array.isArray(actual)) return actual.some((v) => String(v) === expected);
  return String(actual) === expected;
}

/**
 * Whether the changed `file` satisfies `automation.condition`.
 *
 * - No condition (or no glob/frontmatter constraints) ⇒ matches.
 * - `glob`: scope-relative match; a file outside the watched root never matches.
 * - `frontmatter`: every specified key must equal the file's value (array
 *   values match on membership). Read lazily, and only after the glob passes.
 *
 * `weekdays` is a schedule-level gate and is intentionally ignored here.
 */
export async function matchesCondition(
  automation: Automation,
  file: string,
  readFrontmatter: FrontmatterReader,
): Promise<boolean> {
  const condition = automation.condition;
  const glob = condition?.glob?.trim();
  const frontmatter = condition?.frontmatter;
  const hasFrontmatter = !!frontmatter && Object.keys(frontmatter).length > 0;

  if (!glob && !hasFrontmatter) return true;

  // 1. Glob first — cheap, no I/O. Also enforces scope (out-of-root ⇒ no match).
  if (glob) {
    const rel = relativeToBase(automationBase(automation), file);
    if (rel === null) return false;
    if (!picomatch(glob, { dot: true })(rel)) return false;
  }

  // 2. Frontmatter — read the file only now that the path qualifies.
  if (hasFrontmatter) {
    const fm = await readFrontmatter(file);
    if (!fm) return false;
    for (const [key, expected] of Object.entries(frontmatter)) {
      if (!frontmatterValueMatches(fm[key], expected)) return false;
    }
  }

  return true;
}

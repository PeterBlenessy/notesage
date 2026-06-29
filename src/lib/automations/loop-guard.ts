// Loop-prevention re-entrancy guard. An automation's own `document` writes must
// not retrigger a file-event automation. The Rust watcher already drops
// self-writes from `file-changed-batch` (via mark_self_write, 5s TTL), but that
// window can lapse before a late filesystem event arrives — so this is a second,
// frontend-side guard: every automation write is recorded here, and the
// file-event matcher ignores an event for a path an automation just wrote.
//
// PRD: docs/prds/2026-06-28-automations.md (Task #6)

const TTL_MS = 15_000;
const written = new Map<string, number>();

/** Record that an automation just wrote `path` (called by the runner's writeDocument). */
export function markAutomationWrite(path: string): void {
  written.set(path, Date.now());
}

/** True if `path` was written by an automation within the TTL (prunes on read). */
export function wasAutomationWrite(path: string, now: number = Date.now()): boolean {
  const t = written.get(path);
  if (t === undefined) return false;
  if (now - t > TTL_MS) {
    written.delete(path);
    return false;
  }
  return true;
}

/** Test helper — clear all recorded writes. */
export function _resetLoopGuard(): void {
  written.clear();
}

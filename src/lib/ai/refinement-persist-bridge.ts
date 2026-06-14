import type { PersistedRefinement } from './refinement-persist';

/**
 * In-memory handoff for refinement persistence (task #15).
 *
 * `ns-refine` comments are stripped from a document's markdown at read time
 * (`useFileOperations.openFile`) so the editor never renders them. The parsed
 * payloads are stashed here, keyed by document path, and consumed once the
 * editor has parsed that document (`useRefinementWatcher`'s hydration effect),
 * which re-anchors them against the live ProseMirror doc by content hash.
 *
 * This is a transient bridge, not state — entries are written on read and
 * removed on consume. It exists because the read site (a hook) and the
 * re-anchor site (needs the live editor) are different layers.
 */
const pending = new Map<string, PersistedRefinement[]>();

/** Record (or clear) the persisted refinements stripped from a document. */
export function stashPersistedRefinements(docPath: string, persisted: PersistedRefinement[]): void {
  if (persisted.length > 0) pending.set(docPath, persisted);
  else pending.delete(docPath);
}

/** Read the stashed payloads for a doc without removing them. */
export function peekPersistedRefinements(docPath: string): PersistedRefinement[] {
  return pending.get(docPath) ?? [];
}

/** Read and remove the stashed payloads for a doc. */
export function consumePersistedRefinements(docPath: string): PersistedRefinement[] {
  const v = pending.get(docPath) ?? [];
  pending.delete(docPath);
  return v;
}

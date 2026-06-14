import type { Node as PMNode } from '@tiptap/pm/model';
import { hashLine } from './refinement-hash';
import {
  parseRefineComment,
  serializeRefineComment,
  stripRefineComment,
} from './refine-comment';
import type { RefinementEntry, RefinementResult, RefinementEntryStatus } from './refinement';

/**
 * Markdown persistence for refinements (task #15).
 *
 * The refinement store is non-persisted — refinements live on disk as trailing
 * `ns-refine` HTML comments on the source line, and the store is rebuilt from
 * them when a document opens. This module is the pure save/load bridge:
 *
 *  - `injectRefinements`  — on SAVE, append `ns-refine` comments to the markdown
 *    lines carrying pending refinements.
 *  - `extractRefinements` — on OPEN, pull the comments out of the raw markdown
 *    (so the editor never renders them) and return the cleaned markdown plus the
 *    parsed payloads.
 *  - `rebuildEntriesFromDoc` — after the editor parses the cleaned markdown,
 *    re-anchor each persisted refinement to its block by matching the content
 *    hash (the same `hashLine(textContent)` the watcher used), producing store
 *    entries.
 *
 * `srcHash` is consistently the hash of the ProseMirror block `textContent` on
 * both sides, so a comment written on save matches its block on reopen.
 */

export interface PersistedRefinement {
  result: RefinementResult;
  srcHash: string;
  status: RefinementEntryStatus;
}

/** Pull `ns-refine` comments out of raw markdown. No-op when there are none. */
export function extractRefinements(markdown: string): {
  cleaned: string;
  persisted: PersistedRefinement[];
} {
  if (!markdown.includes('ns-refine:')) return { cleaned: markdown, persisted: [] };
  const persisted: PersistedRefinement[] = [];
  const cleaned = markdown
    .split('\n')
    .map((line) => {
      const parsed = parseRefineComment(line);
      if (!parsed) return line;
      persisted.push(parsed);
      return stripRefineComment(line);
    })
    .join('\n');
  return { cleaned, persisted };
}

/**
 * Append `ns-refine` comments to the markdown lines carrying PENDING, non-`keep`
 * refinements. Each entry's line is matched by `originalText` substring (the PM
 * textContent, which the markdown line contains even with list/checkbox
 * markers), first un-commented match wins. Pure; returns the input unchanged
 * when there is nothing to persist.
 */
export function injectRefinements(markdown: string, entries: RefinementEntry[]): string {
  const pending = entries.filter(
    (e) => e.status === 'pending' && e.result.verdict !== 'keep' && e.originalText.trim().length > 0,
  );
  if (pending.length === 0) return markdown;

  const lines = markdown.split('\n');
  const used = new Set<number>();
  for (const entry of pending) {
    for (let i = 0; i < lines.length; i++) {
      if (used.has(i)) continue;
      if (parseRefineComment(lines[i])) continue; // already annotated
      if (lines[i].includes(entry.originalText)) {
        lines[i] = `${lines[i]} ${serializeRefineComment(entry.result, entry.srcHash, 'pending')}`;
        used.add(i);
        break;
      }
    }
  }
  return lines.join('\n');
}

function defaultId(): string {
  return `refine-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Re-anchor persisted refinements to blocks in a freshly-parsed document by
 * content-hash match. Returns one entry per matched block (each persisted hash
 * is claimed at most once). Anchors use the block's inline content range.
 */
export function rebuildEntriesFromDoc(
  doc: PMNode,
  persisted: PersistedRefinement[],
  docPath: string,
  makeId: () => string = defaultId,
): RefinementEntry[] {
  if (persisted.length === 0) return [];
  const byHash = new Map(persisted.map((p) => [p.srcHash, p]));
  const claimed = new Set<string>();
  const entries: RefinementEntry[] = [];

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    const text = node.textContent;
    if (!text.trim()) return;
    const hash = hashLine(text);
    const p = byHash.get(hash);
    if (!p || claimed.has(hash)) return;
    claimed.add(hash);
    entries.push({
      id: makeId(),
      docPath,
      anchor: { from: pos + 1, to: pos + 1 + node.content.size },
      srcHash: hash,
      originalText: text,
      result: p.result,
      status: 'pending',
      createdAt: Date.now(),
    });
  });

  return entries;
}

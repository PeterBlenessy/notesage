import { useEffect } from 'react';
import type { Editor } from '@tiptap/core';
import { useSettingsStore } from '@/stores/settings-store';
import { useEditorStore } from '@/stores/editor-store';
import { useRefinementStore } from '@/stores/refinement-store';
import { createSeenSet } from '@/lib/ai/refinement-hash';
import { resolveRefinementConnection } from '@/lib/ai/refinement-routing';
import { analyzeBlock, type RefinementBlock } from '@/lib/ai/refinement-run';
import { rebuildEntriesFromDoc } from '@/lib/ai/refinement-persist';
import {
  peekPersistedRefinements,
  consumePersistedRefinements,
} from '@/lib/ai/refinement-persist-bridge';
import { log, PERF } from '@/lib/logger';

const DEBOUNCE_MS = 1500;
const MAX_FAILURES = 5;

/**
 * Ambient action-refinement watcher (task #9). Mounted from `Editor.tsx`
 * alongside the completion hooks (the established pattern for editor-bound
 * hooks — they take the live `editor` instance directly).
 *
 * Behaviour:
 *  - Inert unless `settings.ambientRefinementEnabled` AND an editor exists. When
 *    off, no listeners are installed (zero cost).
 *  - Fires on **block commit**, never per keystroke: typing schedules a 1500 ms
 *    debounce on the edited block; moving the cursor OUT of the edited block
 *    flushes immediately (block-exit). This is the v1 commit heuristic — the
 *    PRD flags exact tuning as an open question.
 *  - Gating (candidate pre-filter × already-refined × seen-set) lives in the
 *    pure `analyzeBlock`/`planRefinement`; the engine call is single-in-flight.
 *  - Backs off after MAX_FAILURES consecutive engine errors; resets on success.
 *  - `agent_managed` (ACP) connections are skipped gracefully — the ACP one-shot
 *    runner is deferred (direct-API local connections cover the default).
 */
export function useRefinementWatcher(editor: Editor | null): void {
  const enabled = useSettingsStore((s) => s.ambientRefinementEnabled);
  const activeTabId = useEditorStore((s) => s.activeTabId);

  // Hydration: when a document opens, its `ns-refine` comments were stripped at
  // read time and stashed (see `useFileOperations.openFile`). Re-anchor them
  // against the freshly-parsed doc by content hash and load them into the store
  // so persisted refinements reappear. Runs regardless of `enabled` — refinements
  // saved in the file should show on reopen even if generation is turned off.
  useEffect(() => {
    if (!editor) return;
    const path =
      useEditorStore.getState().openDocuments.find((t) => t.id === activeTabId)?.filePath ?? null;
    if (!path) return;
    const persisted = peekPersistedRefinements(path);
    if (persisted.length === 0) return;

    let cancelled = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = () => {
      if (cancelled || editor.isDestroyed) return;
      const entries = rebuildEntriesFromDoc(editor.state.doc, persisted, path);
      // The doc may not be parsed yet on the first tick — retry briefly until we
      // match (entries found) or give up, then commit whatever we have.
      if (entries.length > 0 || tries >= 8) {
        useRefinementStore.getState().rebuildForDoc(path, entries);
        consumePersistedRefinements(path);
        return;
      }
      tries += 1;
      timer = setTimeout(attempt, 100);
    };
    timer = setTimeout(attempt, 50);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [editor, activeTabId]);

  useEffect(() => {
    if (!editor || !enabled) return;

    const seen = createSeenSet();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    let failures = 0;
    let pending: RefinementBlock | null = null;
    let disposed = false;

    const activeDocPath = (): string | null => {
      const s = useEditorStore.getState();
      return s.openDocuments.find((t) => t.id === s.activeTabId)?.filePath ?? null;
    };

    const captureBlock = (): RefinementBlock | null => {
      const { $from } = editor.state.selection;
      if (!$from.parent.isTextblock) return null;
      const d = $from.depth;
      const docPath = activeDocPath();
      if (!docPath) return null;
      return {
        text: $from.parent.textContent,
        from: $from.start(d),
        to: $from.end(d),
        docPath,
      };
    };

    const flush = async (): Promise<void> => {
      if (disposed || running) return;
      const block = pending;
      pending = null;
      if (!block || !block.text.trim()) return;
      if (failures >= MAX_FAILURES) return;

      running = true;
      const t0 = performance.now();
      const store = useRefinementStore.getState();
      const outcome = await analyzeBlock(block, {
        connection: resolveRefinementConnection(),
        seen,
        alreadyRefined: (hash, docPath) =>
          useRefinementStore
            .getState()
            .entries.some(
              (e) =>
                e.docPath === docPath &&
                e.srcHash === hash &&
                (e.status === 'pending' || e.status === 'applied'),
            ),
        upsertEntry: store.upsertEntry,
        markSeen: store.markSeen,
      });
      running = false;

      if (outcome === 'error') failures += 1;
      else if (outcome === 'refined' || outcome === 'kept') failures = 0;
      log.info(PERF.refine, 'analyze', {
        outcome,
        ms: Math.round(performance.now() - t0),
      });

      // Something queued while we ran — drain it.
      if (pending && !disposed && failures < MAX_FAILURES) schedule(0);
    };

    const schedule = (delay = DEBOUNCE_MS): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), delay);
    };

    const onUpdate = (): void => {
      const block = captureBlock();
      if (!block) return;
      pending = block; // the block currently being edited
      schedule(DEBOUNCE_MS);
    };

    const onSelection = (): void => {
      if (!pending) return;
      const cur = captureBlock();
      // Cursor left the edited block → commit it now (block-exit).
      if (cur && cur.from !== pending.from) schedule(0);
    };

    editor.on('update', onUpdate);
    editor.on('selectionUpdate', onSelection);

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      editor.off('update', onUpdate);
      editor.off('selectionUpdate', onSelection);
    };
  }, [editor, enabled]);
}

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { useSettingsStore } from '@/stores/settings-store';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import {
  computeTypewriterScrollDelta,
  isTypingTransaction,
} from '@/lib/editor/typewriter-scroll';

/**
 * Typewriter scrolling for the markdown WYSIWYG editor (Settings > Writing >
 * "Typewriter scrolling", persisted as `settings.typewriterScrolling`).
 *
 * On every typing-driven transaction (doc changed + caret adjacent to the
 * change — see `isTypingTransaction`) the hook measures the caret's viewport
 * position via `editor.view.coordsAtPos` and, when the caret has drifted
 * outside the 40–60% comfort band of the scroll container, scrolls the
 * container so the caret returns to the vertical center.
 *
 * Deliberate non-goals:
 * - Manual scrolling is never fought — plain selection moves, wheel/scroll
 *   events, pastes, drops, and programmatic content swaps are all ignored.
 * - Source mode (CodeMirror) is out of scope — this hook only sees Tiptap
 *   transactions.
 *
 * Interaction with `useCursorScrollGuard`: that hook nudges the viewport when
 * the caret would slip behind the floating command bar. Both issue relative
 * smooth `scrollBy` calls on typing, which would compose additively and
 * overshoot — so the guard stands down while typewriter scrolling is enabled
 * (centering keeps the caret far above the bar anyway). See the early-return
 * in `useCursorScrollGuard`.
 *
 * Reduced motion: `prefers-reduced-motion: reduce` switches the scroll to
 * instant (`behavior: 'auto'`) instead of smooth.
 */
export function useTypewriterScroll(
  editor: Editor | null,
  scrollContainerRef: RefObject<HTMLElement | null>,
): void {
  const enabled = useSettingsStore((s) => s.typewriterScrolling);
  const reducedMotion = useReducedMotion();

  // Read through a ref so a runtime OS-preference flip doesn't force the
  // transaction listener to unbind/rebind.
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  useEffect(() => {
    if (!enabled || !editor) return;

    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (!isTypingTransaction(transaction)) return;

      const container = scrollContainerRef.current;
      if (!container) return;

      // ProseMirror applies the transaction to the DOM synchronously before
      // Tiptap emits 'transaction', so the caret coordinates are current.
      let coords: { top: number; bottom: number };
      try {
        coords = editor.view.coordsAtPos(editor.state.selection.head);
      } catch {
        // Position outside the rendered view (or view mid-teardown) — skip.
        return;
      }

      const rect = container.getBoundingClientRect();
      const delta = computeTypewriterScrollDelta({
        caretTop: coords.top,
        caretBottom: coords.bottom,
        viewportTop: rect.top,
        viewportHeight: rect.height,
      });
      if (delta === null) return;

      container.scrollBy({
        top: delta,
        behavior: reducedMotionRef.current ? 'auto' : 'smooth',
      });
    };

    editor.on('transaction', onTransaction);
    return () => {
      editor.off('transaction', onTransaction);
    };
  }, [enabled, editor, scrollContainerRef]);
}

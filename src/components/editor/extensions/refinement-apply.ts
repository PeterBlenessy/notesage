import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useRefinementStore, selectPendingForDoc } from "@/stores/refinement-store";
import { useEditorStore } from "@/stores/editor-store";
import type { RefinementEntry } from "@/lib/ai/refinement";

/**
 * Refinement-apply extension.
 *
 * Surfaces a hover/focus-revealed "Apply suggestion" affordance on every block
 * that has a pending refinement (`RefinementEntry`) anchored inside it, and
 * applies the refinement — rewriting the line to the sharpened `outcome` and
 * inserting any sub-steps as a nested task list — in a single undo step.
 *
 * The decoration SOURCE is the refinement store, NOT the document text. The
 * `ns-refine` HTML comments are stripped on markdown→ProseMirror parse, so the
 * live document carries no refinement markup. Pending entries are read from
 * `useRefinementStore` for the active document path (from `editor-store`).
 *
 * See `docs/prds/2026-06-13-ambient-action-refinement.md` (task #10).
 */

export const RefinementApplyPluginKey = new PluginKey("refinementApply");

/** CSS class on the widget button — styled in `editor.css`. */
const APPLY_BUTTON_CLASS = "refinement-apply";

// ---------------------------------------------------------------------------
// Active document path
// ---------------------------------------------------------------------------

/** Resolve the active document's file path from the editor store, or null. */
function getActiveDocPath(): string | null {
  const state = useEditorStore.getState();
  const active = state.openDocuments.find((d) => d.id === state.activeTabId);
  return active?.filePath ?? null;
}

/** Pending, non-`keep` refinements for the active document. */
function getPendingEntries(): RefinementEntry[] {
  const docPath = getActiveDocPath();
  if (!docPath) return [];
  return selectPendingForDoc(useRefinementStore.getState(), docPath).filter(
    (e) => e.result.verdict !== "keep",
  );
}

// ---------------------------------------------------------------------------
// Anchor validation
// ---------------------------------------------------------------------------

/**
 * True when the entry's anchor range sits within the document and is a valid,
 * non-empty, correctly-ordered range. Stale anchors (out of range after edits)
 * are rejected so we never act on the wrong text.
 */
export function isAnchorValid(doc: PMNode, entry: RefinementEntry): boolean {
  const { from, to } = entry.anchor;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
  if (from < 0 || to < 0) return false;
  if (from >= to) return false;
  // Positions must be inside the document content. `doc.content.size` is the
  // last valid position.
  if (to > doc.content.size) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Decoration building
// ---------------------------------------------------------------------------

/**
 * For each pending entry whose anchor falls inside a top-level-resolvable block,
 * place a widget decoration at the END of that block. The widget is an
 * apply button revealed on row hover / button focus (CSS-gated).
 */
function buildDecorations(state: EditorState): DecorationSet {
  const entries = getPendingEntries();
  if (entries.length === 0) return DecorationSet.empty;

  const doc = state.doc;
  const decorations: Decoration[] = [];

  for (const entry of entries) {
    if (!isAnchorValid(doc, entry)) continue;

    // Resolve the block that contains the anchor's `from`. We place the widget
    // at the end of that block's content so it sits at the trailing edge of the
    // line, like an end-of-line affordance.
    let widgetPos: number | null = null;
    try {
      const $from = doc.resolve(Math.min(entry.anchor.from, doc.content.size));
      // depth 1 is the top-level block in a flat doc; clamp to >= 1.
      const blockDepth = Math.max(1, $from.depth);
      widgetPos = $from.end(blockDepth);
    } catch {
      widgetPos = null;
    }
    if (widgetPos === null) continue;
    // Guard the computed position too.
    if (widgetPos < 0 || widgetPos > doc.content.size) continue;

    decorations.push(
      Decoration.widget(
        widgetPos,
        () => createApplyButton(entry),
        {
          // Keep the widget after the block content; side > 0 places it after
          // the position so typing before it does not push the cursor onto it.
          side: 1,
          // Mark non-inclusive so the widget is not absorbed into typed text.
          ignoreSelection: true,
          key: `refine-apply-${entry.id}`,
        },
      ),
    );
  }

  if (decorations.length === 0) return DecorationSet.empty;
  return DecorationSet.create(doc, decorations);
}

/** Build the apply-button DOM widget for an entry. */
function createApplyButton(entry: RefinementEntry): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = APPLY_BUTTON_CLASS;
  button.setAttribute("data-refine-id", entry.id);
  button.setAttribute("aria-label", "Apply suggestion");
  button.setAttribute("title", "Apply suggestion");
  // Decorative glyph; the accessible name comes from aria-label.
  button.textContent = "✦"; // ✦
  // Don't let the editor try to handle the widget as editable content.
  button.setAttribute("contenteditable", "false");
  return button;
}

// ---------------------------------------------------------------------------
// Apply transaction (pure helper)
// ---------------------------------------------------------------------------

/**
 * Build the single transaction that applies a refinement:
 *  1. Replace the anchor range `[from, to]` with `result.outcome`
 *     (only when verdict !== 'keep' AND outcome is non-empty).
 *  2. Insert `result.steps` as an unchecked nested task list immediately after
 *     the block containing the anchor (only when there are steps AND the schema
 *     has the `taskList` / `taskItem` nodes).
 *
 * Returns `null` when the anchor is stale/out-of-range or when there is nothing
 * to apply — the caller should treat `null` as "dismiss this entry, no edit".
 *
 * The whole edit is one transaction, hence one undo step.
 */
export function applyRefinementToDoc(
  state: EditorState,
  entry: RefinementEntry,
): Transaction | null {
  const doc = state.doc;
  if (!isAnchorValid(doc, entry)) return null;

  const { verdict, outcome, steps } = entry.result;
  const wantsTextReplace = verdict !== "keep" && outcome.trim().length > 0;
  const validSteps = (steps ?? []).filter((s) => s.text.trim().length > 0);
  const wantsSteps = validSteps.length > 0;

  if (!wantsTextReplace && !wantsSteps) return null;

  const tr = state.tr;

  // --- Step 1: replace the anchor text -------------------------------------
  // We replace text within the block, not block boundaries, so a plain
  // `replaceWith`/`insertText` over the inline range is safe.
  if (wantsTextReplace) {
    tr.insertText(outcome, entry.anchor.from, entry.anchor.to);
  }

  // --- Step 2: insert sub-steps as a nested task list ----------------------
  if (wantsSteps) {
    const taskListType = state.schema.nodes.taskList;
    const taskItemType = state.schema.nodes.taskItem;
    const paragraphType = state.schema.nodes.paragraph;

    if (taskListType && taskItemType && paragraphType) {
      // Find the end of the block that contains the (possibly remapped) anchor.
      // After the text replace above, positions shift; map the original block
      // end through the transaction so we insert after the rewritten line.
      const $from = tr.doc.resolve(
        Math.min(
          tr.mapping.map(entry.anchor.from),
          tr.doc.content.size,
        ),
      );
      const blockDepth = Math.max(1, $from.depth);
      const insertPos = $from.after(blockDepth);

      const items = validSteps.map((step) =>
        taskItemType.create(
          { checked: false },
          paragraphType.create(null, state.schema.text(step.text)),
        ),
      );
      const taskList = taskListType.create(null, items);

      tr.insert(Math.min(insertPos, tr.doc.content.size), taskList);
    }
  }

  if (!tr.docChanged) return null;
  return tr;
}

// ---------------------------------------------------------------------------
// Apply orchestration (transaction + store update)
// ---------------------------------------------------------------------------

/**
 * Apply the refinement identified by `id` to the view's document and update the
 * store. Exposed for the panel (task #12) to drive the same code path.
 *
 * Semantics:
 *  - On a successful edit: dispatch the transaction, then mark the entry
 *    `applied` and remove it from the pending queue (`setStatus` + `dismiss`).
 *  - On a stale/no-op anchor: dismiss the entry without editing.
 */
export function applyRefinement(view: EditorView, id: string): boolean {
  const store = useRefinementStore.getState();
  const entry = store.entries.find((e) => e.id === id);
  if (!entry) return false;

  const tr = applyRefinementToDoc(view.state, entry);
  if (tr) {
    view.dispatch(tr);
    store.setStatus(id, "applied");
    store.dismiss(id);
    return true;
  }

  // Nothing to apply (stale anchor or empty result) — drop it from the queue.
  store.dismiss(id);
  return false;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export const RefinementApply = Extension.create({
  name: "refinementApply",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: RefinementApplyPluginKey,
        state: {
          init(_, state) {
            return buildDecorations(state);
          },
          apply(tr, value, _oldState, newState) {
            // Rebuild on doc changes OR on our store-driven meta ping.
            if (tr.docChanged || tr.getMeta(RefinementApplyPluginKey)) {
              return buildDecorations(newState);
            }
            return value;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
          handleDOMEvents: {
            mousedown(view, event) {
              if ((event as MouseEvent).button !== 0) return false;
              const target = (event.target as HTMLElement | null)?.closest(
                `.${APPLY_BUTTON_CLASS}`,
              ) as HTMLElement | null;
              if (!target) return false;

              const id = target.getAttribute("data-refine-id");
              if (!id) return false;

              event.preventDefault();
              event.stopPropagation();

              applyRefinement(view, id);
              return true;
            },
          },
        },
        view(editorView) {
          // Subscribe to store changes so decorations rebuild when entries are
          // added/removed/changed externally. A no-op meta transaction triggers
          // the `apply` rebuild without mutating the document.
          const rebuild = () => {
            const tr = editorView.state.tr.setMeta(
              RefinementApplyPluginKey,
              Date.now(),
            );
            editorView.dispatch(tr);
          };
          const unsubRefine = useRefinementStore.subscribe(rebuild);
          // The active document can change without the doc changing (single-doc
          // shell evicts/swaps), so track the editor store too.
          const unsubEditor = useEditorStore.subscribe(rebuild);

          return {
            destroy() {
              unsubRefine();
              unsubEditor();
            },
          };
        },
      }),
    ];
  },
});

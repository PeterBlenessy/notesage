import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { DecorationSet } from "@tiptap/pm/view";

/**
 * Options for creating a decoration plugin via the shared factory.
 *
 * This factory encapsulates the boilerplate common to simple decoration
 * extensions: init from state, rebuild on docChanged (or selectionSet),
 * and expose decorations via `props.decorations()`.
 *
 * Complex extensions (search-highlight, comment-mark, ghost-text,
 * inline-diff) have unique state management that doesn't fit this factory
 * and should continue to define their plugins manually.
 */
export interface DecorationPluginOptions {
  /** Unique plugin key for this decoration set. */
  key: PluginKey;

  /**
   * Build the full DecorationSet from the current editor state.
   * Called on init and whenever a rebuild is triggered.
   */
  buildDecorations: (state: EditorState) => DecorationSet;

  /**
   * Whether to rebuild decorations when the selection changes
   * (in addition to doc changes). Default: false.
   */
  rebuildOnSelectionChange?: boolean;

  /**
   * Optional DOM event handlers passed through to the plugin's
   * `props.handleDOMEvents`.
   */
  handleDOMEvents?: Record<
    string,
    (view: EditorView, event: Event) => boolean
  >;

  /**
   * Optional perf logging callback. When provided, called after each
   * rebuild with timing info. The extension is responsible for
   * sampling (e.g. every 10th call).
   */
  onRebuild?: (info: {
    docNodeSize: number;
    decorationCount: number;
    elapsedMs: number;
  }) => void;
}

/**
 * Creates a ProseMirror plugin that manages a DecorationSet, rebuilding
 * it whenever the document changes (and optionally on selection change).
 *
 * Usage:
 * ```ts
 * const plugin = createDecorationPlugin({
 *   key: MyPluginKey,
 *   buildDecorations: (state) => buildMyDecorations(state.doc),
 * });
 * ```
 */
export function createDecorationPlugin(
  options: DecorationPluginOptions,
): Plugin {
  const { key, buildDecorations, rebuildOnSelectionChange, handleDOMEvents, onRebuild } = options;

  return new Plugin({
    key,
    state: {
      init(_, state) {
        return buildDecorations(state);
      },
      apply(tr, value, _oldState, newState) {
        // Only rebuild when the document changed, or when selection changed
        // and the extension opted in to selection-based rebuilds.
        const shouldRebuild =
          tr.docChanged || (rebuildOnSelectionChange && tr.selectionSet);

        if (!shouldRebuild) return value;

        if (onRebuild) {
          const t0 = performance.now();
          const result = buildDecorations(newState);
          onRebuild({
            docNodeSize: newState.doc.nodeSize,
            decorationCount: result.find().length,
            elapsedMs: Math.round(performance.now() - t0),
          });
          return result;
        }

        return buildDecorations(newState);
      },
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
      ...(handleDOMEvents ? { handleDOMEvents } : {}),
    },
  });
}

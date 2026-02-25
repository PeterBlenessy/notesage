import { StateField, StateEffect } from "@codemirror/state";
import {
  EditorView,
  Decoration,
  DecorationSet,
  WidgetType,
  keymap,
} from "@codemirror/view";
import { useSettingsStore } from "@/stores/settings-store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CMGhostTextCompletion {
  /** The suggested text to insert */
  text: string;
  /** Character offset in the CodeMirror document where ghost text appears */
  pos: number;
  /** LSP command to execute on acceptance (for tracking) */
  command?: { command: string; arguments?: unknown[] };
}

// ---------------------------------------------------------------------------
// Module-level callback for acceptance tracking (set by the hook)
// ---------------------------------------------------------------------------

export const ghostTextAcceptCallbackCM: {
  current: ((completion: CMGhostTextCompletion) => void) | null;
} = { current: null };

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

const setEffect = StateEffect.define<CMGhostTextCompletion>();
const clearEffect = StateEffect.define<void>();
const acceptEffect = StateEffect.define<void>();

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

class GhostTextWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "ghost-text";
    // Show first line only for inline display, truncated to max chars
    const firstLine = this.text.split("\n")[0];
    const maxChars = useSettingsStore.getState().copilotMaxCompletionChars;
    span.textContent = maxChars > 0 && firstLine.length > maxChars
      ? firstLine.slice(0, maxChars) + "\u2026"
      : firstLine;
    return span;
  }
  eq(other: GhostTextWidget) {
    return this.text === other.text;
  }
}

// ---------------------------------------------------------------------------
// State field
// ---------------------------------------------------------------------------

export const ghostTextFieldCM = StateField.define<{
  completion: CMGhostTextCompletion | null;
  decorations: DecorationSet;
}>({
  create() {
    return { completion: null, decorations: Decoration.none };
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setEffect)) {
        const completion = effect.value;
        if (completion.pos < 0 || completion.pos > tr.state.doc.length) {
          return { completion: null, decorations: Decoration.none };
        }
        const widget = Decoration.widget({
          widget: new GhostTextWidget(completion.text),
          side: 1,
        });
        return {
          completion,
          decorations: Decoration.set([widget.range(completion.pos)]),
        };
      }
      if (effect.is(clearEffect) || effect.is(acceptEffect)) {
        return { completion: null, decorations: Decoration.none };
      }
    }
    // Auto-dismiss on any document change
    if (value.completion && tr.docChanged) {
      return { completion: null, decorations: Decoration.none };
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
});

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function acceptGhostTextCommand(view: EditorView): boolean {
  const state = view.state.field(ghostTextFieldCM, false);
  if (!state?.completion) return false;

  const { text, pos } = state.completion;

  // Notify acceptance callback before dispatching
  ghostTextAcceptCallbackCM.current?.(state.completion);

  view.dispatch({
    changes: { from: pos, insert: text },
    effects: acceptEffect.of(undefined),
    selection: { anchor: pos + text.length },
  });
  return true;
}

function dismissGhostTextCommand(view: EditorView): boolean {
  const state = view.state.field(ghostTextFieldCM, false);
  if (!state?.completion) return false;

  view.dispatch({ effects: clearEffect.of(undefined) });
  return true;
}

export const ghostTextKeymapCM = keymap.of([
  { key: "Tab", run: acceptGhostTextCommand },
  { key: "Escape", run: dismissGhostTextCommand },
]);

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/** Show ghost text at the given position. */
export function setGhostTextCM(
  view: EditorView,
  completion: CMGhostTextCompletion,
) {
  view.dispatch({ effects: setEffect.of(completion) });
}

/** Clear any visible ghost text. */
export function clearGhostTextCM(view: EditorView) {
  const state = view.state.field(ghostTextFieldCM, false);
  if (!state?.completion) return;
  view.dispatch({ effects: clearEffect.of(undefined) });
}

/** Check whether ghost text is currently visible. */
export function hasActiveGhostTextCM(view: EditorView): boolean {
  return !!view.state.field(ghostTextFieldCM, false)?.completion;
}

/** Combined extension: state field + keymap. Include in SourceEditor. */
export const ghostTextExtensionCM = [ghostTextFieldCM, ghostTextKeymapCM];

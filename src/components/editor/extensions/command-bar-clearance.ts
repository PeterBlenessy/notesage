import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/**
 * Keeps the line being written above the floating command bar.
 *
 * The command bar floats over the bottom of the editor's scroll area. When
 * ProseMirror scrolls the caret into view it only knows about the scroll
 * container, so it parks the caret at the container's bottom edge — which is
 * BEHIND the bar. Anyone taking notes at the end of a document typed into a
 * line they could not see.
 *
 * An earlier attempt (`useCursorScrollGuard`) listened for `keydown` and
 * nudged the container with a smooth `scrollBy`. It measured the caret BEFORE
 * the key had taken effect, saw nothing for paste, dictation or IME input,
 * and its animation was cancelled by ProseMirror's own instant scroll on the
 * same keystroke — measured in a real browser, the caret sat 75px below the
 * bar's top edge on every line.
 *
 * So the correction runs inside ProseMirror's own scroll-into-view step
 * (`handleScrollToSelection`), which fires after the document change is in
 * the DOM for typing, Enter, paste and undo alike, and again after a
 * keyboard-driven selection change, which the browser scrolls natively. The bar is
 * measured at that moment — it can be pinned, hidden, resized by its own
 * content, or the window resized.
 *
 * (Supplying a larger `scrollMargin` looks simpler, but a plugin's props are
 * copied once when the plugin is created, so the margin could not follow the
 * bar.)
 */

/** Breathing room in px between the caret row and the command bar's top edge. */
export const COMMAND_BAR_BREATHING_ROOM_PX = 48;

/** Gap ProseMirror itself leaves when it scrolls something into view. */
const DEFAULT_MARGIN_PX = 5;

interface RectLike {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * How much of the bottom of `container` the floating bar covers, plus
 * breathing room. Pure, so the geometry is unit-testable without layout.
 */
export function clearanceFor(container: RectLike, bar: RectLike | null): number {
  if (!bar) return 0;
  // The bar must actually sit over the container: horizontally overlapping,
  // and starting above the container's bottom edge.
  const overlapsHorizontally = bar.left < container.right && bar.right > container.left;
  if (!overlapsHorizontally) return 0;
  if (bar.top >= container.bottom || bar.bottom <= container.top) return 0;
  const covered = container.bottom - bar.top;
  // Never claim more than half the container: on a very short window that
  // would leave no band for the caret at all and make every keystroke scroll.
  const height = container.bottom - container.top;
  return Math.max(0, Math.min(covered + COMMAND_BAR_BREATHING_ROOM_PX, Math.floor(height / 2)));
}

/** The nearest ancestor that scrolls vertically, or null. */
export function findScrollContainer(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/** Bottom clearance needed for the editor whose DOM node is `editorDom`, in px. */
export function measureCommandBarClearance(editorDom: HTMLElement): number {
  const bar = document.querySelector<HTMLElement>("[data-cmd-bar]");
  // A pinned bar sits beside or below the editor, not over it.
  if (!bar || bar.getAttribute("data-cmd-bar-pinned") === "true") return 0;
  const container = findScrollContainer(editorDom);
  if (!container) return 0;
  return clearanceFor(container.getBoundingClientRect(), bar.getBoundingClientRect());
}

/**
 * How far `container` must scroll down for a caret whose bottom edge is at
 * `caretBottom` to sit above the cleared band. 0 when it already does.
 */
export function scrollNeeded(caretBottom: number, containerBottom: number, clearance: number): number {
  if (clearance <= 0) return 0;
  const limit = containerBottom - clearance - DEFAULT_MARGIN_PX;
  return Math.max(0, Math.ceil(caretBottom - limit));
}

const commandBarClearanceKey = new PluginKey("commandBarClearance");

/**
 * Scroll the editor's container so the caret row clears the bar.
 * Returns true when it scrolled.
 */
function liftCaretAboveBar(view: EditorView): boolean {
  const dom = view.dom as HTMLElement;
  const container = findScrollContainer(dom);
  if (!container) return false;
  const clearance = measureCommandBarClearance(dom);
  if (clearance <= 0) return false;

  let caretBottom: number;
  try {
    caretBottom = view.coordsAtPos(view.state.selection.head).bottom;
  } catch {
    // Position outside the rendered view, or the view is mid-teardown.
    return false;
  }
  const delta = scrollNeeded(caretBottom, container.getBoundingClientRect().bottom, clearance);
  if (delta === 0) return false;

  // Instant, not smooth: a smooth scroll is cancelled by the next
  // keystroke's scroll and the caret never arrives.
  container.scrollTop += delta;
  return true;
}

export const CommandBarClearance = Extension.create({
  name: "commandBarClearance",

  addProseMirrorPlugins() {
    // What the person last used on the editor. Moving the caret with the
    // keyboard should bring it clear of the bar; a click or a drag-select
    // must not move the page under the pointer.
    let lastInput: "keyboard" | "pointer" | null = null;

    return [
      new Plugin({
        key: commandBarClearanceKey,
        props: {
          // Typing, Enter, paste, undo: everything ProseMirror itself scrolls
          // into view. Returning false when the caret is already clear leaves
          // ProseMirror's own handling (scrolling UP to a caret above the
          // viewport, horizontal scroll) in place.
          handleScrollToSelection(view) {
            return liftCaretAboveBar(view);
          },
          handleKeyDown() {
            lastInput = "keyboard";
            return false;
          },
          handleDOMEvents: {
            mousedown() {
              lastInput = "pointer";
              return false;
            },
            touchstart() {
              lastInput = "pointer";
              return false;
            },
          },
        },
        view() {
          return {
            // Arrow keys and Page Down move the caret natively: the browser
            // scrolls it to the container's edge and ProseMirror only reads
            // the new selection back, without a scroll-into-view step.
            update(view, prevState) {
              if (lastInput !== "keyboard") return;
              if (!view.hasFocus()) return;
              if (prevState.selection.eq(view.state.selection)) return;
              liftCaretAboveBar(view);
            },
          };
        },
      }),
    ];
  },
});

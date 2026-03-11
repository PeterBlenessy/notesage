/**
 * ItemAnnotation extension — adds emoji annotation to list items.
 *
 * - Stores annotations as a JSON string `{"icon":"🔴"}` in the `annotation`
 *   attribute on listItem and taskItem nodes.
 * - Renders a widget decoration before each list item's content:
 *     • If the item has an annotation → shows the emoji.
 *     • If the item has no annotation → shows a subtle "+" on hover.
 * - Clicking the decoration dispatches a `notesage:annotation-click` window
 *   CustomEvent with `{ nodePos, rect }` so AnnotationPicker can open.
 * - HTML round-trip via `data-annotation` attribute on `<li>` tags.
 */

import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnnotationClickDetail {
  /** ProseMirror position of the listItem/taskItem node. */
  nodePos: number;
  /** Viewport-relative bounding rect of the clicked widget. */
  rect: DOMRect;
}

// ---------------------------------------------------------------------------
// Plugin key — exported so external code can reference it
// ---------------------------------------------------------------------------

export const ItemAnnotationPluginKey = new PluginKey<DecorationSet>("itemAnnotation");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse annotation JSON stored in the attribute; returns the icon string or null. */
function parseAnnotationIcon(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "icon" in parsed &&
      typeof (parsed as Record<string, unknown>).icon === "string"
    ) {
      return (parsed as { icon: string }).icon;
    }
  } catch {
    // Invalid JSON — ignore
  }
  return null;
}

/** Serialise an icon string into the attribute JSON format. */
export function serializeAnnotation(icon: string): string {
  return JSON.stringify({ icon });
}

// ---------------------------------------------------------------------------
// Decoration builder
// ---------------------------------------------------------------------------

function buildAnnotationDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== "listItem" && node.type.name !== "taskItem") return;

    const icon = parseAnnotationIcon(node.attrs.annotation);

    // Widget placed at `pos` — the opening boundary of the list-item node.
    // side: -1 renders it before the node's inner content.
    const widget = Decoration.widget(
      pos + 1,
      () => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.contentEditable = "false";
        btn.setAttribute("aria-label", icon ? `Annotation: ${icon}` : "Add annotation");
        btn.className = icon
          ? "item-annotation-badge item-annotation-badge--set"
          : "item-annotation-badge item-annotation-badge--empty";

        if (icon) {
          btn.textContent = icon;
        }

        btn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();

          const rect = btn.getBoundingClientRect();
          const detail: AnnotationClickDetail = { nodePos: pos, rect };
          window.dispatchEvent(
            new CustomEvent<AnnotationClickDetail>("notesage:annotation-click", { detail })
          );
        });

        return btn;
      },
      {
        side: -1,
        key: `annotation-${pos}-${icon ?? "empty"}`,
        // Prevent ProseMirror from treating this as editable content
        stopEvent: () => true,
      }
    );

    decorations.push(widget);
  });

  if (decorations.length === 0) return DecorationSet.empty;
  return DecorationSet.create(doc, decorations);
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export const ItemAnnotation = Extension.create({
  name: "itemAnnotation",

  /**
   * Extend listItem and taskItem with the `annotation` attribute.
   * `addGlobalAttributes` attaches to existing node types without redefining them.
   */
  addGlobalAttributes() {
    return [
      {
        types: ["listItem", "taskItem"],
        attributes: {
          annotation: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              return element.getAttribute("data-annotation") ?? null;
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              const annotation = attributes.annotation;
              if (!annotation || typeof annotation !== "string") return {};
              return { "data-annotation": annotation };
            },
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: ItemAnnotationPluginKey,
        state: {
          init(_, state) {
            return buildAnnotationDecorations(state.doc);
          },
          apply(tr, value, _old, newState) {
            if (!tr.docChanged) return value;
            return buildAnnotationDecorations(newState.doc);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

// ---------------------------------------------------------------------------
// Public helper — set annotation on a node at a given ProseMirror position
// ---------------------------------------------------------------------------

/**
 * Set the annotation attribute on the listItem/taskItem node at `nodePos`.
 * Pass `null` to clear.
 */
export function setItemAnnotation(
  editor: Editor,
  nodePos: number,
  icon: string | null
): void {
  const node = editor.state.doc.nodeAt(nodePos);
  if (!node) return;
  if (node.type.name !== "listItem" && node.type.name !== "taskItem") return;

  editor.view.dispatch(
    editor.state.tr.setNodeAttribute(
      nodePos,
      "annotation",
      icon ? serializeAnnotation(icon) : null
    )
  );
}

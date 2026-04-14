import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { createDecorationPlugin } from "./decoration-factory";

const TAG_RE = /(?:^|(?:[^\w]))#([a-zA-Z][a-zA-Z0-9_-]*)/g;

export const TagHighlightPluginKey = new PluginKey("tagHighlight");

let tagHighlightCounter = 0;

function buildTagDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    // Skip code blocks entirely
    if (node.type.name === "codeBlock") return false;

    if (!node.isText || !node.text) return;

    // Skip text nodes with a code mark
    if (node.marks.some((m) => m.type.name === "code")) return;

    const text = node.text;
    TAG_RE.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = TAG_RE.exec(text)) !== null) {
      const tagName = match[1];
      const fullMatch = match[0];
      const hashOffset = fullMatch.lastIndexOf("#");
      const from = pos + match.index + hashOffset;
      const to = from + 1 + tagName.length;

      decorations.push(
        Decoration.inline(from, to, {
          class: "tag-badge",
          "data-tag": tagName,
        })
      );
    }
  });

  if (decorations.length === 0) return DecorationSet.empty;
  return DecorationSet.create(doc, decorations);
}

export const TagHighlight = Extension.create({
  name: "tagHighlight",

  addProseMirrorPlugins() {
    return [
      createDecorationPlugin({
        key: TagHighlightPluginKey,
        buildDecorations: (state) => buildTagDecorations(state.doc),
        onRebuild({ docNodeSize, decorationCount, elapsedMs }) {
          tagHighlightCounter++;
          if (tagHighlightCounter % 10 === 0) {
            console.log('[perf:typing]', {
              plugin: 'TagHighlight',
              docNodes: docNodeSize,
              decorationCount,
              ms: elapsedMs,
            });
          }
        },
        handleDOMEvents: {
          mousedown(_view, event) {
            if ((event as MouseEvent).button !== 0) return false;
            const target = (event.target as HTMLElement).closest(
              ".tag-badge"
            ) as HTMLElement | null;
            if (!target) return false;

            const tag = target.getAttribute("data-tag");
            if (!tag) return false;

            event.preventDefault();
            event.stopPropagation();

            window.dispatchEvent(
              new CustomEvent("notesage:open-tag-search", {
                detail: { tag },
              })
            );
            return true;
          },
        },
      }),
    ];
  },
});

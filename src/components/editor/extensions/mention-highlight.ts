import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

const MENTION_RE = /(?:^|(?:[^\w]))@([a-zA-Z][a-zA-Z0-9_-]*)/g;

export const MentionHighlightPluginKey = new PluginKey("mentionHighlight");

function buildMentionDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    // Skip code blocks entirely
    if (node.type.name === "codeBlock") return false;

    if (!node.isText || !node.text) return;

    // Skip text nodes with a code mark
    if (node.marks.some((m) => m.type.name === "code")) return;

    const text = node.text;
    MENTION_RE.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = MENTION_RE.exec(text)) !== null) {
      const mentionName = match[1];
      const fullMatch = match[0];
      const atOffset = fullMatch.lastIndexOf("@");
      const from = pos + match.index + atOffset;
      const to = from + 1 + mentionName.length;

      decorations.push(
        Decoration.inline(from, to, {
          class: "mention-badge",
          "data-mention": mentionName,
        })
      );
    }
  });

  if (decorations.length === 0) return DecorationSet.empty;
  return DecorationSet.create(doc, decorations);
}

export const MentionHighlight = Extension.create({
  name: "mentionHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: MentionHighlightPluginKey,
        state: {
          init(_, state) {
            return buildMentionDecorations(state.doc);
          },
          apply(tr, value) {
            if (!tr.docChanged) return value;
            return buildMentionDecorations(tr.doc);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
          handleDOMEvents: {
            mousedown(_view, event) {
              if (event.button !== 0) return false;
              const target = (event.target as HTMLElement).closest(
                ".mention-badge"
              ) as HTMLElement | null;
              if (!target) return false;

              const mention = target.getAttribute("data-mention");
              if (!mention) return false;

              event.preventDefault();
              event.stopPropagation();

              window.dispatchEvent(
                new CustomEvent("notesage:open-mention-search", {
                  detail: { mention },
                })
              );
              return true;
            },
          },
        },
      }),
    ];
  },
});

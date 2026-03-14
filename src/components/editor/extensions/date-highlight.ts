import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

// Matches //YYYY-MM-DD (with optional leading non-word char)
const DATE_RE = /(?:^|(?:[^\w]))\/\/(\d{4}-\d{2}-\d{2})/g;

export const DateHighlightPluginKey = new PluginKey("dateHighlight");

function buildDateDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    // Skip code blocks entirely
    if (node.type.name === "codeBlock") return false;

    if (!node.isText || !node.text) return;

    // Skip text nodes with a code mark
    if (node.marks.some((m) => m.type.name === "code")) return;

    const text = node.text;
    DATE_RE.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = DATE_RE.exec(text)) !== null) {
      const dateStr = match[1];
      const fullMatch = match[0];
      const slashOffset = fullMatch.indexOf("//");
      const slashFrom = pos + match.index + slashOffset;
      const dateFrom = slashFrom + 2; // after "//"
      const dateTo = dateFrom + dateStr.length;

      // Hide the "//" prefix
      decorations.push(
        Decoration.inline(slashFrom, dateFrom, {
          class: "date-badge-prefix",
        })
      );

      // Style the date portion as a badge
      decorations.push(
        Decoration.inline(dateFrom, dateTo, {
          class: "date-badge",
          "data-date": dateStr,
        })
      );
    }
  });

  if (decorations.length === 0) return DecorationSet.empty;
  return DecorationSet.create(doc, decorations);
}

export const DateHighlight = Extension.create({
  name: "dateHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: DateHighlightPluginKey,
        state: {
          init(_, state) {
            return buildDateDecorations(state.doc);
          },
          apply(tr, value) {
            if (!tr.docChanged) return value;
            return buildDateDecorations(tr.doc);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
          handleDOMEvents: {
            mousedown(view, event) {
              if (event.button !== 0) return false;
              const target = (event.target as HTMLElement).closest(
                ".date-badge"
              ) as HTMLElement | null;
              if (!target) return false;

              const date = target.getAttribute("data-date");
              if (!date) return false;

              event.preventDefault();
              event.stopPropagation();

              // Get bounding rect for positioning the popover
              const rect = target.getBoundingClientRect();

              // Find the exact ProseMirror position of the clicked date
              const posInfo = view.posAtCoords({
                left: event.clientX,
                top: event.clientY,
              });
              let dateFrom = -1;
              let dateTo = -1;
              if (posInfo) {
                const decos = this.getState(view.state) as DecorationSet;
                if (decos) {
                  const found = decos.find(
                    Math.max(0, posInfo.pos - 15),
                    posInfo.pos + 15
                  );
                  for (const deco of found) {
                    if (
                      (
                        deco as Decoration & {
                          type: { attrs: Record<string, string> };
                        }
                      ).type.attrs?.["data-date"] === date
                    ) {
                      dateFrom = deco.from - 2;
                      dateTo = deco.to;
                      break;
                    }
                  }
                }
              }

              window.dispatchEvent(
                new CustomEvent("notesage:open-date-picker", {
                  detail: { date, rect, from: dateFrom, to: dateTo },
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

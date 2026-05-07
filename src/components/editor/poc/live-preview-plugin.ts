/**
 * Live-preview ViewPlugin for the CM6 editor PoC.
 *
 * Walks the Lezer markdown syntax tree on every doc/selection/viewport change
 * and emits two kinds of decorations:
 *
 *   1. Styling marks (cm-md-h1, cm-md-strong, cm-md-em, cm-md-inline-code,
 *      cm-md-link) over the content range — pure CSS.
 *
 *   2. `Decoration.replace` over the markdown syntax markers (#, *, _, `,
 *      [, ](url)) when the cursor is NOT on that line. Cursor-on-line reveals
 *      the markers so they can be edited.
 *
 * Block widgets (callouts) replace the entire blockquote range when the cursor
 * is outside the block. Inside the block, the source markdown is shown.
 *
 * This is the canonical Obsidian "Live Preview" pattern.
 */

import { syntaxTree } from "@codemirror/language";
import { type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { CalloutWidget } from "./callout-widget";

const HIDE = Decoration.replace({});

interface CalloutInfo {
  type: string;
  title: string;
}

function detectCallout(
  view: EditorView,
  blockquoteFrom: number,
  blockquoteTo: number,
): CalloutInfo | null {
  const text = view.state.sliceDoc(blockquoteFrom, blockquoteTo);
  const m = /^>\s*\[!(\w+)\]\s*(.*)/.exec(text);
  if (!m) return null;
  return { type: m[1].toLowerCase(), title: m[2].trim() };
}

function buildDecorations(view: EditorView): DecorationSet {
  const widgets: Range<Decoration>[] = [];
  const cursorPos = view.state.selection.main.head;
  const cursorLine = view.state.doc.lineAt(cursorPos).number;
  const handledBlockquotes = new Set<number>(); // by from-position

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        const startLineObj = view.state.doc.lineAt(node.from);
        const endLineObj = view.state.doc.lineAt(node.to);
        const onCursorLine =
          cursorLine >= startLineObj.number && cursorLine <= endLineObj.number;

        // ---- Block-level: callout (replaces whole blockquote) ----
        if (node.name === "Blockquote") {
          if (handledBlockquotes.has(node.from)) return;
          handledBlockquotes.add(node.from);
          const info = detectCallout(view, node.from, node.to);
          if (info && !onCursorLine) {
            const startLine = view.state.doc.lineAt(node.from);
            const endLine = view.state.doc.lineAt(node.to);
            const text = view.state.sliceDoc(node.from, node.to);
            const lines = text.split("\n");
            const body = lines
              .slice(1)
              .map((l) => l.replace(/^>\s?/, ""))
              .join("\n")
              .trim();
            widgets.push(
              Decoration.replace({
                widget: new CalloutWidget(info.type, info.title, body),
                block: true,
              }).range(startLine.from, endLine.to),
            );
            return false; // don't descend; the whole block is replaced
          }
          // fall through: cursor inside, render normally with mark styling
          widgets.push(
            Decoration.mark({ class: "cm-md-blockquote" }).range(
              node.from,
              node.to,
            ),
          );
          return;
        }

        // ---- Headings ----
        if (/^ATXHeading[1-6]$/.test(node.name)) {
          const level = parseInt(node.name.slice(-1), 10);
          widgets.push(
            Decoration.mark({
              class: `cm-md-heading cm-md-h${level}`,
            }).range(node.from, node.to),
          );
          return;
        }
        if (node.name === "HeaderMark") {
          if (!onCursorLine) {
            // Hide the `#` chars and the trailing space
            const nextChar = view.state.sliceDoc(node.to, node.to + 1);
            const replaceTo = nextChar === " " ? node.to + 1 : node.to;
            widgets.push(HIDE.range(node.from, replaceTo));
          } else {
            widgets.push(
              Decoration.mark({ class: "cm-md-marker" }).range(
                node.from,
                node.to,
              ),
            );
          }
          return;
        }

        // ---- Inline marks ----
        if (node.name === "StrongEmphasis") {
          widgets.push(
            Decoration.mark({ class: "cm-md-strong" }).range(
              node.from,
              node.to,
            ),
          );
          return;
        }
        if (node.name === "Emphasis") {
          widgets.push(
            Decoration.mark({ class: "cm-md-em" }).range(node.from, node.to),
          );
          return;
        }
        if (node.name === "InlineCode") {
          widgets.push(
            Decoration.mark({ class: "cm-md-inline-code" }).range(
              node.from,
              node.to,
            ),
          );
          return;
        }
        if (node.name === "EmphasisMark" || node.name === "CodeMark") {
          if (!onCursorLine) {
            widgets.push(HIDE.range(node.from, node.to));
          } else {
            widgets.push(
              Decoration.mark({ class: "cm-md-marker" }).range(
                node.from,
                node.to,
              ),
            );
          }
          return;
        }

        // ---- Links ----
        if (node.name === "Link") {
          widgets.push(
            Decoration.mark({ class: "cm-md-link" }).range(node.from, node.to),
          );
          if (!onCursorLine) {
            // [text](url) — hide [, ](url)
            const text = view.state.sliceDoc(node.from, node.to);
            const closeBracket = text.indexOf("](");
            const closeParen = text.lastIndexOf(")");
            if (closeBracket > 0 && closeParen > closeBracket) {
              widgets.push(HIDE.range(node.from, node.from + 1));
              widgets.push(
                HIDE.range(
                  node.from + closeBracket,
                  node.from + closeParen + 1,
                ),
              );
            }
          }
          return;
        }

        // ---- Lists: keep ListMark visible; just style ----
        if (node.name === "BulletList" || node.name === "OrderedList") {
          // descend
          return;
        }
      },
    });
  }

  return Decoration.set(widgets, true);
}

export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);
